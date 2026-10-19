/**
 * Schemas for the public booking flow.
 *
 * Two jobs:
 *   1. Validate input (query strings, form posts) on the server.
 *   2. Parse the jsonb returned by SQL functions. supabase-js types an RPC
 *      that returns jsonb as the loose `Json` type; parsing it with Zod gives
 *      a precise TypeScript type and fails loudly if SQL and TS drift apart.
 */
import { z } from "zod";
import { Constants } from "@/lib/database.types";
import { isISODay } from "@/lib/datetime";
import { BUSINESS_TYPES, emailSchema, phoneSchema, slugSchema } from "@/lib/validation/schemas";

// Postgres renders timestamptz in JSON as "2026-10-21T07:00:00+00:00".
const instant = z.iso.datetime({ offset: true });
const cents = z.number().int().nonnegative();
const day = z.string().refine(isISODay, "Use a YYYY-MM-DD date");

// ---------------------------------------------------------------------------
// get_public_booking_page(slug)
// ---------------------------------------------------------------------------
export const publicServiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  duration_minutes: z.number().int().positive(),
  price_cents: cents,
  deposit_cents: cents,
  staff_ids: z.array(z.uuid()),
});

export const publicStaffSchema = z.object({
  id: z.uuid(),
  display_name: z.string(),
  color: z.string().nullable(),
});

export const publicBookingPageSchema = z.object({
  business: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    business_type: z.enum(BUSINESS_TYPES),
    timezone: z.string(),
    currency: z.string(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  labels: z.object({ staff: z.string(), customer: z.string(), booking: z.string() }),
  services: z.array(publicServiceSchema),
  staff: z.array(publicStaffSchema),
});

export type PublicBookingPage = z.infer<typeof publicBookingPageSchema>;
export type PublicService = z.infer<typeof publicServiceSchema>;
export type PublicStaff = z.infer<typeof publicStaffSchema>;

// ---------------------------------------------------------------------------
// GET /api/slots
// ---------------------------------------------------------------------------
export const slotsQuerySchema = z.object({
  business: z.uuid(),
  service: z.uuid(),
  day,
  // An empty string or a missing param both mean "any staff member".
  staff: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.uuid().optional()),
});

export const slotSchema = z.object({
  staffId: z.uuid(),
  startsAt: instant,
  endsAt: instant,
});
export const slotsResponseSchema = z.object({ slots: z.array(slotSchema) });
export type Slot = z.infer<typeof slotSchema>;

// ---------------------------------------------------------------------------
// The booking form (server action) and book_public's result
// ---------------------------------------------------------------------------
export const publicBookingSchema = z.object({
  slug: slugSchema,
  serviceId: z.uuid({ error: "Choose a service" }),
  staffId: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.uuid().optional()),
  startsAt: instant.or(z.literal("")).refine((v) => v !== "", "Choose a time"),
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(emailSchema.optional()),
  notes: z.string().trim().max(500, "Keep notes under 500 characters").optional(),
});
export type PublicBookingInput = z.output<typeof publicBookingSchema>;

// Built from the generated Constants, so a new enum value in SQL flows through.
export const bookingStatusSchema = z.enum(Constants.public.Enums.booking_status);

export const bookPublicResultSchema = z.object({
  booking_id: z.uuid(),
  reference: z.string(),
  status: bookingStatusSchema,
});

// ---------------------------------------------------------------------------
// get_public_booking(id)
// ---------------------------------------------------------------------------
export const publicBookingConfirmationSchema = z.object({
  booking_id: z.uuid(),
  reference: z.string(),
  status: bookingStatusSchema,
  starts_at: instant,
  ends_at: instant,
  price_cents: cents,
  deposit_cents: cents,
  customer_first_name: z.string(),
  service_name: z.string(),
  staff_name: z.string(),
  business: z.object({
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
});
export type PublicBookingConfirmation = z.infer<typeof publicBookingConfirmationSchema>;
