/**
 * Pure helpers for Safaricom's Daraja M-Pesa Express (STK push) API. No I/O
 * and no secrets here, so Vitest can test every rule directly. The network
 * calls live in ./daraja.ts.
 */
import { z } from "zod";

/**
 * Daraja timestamps are "YYYYMMDDHHmmss" in Kenyan time. Intl formats the
 * instant in Africa/Nairobi, whatever time zone the server runs in (Vercel
 * runs in UTC).
 */
export function darajaTimestamp(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

/** The STK push Password: base64(Shortcode + Passkey + Timestamp). */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/**
 * E.164 "+254712345678" -> Daraja's "254712345678". Only Kenyan mobiles
 * (07xx / 01xx) can receive an STK prompt; anything else is null.
 */
export function toDarajaPhone(e164: string): string | null {
  const m = /^\+254([17]\d{8})$/.exec(e164);
  return m ? `254${m[1]}` : null;
}

/** Daraja's Amount is whole shillings. Callers pass cents already rounded by SQL. */
export function centsToWholeShillings(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 100 || cents % 100 !== 0) {
    throw new RangeError(`M-Pesa needs whole shillings, got ${cents} cents`);
  }
  return cents / 100;
}

/** AccountReference: at most 12 letters/digits. TransactionDesc: at most 13. */
export function darajaText(text: string, max: number): string {
  return text.replace(/[^A-Za-z0-9 ]/g, "").slice(0, max) || "Nextto";
}

// ---------------------------------------------------------------------------
// The callback Safaricom POSTs to CallBackURL.
// ---------------------------------------------------------------------------

const metadataItem = z.object({
  Name: z.string(),
  // Value is a number (Amount, PhoneNumber, TransactionDate) or a string
  // (MpesaReceiptNumber); Balance has no Value at all.
  Value: z.union([z.number(), z.string()]).optional(),
});

/**
 * Validates the shape before anything touches the database. `.loose()` keeps
 * unknown keys: the raw payload is stored for audit, and Safaricom adds fields
 * from time to time.
 */
export const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z
      .object({
        MerchantRequestID: z.string().min(1).max(100),
        CheckoutRequestID: z.string().min(1).max(100),
        ResultCode: z.number().int(),
        ResultDesc: z.string().max(500),
        CallbackMetadata: z.object({ Item: z.array(metadataItem).max(20) }).optional(),
      })
      .loose(),
  }),
});

export type StkCallback = z.infer<typeof stkCallbackSchema>;

/** Builds a callback exactly like Safaricom's, for the mock mode and tests. */
export function buildStkCallback(input: {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  amountKes?: number;
  phone?: string; // Daraja format, 2547XXXXXXXX
  receipt?: string;
  at?: Date;
}): StkCallback {
  const success = input.resultCode === 0;
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: input.merchantRequestId,
        CheckoutRequestID: input.checkoutRequestId,
        ResultCode: input.resultCode,
        ResultDesc: success
          ? "The service request is processed successfully."
          : input.resultCode === 1032
            ? "Request cancelled by user"
            : "The balance is insufficient for the transaction.",
        ...(success && {
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: input.amountKes ?? 1 },
              { Name: "MpesaReceiptNumber", Value: input.receipt ?? "NXTMOCK000" },
              { Name: "TransactionDate", Value: Number(darajaTimestamp(input.at)) },
              { Name: "PhoneNumber", Value: Number(input.phone ?? "254708374149") },
            ],
          },
        }),
      },
    },
  };
}

/**
 * Mock mode outcome from the phone number, so demos and tests can choose:
 * ending in 1032 -> the customer cancels; ending in 0001 -> insufficient
 * funds (1); anything else -> paid.
 */
export function mockResultCode(darajaPhone: string): number {
  if (darajaPhone.endsWith("1032")) return 1032;
  if (darajaPhone.endsWith("0001")) return 1;
  return 0;
}

/** A plausible receipt such as "NXT4K9Q2ZA" (10 upper-case characters). */
export function mockReceipt(random: () => number = Math.random): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "NXT";
  for (let i = 0; i < 7; i++) out += chars[Math.floor(random() * chars.length)];
  return out;
}

/** Friendly words for the result codes customers actually hit. */
export function resultMessage(status: string, resultDesc?: string | null): string {
  switch (status) {
    case "succeeded":
      return "Paid";
    case "cancelled":
      return "The customer cancelled the M-Pesa prompt";
    case "pending":
      return "Waiting for the customer to enter their M-Pesa PIN";
    default:
      return resultDesc ? `Not paid: ${resultDesc}` : "Not paid";
  }
}
