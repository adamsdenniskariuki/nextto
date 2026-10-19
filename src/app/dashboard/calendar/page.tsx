import type { Metadata, Route } from "next";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/booking-status";
import { layoutLanes, placeInDay, visibleHours } from "@/lib/calendar";
import { getCalendarBookings, getTeamAndServices } from "@/lib/dashboard";
import {
  addDays,
  dayParts,
  formatDayLong,
  formatTime,
  localDay,
  localDaysRange,
  startOfWeek,
  zonedDateTimeToInstant,
} from "@/lib/datetime";
import {
  calendarQuerySchema,
  type BookingDetail,
  type CalendarQuery,
} from "@/lib/validation/dashboard";
import { LiveUpdates } from "./live-updates";

export const metadata: Metadata = { title: "Calendar" };

const HOUR_PX = 56;
const MIN_PX = HOUR_PX / 60;

type Column = {
  key: string;
  label: string;
  sub?: string;
  day: string;
  staffId?: string;
  color?: string;
};

function calendarHref(q: CalendarQuery, patch: Partial<CalendarQuery>): Route {
  const params = new URLSearchParams();
  const merged = { ...q, ...patch };
  params.set("view", merged.view);
  if (merged.date) params.set("date", merged.date);
  if (merged.staff) params.set("staff", merged.staff);
  return `/dashboard/calendar?${params}` as Route;
}

function newBookingHref(day: string, time?: string, staffId?: string): Route {
  const params = new URLSearchParams({ date: day });
  if (time) params.set("time", time);
  if (staffId) params.set("staff", staffId);
  return `/dashboard/bookings/new?${params}` as Route;
}

