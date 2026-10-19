import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { InvoiceDocument } from "@/components/invoice-document";
import { Logo } from "@/components/logo";
import { getSharedInvoice } from "@/lib/invoices";
import { formatKES } from "@/lib/money";

/**
 * /i/[token]: the customer's view of an invoice or quote.
 *
 * The share token is a random UUID: a "capability URL". Holding the link IS
 * the permission, so it's safe to send on WhatsApp, but it must never be
 * indexed by search engines (robots: noindex) or cached publicly. Rendered
 * per request because payment status changes.
 */
export const dynamic = "force-dynamic";

async function load(params: PageProps<"/i/[token]">["params"]) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) return null;
  return getSharedInvoice(token);
}

export async function generateMetadata({ params }: PageProps<"/i/[token]">): Promise<Metadata> {
  const doc = await load(params);
  const robots = { index: false, follow: false };
  if (!doc) return { title: "Document not found", robots };
  const kind = doc.invoice.kind === "quote" ? "Quote" : "Invoice";
  return {
    title: `${kind} ${doc.invoice.number} from ${doc.business.name}`,
    description: `${kind} for ${formatKES(doc.invoice.total_cents)}.`,
    robots,
  };
}

export default async function SharedInvoicePage({ params }: PageProps<"/i/[token]">) {
  const doc = await load(params);
  if (!doc) notFound();
  const { token } = await params;
  const { invoice } = doc;
  const open = invoice.status === "issued" || invoice.status === "partially_paid";

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-10">
      <main className="space-y-5">
        {invoice.kind === "invoice" && open && (
          <p className="card flex flex-wrap items-center justify-between gap-3 bg-brand-soft">
            <span>
              <span className="block text-sm text-muted">Balance due</span>
              <strong className="text-2xl font-extrabold">
                {formatKES(invoice.balance_cents)}
              </strong>
            </span>
            <span className="text-sm text-muted">
              Pay by M-Pesa, cash or bank transfer. Quote {invoice.number} as the reference.
            </span>
          </p>
        )}
        <InvoiceDocument doc={doc} headingLevel="h1" />
        <p>
          <a href={`/i/${token}/pdf`} className="btn-secondary">
            Download PDF
          </a>
        </p>
      </main>
      <footer className="flex items-center gap-2 text-xs text-muted">
        Sent with <Logo className="h-4" />
      </footer>
    </div>
  );
}
