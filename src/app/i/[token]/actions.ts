"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PayState } from "@/components/pay-with-mpesa";
import { getSharedInvoice } from "@/lib/invoices";
import { requestStkPush } from "@/lib/mpesa/request";

/**
 * Customer: pay a shared invoice with M-Pesa. The share token is the
 * capability; it resolves to the invoice through the same anon function that
 * renders the page. SQL then decides the amount (deposit or balance) and the
 * phone (the customer's, on file).
 */
export async function payInvoiceWithMpesa(_prev: PayState, formData: FormData): Promise<PayState> {
  const token = z.uuid().safeParse(formData.get("token"));
  if (!token.success) return { status: "error", message: "That invoice link isn't valid." };
  const doc = await getSharedInvoice(token.data);
  if (!doc) return { status: "error", message: "That invoice no longer exists." };

  const result = await requestStkPush({ target: { invoiceId: doc.invoice.id } });
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/i/[token]", "page");
  return { status: "ok", message: "Check your phone and enter your M-Pesa PIN." };
}
