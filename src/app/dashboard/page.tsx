import type { Metadata, Route } from "next";
import Link from "next/link";
import { getCurrentMembership, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/booking-status";
import { getCalendarBookings } from "@/lib/dashboard";
import { formatTime, localDay, localDaysRange } from "@/lib/datetime";
import { publicEnv } from "@/lib/env";
import { formatKES } from "@/lib/money";
import { revokeInvitation } from "./actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { supabase } = await requireUser();
  const { business, role } = await getCurrentMembership();
  const isOwner = role === "owner";
  const today = localDay(new Date(), business.timezone);
  const { from, to } = localDaysRange(today, today, business.timezone);

  // Independent queries run in parallel. RLS scopes every one to this user's businesses.
  const [todays, services, staff, invitations] = await Promise.all([
    getCalendarBookings(business.id, from, to),
    supabase
      .from("services")
      .select("id, name, duration_minutes, price_cents, active")
      .eq("business_id", business.id)
      .order("sort_order"),
    supabase
      .from("staff")
      .select("id, display_name, user_id, active")
      .eq("business_id", business.id)
      .order("created_at"),
    isOwner
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at")
          .eq("business_id", business.id)
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [services, staff, invitations]) if (r.error) throw r.error;

  const bookingUrl = new URL(`/b/${business.slug}`, publicEnv.NEXT_PUBLIC_SITE_URL).href;

  return (
    <div className="space-y-8">
      <section>
        <p className="eyebrow">{isOwner ? "Owner" : "Staff"}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-muted">
          Your booking page:{" "}
          <a
            href={`/b/${business.slug}`}
            className="font-mono text-sm break-all text-ink underline-offset-4 hover:underline"
          >
            {bookingUrl}
          </a>
        </p>
      </section>

      <section aria-labelledby="today-heading" className="card">
        <div className="flex items-center justify-between gap-3">
          <h2 id="today-heading" className="text-lg font-bold">
            Today
          </h2>
          <Link
            href={`/dashboard/calendar?view=day&date=${today}` as Route}
            className="text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            Open calendar
          </Link>
        </div>
        {todays.filter((b) => b.status !== "cancelled").length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing booked today yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {todays
              .filter((b) => b.status !== "cancelled")
              .map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/dashboard/bookings/${b.id}` as Route}
                    className="flex gap-3 py-2.5 text-sm hover:bg-surface-2"
                  >
                    <span className="w-12 shrink-0 font-semibold">
                      {formatTime(b.starts_at, business.timezone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{b.customer_name}</span>
                      <span className="block truncate text-muted">
                        {b.service_name} · {b.staff_name}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted">{STATUS_LABEL[b.status]}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="services-heading" className="card">
          <h2 id="services-heading" className="text-lg font-bold">
            Services
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {services.data?.map((s) => (
              <li key={s.id} className="flex justify-between gap-4 py-2.5 text-sm">
                <span className={s.active ? "" : "text-muted line-through"}>{s.name}</span>
                <span className="shrink-0 text-muted">
                  {s.duration_minutes} min · {formatKES(s.price_cents)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="team-heading" className="card space-y-4">
          <h2 id="team-heading" className="text-lg font-bold">
            Team
          </h2>
          <ul className="divide-y divide-line">
            {staff.data?.map((s) => (
              <li key={s.id} className="flex justify-between gap-4 py-2.5 text-sm">
                <span>{s.display_name}</span>
                <span className="text-muted">{s.user_id ? "Has login" : "No login"}</span>
              </li>
            ))}
          </ul>

          {isOwner && (
            <>
              <InviteForm businessId={business.id} />
              {invitations.data && invitations.data.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Pending invitations</h3>
                  <ul className="divide-y divide-line">
                    {invitations.data.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {inv.email} <span className="text-muted">· {inv.role}</span>
                        </span>
                        <form action={revokeInvitation}>
                          <input type="hidden" name="id" value={inv.id} />
                          <button type="submit" className="btn-ghost min-h-9 px-3">
                            Revoke<span className="sr-only"> invitation for {inv.email}</span>
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