export default async function CalendarPage({ searchParams }: PageProps<"/dashboard/calendar">) {
  // .catch() defaults mean a mangled URL still renders a calendar.
  const query = calendarQuerySchema.parse(await searchParams);
  const { business } = await getCurrentMembership();
  const tz = business.timezone;
  const today = localDay(new Date(), tz);
  const date = query.date ?? today;

  const days =
    query.view === "day"
      ? [date]
      : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  const { from, to } = localDaysRange(days[0]!, days.at(-1)!, tz);

  const [allBookings, team] = await Promise.all([
    getCalendarBookings(business.id, from, to),
    getTeamAndServices(business.id),
  ]);
  const staffFilter = team.staff.some((s) => s.id === query.staff) ? query.staff : undefined;
  const bookings = allBookings.filter(
    (b) => b.status !== "cancelled" && (!staffFilter || b.staff_id === staffFilter),
  );
  const shownStaff = staffFilter ? team.staff.filter((s) => s.id === staffFilter) : team.staff;

  const columns: Column[] =
    query.view === "day"
      ? shownStaff.map((s) => ({
          key: s.id,
          label: s.display_name,
          day: date,
          staffId: s.id,
          color: s.color,
        }))
      : days.map((d) => {
          const p = dayParts(d);
          return { key: d, label: p.weekday, sub: p.date, day: d, staffId: staffFilter };
        });

  const dayStarts = new Map(days.map((d) => [d, zonedDateTimeToInstant(d, "00:00", tz)]));
  const placed = (b: BookingDetail, day: string) => ({
    ...placeInDay(b.starts_at, b.ends_at, dayStarts.get(day)!),
    booking: b,
  });
  const itemsFor = (col: Column) =>
    bookings
      .filter((b) => (col.staffId ? b.staff_id === col.staffId : true))
      .map((b) => placed(b, col.day))
      .filter((i) => i.end > i.start);

  const columnItems = columns.map((col) => ({ col, items: layoutLanes(itemsFor(col)) }));
  const hours = visibleHours(
    team.workingHours.filter((w) => !staffFilter || w.staff_id === staffFilter),
    columnItems.flatMap((c) => c.items),
  );
  const hourList = Array.from(
    { length: hours.endHour - hours.startHour },
    (_, i) => hours.startHour + i,
  );
  const gridHeight = hourList.length * HOUR_PX;

  const now = new Date();
  const nowMinutes = (now.getTime() - (dayStarts.get(today)?.getTime() ?? 0)) / 60_000;
  const showNow =
    dayStarts.has(today) && nowMinutes >= hours.startHour * 60 && nowMinutes < hours.endHour * 60;

  const step = query.view === "day" ? 1 : 7;
  const title =
    query.view === "day"
      ? formatDayLong(date)
      : `${dayParts(days[0]!).date} – ${dayParts(days[6]!).date} ${days[6]!.slice(0, 4)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{query.view === "day" ? "Day" : "Week"}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{title}</h1>
        </div>
        <LiveUpdates businessId={business.id} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Change dates" className="flex items-center gap-1">
          <Link
            href={calendarHref(query, { date: addDays(date, -step) })}
            className="btn-secondary min-h-9 px-3"
          >
            <span aria-hidden="true">←</span>
            <span className="sr-only">Previous {query.view}</span>
          </Link>
          <Link href={calendarHref(query, { date: today })} className="btn-secondary min-h-9 px-3">
            Today
          </Link>
          <Link
            href={calendarHref(query, { date: addDays(date, step) })}
            className="btn-secondary min-h-9 px-3"
          >
            <span aria-hidden="true">→</span>
            <span className="sr-only">Next {query.view}</span>
          </Link>
        </nav>

        <nav aria-label="Calendar view" className="flex rounded-xl border border-line p-0.5">
          {(["day", "week"] as const).map((v) => (
            <Link
              key={v}
              href={calendarHref(query, { view: v, date })}
              aria-current={query.view === v ? "page" : undefined}
              className="rounded-lg px-3 py-1.5 text-sm font-medium capitalize text-muted aria-[current=page]:bg-ink aria-[current=page]:text-bg"
            >
              {v}
            </Link>
          ))}
        </nav>

        {team.staff.length > 1 && (
          <form className="flex items-center gap-1" action="/dashboard/calendar">
            <input type="hidden" name="view" value={query.view} />
            <input type="hidden" name="date" value={date} />
            <label htmlFor="staff-filter" className="sr-only">
              Team member
            </label>
            <select
              id="staff-filter"
              name="staff"
              defaultValue={staffFilter ?? ""}
              className="input min-h-9 w-auto py-1 text-sm"
            >
              <option value="">Everyone</option>
              {team.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost min-h-9 px-3">
              Show
            </button>
          </form>
        )}

        <Link
          href={newBookingHref(date, undefined, staffFilter)}
          className="btn-primary ml-auto min-h-9 px-4"
        >
          New booking
        </Link>
      </div>

      {/* Below md, the week is an agenda list: seven narrow columns don't fit 360px. */}
      {query.view === "week" && (
        <WeekAgenda days={days} bookings={bookings} tz={tz} today={today} />
      )}

      <section
        aria-label={query.view === "day" ? "Day schedule" : "Week schedule"}
        className={`${query.view === "week" ? "hidden md:block" : ""} card overflow-x-auto p-0`}
      >
        <div
          className="grid min-w-full"
          style={{
            gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(${query.view === "day" ? "10rem" : "6.5rem"}, 1fr))`,
          }}
        >
          {/* Header row */}
          <div className="sticky left-0 z-20 border-b border-line bg-surface" />
          {columns.map((col) => (
            <div
              key={col.key}
              className="border-b border-l border-line px-2 py-2 text-center text-sm"
              style={col.color ? { boxShadow: `inset 0 3px 0 ${col.color}` } : undefined}
            >
              <span
                className={`font-semibold ${col.day === today && query.view === "week" ? "text-brand" : ""}`}
              >
                {col.label}
              </span>
              {col.sub && <span className="block text-xs text-muted">{col.sub}</span>}
            </div>
          ))}

          {/* Hour labels */}
          <div
            className="sticky left-0 z-20 bg-surface"
            style={{ height: gridHeight }}
            aria-hidden="true"
          >
            {hourList.map((h) => (
              <div
                key={h}
                className="relative pr-2 text-right text-xs text-muted"
                style={{ height: HOUR_PX }}
              >
                <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {columnItems.map(({ col, items }) => (
            <div
              key={col.key}
              className="relative border-l border-line"
              style={{ height: gridHeight }}
            >
              {/* Empty hour cells are a mouse shortcut to "New booking"; keyboard users have the button. */}
              {hourList.map((h) => (
                <Link
                  key={h}
                  href={newBookingHref(col.day, `${String(h).padStart(2, "0")}:00`, col.staffId)}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="block border-b border-line/60 hover:bg-surface-2"
                  style={{ height: HOUR_PX }}
                />
              ))}

              {showNow && col.day === today && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger"
                  style={{ top: (nowMinutes - hours.startHour * 60) * MIN_PX }}
                />
              )}

              {items.map((item) => {
                const b = item.booking;
                const top = (item.start - hours.startHour * 60) * MIN_PX;
                const height = Math.max((item.end - item.start) * MIN_PX, 22);
                const width = 100 / item.lanes;
                return (
                  <Link
                    key={b.id}
                    href={`/dashboard/bookings/${b.id}` as Route}
                    data-status={b.status}
                    className="absolute z-10 overflow-hidden rounded-lg border-l-4 bg-brand-soft px-1.5 py-1 text-xs leading-tight text-ink shadow-sm hover:z-20 hover:ring-2 hover:ring-brand focus-visible:z-20 data-[status=completed]:opacity-60 data-[status=no_show]:line-through data-[status=pending]:border-dashed"
                    style={{
                      top,
                      height,
                      left: `calc(${item.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      borderLeftColor: b.staff_color,
                    }}
                  >
                    <span className="font-semibold">{formatTime(b.starts_at, tz)}</span>{" "}
                    <span className="font-medium">{b.customer_name}</span>
                    <span className="block truncate text-muted">
                      {b.service_name}
                      {query.view === "week" && !staffFilter ? ` · ${b.staff_name}` : ""}
                    </span>
                    {b.status !== "confirmed" && (
                      <span className="sr-only"> ({STATUS_LABEL[b.status]})</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        {columns.length === 0 && (
          <p className="p-5 text-sm text-muted">No active team members yet.</p>
        )}
      </section>
    </div>
  );
}

function WeekAgenda({
  days,
  bookings,
  tz,
  today,
}: {
  days: string[];
  bookings: BookingDetail[];
  tz: string;
  today: string;
}) {
  return (
    <section aria-label="Week agenda" className="space-y-4 md:hidden">
      {days.map((day) => {
        const list = bookings.filter((b) => localDay(new Date(b.starts_at), tz) === day);
        const p = dayParts(day);
        return (
          <div key={day}>
            <h2 className={`text-sm font-semibold ${day === today ? "text-brand" : ""}`}>
              {p.weekday} {p.date}
              {day === today && <span className="text-muted"> · Today</span>}
            </h2>
            {list.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No bookings</p>
            ) : (
              <ul className="mt-1 divide-y divide-line rounded-xl border border-line bg-surface">
                {list.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/dashboard/bookings/${b.id}` as Route}
                      className="flex gap-3 px-3 py-2.5 text-sm hover:bg-surface-2"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: b.staff_color }}
                      />
                      <span className="w-12 shrink-0 font-semibold">
                        {formatTime(b.starts_at, tz)}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium">{b.customer_name}</span>
                        <span className="block truncate text-muted">
                          {b.service_name} · {b.staff_name}
                          {b.status !== "confirmed" ? ` · ${STATUS_LABEL[b.status]}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
