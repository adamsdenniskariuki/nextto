import type { Metadata } from "next";
import { getMemberships, requireUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { formatKES } from "@/lib/money";
import { revokeInvitation } from "./actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { supabase } = await requireUser();
  const memberships = await getMemberships();
  const { business: businessId } = await searchParams;
  const current = memberships.find((m) => m.business.id === businessId) ?? memberships[0];
  if (!current) return null; // the layout already redirects to /onboarding
  const { business, role } = current;
  const isOwner = role === "owner";

  // Independent queries run in parallel. RLS scopes every one to this user's businesses.
  const [services, staff, invitations] = await Promise.all([
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
        {memberships.length > 1 && (
          <nav aria-label="Your businesses" className="mb-4 flex flex-wrap gap-2">
            {memberships.map((m) => (
              <a
                key={m.business.id}
                href={`/dashboard?business=${m.business.id}`}
                aria-current={m.business.id === business.id ? "page" : undefined}
                className="rounded-full border border-line px-3 py-1 text-sm aria-[current=page]:border-ink aria-[current=page]:font-semibold"
              >
                {m.business.name}
              </a>
            ))}
          </nav>
        )}
        <p className="eyebrow">{isOwner ? "Owner" : "Staff"}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-muted">
          Your booking page:{" "}
          <span className="font-mono text-sm break-all text-ink">{bookingUrl}</span>
        </p>
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
