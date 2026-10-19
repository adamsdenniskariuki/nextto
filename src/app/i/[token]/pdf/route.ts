import { z } from "zod";
import { getSharedInvoice } from "@/lib/invoices";
import { invoicePdfResponse } from "@/lib/pdf/response";

/**
 * GET /i/[token]/pdf: the public PDF. The unguessable share token is the
 * capability; get_shared_invoice() refuses drafts.
 */
export async function GET(_req: Request, ctx: RouteContext<"/i/[token]/pdf">) {
  const { token } = await ctx.params;
  if (!z.uuid().safeParse(token).success) return new Response("Not found", { status: 404 });
  const doc = await getSharedInvoice(token);
  if (!doc) return new Response("Not found", { status: 404 });
  return invoicePdfResponse(doc);
}
