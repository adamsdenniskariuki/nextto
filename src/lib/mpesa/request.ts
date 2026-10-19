import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { MpesaError, stkPush } from "./daraja";
import { centsToWholeShillings, toDarajaPhone } from "./format";

/**
 * Ask a customer's phone for money: the one path every M-Pesa button uses.
 *
 *   1. prepare_mpesa_request (SQL): is this allowed, how much, which phone?
 *   2. Daraja STK push: the customer's phone shows "Enter M-Pesa PIN".
 *   3. create_mpesa_payment (SQL): a 'pending' payment keyed by the
 *      CheckoutRequestID. The callback route settles it later.
 *
 * Callers authorise first (dashboard: membership under RLS; guests: the
 * unguessable booking id or share token). This module uses the service role.
 */

export type MpesaTarget = { invoiceId: string } | { bookingId: string };

export type MpesaRequestResult =
  { ok: true; message: string } | { ok: false; error: string; field?: "phone" | "amount" };

const preparedSchema = z.object({
  business_id: z.uuid(),
  invoice_id: z.uuid().nullable(),
  booking_id: z.uuid().nullable(),
  amount_cents: z.number().int().positive(),
  phone: z.string(),
  account_reference: z.string(),
  description: z.string(),
});

function sqlMessage(error: PostgrestError): MpesaRequestResult {
  switch (error.code) {
    case "22023":
      return { ok: false, error: error.message, field: "amount" };
    case "55000":
      return { ok: false, error: `${error.message}.` };
    case "23505": // a racing request won the one-pending-prompt unique index
      return { ok: false, error: "An M-Pesa request is already waiting on the customer's phone." };
    case "P0002":
      return { ok: false, error: "That no longer exists." };
    default:
      console.error("M-Pesa request failed", error);
      return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function requestStkPush(input: {
  target: MpesaTarget;
  /** Optional: staff can ask for part of the balance. Guests never pass this. */
  amountCents?: number;
  /** Optional E.164 override (staff only). Guests always use the phone on file. */
  phone?: string;
  createdBy?: string;
}): Promise<MpesaRequestResult> {
  const admin = createAdminClient();
  const target =
    "invoiceId" in input.target
      ? { p_invoice_id: input.target.invoiceId }
      : { p_booking_id: input.target.bookingId };

  const prep = await admin.rpc("prepare_mpesa_request", {
    ...target,
    ...(input.amountCents !== undefined ? { p_amount_cents: input.amountCents } : {}),
  });
  if (prep.error) return sqlMessage(prep.error);
  const prepared = preparedSchema.parse(prep.data);

  const e164 = input.phone ?? prepared.phone;
  const darajaPhone = toDarajaPhone(e164);
  if (!darajaPhone) {
    return {
      ok: false,
      field: "phone",
      error: "M-Pesa needs a Kenyan mobile number, such as 0712 345 678.",
    };
  }

  let ids;
  try {
    ids = await stkPush({
      phone: darajaPhone,
      amountKes: centsToWholeShillings(prepared.amount_cents),
      accountReference: prepared.account_reference,
      description: prepared.description,
    });
  } catch (error) {
    if (error instanceof MpesaError) {
      return { ok: false, error: `M-Pesa didn't accept the request: ${error.message}` };
    }
    console.error("STK push failed", error);
    return { ok: false, error: "Couldn't reach M-Pesa. Please try again in a moment." };
  }

  const created = await admin.rpc("create_mpesa_payment", {
    p_business_id: prepared.business_id,
    p_amount_cents: prepared.amount_cents,
    p_phone: e164,
    p_checkout_request_id: ids.checkoutRequestId,
    p_merchant_request_id: ids.merchantRequestId,
    ...(prepared.invoice_id ? { p_invoice_id: prepared.invoice_id } : {}),
    ...(prepared.booking_id ? { p_booking_id: prepared.booking_id } : {}),
    ...(input.createdBy ? { p_created_by: input.createdBy } : {}),
  });
  if (created.error) return sqlMessage(created.error);

  return {
    ok: true,
    message: `Sent an M-Pesa request for ${formatKES(prepared.amount_cents)} to ${formatKenyanPhone(e164)}.`,
  };
}

const attemptSchema = z.object({
  status: z.enum(["pending", "succeeded", "failed", "cancelled"]),
  amount_cents: z.number().int(),
  receipt: z.string().nullable(),
  result_desc: z.string().nullable(),
  phone_last3: z.string().nullable(),
  created_at: z.string(),
});

export type MpesaAttempt = z.infer<typeof attemptSchema>;

/** The latest prompt for an invoice or booking, for guest pages (service role). */
export async function latestMpesaAttempt(target: MpesaTarget): Promise<MpesaAttempt | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "latest_mpesa_attempt",
    "invoiceId" in target ? { p_invoice_id: target.invoiceId } : { p_booking_id: target.bookingId },
  );
  if (error) throw error;
  return data === null ? null : attemptSchema.parse(data);
}
