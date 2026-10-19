import { z } from "zod";
import { getInvoice, getSharedInvoice } from "@/lib/invoices";
import { invoicePdfResponse } from "@/lib/pdf/response";

/**
 * GET /dashboard/invoices/[id]/pdf: the same document for signed-in staff.
 * getInvoice() runs under RLS, so it only finds the user's own businesses'
 * invoices; the PDF is then built from the shared document.
 */
export async function GET(_req: Request, ctx: RouteContext<"/dashboard/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const invoice = await getInvoice(id);
  if (!invoice || invoice.status === "draft") return new Response("Not found", { status: 404 });
  const doc = await getSharedInvoice(invoice.share_token);
  if (!doc) return new Response("Not found", { status: 404 });
  return invoicePdfResponse(doc);
}
