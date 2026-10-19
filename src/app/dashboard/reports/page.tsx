import type { Metadata, Route } from "next";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/auth";
import { formatDayShort, formatDuration, localDay } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import { getReports } from "@/lib/reports";
import {
  REPORT_RANGES,
  bucketTrend,
  heatIntensity,
  heatmapGrid,
  parseReportRange,
  reportPeriod,
  sumBy,
  type ReportRange,
} from "@/lib/reports-math";
import { RevenueChart } from "./revenue-chart";

export const metadata: Metadata = { title: "Reports" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * /dashboard/reports?range=30d
 *
 * A Server Component that runs five SQL report functions in parallel and
 * renders the results as HTML and SVG. The range lives in the URL, so every
 * view is a shareable link and the back button works; there is no client
 * state at all.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/dashboard/reports">) {
  const range = parseReportRange((await searchParams).range);
  const { business } = await getCurrentMembership();
  const today = localDay(new Date(), business.timezone);
  const { from, to } = reportPeriod(range, today);
  const { trend, hours, staff, ageing, repeat } = await getReports(business.id, from, to);

  const buckets = bucketTrend(trend);
  const weekly = buckets.length !== trend.length;
  const revenue = trend.at(-1)?.running_total_cents ?? 0;
  const bookings = sumBy(trend, (d) => d.bookings_count);
  const outstanding = sumBy(ageing, (a) => a.balance_cents);
  const overdue = sumBy(
    ageing.filter((a) => a.bucket !== "Current"),
    (a) => a.balance_cents,
  );
  const heat = heatmapGrid(hours);
  const busiest = hours.filter((h) => h.rank === 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{business.name}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted">
            {formatDayShort(from)} – {formatDayShort(to)}
          </p>
        </div>
        <nav aria-label="Period" className="flex rounded-xl border border-line bg-surface p-1">
          {(Object.keys(REPORT_RANGES) as ReportRange[]).map((key) => (
            <Link
              key={key}
              href={`/dashboard/reports?range=${key}` as Route}
              aria-current={key === range ? "page" : undefined}
              className="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted hover:text-ink aria-[current=page]:bg-brand aria-[current=page]:text-brand-ink"
            >
              {REPORT_RANGES[key].label}
            </Link>
          ))}
        </nav>
      </div>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue" value={formatKES(revenue)} testId="kpi-revenue" />
        <Kpi label="Bookings" value={String(bookings)} />
        <Kpi
          label="Repeat customers"
          value={repeat.repeat_rate_pct === null ? "–" : `${repeat.repeat_rate_pct}%`}
          note={`${repeat.repeat_customers} of ${repeat.customers_in_period} came back`}
        />
        <Kpi
          label="Owed to you"
          value={formatKES(outstanding)}
          note={overdue > 0 ? `${formatKES(overdue)} overdue` : "Nothing overdue"}
          testId="kpi-outstanding"
        />
      </section>

      <section aria-labelledby="revenue-heading" className="card space-y-4">
        <div>
          <h2 id="revenue-heading" className="text-lg font-bold">
            Revenue trend
          </h2>
          <p className="text-xs text-muted">Payments received. Updated every 10 minutes.</p>
        </div>
        <RevenueChart buckets={buckets} weekly={weekly} />
        <details>
          <summary className="cursor-pointer text-sm font-medium">Show the numbers</summary>
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Day
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Revenue
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Running total
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    7-day avg
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    vs day before
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {trend
                  .filter((d) => d.revenue_cents !== 0 || d.change_vs_prev_day_cents !== 0)
                  .toReversed()
                  .map((d) => (
                    <tr key={d.day}>
                      <th
                        scope="row"
                        className="py-1.5 pr-3 text-left font-normal whitespace-nowrap"
                      >
                        {formatDayShort(d.day)}
                      </th>
                      <td className="py-1.5 pr-3 text-right">{formatKES(d.revenue_cents)}</td>
                      <td className="py-1.5 pr-3 text-right">{formatKES(d.running_total_cents)}</td>
                      <td className="py-1.5 pr-3 text-right">{formatKES(d.moving_avg_7d_cents)}</td>
                      <td className="py-1.5 text-right">
                        {d.change_vs_prev_day_cents > 0 ? "+" : ""}
                        {formatKES(d.change_vs_prev_day_cents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {revenue === 0 && (
              <p className="py-2 text-sm text-muted">No payments in this period.</p>
            )}
          </div>
        </details>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="hours-heading" className="card space-y-3">
          <div>
            <h2 id="hours-heading" className="text-lg font-bold">
              Busiest hours
            </h2>
            <p className="text-xs text-muted">
              Bookings by start time.
              {busiest.length > 0 &&
                ` Peak: ${busiest
                  .slice(0, 2)
                  .map((h) => `${WEEKDAYS[h.weekday - 1]} ${pad(h.hour)}`)
                  .join(", ")}.`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-0.5 text-xs tabular-nums">
              <caption className="sr-only">
                Bookings per weekday and hour; darker means busier.
              </caption>
              <thead>
                <tr>
                  <td className="w-12" />
                  {WEEKDAYS.map((d) => (
                    <th key={d} scope="col" className="pb-1 font-medium text-muted">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.rows.map((row) => (
                  <tr key={row.hour}>
                    <th scope="row" className="pr-1 text-right font-normal text-muted">
                      {pad(row.hour)}
                    </th>
                    {row.counts.map((n, i) => {
                      const level = heatIntensity(n, heat.max);
                      return (
                        <td
                          key={i}
                          className="h-7 rounded text-center"
                          style={{
                            backgroundColor: `color-mix(in oklab, var(--color-brand) ${Math.round(level * 100)}%, var(--color-surface-2))`,
                            color: level > 0.55 ? "var(--color-brand-ink)" : undefined,
                          }}
                        >
                          {n > 0 ? n : <span className="sr-only">0</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <section aria-labelledby="staff-heading" className="card space-y-3">
            <div>
              <h2 id="staff-heading" className="text-lg font-bold">
                Staff utilisation
              </h2>
              <p className="text-xs text-muted">Booked time as a share of working hours.</p>
            </div>
            <ul className="space-y-3">
              {staff.map((s) => (
                <li key={s.staff_id} className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="truncate font-medium">{s.display_name}</span>
                    <span className="shrink-0 text-muted tabular-nums">
                      {s.utilisation_pct === null
                        ? "No hours set"
                        : `${s.utilisation_pct}% · ${formatDuration(s.booked_minutes)} of ${formatDuration(s.available_minutes)}`}
                    </span>
                  </div>
                  <div
                    role="meter"
                    aria-label={`${s.display_name} utilisation`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, s.utilisation_pct ?? 0)}
                    className="h-2 overflow-hidden rounded-full bg-surface-2"
                  >
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${Math.min(100, s.utilisation_pct ?? 0)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="ageing-heading" className="card space-y-3">
            <div>
              <h2 id="ageing-heading" className="text-lg font-bold">
                Receivables ageing
              </h2>
              <p className="text-xs text-muted">Unpaid invoices by days past their due date.</p>
            </div>
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="pb-1.5 font-medium">
                    Age
                  </th>
                  <th scope="col" className="pb-1.5 text-right font-medium">
                    Invoices
                  </th>
                  <th scope="col" className="pb-1.5 text-right font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ageing.map((a) => (
                  <tr key={a.bucket}>
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {a.bucket.replace("-", "–")}
                    </th>
                    <td className="py-1.5 text-right">{a.invoice_count}</td>
                    <td
                      data-overdue={a.bucket !== "Current" && a.balance_cents > 0}
                      className="py-1.5 text-right data-[overdue=true]:font-semibold data-[overdue=true]:text-danger"
                    >
                      {formatKES(a.balance_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link
              href={"/dashboard/invoices?show=unpaid" as Route}
              className="inline-block text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              See unpaid invoices
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  testId?: string;
}) {
  return (
    <div className="card min-w-0 p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        data-testid={testId}
        className="mt-1 truncate text-xl font-extrabold tabular-nums sm:text-2xl"
      >
        {value}
      </p>
      {note && <p className="mt-0.5 truncate text-xs text-muted">{note}</p>}
    </div>
  );
}
