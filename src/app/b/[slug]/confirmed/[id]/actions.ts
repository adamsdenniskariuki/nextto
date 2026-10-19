"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PayState } from "@/components/pay-with-mpesa";
import { requestStkPush } from "@/lib/mpesa/request";

/**
 * Guest: pay a booking's deposit with M-Pesa.
 *
 * There is no login, so the unguessable booking id is the capability (the
 * same secret that shows this page). What a guest can do with it is narrow:
 * prepare_mpesa_request only allows the deposit amount, only to the phone the
 * booking was made with, at most one waiting prompt and five per hour.
 */
export async function payDepositWithMpesa(_prev: PayState, formData: FormData): Promise<PayState> {
  const bookingId = z.uuid().safeParse(formData.get("bookingId"));
  if (!bookingId.success) return { status: "error", message: "That booking link isn't valid." };

  const result = await requestStkPush({ target: { bookingId: bookingId.data } });
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/b/[slug]/confirmed/[id]", "page");
  return { status: "ok", message: "Check your phone and enter your M-Pesa PIN." };
}
