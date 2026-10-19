import { describe, expect, it } from "vitest";
import { NEXT_STATUSES, canChangeStatus, canReschedule } from "./booking-status";
import { layoutLanes, placeInDay, timeToMinutes, visibleHours } from "./calendar";
import {
  localDaysRange,
  minutesIntoDay,
  startOfWeek,
  zoneOffsetMinutes,
  zonedDateTimeToInstant,
} from "./datetime";
import { calendarQuerySchema, newBookingSchema, searchTerms } from "./validation/dashboard";

const NAIROBI = "Africa/Nairobi";

describe("time zone helpers", () => {
  it("knows Nairobi is UTC+3 all year", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), NAIROBI)).toBe(180);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), NAIROBI)).toBe(180);
  });

  it("turns Nairobi wall-clock time into the right instant", () => {
    expect(zonedDateTimeToInstant("2026-10-21", "10:00", NAIROBI).toISOString()).toBe(
      "2026-10-21T07:00:00.000Z",
    );
    // Local midnight is the previous UTC day.
    expect(zonedDateTimeToInstant("2026-10-21", "00:00", NAIROBI).toISOString()).toBe(
      "2026-10-20T21:00:00.000Z",
    );
  });

  it("handles a daylight-saving zone on both sides of the change", () => {
    // London: GMT in March before the 29th, BST (UTC+1) after.
    expect(zonedDateTimeToInstant("2026-03-28", "09:00", "Europe/London").toISOString()).toBe(
      "2026-03-28T09:00:00.000Z",
    );
    expect(zonedDateTimeToInstant("2026-03-30", "09:00", "Europe/London").toISOString()).toBe(
      "2026-03-30T08:00:00.000Z",
    );
  });

  it("reads minutes into the local day", () => {
    expect(minutesIntoDay("2026-10-21T07:30:00Z", NAIROBI)).toBe(630);
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-10-21")).toBe("2026-10-19"); // Wednesday
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19"); // Sunday
  });

  it("covers whole local days as a half-open range", () => {
    const { from, to } = localDaysRange("2026-10-19", "2026-10-25", NAIROBI);
    expect(from.toISOString()).toBe("2026-10-18T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-25T21:00:00.000Z");
  });
});

describe("calendar layout", () => {
  it("gives non-overlapping items the full width", () => {
    const out = layoutLanes([
      { start: 540, end: 600 },
      { start: 600, end: 660 },
    ]);
    expect(out.map((i) => [i.lane, i.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it("puts overlapping items side by side and reuses free lanes", () => {
    const out = layoutLanes([
      { start: 540, end: 660 }, // A 09:00–11:00
      { start: 570, end: 600 }, // B 09:30–10:00 overlaps A
      { start: 600, end: 630 }, // C 10:00–10:30 overlaps A, reuses B's lane
      { start: 720, end: 780 }, // D separate cluster
    ]);
    expect(out.map((i) => [i.start, i.lane, i.lanes])).toEqual([
      [540, 0, 2],
      [570, 1, 2],
      [600, 1, 2],
      [720, 0, 1],
    ]);
  });

  it("places bookings relative to the column's local midnight, clamped", () => {
    const dayStart = new Date("2026-10-20T21:00:00Z"); // 21 Oct 00:00 Nairobi
    expect(placeInDay("2026-10-21T07:00:00Z", "2026-10-21T07:45:00Z", dayStart)).toEqual({
      start: 600,
      end: 645,
    });
    // Runs past midnight: cut at the end of the day.
    expect(placeInDay("2026-10-21T20:00:00Z", "2026-10-21T22:00:00Z", dayStart)).toEqual({
      start: 1380,
      end: 1440,
    });
    // Entirely on another day: zero length.
    const other = placeInDay("2026-10-22T07:00:00Z", "2026-10-22T08:00:00Z", dayStart);
    expect(other.end - other.start).toBe(0);
  });

  it("parses Postgres times", () => {
    expect(timeToMinutes("09:30:00")).toBe(570);
    expect(timeToMinutes("18:00")).toBe(1080);
  });

  it("shows working hours, stretched to fit bookings", () => {
    expect(visibleHours([], [])).toEqual({ startHour: 8, endHour: 18 });
    expect(visibleHours([{ start_time: "09:00:00", end_time: "17:30:00" }], [])).toEqual({
      startHour: 9,
      endHour: 18,
    });
    expect(
      visibleHours(
        [{ start_time: "09:00:00", end_time: "17:00:00" }],
        [{ start: 7 * 60 + 15, end: 20 * 60 }],
      ),
    ).toEqual({ startHour: 7, endHour: 20 });
  });
});

describe("booking status machine (mirrors guard_booking_change)", () => {
  it("allows the expected changes", () => {
    expect(canChangeStatus("confirmed", "no_show")).toBe(true);
    expect(canChangeStatus("no_show", "confirmed")).toBe(true);
    expect(canChangeStatus("completed", "cancelled")).toBe(false);
    expect(NEXT_STATUSES.cancelled).toEqual([]);
  });

  it("only moves upcoming bookings", () => {
    expect(canReschedule("pending")).toBe(true);
    expect(canReschedule("confirmed")).toBe(true);
    expect(canReschedule("completed")).toBe(false);
    expect(canReschedule("cancelled")).toBe(false);
  });
});

describe("dashboard schemas", () => {
  it("falls back to defaults for bad search params", () => {
    expect(calendarQuerySchema.parse({ view: "month", date: "2026-02-30", staff: "x" })).toEqual({
      view: "week",
      date: undefined,
      staff: undefined,
    });
    expect(calendarQuerySchema.parse({ view: "day", date: "2026-10-21" })).toMatchObject({
      view: "day",
      date: "2026-10-21",
    });
  });

  const base = {
    businessId: "00000000-0000-4000-8000-000000000001",
    serviceId: "00000000-0000-4000-8000-000000000002",
    staffId: "00000000-0000-4000-8000-000000000003",
    date: "2026-10-21",
    time: "10:00",
  };

  it("needs a phone and name for a new customer", () => {
    const r = newBookingSchema.safeParse({ ...base, customerPhone: "", customerName: "" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["customerPhone", "customerName"]));
  });

  it("normalises the phone and defaults repeats", () => {
    const r = newBookingSchema.parse({
      ...base,
      customerPhone: "0712 345 678",
      customerName: "Akinyi",
      occurrences: "",
    });
    expect(r.customerPhone).toBe("+254712345678");
    expect(r.repeat).toBe("none");
    expect(r.occurrences).toBe(4);
  });

  it("accepts an existing customer without a phone", () => {
    const r = newBookingSchema.safeParse({
      ...base,
      customerId: "00000000-0000-4000-8000-000000000004",
    });
    expect(r.success).toBe(true);
  });

  it("bounds the number of repeats", () => {
    expect(
      newBookingSchema.safeParse({
        ...base,
        customerPhone: "0712345678",
        customerName: "Akinyi",
        repeat: "weekly",
        occurrences: "60",
      }).success,
    ).toBe(false);
  });

  it("makes search terms safe for a PostgREST or-filter", () => {
    expect(searchTerms("Wanji,ku).(")).toEqual({ name: "Wanjiku", phoneDigits: "" });
    expect(searchTerms("0712 345")).toEqual({ name: "0712 345", phoneDigits: "712345" });
    expect(searchTerms("O'Brien-Smith")).toMatchObject({ name: "O'Brien-Smith" });
  });
});
