import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf, pdfFilename } from "@/lib/pdf/invoice-pdf";
import type { SharedInvoice } from "@/lib/validation/invoices";

/**
 * Renders the document to a PDF Response. `inline` opens it in the browser's
 * viewer (and still lets people save it with the right file name).
 */
export async function invoicePdfResponse(doc: SharedInvoice): Promise<Response> {
  const pdf = await renderToBuffer(<InvoicePdf doc={doc} />);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFilename(doc)}"`,
      // Payment status changes, so never serve a stale copy.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
