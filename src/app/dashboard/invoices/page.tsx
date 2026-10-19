import type { Metadata, Route } from "next";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/auth";
import { formatDayShort, localDay } from "@/lib/datetime";
import { listInvoices } from "@/lib/invoices";
import { formatKES } from "@/lib/money";
import {
  INVOICE_FILTERS,
  invoiceListQuerySchema,
  statusLabel,
  type InvoiceFilter,
  type InvoiceSummary,
} from "@/lib/validation/invoices";

export const metadata: Metadata = { title: "Invoices" };

const EMPTY: Record<InvoiceFilter, string> = {
  all: "No invoices or quotes yet. Create one, or start from a booking.",
  unpaid: "Nothing outstanding. Everyone has paid.",
  overdue: "Nothing overdue.",
  draft: "No drafts.",
  paid: "No paid invoices yet.",
  quotes: "No quotes yet.",
};

function dueText(inv: InvoiceSummary, tz: string): string {
  if (inv.status === "draft")
    return `Created ${formatDayShort(localDay(new Date(inv.created_at), tz))}`;
  if (inv.is_overdue)
    return `${inv.days_overdue} ${inv.days_overdue === 1 ? "day" : "days"} overdue`;
  if (inv.due_date && (inv.status === "issued" || inv.status === "partially_paid"))
    return `Due ${formatDayShort(inv.due_date)}`;
  return inv.issue_date ? formatDayShort(inv.issue_date) : "";
}

export default async function InvoicesPage({ searchParams }: PageProps<"/dashboard/invoices">) {
  const { show } = invoiceListQuerySchema.parse(await searchParams);
  const { business } = await getCurrentMembership();
  const invoices = await listInvoices(business.id, show);
  const outstanding = invoices
    .filter((i) => i.kind === "invoice" && (i.status === "issued" || i.status === "partially_paid"))
    .reduce((sum, i) => sum + i.balance_cents, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Invoices &amp; quotes</h1>
        <div className="flex gap-2">
          <Link href={"/dashboard/invoices/new?kind=quote" as Route} className="btn-secondary">
            New quote
          </Link>
          <Link href="/dashboard/invoices/new" className="btn-primary">
            New invoice
          </Link>
        </div>
      </div>

      {/* Filters are plain links: the URL is the state, so they work without JS and can be bookmarked. */}
      <nav aria-label="Filter invoices" className="flex gap-1 overflow-x-auto">
        {(Object.keys(INVOICE_FILTERS) as InvoiceFilter[]).map((key) => (
          <Link
            key={key}
            href={
              (key === "all" ? "/dashboard/invoices" : `/dashboard/invoices?show=${key}`) as Route
            }
            aria-current={show === key ? "page" : undefined}
            className="rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted hover:bg-surface-2 hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-bg"
          >
            {INVOICE_FILTERS[key]}
          </Link>
        ))}
      </nav>

      {(show === "unpaid" || show === "overdue") && invoices.length > 0 && (
        <p className="text-sm">
          <span className="text-muted">Outstanding on this list: </span>
          <strong>{formatKES(outstanding)}</strong>
        </p>
      )}

      {invoices.length === 0 ? (
        <p className="card text-sm text-muted">{EMPTY[show]}</p>
      ) : (
        <ul
          className="card divide-y divide-line p-0"
          aria-label={`${INVOICE_FILTERS[show]} documents`}
        >
          {invoices.map((inv) => (
            <li key={inv.id}>
              <Link
                href={`/dashboard/invoices/${inv.id}` as Route}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {inv.number ?? (inv.kind === "quote" ? "Draft quote" : "Draft invoice")}
                  </span>
                  <span className="text-muted"> · {inv.customer_name}</span>
                  <span
                    data-overdue={inv.is_overdue || undefined}
                    className="block text-sm text-muted data-overdue:font-medium data-overdue:text-danger"
                  >
                    {dueText(inv, business.timezone)}
                  </span>
                </span>
                <span className="text-right text-sm tabular-nums">
                  <span className="font-semibold">{formatKES(inv.total_cents)}</span>
                  <span className="block">
                    <span
                      data-status={inv.status}
                      className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold data-[status=paid]:text-mpesa data-[status=void]:text-danger"
                    >
                      {statusLabel(inv.kind, inv.status)}
                    </span>
                    {inv.status === "partially_paid" && (
                      <span className="text-muted"> · {formatKES(inv.balance_cents)} due</span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {invoices.length === 100 && (
        <p className="text-sm text-muted">
          Showing the latest 100. Use the filters to narrow it down.
        </p>
      )}
    </div>
  );
}
