"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import type { FormState } from "@/app/dashboard/bookings/actions";
import { getMemberships, requireUser } from "@/lib/auth";
import { customerIdFor } from "@/lib/customers";
import { quantityToString } from "@/lib/invoice-math";
import { formatKES } from "@/lib/money";
import {
  documentActionSchema,
  invoiceDraftSchema,
  manualPaymentSchema,
} from "@/lib/validation/invoices";
import { fieldErrors } from "@/lib/validation/schemas";
import { z } from "zod";

/** Postgres SQLSTATE -> a message the owner can act on. */
function dbError(error: PostgrestError): FormState {
  switch (error.code) {
    case "22023": // invalid_parameter_value: our functions explain themselves
    case "23514": // check_violation
    case "55000": // object_not_in_prerequisite_state: wrong status for this step
      return { status: "error", errors: { _form: error.message } };
    case "P0002":
      return { status: "error", errors: { _form: "That document no longer exists." } };
    case "42501":
      return { status: "error", errors: { _form: "You don't have permission to do that." } };
    default:
      console.error("invoice action failed", error);
      return { status: "error", errors: { _form: "Something went wrong. Please try again." } };
  }
}

const stringValues = (formData: FormData) =>
  Object.fromEntries([...formData].map(([k, v]) => [k, String(v)]));

const withValues = (state: FormState, values: Record<string, string>): FormState =>
  state.status === "error" ? { ...state, values } : state;

const invoicePath = (id: string) => `/dashboard/invoices/${id}` as Route;

function revalidateInvoices() {
  revalidatePath("/dashboard", "layout");
}

/** Create or update a draft: the invoice row and all its items, atomically. */
export async function saveDraft(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = stringValues(formData);
  const parsed = invoiceDraftSchema.safeParse(values);
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error), values };
  const input = parsed.data;

  const isMember = (await getMemberships()).some((m) => m.business.id === input.businessId);
  if (!isMember) return { status: "error", errors: { _form: "Business not found." }, values };

  let customerId = input.customerId;
  if (!customerId) {
    const found = await customerIdFor(input.businessId, input.customerPhone!, input.customerName!);
    if ("error" in found) return withValues(dbError(found.error), values);
    customerId = found.id;
  }

  const { supabase } = await requireUser();
  const { data: id, error } = await supabase.rpc("save_invoice_draft", {
    p_business_id: input.businessId,
    // The generated Args type can't express "nullable without a default";
    // SQL NULL here means "create a new draft".
    p_invoice_id: input.invoiceId ?? (null as unknown as string),
    p_kind: input.kind,
    p_customer_id: customerId,
    // Quantities go as JSON numbers built from exact decimal strings ("1.5").
    p_items: input.items.map((it) => ({
      description: it.description,
      quantity: Number(quantityToString(it.quantity)),
      unit_price_cents: it.unitPrice,
    })),
    p_vat_rate_bp: input.vatRateBp,
    p_deposit_cents: input.deposit,
    ...(input.dueDate ? { p_due_date: input.dueDate } : {}),
    ...(input.notes ? { p_notes: input.notes } : {}),
    ...(input.bookingId ? { p_booking_id: input.bookingId } : {}),
  });
  if (error) return withValues(dbError(error), values);
  revalidateInvoices();
  if (!input.invoiceId) redirect(invoicePath(id));
  return { status: "ok", message: "Draft saved." };
}

/** Draft -> issued: assigns the next gapless number (INV-2026-0001). */
export async function issueInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = documentActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("issue_invoice", {
    p_invoice_id: parsed.data.invoiceId,
  });
  if (error) return dbError(error);
  revalidateInvoices();
  return { status: "ok", message: `Issued as ${data.number}.` };
}

export async function deleteDraft(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = documentActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const { supabase } = await requireUser();
  // RLS: only owners may delete, and only drafts. A filtered-out row is just
  // "0 rows deleted", so ask for the row back to tell the difference.
  const { data, error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", parsed.data.invoiceId)
    .select("id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) {
    return { status: "error", errors: { _form: "Only the owner can delete drafts." } };
  }
  revalidateInvoices();
  redirect("/dashboard/invoices?show=draft" as Route);
}

export async function voidInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = documentActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: parsed.data.invoiceId });
  if (error) return dbError(error);
  revalidateInvoices();
  return { status: "ok", message: "Voided. The number stays used, so the sequence has no gaps." };
}

/** Cash, bank or card. The payments trigger locks the invoice and updates its balance. */
export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = stringValues(formData);
  const parsed = manualPaymentSchema.safeParse(values);
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error), values };
  const input = parsed.data;
  const { supabase, userId } = await requireUser();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("business_id")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (!invoice) return { status: "error", errors: { _form: "That invoice no longer exists." } };

  const { error } = await supabase.from("payments").insert({
    business_id: invoice.business_id,
    invoice_id: input.invoiceId,
    method: input.method,
    status: "succeeded",
    amount_cents: input.amount,
    reference: input.reference ?? null,
    created_by: userId,
  });
  if (error) return withValues(dbError(error), values);
  revalidateInvoices();
  return { status: "ok", message: `Recorded ${formatKES(input.amount)}.` };
}

/** From a booking page. Idempotent: an existing invoice for the booking is reused. */
export async function createInvoiceFromBooking(formData: FormData): Promise<void> {
  const bookingId = z.uuid().parse(formData.get("bookingId"));
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_invoice_from_booking", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(error.message);
  revalidateInvoices();
  redirect(invoicePath(data));
}

export async function convertQuote(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = documentActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("convert_quote_to_invoice", {
    p_quote_id: parsed.data.invoiceId,
  });
  if (error) return dbError(error);
  revalidateInvoices();
  redirect(invoicePath(data));
}

export async function declineQuote(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = documentActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("decline_quote", { p_quote_id: parsed.data.invoiceId });
  if (error) return dbError(error);
  revalidateInvoices();
  return { status: "ok", message: "Marked as declined." };
}
