import { describe, expect, it } from "vitest";
import {
  addDays,
  dayParts,
  formatDateTimeLong,
  formatDuration,
  formatTime,
  isISODay,
  localDay,
  upcomingDays,
} from "@/lib/datetime";
import { buildICS, icsDate, icsEscape } from "@/lib/ics";
import { whatsappLink } from "@/lib/phone";
import {
  publicBookingConfirmationSchema,
  publicBookingSchema,
  slotsQuerySchema,
} from "@/lib/validation/booking";

const UUID = "3f1c2b8e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("datetime", () => {
  it("finds the Nairobi calendar day of an instant, not the UTC day", () => {
    // 22:30 UTC on the 20th is 01:30 EAT on the 21st.
    const instant = new Date("2026-10-20T22:30:00Z");
    expect(localDay(instant, "UTC")).toBe("2026-10-20");
    expect(localDay(instant, "Africa/Nairobi")).toBe("2026-10-21");
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  it("lists upcoming local days starting today", () => {
    const now = new Date("2026-10-20T22:30:00Z");
    expect(upcomingDays(3, "Africa/Nairobi", now)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
  });

  it("validates ISO days strictly", () => {
    expect(isISODay("2026-10-21")).toBe(true);
    expect(isISODay("2026-02-30")).toBe(false);
    expect(isISODay("21/10/2026")).toBe(false);
  });

  it("formats times in the business zone regardless of the runtime's zone", () => {
    expect(formatTime("2026-10-21T07:00:00+00:00", "Africa/Nairobi")).toBe("10:00");
    expect(formatDateTimeLong("2026-10-21T07:00:00+00:00", "Africa/Nairobi")).toBe(
      "Wednesday, 21 October 2026 at 10:00",
    );
    expect(dayParts("2026-10-21")).toEqual({ weekday: "Wed", date: "21 Oct" });
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});

describe("ics", () => {
  it("writes UTC timestamps and escapes text", () => {
    expect(icsDate(new Date("2026-10-21T07:00:00Z"))).toBe("20261021T070000Z");
    expect(icsEscape("Cut, wash; dry\\style\nnow")).toBe("Cut\\, wash\\; dry\\\\style\\nnow");
  });

  it("builds a CRLF calendar with folded long lines", () => {
    const ics = buildICS(
      {
        uid: "abc@nextto.app",
        start: new Date("2026-10-21T07:00:00Z"),
        end: new Date("2026-10-21T08:00:00Z"),
        summary: "Haircut at Mama Njeri's Salon",
        description: "x".repeat(200),
      },
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261021T070000Z\r\n");
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"x".repeat(200)}`);
  });
});

describe("whatsappLink", () => {
  it("strips the plus and encodes the message", () => {
    expect(whatsappLink("+254712345678", "Hi & hello")).toBe(
      "https://wa.me/254712345678?text=Hi+%26+hello",
    );
  });
});

describe("booking schemas", () => {
  it("treats an empty staff param as 'anyone'", () => {
    const q = slotsQuerySchema.parse({
      business: UUID,
      service: UUID,
      day: "2026-10-21",
      staff: "",
    });
    expect(q.staff).toBeUndefined();
    expect(
      slotsQuerySchema.safeParse({ business: UUID, service: UUID, day: "tomorrow" }).success,
    ).toBe(false);
  });

  it("normalises the guest phone and requires a chosen time", () => {
    const base = {
      slug: "demo-salon",
      serviceId: UUID,
      name: "Wanjiru Kamau",
      phone: "0712 345 678",
      email: "",
    };
    const ok = publicBookingSchema.parse({ ...base, startsAt: "2026-10-21T07:00:00+00:00" });
    expect(ok.phone).toBe("+254712345678");
    expect(ok.email).toBeUndefined();

    const missing = publicBookingSchema.safeParse({ ...base, startsAt: "" });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(["startsAt"]);
  });

  it("parses Postgres timestamptz JSON in the confirmation payload", () => {
    const parsed = publicBookingConfirmationSchema.parse({
      booking_id: UUID,
      reference: "3F1C2B8E",
      status: "pending",
      starts_at: "2026-10-21T07:00:00+00:00",
      ends_at: "2026-10-21T08:00:00+00:00",
      price_cents: 150000,
      deposit_cents: 50000,
      customer_first_name: "Wanjiru",
      service_name: "Haircut",
      staff_name: "Njeri",
      business: {
        slug: "demo-salon",
        name: "Demo",
        timezone: "Africa/Nairobi",
        phone: null,
        address: null,
      },
    });
    expect(parsed.status).toBe("pending");
  });
});
