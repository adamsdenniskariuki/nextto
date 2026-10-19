import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberships, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/booking-status";
import { getCustomer } from "@/lib/dashboard";
import { formatDayLong, formatTime, localDay } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone, whatsappLink } from "@/lib/phone";
import { bookingDetailsSchema } from "@/lib/validation/dashboard";
import { invoiceSummarySchema, statusLabel } from "@/lib/validation/invoices";
import { CustomerNotesForm } from "./customer-notes-form";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/dashboard/customers/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const { supabase } = await requireUser();
  const membership = (await getMemberships()).find((m) => m.business.id === customer.business_id);
  const tz = membership?.business.timezone ?? "Africa/Nairobi";
  const { data, error } = await supabase
    .from("booking_details")
    .select("*")
    .eq("customer_id", id)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const history = bookingDetailsSchema.parse(data);

  const inv = await supabase
    .from("invoice_summaries")
    .select("*")
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (inv.error) throw inv.error;
  const invoices = invoiceSummarySchema.array().parse(inv.data);

  const stats = [
    { label: "Visits", value: String(customer.visits) },
    { label: "Spent", value: formatKES(customer.completed_value_cents) },
    { label: "Upcoming", value: String(customer.upcoming) },
    { label: "No-shows", value: String(customer.no_shows) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/customers" className="text-sm text-muted hover:text-ink">
          ← Customers
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{customer.name}</h1>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
          <a href={`tel:${customer.phone}`} className="underline-offset-4 hover:underline">
            {formatKenyanPhone(customer.phone)}
          </a>
          <a
            href={whatsappLink(customer.phone)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-mpesa underline-offset-4 hover:underline"
          >
            WhatsApp<span className="sr-only"> (opens in a new tab)</span>
          </a>
          {customer.email && <span className="text-muted">{customer.email}</span>}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card py-4">
            <dt className="text-xs font-medium text-muted uppercase">{s.label}</dt>
            <dd className="mt-1 text-xl font-bold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="history-heading" className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 id="history-heading" className="text-lg font-bold">
              History
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/dashboard/invoices/new?customer=${customer.customer_id}` as Route}
                className="btn-secondary min-h-9 px-4"
              >
                New invoice
              </Link>
              <Link
                href={`/dashboard/bookings/new?customer=${customer.customer_id}` as Route}
                className="btn-primary min-h-9 px-4"
              >
                New booking
              </Link>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No bookings yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {history.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/dashboard/bookings/${b.id}` as Route}
                    className="flex justify-between gap-4 py-2.5 text-sm hover:bg-surface-2"
                  >
                    <span>
                      <span className="font-medium">
                        {formatDayLong(localDay(new Date(b.starts_at), tz))}
                      </span>
                      <span className="block text-muted">
                        {formatTime(b.starts_at, tz)} · {b.service_name} · {b.staff_name}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {formatKES(b.price_cents)}
                      <span
                        data-status={b.status}
                        className="block text-muted data-[status=cancelled]:text-danger data-[status=no_show]:text-danger"
                      >
                        {STATUS_LABEL[b.status]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="customer-invoices-heading" className="card">
            <h2 id="customer-invoices-heading" className="text-lg font-bold">
              Invoices
            </h2>
            {invoices.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No invoices or quotes yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/dashboard/invoices/${inv.id}` as Route}
                      className="flex justify-between gap-4 py-2.5 text-sm hover:bg-surface-2"
                    >
                      <span className="font-medium">
                        {inv.number ?? (inv.kind === "quote" ? "Draft quote" : "Draft invoice")}
                      </span>
                      <span className="text-right">
                        {formatKES(inv.total_cents)}
                        <span
                          data-overdue={inv.is_overdue || undefined}
                          className="block text-muted data-overdue:text-danger"
                        >
                          {inv.is_overdue ? "Overdue" : statusLabel(inv.kind, inv.status)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="customer-notes-heading" className="card">
            <h2 id="customer-notes-heading" className="sr-only">
              Notes
            </h2>
            <CustomerNotesForm customerId={customer.customer_id} notes={customer.notes} />
          </section>
        </div>
      </div>
    </div>
  );
}
