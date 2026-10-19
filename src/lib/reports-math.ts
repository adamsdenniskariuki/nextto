/**
 * Pure helpers for the reports page: date ranges, bucketing and chart
 * scaling. No I/O, so Vitest covers them directly. The numbers themselves come
 * from SQL (window functions in supabase/migrations/*_reports.sql).
 */
import { addDays } from "./datetime";

export const REPORT_RANGES = {
  "7d": { days: 7, label: "7 days" },
  "30d": { days: 30, label: "30 days" },
  "90d": { days: 90, label: "90 days" },
  "365d": { days: 365, label: "12 months" },
} as const;

export type ReportRange = keyof typeof REPORT_RANGES;

/** `?range=` from the URL, falling back to 30 days for anything unknown. */
export function parseReportRange(value: string | string[] | undefined): ReportRange {
  // Object.hasOwn, not `in`: `"constructor" in {}` is true via the prototype.
  return typeof value === "string" && Object.hasOwn(REPORT_RANGES, value)
    ? (value as ReportRange)
    : "30d";
}

/** Inclusive local days ending today, e.g. 30d = today and the 29 days before. */
export function reportPeriod(range: ReportRange, today: string): { from: string; to: string } {
  return { from: addDays(today, -(REPORT_RANGES[range].days - 1)), to: today };
}

export type TrendDay = {
  day: string;
  revenue_cents: number;
  running_total_cents: number;
  moving_avg_7d_cents: number;
  change_vs_prev_day_cents: number;
  bookings_count: number;
};

export type TrendBucket = {
  /** First day of the bucket (a day, or the Monday of a week). */
  start: string;
  end: string;
  revenue_cents: number;
  bookings_count: number;
  /** 7-day moving average at the end of the bucket (daily buckets only). */
  moving_avg_7d_cents: number | null;
};

/** ISO weekday 1 (Monday) to 7 (Sunday) of a "YYYY-MM-DD" day. */
export function isoWeekday(day: string): number {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * Daily bars up to ~3 months; beyond that, 365 one-pixel bars say little, so
 * group into Monday-to-Sunday weeks (the first and last may be partial).
 */
export function bucketTrend(days: TrendDay[]): TrendBucket[] {
  if (days.length <= 92) {
    return days.map((d) => ({
      start: d.day,
      end: d.day,
      revenue_cents: d.revenue_cents,
      bookings_count: d.bookings_count,
      moving_avg_7d_cents: d.moving_avg_7d_cents,
    }));
  }
  const weeks: TrendBucket[] = [];
  for (const d of days) {
    const last = weeks.at(-1);
    if (!last || isoWeekday(d.day) === 1) {
      weeks.push({
        start: d.day,
        end: d.day,
        revenue_cents: d.revenue_cents,
        bookings_count: d.bookings_count,
        moving_avg_7d_cents: null,
      });
    } else {
      last.end = d.day;
      last.revenue_cents += d.revenue_cents;
      last.bookings_count += d.bookings_count;
    }
  }
  return weeks;
}

/**
 * A round axis maximum at or above `value`: 1, 2 or 5 times a power of ten
 * (e.g. 7,300 -> 10,000; 1,800 -> 2,000). Zero stays a usable 1.
 */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value)!;
  return step * power;
}

export type HourCell = { weekday: number; hour: number; bookings_count: number };

/**
 * The busiest-hours heat map as rows of hours by Monday..Sunday columns.
 * Shows at least 08:00-18:00 so a quiet business still gets a sensible grid.
 */
export function heatmapGrid(cells: HourCell[]) {
  const hours = cells.map((c) => c.hour);
  const first = Math.min(8, ...hours);
  const last = Math.max(18, ...hours);
  const counts = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c.bookings_count]));
  const max = Math.max(0, ...cells.map((c) => c.bookings_count));
  const rows = [];
  for (let hour = first; hour <= last; hour++) {
    rows.push({
      hour,
      counts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => counts.get(`${weekday}:${hour}`) ?? 0),
    });
  }
  return { rows, max };
}

/** 0..1 shading for a heat-map cell; any booking is at least faintly visible. */
export function heatIntensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return 0.15 + 0.85 * (count / max);
}

export function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}
