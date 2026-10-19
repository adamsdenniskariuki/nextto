import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { DEFAULT_TIMEZONE, formatDuration, upcomingDays } from "@/lib/datetime";
import { publicEnv } from "@/lib/env";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone } from "@/lib/phone";
import { getBookingPage } from "@/lib/public-booking";
import { BookingFlow } from "./booking-flow";

/**
 * Incremental Static Regeneration (ISR): the first visit renders the page on
 * the server and caches the HTML; later visits get the cached copy, which is
 * regenerated in the background at most once a minute. Search engines get
 * full HTML; live availability is fetched separately from /api/slots.
 */
export const revalidate = 60;

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getBookingPage(slug);
  if (!page) return { title: "Business not found", robots: { index: false } };

  const { business, services } = page;
  const serviceNames = services
    .slice(0, 4)
    .map((s) => s.name)
    .join(", ");
  const description = `Book ${serviceNames ? `${serviceNames} ` : ""}with ${business.name} online. Prices in KES; pay by M-Pesa.`;
  return {
    title: `Book with ${business.name}`,
    description,
    alternates: { canonical: `/b/${business.slug}` },
    openGraph: { title: `Book with ${business.name}`, description, url: `/b/${business.slug}` },
  };
}

export default async function BookingPage({ params }: PageProps<"/b/[slug]">) {
  const { slug } = await params;
  const page = await getBookingPage(slug);
  if (!page) notFound();

  const { business, services, staff, labels } = page;
  const timeZone = business.timezone || DEFAULT_TIMEZONE;

  // schema.org structured data, which helps search engines show prices and contacts.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    url: new URL(`/b/${business.slug}`, publicEnv.NEXT_PUBLIC_SITE_URL).href,
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.address ? { address: business.address } : {}),
    makesOffer: services.map((s) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: s.name },
      price: (s.price_cents / 100).toFixed(2),
      priceCurrency: business.currency,
    })),
  };

  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <span className="text-sm text-muted">Online booking</span>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <section className="py-6 sm:py-10">
          <p className="eyebrow">Book online</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
            {business.name}
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            {business.address && (
              <div className="flex gap-1.5">
                <dt className="sr-only">Address</dt>
                <dd>{business.address}</dd>
              </div>
            )}
            {business.phone && (
              <div className="flex gap-1.5">
                <dt className="sr-only">Phone</dt>
                <dd>
                  <a href={`tel:${business.phone}`} className="underline-offset-4 hover:underline">
                    {formatKenyanPhone(business.phone)}
                  </a>
                </dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt className="sr-only">Payment</dt>
              <dd>
                Pay with <span className="font-semibold text-mpesa">M-Pesa</span>
              </dd>
            </div>
          </dl>
        </section>

        {services.length === 0 ? (
          <p className="card text-muted">
            {business.name} isn&apos;t taking online bookings yet. Please call them directly.
          </p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
            <BookingFlow
              slug={business.slug}
              businessId={business.id}
              timeZone={timeZone}
              services={services}
              staff={staff}
              staffLabel={labels.staff}
              days={upcomingDays(14, timeZone)}
            />

            {/* A plain price list: indexable, and readable without JavaScript. */}
            <aside aria-labelledby="price-list" className="card h-fit">
              <h2 id="price-list" className="text-lg font-bold">
                Price list
              </h2>
              <ul className="mt-3 divide-y divide-line">
                {services.map((s) => (
                  <li key={s.id} className="py-2.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{s.name}</span>
                      <span className="shrink-0 font-semibold">{formatKES(s.price_cents)}</span>
                    </div>
                    <p className="text-muted">
                      {formatDuration(s.duration_minutes)}
                      {s.deposit_cents > 0 && ` · ${formatKES(s.deposit_cents)} deposit`}
                    </p>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
      </main>

      <script
        type="application/ld+json"
        // Escape "<" so a business name can never close the script tag (XSS).
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
}
