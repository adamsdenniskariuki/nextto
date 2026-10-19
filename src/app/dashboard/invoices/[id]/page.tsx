import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/invoice-document";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { getMemberships } from "@/lib/auth";
import { getTeamAndServices } from "@/lib/dashboard";
import { formatDateTimeLong } from "@/lib/datetime";
import { publicEnv } from "@/lib/env";
import { getInvoice, getSharedInvoice } from "@/lib/invoices";
import { centsToInput, formatKES } from "@/lib/money";
import { formatKenyanPhone, whatsappLink } from "@/lib/phone";
import { mpesaEnabled } from "@/lib/server-env";
import { MANUAL_PAYMENT_METHODS, statusLabel, vatOptions } from "@/lib/validation/invoices";
import { MpesaRequestForm } from "../../mpesa-request-form";
import { InvoiceEditor } from "../invoice-editor";
import {
  CopyLinkButton,
  DeleteDraftButton,
  IssueButton,
  PaymentForm,
  QuoteActions,
  VoidButton,
} from "./invoice-forms";

export const metadata: Metadata = { title: "Invoice" };

const METHOD_LABEL: Record<string, string> = { ...MANUAL_PAYMENT_METHODS, mpesa: "M-Pesa" };

export default async function InvoicePage({ params }: PageProps<"/dashboard/invoices/[id]">) {
  const { id } = await params;
  // A malformed id would be a Postgres 22P02 error; treat it as missing.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const invoice = await getInvoice(id);
  if (!invoice) notFound(); // RLS hides other businesses' invoices too.

  const membership = (await getMemberships()).find((m) => m.business.id === invoice.business_id);
  if (!membership) notFound();
  const { business, role } = membership;
  const isOwner = role === "owner";
  const isQuote = invoice.kind === "quote";
  const noun = isQuote ? "quote" : "invoice";

  const back = (
    <Link href="/dashboard/invoices" className="text-sm text-muted hover:text-ink">
      ← Invoices
    </Link>
  );
  const bookingLink = invoice.booking_id && (
    <Link
      href={`/dashboard/bookings/${invoice.booking_id}` as Route}
      className="text-sm font-medium underline-offset-4 hover:underline"
    >
      View the booking
    </Link>
  );

  // ---- Drafts: edit, then issue ------------------------------------------
  if (invoice.status === "draft") {
    const team = await getTeamAndServices(business.id);
    return (
      <div className="max-w-3xl space-y-5">
        <div>
          {back}
          <p className="eyebrow mt-3">Draft {noun}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
            {isQuote ? "Quote" : "Invoice"} for {invoice.customer_name}
          </h1>
          {bookingLink && <p className="mt-1">{bookingLink}</p>}
        </div>
        <InvoiceEditor
          // Remount after each save so the rows reflect what the database stored.
          key={invoice.items.map((i) => i.id).join()}
          businessId={business.id}
          invoiceId={invoice.id}
          bookingId={invoice.booking_id ?? undefined}
          kind={invoice.kind}
          customer={{
            id: invoice.customer_id,
            name: invoice.customer_name,
            phone: formatKenyanPhone(invoice.customer_phone),
          }}
          services={team.services}
          vatOptions={vatOptions(invoice.vat_rate_bp)}
          initial={{
            items: invoice.items.map((it) => ({
              description: it.description,
              quantity: String(it.quantity),
              unitPrice: centsToInput(it.unit_price_cents),
            })),
            vatRateBp: invoice.vat_rate_bp,
            deposit: invoice.deposit_cents ? centsToInput(invoice.deposit_cents) : "",
            dueDate: invoice.due_date ?? "",
            notes: invoice.notes ?? "",
          }}
        />
        <section aria-labelledby="issue-heading" className="card space-y-3">
          <h2 id="issue-heading" className="text-lg font-bold">
            Ready to send?
          </h2>
          <p className="text-sm text-muted">
            Save your changes first. Issuing gives the {noun} its number and locks it; after that
            you can share it and take payments.
          </p>
          {invoice.items.length > 0 && <IssueButton invoiceId={invoice.id} isQuote={isQuote} />}
          {isOwner && <DeleteDraftButton invoiceId={invoice.id} />}
        </section>
      </div>
    );
  }

  // ---- Issued documents: view, share, take payments ----------------------
  const doc = await getSharedInvoice(invoice.share_token);
  if (!doc) notFound();
  const shareUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL}/i/${invoice.share_token}`;
  const open = invoice.status === "issued" || invoice.status === "partially_paid";
  const waitingMpesa = invoice.payments.some((p) => p.method === "mpesa" && p.status === "pending");
  const message = isQuote
    ? `Hi ${invoice.customer_name}, here is your quote ${invoice.number} from ${business.name} for ${formatKES(invoice.total_cents)}: ${shareUrl}`
    : `Hi ${invoice.customer_name}, here is invoice ${invoice.number} from ${business.name}. Amount due: ${formatKES(invoice.amount_due_now_cents || invoice.balance_cents)}. View or download: ${shareUrl}`;

  return (
    <div className="space-y-5">
      <div>
        {back}
        <p className="eyebrow mt-3">
          {isQuote ? "Quote" : "Invoice"} · {statusLabel(invoice.kind, invoice.status)}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {invoice.number} for {invoice.customer_name}
        </h1>
        {bookingLink && <p className="mt-1">{bookingLink}</p>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <InvoiceDocument doc={doc} />

        <div className="space-y-6">
          {invoice.status !== "void" && (
            <section aria-labelledby="share-heading" className="card space-y-3">
              <h2 id="share-heading" className="text-lg font-bold">
                Share
              </h2>
              <p className="text-sm text-muted">
                Anyone with the link can view and download this {noun}; it&apos;s unguessable.
              </p>
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs break-all">
                <a
                  href={shareUrl}
                  data-testid="share-url"
                  className="underline-offset-4 hover:underline"
                >
                  {shareUrl}
                </a>
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={whatsappLink(invoice.customer_phone, message)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-mpesa"
                >
                  Send on WhatsApp<span className="sr-only"> (opens in a new tab)</span>
                </a>
                <CopyLinkButton url={shareUrl} />
                <a
                  href={`/dashboard/invoices/${invoice.id}/pdf`}
                  className="btn-secondary"
                  target="_blank"
                  rel="noopener"
                >
                  PDF<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            </section>
          )}

          {isQuote && invoice.status === "issued" && (
            <section aria-labelledby="quote-heading" className="card space-y-3">
              <h2 id="quote-heading" className="text-lg font-bold">
                Customer&apos;s answer
              </h2>
              <QuoteActions invoiceId={invoice.id} />
            </section>
          )}

          {!isQuote && (
            <section aria-labelledby="payments-heading" className="card space-y-4">
              <h2 id="payments-heading" className="text-lg font-bold">
                Payments
              </h2>
              {invoice.payments.length === 0 ? (
                <p className="text-sm text-muted">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {invoice.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 py-2">
                      <span>
                        {METHOD_LABEL[p.method] ?? p.method}
                        {(p.mpesa_receipt ?? p.reference) && (
                          <span className="text-muted"> · {p.mpesa_receipt ?? p.reference}</span>
                        )}
                        <span className="block text-xs text-muted">
                          {formatDateTimeLong(p.paid_at ?? p.created_at, business.timezone)}
                          {p.status !== "succeeded" && ` · ${p.status}`}
                        </span>
                      </span>
                      <span
                        data-status={p.status}
                        className="font-semibold tabular-nums data-[status=succeeded]:text-mpesa data-[status=failed]:text-muted data-[status=failed]:line-through data-[status=cancelled]:text-muted data-[status=cancelled]:line-through"
                      >
                        {formatKES(p.amount_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {open && (
                <>
                  {invoice.amount_due_now_cents !== invoice.balance_cents && (
                    <p className="text-sm">
                      Deposit due now: <strong>{formatKES(invoice.amount_due_now_cents)}</strong>
                    </p>
                  )}
                  {waitingMpesa ? (
                    <RefreshWhilePending label="Waiting for the customer to enter their M-Pesa PIN…" />
                  ) : mpesaEnabled() ? (
                    <MpesaRequestForm
                      invoiceId={invoice.id}
                      phone={formatKenyanPhone(invoice.customer_phone)}
                      // M-Pesa takes whole shillings: suggest the due amount without cents.
                      suggestedAmount={centsToInput(
                        Math.floor(invoice.amount_due_now_cents / 100) * 100,
                      )}
                    />
                  ) : (
                    <p className="text-xs text-muted">
                      M-Pesa isn&apos;t configured on this server (see docs/SETUP.md).
                    </p>
                  )}
                  <details className="border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Record a cash, card or bank payment
                    </summary>
                    <div className="mt-3">
                      <PaymentForm
                        invoiceId={invoice.id}
                        suggested={centsToInput(invoice.balance_cents)}
                      />
                    </div>
                  </details>
                </>
              )}
            </section>
          )}

          {isOwner && !isQuote && open && invoice.amount_paid_cents === 0 && (
            <section aria-label="Void" className="card">
              <VoidButton invoiceId={invoice.id} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
