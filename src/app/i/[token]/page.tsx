import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { InvoiceDocument } from "@/components/invoice-document";
import { Logo } from "@/components/logo";
import { PayWithMpesaButton } from "@/components/pay-with-mpesa";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { getSharedInvoice } from "@/lib/invoices";
import { formatKES } from "@/lib/money";
import { latestMpesaAttempt } from "@/lib/mpesa/request";
import { mpesaEnabled } from "@/lib/server-env";
import { payInvoiceWithMpesa } from "./actions";

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
  const canPay = invoice.kind === "invoice" && open && mpesaEnabled();
  const attempt = canPay ? await latestMpesaAttempt({ invoiceId: invoice.id }) : null;
  // What the prompt asks for: the rest of the deposit first, then the balance,
  // in whole shillings (prepare_mpesa_request applies the same rule).
  const depositLeft = invoice.deposit_cents - invoice.amount_paid_cents;
  const dueNow =
    depositLeft > 0 ? Math.min(depositLeft, invoice.balance_cents) : invoice.balance_cents;
  const dueNowKes = Math.floor(dueNow / 100) * 100;

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
        {canPay && dueNowKes >= 100 && (
          <section aria-label="Pay with M-Pesa" className="card space-y-2">
            {attempt?.status === "pending" ? (
              <RefreshWhilePending
                label={`Check your phone${attempt.phone_last3 ? ` (ending ${attempt.phone_last3})` : ""} and enter your M-Pesa PIN…`}
              />
            ) : (
              <>
                {attempt?.status === "succeeded" && attempt.receipt && (
                  <p className="text-sm text-mpesa">
                    Received {formatKES(attempt.amount_cents)}, receipt{" "}
                    <strong data-testid="mpesa-receipt">{attempt.receipt}</strong>. Thank you.
                  </p>
                )}
                {(attempt?.status === "cancelled" || attempt?.status === "failed") && (
                  <p className="text-sm">
                    {attempt.status === "cancelled"
                      ? "The last M-Pesa prompt was cancelled."
                      : `The last M-Pesa prompt didn't go through${attempt.result_desc ? `: ${attempt.result_desc}` : "."}`}{" "}
                    You can try again.
                  </p>
                )}
                <PayWithMpesaButton
                  action={payInvoiceWithMpesa}
                  fieldName="token"
                  fieldValue={token}
                  label={`Pay ${formatKES(dueNowKes)} with M-Pesa`}
                />
                <p className="text-xs text-muted">
                  The prompt goes to the phone number {doc.business.name} has on file for you.
                </p>
              </>
            )}
          </section>
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
