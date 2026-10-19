import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { formatDateTimeLong, formatDuration, formatTime } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone, whatsappLink } from "@/lib/phone";
import { getPublicBooking } from "@/lib/public-booking";

// The status can change at any moment (deposit paid, cancelled), so always render fresh.
export const dynamic = "force-dynamic";

// A private capability URL: keep it out of search engines.
export const metadata: Metadata = {
  title: "Booking confirmed",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConfirmedPage({ params }: PageProps<"/b/[slug]/confirmed/[id]">) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const booking = await getPublicBooking(id);
  if (!booking || booking.business.slug !== slug.toLowerCase()) notFound();

  const { business } = booking;
  const tz = business.timezone;
  const minutes = Math.round(
    (new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()) / 60_000,
  );
  const when = formatDateTimeLong(booking.starts_at, tz);
  const pending = booking.status === "pending";
  const cancelled = booking.status === "cancelled";

  return (
    <>
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 pb-20 sm:px-6">
        <section className="card mt-4 space-y-6 sm:mt-10">
          <div role="status">
            <p className="eyebrow">Reference {booking.reference}</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-balance">
              {cancelled
                ? "This booking was cancelled"
                : pending
                  ? `Almost there, ${booking.customer_first_name}`
                  : `You're booked, ${booking.customer_first_name}!`}
            </h1>
            {pending && (
              <p className="mt-2 text-muted">
                Your time is held. {business.name} will send an M-Pesa request for the{" "}
                <strong className="text-ink">{formatKES(booking.deposit_cents)}</strong> deposit to
                confirm it.
              </p>
            )}
          </div>

          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Item label="When" value={when} />
            <Item label="Service" value={`${booking.service_name} · ${formatDuration(minutes)}`} />
            <Item label="With" value={booking.staff_name} />
            <Item label="Price" value={formatKES(booking.price_cents)} />
            <Item label="Where" value={business.address ?? business.name} />
            <Item
              label="Ends"
              value={`${formatTime(booking.ends_at, tz)} (Nairobi time)`}
              className="sm:col-span-1"
            />
          </dl>

          {!cancelled && (
            <div className="flex flex-wrap gap-3">
              <a
                href={`/b/${business.slug}/confirmed/${booking.booking_id}/calendar.ics`}
                className="btn-secondary"
                download
              >
                Add to calendar
              </a>
              {business.phone && (
                <a
                  href={whatsappLink(
                    business.phone,
                    `Hi ${business.name}, about my booking ${booking.reference} on ${when}.`,
                  )}
                  className="btn-secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp {formatKenyanPhone(business.phone)}
                </a>
              )}
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-sm text-muted">
          Need another time?{" "}
          <Link
            href={`/b/${business.slug}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            Book again with {business.name}
          </Link>
        </p>
      </main>
    </>
  );
}

function Item({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
