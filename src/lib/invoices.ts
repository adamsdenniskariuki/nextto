import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/anon";
import {
  invoiceSummarySchema,
  sharedInvoiceSchema,
  type InvoiceFilter,
  type SharedInvoice,
} from "@/lib/validation/invoices";

/**
 * Invoice reads. Dashboard reads run as the signed-in user (RLS limits them
 * to their businesses); the shared document is read as `anon` through the
 * get_shared_invoice() capability function.
 */

export async function listInvoices(businessId: string, filter: InvoiceFilter) {
  const { supabase } = await requireUser();
  let query = supabase
    .from("invoice_summaries")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);

  switch (filter) {
    case "unpaid":
      query = query.eq("kind", "invoice").in("status", ["issued", "partially_paid"]);
      break;
    case "overdue":
      query = query.eq("is_overdue", true);
      break;
    case "draft":
      query = query.eq("status", "draft");
      break;
    case "paid":
      query = query.eq("status", "paid");
      break;
    case "quotes":
      query = query.eq("kind", "quote");
      break;
  }

  const { data, error } = await query;
  if (error) throw error;
  return invoiceSummarySchema.array().parse(data);
}

/** One invoice for the dashboard: summary, editable fields, items and payments. */
export const getInvoice = cache(async (id: string) => {
  const { supabase } = await requireUser();
  const [summary, invoice, items, payments] = await Promise.all([
    supabase.from("invoice_summaries").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("invoices")
      .select(
        "vat_rate_bp, subtotal_cents, vat_cents, due_date, notes, share_token, issued_at, created_by",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("invoice_items")
      .select("id, description, quantity, unit_price_cents, line_total_cents")
      .eq("invoice_id", id)
      .order("sort_order"),
    supabase
      .from("payments")
      .select("id, method, status, amount_cents, reference, mpesa_receipt, paid_at, created_at")
      .eq("invoice_id", id)
      .order("created_at"),
  ]);
  for (const r of [summary, invoice, items, payments]) if (r.error) throw r.error;
  if (!summary.data || !invoice.data) return null;
  return {
    ...invoiceSummarySchema.parse(summary.data),
    ...invoice.data,
    items: items.data ?? [],
    payments: payments.data ?? [],
  };
});

export type InvoiceWithDetails = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** VAT defaults for new documents, from the business settings. */
export const getInvoiceSettings = cache(async (businessId: string) => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("businesses")
    .select("vat_registered, vat_rate_bp")
    .eq("id", businessId)
    .single();
  if (error) throw error;
  return { defaultVatRateBp: data.vat_registered ? data.vat_rate_bp : 0 };
});

/** The customer-facing document. Drafts are never shared, so they return null. */
export const getSharedInvoice = cache(async (token: string): Promise<SharedInvoice | null> => {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_shared_invoice", { p_share_token: token });
  if (error) throw error;
  return data === null ? null : sharedInvoiceSchema.parse(data);
});
