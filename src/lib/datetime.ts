/**
 * Date and time helpers for business-local display.
 *
 * Rules used across Nextto:
 *   - Instants are timestamptz in Postgres and ISO strings with an offset in
 *     TypeScript (e.g. "2026-10-21T07:00:00+00:00"). They are never naive.
 *   - A "day" is a local calendar date in the BUSINESS's time zone, as a
 *     "YYYY-MM-DD" string. Postgres turns it into instants with
 *     `(day + time) AT TIME ZONE tz`; the browser's own zone is never used.
 *   - Formatting always passes `timeZone`, so a visitor abroad still sees
 *     Nairobi times.
 */

export const DEFAULT_TIMEZONE = "Africa/Nairobi";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isISODay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** The local calendar date of an instant in a time zone: "YYYY-MM-DD". */
export function localDay(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Calendar arithmetic on a "YYYY-MM-DD" day, done in UTC so it's DST-proof. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next `count` local days starting today: ["2026-10-21", ...]. */
export function upcomingDays(
  count: number,
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): string[] {
  const today = localDay(now, timeZone);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

/** "2026-10-21" -> { weekday: "Wed", date: "21 Oct" }. A pure calendar date, so UTC is correct here. */
export function dayParts(day: string): { weekday: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-KE", { weekday: "short", timeZone: "UTC" }).format(d),
    date: new Intl.DateTimeFormat("en-KE", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(d),
  };
}

/** "2026-10-21" -> "Wednesday, 21 October 2026" */
export function formatDayLong(day: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** An instant as 24-hour local time: "14:30". */
export function formatTime(instant: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(instant));
}

/** An instant as "Wednesday, 21 October 2026 at 10:00". */
export function formatDateTimeLong(
  instant: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const d = new Date(instant);
  return `${formatDayLong(localDay(d, timeZone))} at ${formatTime(d, timeZone)}`;
}

/** Duration in minutes as "45 min", "1 h" or "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
