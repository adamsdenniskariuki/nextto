import type { Metadata, Route } from "next";
import Link from "next/link";
import { getCurrentMembership, requireUser } from "@/lib/auth";
import { formatDayLong, localDay } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone } from "@/lib/phone";
import { customerSearchSchema, customerStatsSchema, searchTerms } from "@/lib/validation/dashboard";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/dashboard/customers">) {
  const { q } = customerSearchSchema.parse(await searchParams);
  const { business } = await getCurrentMembership();
  const { supabase } = await requireUser();

  let query = supabase
    .from("customer_stats")
    .select("*")
    .eq("business_id", business.id)
    .order("name")
    .limit(50);

  if (q) {
    const { name, phoneDigits } = searchTerms(q);
    // name ILIKE uses the pg_trgm GIN index; see docs/sql-notes.md.
    const filters = [
      name && `name.ilike."%${name}%"`,
      phoneDigits.length >= 3 && `phone.like."%${phoneDigits}%"`,
    ].filter(Boolean);
    if (filters.length > 0) query = query.or(filters.join(","));
  }

  const { data, error } = await query;
  if (error) throw error;
  const customers = customerStatsSchema.array().parse(data);
  const tz = business.timezone;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Customers</h1>
        <form role="search" action="/dashboard/customers" className="flex w-full gap-2 sm:w-auto">
          <label htmlFor="customer-search" className="sr-only">
            Search by name or phone
          </label>
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name or phone"
            className="input sm:w-64"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
      </div>

      {customers.length === 0 ? (
        <p className="card text-sm text-muted">
          {q
            ? `No customers match “${q}”.`
            : "No customers yet. They appear here after their first booking."}
        </p>
      ) : (
        <ul
          className="card divide-y divide-line p-0"
          aria-label={q ? `Customers matching ${q}` : "All customers"}
        >
          {customers.map((c) => (
            <li key={c.customer_id}>
              <Link
                href={`/dashboard/customers/${c.customer_id}` as Route}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">{c.name}</span>
                  <span className="block text-sm text-muted">{formatKenyanPhone(c.phone)}</span>
                </span>
                <span className="text-right text-sm text-muted">
                  {c.visits} {c.visits === 1 ? "visit" : "visits"} ·{" "}
                  {formatKES(c.completed_value_cents)}
                  <span className="block">
                    {c.next_visit_at
                      ? `Next: ${formatDayLong(localDay(new Date(c.next_visit_at), tz))}`
                      : c.last_visit_at
                        ? `Last: ${formatDayLong(localDay(new Date(c.last_visit_at), tz))}`
                        : "No visits yet"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {customers.length === 50 && (
        <p className="text-sm text-muted">Showing the first 50. Search to narrow it down.</p>
      )}
    </div>
  );
}
