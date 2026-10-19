"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import { getMemberships, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/booking-status";
import { zonedDateTimeToInstant } from "@/lib/datetime";
import {
  REPEAT_OPTIONS,
  bookingNotesSchema,
  newBookingSchema,
  rescheduleSchema,
  statusChangeSchema,
} from "@/lib/validation/dashboard";
import { fieldErrors } from "@/lib/validation/schemas";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      errors: Record<string, string>;
      /** What was submitted, so React's post-action form reset doesn't wipe it. */
      values?: Record<string, string>;
    };

/** Postgres SQLSTATE -> a message a receptionist can act on. */
function dbError(error: PostgrestError, field = "_form"): FormState {
  switch (error.code) {
    case "23P01": // exclusion_violation (bookings_no_overlap)
      return {
        status: "error",
        errors: { [field]: "That time clashes with another booking for this team member." },
      };
    case "23514": // check_violation, including guard_booking_change()
    case "22023": // invalid_parameter_value, raised by our functions
      return { status: "error", errors: { _form: error.message } };
    case "P0002":
      return { status: "error", errors: { _form: "That booking no longer exists." } };
    case "42501":
      return { status: "error", errors: { _form: "You don't have permission to do that." } };
    default:
      console.error("dashboard booking action failed", error);
      return { status: "error", errors: { _form: "Something went wrong. Please try again." } };
  }
}

const withValues = (state: FormState, values: Record<string, string>): FormState =>
  state.status === "error" ? { ...state, values } : state;

/** Find-or-create a customer by phone. The phone is unique per business. */
async function customerIdFor(
  businessId: string,
  phone: string,
  name: string,
): Promise<{ id: string } | { error: PostgrestError }> {
  const { supabase } = await requireUser();
  // ignoreDuplicates -> ON CONFLICT DO NOTHING: an existing customer keeps their name.
  const { error: upsertError } = await supabase
    .from("customers")
    .upsert(
      { business_id: businessId, phone, name },
      { onConflict: "business_id,phone", ignoreDuplicates: true },
    );
  if (upsertError) return { error: upsertError };
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .single();
  return error ? { error } : { id: data.id };
}

export async function createBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  const parsed = newBookingSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error), values };
  const input = parsed.data;

  const membership = (await getMemberships()).find((m) => m.business.id === input.businessId);
  if (!membership) return { status: "error", errors: { _form: "Business not found." }, values };
  const { supabase } = await requireUser();

  let customerId = input.customerId;
  if (!customerId) {
    const found = await customerIdFor(input.businessId, input.customerPhone!, input.customerName!);
    if ("error" in found) return withValues(dbError(found.error), values);
    customerId = found.id;
  }

  // The form's date + time are Nairobi wall-clock; turn them into an instant.
  const startsAt = zonedDateTimeToInstant(
    input.date,
    input.time,
    membership.business.timezone,
  ).toISOString();
  const every = REPEAT_OPTIONS[input.repeat].interval;

  if (!every) {
    const { data, error } = await supabase.rpc("create_booking", {
      p_service_id: input.serviceId,
      p_staff_id: input.staffId,
      p_customer_id: customerId,
      p_starts_at: startsAt,
      ...(input.notes ? { p_notes: input.notes } : {}),
    });
    if (error) return withValues(dbError(error, "time"), values);
    revalidatePath("/dashboard", "layout");
    redirect(`/dashboard/bookings/${data.id}` as Route);
  }

  // A series is all-or-nothing: one clash rolls back every occurrence.
  const { error } = await supabase.rpc("create_recurring_bookings", {
    p_staff_id: input.staffId,
    p_service_id: input.serviceId,
    p_customer_id: customerId,
    p_first_start: startsAt,
    p_every: every,
    p_occurrences: input.occurrences,
    ...(input.notes ? { p_notes: input.notes } : {}),
  });
  if (error) {
    const state = dbError(error, "time");
    if (error.code === "23P01") {
      return {
        status: "error",
        values,
        errors: { time: "One of the repeats clashes with another booking. Nothing was booked." },
      };
    }
    return withValues(state, values);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/calendar?view=week&date=${input.date}` as Route);
}

export async function changeStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = statusChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const { supabase } = await requireUser();
  // The guard_booking_change trigger enforces the allowed transitions.
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.bookingId)
    .select("id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { status: "error", errors: { _form: "That booking no longer exists." } };
  revalidatePath("/dashboard", "layout");
  return { status: "ok", message: `Marked as ${STATUS_LABEL[parsed.data.status].toLowerCase()}.` };
}

export async function rescheduleBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  const parsed = rescheduleSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error), values };
  const { supabase } = await requireUser();

  const { data: booking } = await supabase
    .from("bookings")
    .select("business:businesses(timezone)")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();
  if (!booking?.business)
    return { status: "error", errors: { _form: "That booking no longer exists." } };

  const startsAt = zonedDateTimeToInstant(
    parsed.data.date,
    parsed.data.time,
    booking.business.timezone,
  );
  const { error } = await supabase.rpc("reschedule_booking", {
    p_booking_id: parsed.data.bookingId,
    p_starts_at: startsAt.toISOString(),
    ...(parsed.data.staffId ? { p_staff_id: parsed.data.staffId } : {}),
  });
  if (error) return withValues(dbError(error, "time"), values);
  revalidatePath("/dashboard", "layout");
  return { status: "ok", message: "Booking moved." };
}

export async function saveBookingNotes(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  const parsed = bookingNotesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: fieldErrors(parsed.error),
      values: { notes: String(raw.notes ?? "") },
    };
  }
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("bookings")
    .update({ notes: parsed.data.notes || null })
    .eq("id", parsed.data.bookingId);
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  return { status: "ok", message: "Notes saved." };
}
