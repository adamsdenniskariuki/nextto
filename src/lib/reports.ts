import "server-only";
import { z } from "zod";
import { requireUser } from "./auth";

/**
 * Loads every report for one business and period in parallel. Each is a SQL
 * function (see supabase/migrations/*_reports.sql):
 *
 * - report_revenue_trend: SECURITY DEFINER over a materialised view (which
 *   can't have RLS), so it checks membership itself first.
 * - the others: SECURITY INVOKER, so RLS on bookings/invoices/staff scopes
 *   them to the signed-in member automatically.
 *
 * Zod turns the generated `Json`-ish row types into exact shapes and catches a
 * changed SQL signature at the boundary instead of deep inside a chart.
 */

const count = z.number().int().nonnegative();
const cents = z.number().int();

const trendRow = z.object({
  day: z.iso.date(),
  revenue_cents: cents,
  running_total_cents: cents,
  moving_avg_7d_cents: cents,
  change_vs_prev_day_cents: cents,
  bookings_count: count,
});

const hourRow = z.object({
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  bookings_count: count,
  rank: count,
});

const staffRow = z.object({
  staff_id: z.uuid(),
  display_name: z.string(),
  available_minutes: count,
  booked_minutes: count,
  utilisation_pct: z.number().nullable(),
});

const ageingRow = z.object({ bucket: z.string(), invoice_count: count, balance_cents: cents });

const repeatRow = z.object({
  customers_in_period: count,
  repeat_customers: count,
  repeat_rate_pct: z.number().nullable(),
});

export async function getReports(businessId: string, from: string, to: string) {
  const { supabase } = await requireUser();
  const period = { p_business_id: businessId, p_from: from, p_to: to };
  const [trend, hours, staff, ageing, repeat] = await Promise.all([
    supabase.rpc("report_revenue_trend", period),
    supabase.rpc("report_busiest_hours", period),
    supabase.rpc("report_staff_utilisation", period),
    supabase.rpc("report_receivables_ageing", { p_business_id: businessId }),
    supabase.rpc("report_repeat_customer_rate", period),
  ]);
  for (const r of [trend, hours, staff, ageing, repeat]) if (r.error) throw r.error;

  return {
    trend: z.array(trendRow).parse(trend.data),
    hours: z.array(hourRow).parse(hours.data),
    staff: z.array(staffRow).parse(staff.data),
    ageing: z.array(ageingRow).parse(ageing.data),
    // A single-row function still comes back as an array.
    repeat: z.array(repeatRow).length(1).parse(repeat.data)[0]!,
  };
}

export type Reports = Awaited<ReturnType<typeof getReports>>;
