/**
 * Schemas for the owner/staff dashboard: URL params, form posts, and rows
 * read from the security_invoker views.
 *
 * Why parse view rows? Postgres can't promise a view column is NOT NULL, so
 * the generated types make every view column nullable. Parsing once at the
 * boundary gives the UI precise, non-null types (and a loud error if the SQL
 * and the TypeScript ever disagree).
 */
import { z } from "zod";
import { isISODay } from "@/lib/datetime";
import { bookingStatusSchema } from "@/lib/validation/booking";
import { phoneSchema } from "@/lib/validation/schemas";

const instant = z.iso.datetime({ offset: true });
const cents = z.number().int().nonnegative();
const count = z.number().int().nonnegative();
const day = z.string().refine(isISODay, "Choose a date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time");
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => v || undefined);
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(z.uuid().optional());

// ---------------------------------------------------------------------------
// URL search params. `.catch()` turns a hand-edited bad value into the
// default instead of an error page.
// ---------------------------------------------------------------------------
export const calendarQuerySchema = z.object({
  view: z.enum(["day", "week"]).catch("week"),
  date: day.optional().catch(undefined),
  staff: z.uuid().optional().catch(undefined),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const newBookingQuerySchema = z.object({
  date: day.optional().catch(undefined),
  time: time.optional().catch(undefined),
  staff: z.uuid().optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
});

export const customerSearchSchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
});

// ---------------------------------------------------------------------------
// Rows from public.booking_details / calendar_bookings()
// ---------------------------------------------------------------------------
export const bookingDetailSchema = z.object({
  id: z.uuid(),
  business_id: z.uuid(),
  staff_id: z.uuid(),
  service_id: z.uuid(),
  customer_id: z.uuid(),
  series_id: z.uuid().nullable(),
  starts_at: instant,
  ends_at: instant,
  status: bookingStatusSchema,
  source: z.enum(["public", "dashboard"]),
  price_cents: cents,
  deposit_cents: cents,
  notes: z.string().nullable(),
  customer_name: z.string(),
  customer_phone: z.string(),
  service_name: z.string(),
  staff_name: z.string(),
  staff_color: z.string(),
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;
export const bookingDetailsSchema = z.array(bookingDetailSchema);

// ---------------------------------------------------------------------------
// Rows from public.customer_stats
// ---------------------------------------------------------------------------
export const customerStatsSchema = z.object({
  customer_id: z.uuid(),
  business_id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  visits: count,
  no_shows: count,
  cancellations: count,
  upcoming: count,
  completed_value_cents: cents,
  last_visit_at: instant.nullable(),
  next_visit_at: instant.nullable(),
});
export type CustomerStats = z.infer<typeof customerStatsSchema>;

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
export const REPEAT_OPTIONS = {
  none: { label: "Does not repeat", interval: null },
  weekly: { label: "Every week", interval: "7 days" },
  fortnightly: { label: "Every 2 weeks", interval: "14 days" },
  monthly: { label: "Every month", interval: "1 month" },
} as const;
export type RepeatOption = keyof typeof REPEAT_OPTIONS;
const repeatKeys = Object.keys(REPEAT_OPTIONS) as [RepeatOption, ...RepeatOption[]];

export const newBookingSchema = z
  .object({
    businessId: z.uuid(),
    serviceId: z.uuid({ error: "Choose a service" }),
    staffId: z.uuid({ error: "Choose who will do it" }),
    // Either an existing customer, or a phone (+ name for a new customer).
    customerId: optionalUuid,
    customerName: optionalText(120, "Keep the name under 120 characters"),
    customerPhone: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined)
      .pipe(phoneSchema.optional()),
    date: day,
    time,
    notes: optionalText(500, "Keep notes under 500 characters"),
    repeat: z.enum(repeatKeys).default("none"),
    occurrences: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().min(2, "At least 2").max(52, "At most 52").default(4),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.customerId) return;
    if (!v.customerPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["customerPhone"],
        message: "Enter the customer's phone",
      });
    }
    if (!v.customerName || v.customerName.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["customerName"],
        message: "Enter the customer's name",
      });
    }
  });
export type NewBookingInput = z.output<typeof newBookingSchema>;

export const rescheduleSchema = z.object({
  bookingId: z.uuid(),
  date: day,
  time,
  staffId: optionalUuid,
});

export const statusChangeSchema = z.object({
  bookingId: z.uuid(),
  status: bookingStatusSchema,
});

export const bookingNotesSchema = z.object({
  bookingId: z.uuid(),
  notes: z.string().trim().max(500, "Keep notes under 500 characters"),
});

export const customerNotesSchema = z.object({
  customerId: z.uuid(),
  notes: z.string().trim().max(2000, "Keep notes under 2,000 characters"),
});

export const switchBusinessSchema = z.object({ businessId: z.uuid() });

/**
 * A search term made safe for a PostgREST `or=(...)` filter: commas, dots,
 * brackets and quotes have meaning there, so keep only letters, digits,
 * spaces, apostrophes and dashes.
 */
export function searchTerms(q: string): { name: string; phoneDigits: string } {
  const name = q
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} '-]/gu, "")
    .trim();
  // "0712 345" -> "712345" so it matches the stored "+254712345...".
  const phoneDigits = q.replace(/\D/g, "").replace(/^(254|0)/, "");
  return { name, phoneDigits };
}
