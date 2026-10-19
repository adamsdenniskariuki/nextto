import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATUS_LABEL, canReschedule } from "@/lib/booking-status";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { getBooking, getBookingPayments, getTeamAndServices } from "@/lib/dashboard";
import { formatDateTimeLong, formatTime, localDay } from "@/lib/datetime";
import { getMemberships } from "@/lib/auth";
import { formatKES } from "@/lib/money";
import { resultMessage } from "@/lib/mpesa/format";
import { formatKenyanPhone, whatsappLink } from "@/lib/phone";
import { mpesaEnabled } from "@/lib/server-env";
import { MpesaRequestForm } from "../../mpesa-request-form";
import { NotesForm, RescheduleForm, StatusForm } from "./booking-forms";
import { createInvoiceFromBooking } from "../../invoices/actions";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: PageProps<"/dashboard/bookings/[id]">) {
  const { id } = await params;
  // A malformed id would be a Postgres 22P02 error; treat it as missing.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const booking = await getBooking(id);
  if (!booking) notFound(); // RLS hides other businesses' bookings, so this covers them too.

  const membership = (await getMemberships()).find((m) => m.business.id === booking.business_id);
  const tz = membership?.business.timezone ?? "Africa/Nairobi";
  const [team, payments] = await Promise.all([
    getTeamAndServices(booking.business_id),
    getBookingPayments(booking.id),
  ]);
  const waitingMpesa = payments.some((p) => p.method === "mpesa" && p.status === "pending");
  const depositPaid = payments.some((p) => p.status === "succeeded");
  const day = localDay(new Date(booking.starts_at), tz);
  const reference = booking.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const reminder = `Hi ${booking.customer_name}, a reminder of your ${booking.service_name} with ${membership?.business.name ?? "us"} on ${formatDateTimeLong(booking.starts_at, tz)}.`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/calendar?view=day&date=${day}` as Route}
          className="text-sm text-muted hover:text-ink"
        >
          ← Calendar for this day
        </Link>
        <p className="eyebrow mt-3">Booking {reference}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {booking.service_name} for {booking.customer_name}
        </h1>
        <p className="mt-2">
          <span
            data-status={booking.status}
            className="inline-block rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold data-[status=cancelled]:bg-surface-2 data-[status=cancelled]:text-danger data-[status=no_show]:text-danger"
          >
            {STATUS_LABEL[booking.status]}
          </span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section aria-labelledby="details-heading" className="card">
          <h2 id="details-heading" className="text-lg font-bold">
            Details
          </h2>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">When</dt>
            <dd>
              {formatDateTimeLong(booking.starts_at, tz)}–{formatTime(booking.ends_at, tz)}
            </dd>
            <dt className="text-muted">With</dt>
            <dd className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ backgroundColor: booking.staff_color }}
              />
              {booking.staff_name}
            </dd>
            <dt className="text-muted">Price</dt>
            <dd>
              {formatKES(booking.price_cents)}
              {booking.deposit_cents > 0 && (
                <span className="text-muted"> · deposit {formatKES(booking.deposit_cents)}</span>
              )}
            </dd>
            <dt className="text-muted">Customer</dt>
            <dd>
              <Link
                href={`/dashboard/customers/${booking.customer_id}` as Route}
                className="font-medium underline-offset-4 hover:underline"
              >
                {booking.customer_name}
              </Link>
            </dd>
            <dt className="text-muted">Phone</dt>
            <dd className="flex flex-wrap gap-x-3">
              <a
                href={`tel:${booking.customer_phone}`}
                className="underline-offset-4 hover:underline"
              >
                {formatKenyanPhone(booking.customer_phone)}
              </a>
              <a
                href={whatsappLink(booking.customer_phone, reminder)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-mpesa underline-offset-4 hover:underline"
              >
                WhatsApp reminder<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </dd>
            <dt className="text-muted">Booked</dt>
            <dd>
              {booking.source === "public" ? "Online" : "From the dashboard"}
              {booking.series_id ? " · repeating" : ""}
            </dd>
          </dl>
        </section>

        <div className="space-y-6">
          <section aria-labelledby="status-heading" className="card space-y-3">
            <h2 id="status-heading" className="text-lg font-bold">
              Status
            </h2>
            <StatusForm bookingId={booking.id} status={booking.status} />
          </section>

          {canReschedule(booking.status) && (
            <section aria-labelledby="reschedule-heading" className="card space-y-3">
              <h2 id="reschedule-heading" className="text-lg font-bold">
                Reschedule
              </h2>
              <RescheduleForm
                bookingId={booking.id}
                date={day}
                time={formatTime(booking.starts_at, tz)}
                staffId={booking.staff_id}
                staff={team.staff}
              />
            </section>
          )}

          <section aria-labelledby="notes-heading" className="card">
            <h2 id="notes-heading" className="sr-only">
              Notes
            </h2>
            <NotesForm bookingId={booking.id} notes={booking.notes} />
          </section>

          {booking.deposit_cents > 0 && (
            <section aria-labelledby="deposit-heading" className="card space-y-3">
              <h2 id="deposit-heading" className="text-lg font-bold">
                Deposit {formatKES(booking.deposit_cents)}
              </h2>
              {payments.length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 py-2">
                      <span>
                        {p.method === "mpesa" ? "M-Pesa" : p.method}
                        {p.mpesa_receipt && (
                          <span className="text-muted"> · {p.mpesa_receipt}</span>
                        )}
                        <span className="block text-xs text-muted">
                          {formatDateTimeLong(p.paid_at ?? p.created_at, tz)} ·{" "}
                          {resultMessage(p.status, p.result_desc)}
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
              {depositPaid ? (
                <p className="text-sm font-medium text-mpesa">Deposit paid.</p>
              ) : booking.status !== "pending" ? (
                <p className="text-sm text-muted">
                  No deposit is waiting: the booking is {STATUS_LABEL[booking.status].toLowerCase()}
                  .
                </p>
              ) : waitingMpesa ? (
                <RefreshWhilePending label="Waiting for the customer to enter their M-Pesa PIN…" />
              ) : mpesaEnabled() ? (
                <>
                  <p className="text-sm text-muted">
                    The booking is held until the deposit is paid. Paying confirms it.
                  </p>
                  <MpesaRequestForm
                    bookingId={booking.id}
                    phone={formatKenyanPhone(booking.customer_phone)}
                    depositLabel={formatKES(Math.floor(booking.deposit_cents / 100) * 100)}
                  />
                </>
              ) : (
                <p className="text-xs text-muted">
                  M-Pesa isn&apos;t configured on this server (see docs/SETUP.md).
                </p>
              )}
            </section>
          )}

          {booking.status !== "cancelled" && (
            <section aria-labelledby="invoice-heading" className="card space-y-3">
              <h2 id="invoice-heading" className="text-lg font-bold">
                Invoice
              </h2>
              <p className="text-sm text-muted">
                Starts a draft with this service and price. If one exists already, opens it.
              </p>
              <form action={createInvoiceFromBooking}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <button type="submit" className="btn-secondary">
                  Invoice this booking
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
