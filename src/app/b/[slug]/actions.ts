"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/anon";
import { bookPublicResultSchema, publicBookingSchema } from "@/lib/validation/booking";
import { fieldErrors } from "@/lib/validation/schemas";

export type BookingState =
  | { status: "idle" }
  | {
      status: "error";
      errors: Record<string, string>;
      /** What the visitor typed, so React's post-action form reset doesn't wipe it. */
      values: Partial<Record<"name" | "phone" | "email" | "notes", string>>;
      slotTaken?: boolean;
    };

/**
 * Server Action behind the booking form. It re-validates everything with the
 * shared Zod schema, then calls book_public(). That SQL function re-checks
 * availability, and the exclusion constraint settles any race: two visitors
 * can't both win the same slot.
 */
export async function bookAppointment(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const raw = Object.fromEntries(formData);
  const values = {
    name: String(raw.name ?? ""),
    phone: String(raw.phone ?? ""),
    email: String(raw.email ?? ""),
    notes: String(raw.notes ?? ""),
  };
  const parsed = publicBookingSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", values, errors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("book_public", {
    p_slug: input.slug,
    p_service_id: input.serviceId,
    p_starts_at: input.startsAt,
    p_customer_name: input.name,
    p_customer_phone: input.phone,
    ...(input.email ? { p_customer_email: input.email } : {}),
    ...(input.staffId ? { p_staff_id: input.staffId } : {}),
    ...(input.notes ? { p_notes: input.notes } : {}),
  });

  if (error) {
    // Map Postgres SQLSTATE codes (raised in book_public) to friendly messages.
    switch (error.code) {
      case "23P01": // exclusion_violation: slot taken or no longer offered
        return {
          status: "error",
          values,
          slotTaken: true,
          errors: { startsAt: "Sorry, that time was just taken. Please pick another." },
        };
      case "P0002": // no_data_found: business or service missing/inactive
        return {
          status: "error",
          values,
          errors: { _form: "This service is no longer available." },
        };
      case "22023": // invalid_parameter_value
        return { status: "error", values, errors: { _form: error.message } };
      default:
        console.error("book_public failed", error);
        return {
          status: "error",
          values,
          errors: { _form: "Something went wrong. Please try again." },
        };
    }
  }

  const result = bookPublicResultSchema.parse(data);
  // redirect() throws, so nothing after it runs. Do it outside try/catch.
  redirect(`/b/${input.slug}/confirmed/${result.booking_id}` as Route);
}
