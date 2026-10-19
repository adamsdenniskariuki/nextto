import { describe, expect, it } from "vitest";
import {
  bucketTrend,
  heatIntensity,
  heatmapGrid,
  isoWeekday,
  niceCeiling,
  parseReportRange,
  reportPeriod,
  type TrendDay,
} from "./reports-math";
import { addDays } from "./datetime";

const day = (d: string, revenue = 0, bookings = 0): TrendDay => ({
  day: d,
  revenue_cents: revenue,
  running_total_cents: 0,
  moving_avg_7d_cents: revenue,
  change_vs_prev_day_cents: 0,
  bookings_count: bookings,
});

describe("ranges", () => {
  it("parses ?range= with a safe default", () => {
    expect(parseReportRange("90d")).toBe("90d");
    expect(parseReportRange("1000d")).toBe("30d");
    expect(parseReportRange(["7d"])).toBe("30d");
    expect(parseReportRange(undefined)).toBe("30d");
    expect(parseReportRange("constructor")).toBe("30d");
  });

  it("counts today as the last of N days", () => {
    expect(reportPeriod("7d", "2026-03-10")).toEqual({ from: "2026-03-04", to: "2026-03-10" });
    expect(reportPeriod("365d", "2026-03-10").from).toBe("2025-03-11");
  });
});

describe("isoWeekday", () => {
  it("numbers Monday 1 to Sunday 7", () => {
    expect(isoWeekday("2026-03-09")).toBe(1); // Monday
    expect(isoWeekday("2026-03-15")).toBe(7); // Sunday
  });
});

describe("bucketTrend", () => {
  it("keeps daily buckets up to 92 days", () => {
    const days = Array.from({ length: 30 }, (_, i) => day(addDays("2026-03-01", i), 100));
    const buckets = bucketTrend(days);
    expect(buckets).toHaveLength(30);
    expect(buckets[0]).toMatchObject({
      start: "2026-03-01",
      end: "2026-03-01",
      revenue_cents: 100,
    });
  });

  it("groups long ranges into Monday-to-Sunday weeks", () => {
    // Wed 2026-01-07 .. 100 days later: a partial first week, then full weeks.
    const days = Array.from({ length: 100 }, (_, i) => day(addDays("2026-01-07", i), 100, 1));
    const weeks = bucketTrend(days);
    expect(weeks[0]).toMatchObject({ start: "2026-01-07", end: "2026-01-11", revenue_cents: 500 });
    expect(weeks[1]).toMatchObject({ start: "2026-01-12", end: "2026-01-18", revenue_cents: 700 });
    expect(weeks[1]!.moving_avg_7d_cents).toBeNull();
    expect(weeks.reduce((s, w) => s + w.bookings_count, 0)).toBe(100);
  });
});

describe("niceCeiling", () => {
  it.each([
    [0, 1],
    [1, 1],
    [7_300, 10_000],
    [1_800, 2_000],
    [450_000, 500_000],
    [500_000, 500_000],
  ])("%d -> %d", (input, out) => expect(niceCeiling(input)).toBe(out));
});

describe("heatmap", () => {
  it("covers 08:00-18:00 at least, and widens for early or late bookings", () => {
    expect(heatmapGrid([]).rows.map((r) => r.hour)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    const grid = heatmapGrid([
      { weekday: 1, hour: 6, bookings_count: 2 },
      { weekday: 7, hour: 20, bookings_count: 4 },
    ]);
    expect(grid.rows[0]).toEqual({ hour: 6, counts: [2, 0, 0, 0, 0, 0, 0] });
    expect(grid.rows.at(-1)).toEqual({ hour: 20, counts: [0, 0, 0, 0, 0, 0, 4] });
    expect(grid.max).toBe(4);
  });

  it("shades any booking visibly and the busiest fully", () => {
    expect(heatIntensity(0, 4)).toBe(0);
    expect(heatIntensity(1, 100)).toBeGreaterThan(0.15);
    expect(heatIntensity(4, 4)).toBe(1);
  });
});
