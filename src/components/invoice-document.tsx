import { formatDayShort } from "@/lib/datetime";
import { formatVatRate } from "@/lib/invoice-math";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone } from "@/lib/phone";
import { statusLabel, type SharedInvoice } from "@/lib/validation/invoices";

/**
 * The invoice / quote as an HTML document. A Server Component with no
 * interactivity, shared by the dashboard and the public /i/[token] page, and
 * laid out like the PDF so both read the same.
 */
export function InvoiceDocument({
  doc,
  headingLevel = "h2",
}: {
  doc: SharedInvoice;
  /** h1 on the public page, h2 inside the dashboard (which has its own h1). */
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  const { invoice: inv, business: biz, customer, items } = doc;
  const isQuote = inv.kind === "quote";

  return (
    <article className="card space-y-6" aria-labelledby="doc-title">
      <header className="flex flex-wrap justify-between gap-4">
        <div className="text-sm">
          <p className="text-lg font-extrabold">{biz.name}</p>
          {biz.address && <p className="text-muted">{biz.address}</p>}
          {biz.phone && <p className="text-muted">{formatKenyanPhone(biz.phone)}</p>}
          {biz.email && <p className="text-muted">{biz.email}</p>}
          {biz.kra_pin && <p className="text-muted">KRA PIN: {biz.kra_pin}</p>}
        </div>
        <div className="text-right text-sm">
          <Heading id="doc-title" className="text-2xl font-extrabold text-brand">
            {isQuote ? "Quote" : "Invoice"}
          </Heading>
          <p className="font-semibold" data-testid="doc-number">
            {inv.number}
          </p>
          <p className="text-muted">Date: {formatDayShort(inv.issue_date)}</p>
          {inv.due_date && (
            <p className="text-muted">
              {isQuote ? "Valid until" : "Due"}: {formatDayShort(inv.due_date)}
            </p>
          )}
          <p className="mt-1">
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold">
              {statusLabel(inv.kind, inv.status)}
            </span>
          </p>
        </div>
      </header>

      <div className="text-sm">
        <p className="eyebrow">{isQuote ? "Prepared for" : "Bill to"}</p>
        <p className="font-semibold">{customer.name}</p>
        <p>{formatKenyanPhone(customer.phone)}</p>
        {customer.email && <p>{customer.email}</p>}
      </div>

      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[28rem] text-sm tabular-nums">
          <caption className="sr-only">Line items</caption>
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th scope="col" className="py-2 pr-2 font-semibold">
                Description
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">
                Qty
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">
                Unit price
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2 pr-2">{it.description}</td>
                <td className="py-2 pr-2 text-right">{String(it.quantity)}</td>
                <td className="py-2 pr-2 text-right">{formatKES(it.unit_price_cents)}</td>
                <td className="py-2 text-right">{formatKES(it.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatKES(inv.subtotal_cents)}</dd>
        {inv.vat_rate_bp > 0 && (
          <>
            <dt>VAT {formatVatRate(inv.vat_rate_bp)}</dt>
            <dd className="text-right">{formatKES(inv.vat_cents)}</dd>
          </>
        )}
        <dt className="mt-1 border-t-2 border-ink pt-1 font-bold">Total</dt>
        <dd className="mt-1 border-t-2 border-ink pt-1 text-right font-bold">
          {formatKES(inv.total_cents)}
        </dd>
        {!isQuote && inv.amount_paid_cents > 0 && (
          <>
            <dt>Paid</dt>
            <dd className="text-right text-mpesa">−{formatKES(inv.amount_paid_cents)}</dd>
          </>
        )}
        {!isQuote && (
          <>
            <dt className="font-bold">Balance due</dt>
            <dd className="text-right font-bold" data-testid="doc-balance">
              {formatKES(Math.max(inv.balance_cents, 0))}
            </dd>
          </>
        )}
        {inv.deposit_cents > 0 && (
          <>
            <dt className="text-muted">{isQuote ? "Deposit to confirm" : "Deposit requested"}</dt>
            <dd className="text-right text-muted">{formatKES(inv.deposit_cents)}</dd>
          </>
        )}
      </dl>

      {inv.notes && (
        <div className="text-sm">
          <p className="eyebrow">Notes</p>
          <p className="whitespace-pre-line">{inv.notes}</p>
        </div>
      )}
      {biz.invoice_footer && <p className="text-xs text-muted">{biz.invoice_footer}</p>}
    </article>
  );
}
