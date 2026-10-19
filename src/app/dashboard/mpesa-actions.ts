"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/dashboard/bookings/actions";
import { requireUser } from "@/lib/auth";
import { requestStkPush } from "@/lib/mpesa/request";
import { mpesaRequestSchema } from "@/lib/validation/invoices";
import { fieldErrors } from "@/lib/validation/schemas";

/**
 * Staff: send an M-Pesa STK push for an invoice or a booking deposit.
 *
 * Authorisation is the interesting part. The SQL functions that create the
 * request are granted to service_role only, so first we read the target as
 * the signed-in user: RLS returns the row only to members of its business.
 * Having proved that, the service-role client does the rest.
 */
export async function requestMpesaPayment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = Object.fromEntries([...formData].map(([k, v]) => [k, String(v)]));
  const parsed = mpesaRequestSchema.safeParse(values);
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error), values };
  const { invoiceId, bookingId, phone, amount } = parsed.data;

  const { supabase, userId } = await requireUser();
  const visible = invoiceId
    ? await supabase.from("invoices").select("id").eq("id", invoiceId).maybeSingle()
    : await supabase.from("bookings").select("id").eq("id", bookingId!).maybeSingle();
  if (visible.error || !visible.data) {
    return { status: "error", errors: { _form: "That no longer exists." }, values };
  }

  const result = await requestStkPush({
    target: invoiceId ? { invoiceId } : { bookingId: bookingId! },
    phone,
    createdBy: userId,
    ...(amount !== undefined ? { amountCents: amount } : {}),
  });
  if (!result.ok) {
    return { status: "error", errors: { [result.field ?? "_form"]: result.error }, values };
  }
  revalidatePath("/dashboard", "layout");
  return { status: "ok", message: result.message };
}
