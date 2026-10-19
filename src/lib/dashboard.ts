import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import {
  bookingDetailSchema,
  bookingDetailsSchema,
  customerStatsSchema,
} from "@/lib/validation/dashboard";

/**
 * Dashboard reads. Every query runs as the signed-in user, so RLS limits it
 * to their businesses; the explicit business_id filters only pick WHICH of
 * their businesses.
 */

/** Bookings overlapping [from, to), via the GiST-indexed calendar_bookings(). */
export async function getCalendarBookings(businessId: string, from: Date, to: Date) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("calendar_bookings", {
    p_business_id: businessId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return bookingDetailsSchema.parse(data);
}

export const getBooking = cache(async (id: string) => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("booking_details")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? bookingDetailSchema.parse(data) : null;
});

/** Payments taken against a booking directly (deposits), newest first. RLS applies. */
export async function getBookingPayments(bookingId: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("payments")
    .select("id, method, status, amount_cents, mpesa_receipt, result_desc, paid_at, created_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}
/** Active staff, active services, and who offers what. */
export const getTeamAndServices = cache(async (businessId: string) => {
  const { supabase } = await requireUser();
  const [staff, services, links, hours] = await Promise.all([
    supabase
      .from("staff")
      .select("id, display_name, color")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("created_at"),
    supabase
      .from("services")
      .select("id, name, duration_minutes, price_cents")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order"),
    supabase.from("staff_services").select("staff_id, service_id").eq("business_id", businessId),
    supabase
      .from("working_hours")
      .select("staff_id, weekday, start_time, end_time")
      .eq("business_id", businessId),
  ]);
  for (const r of [staff, services, links, hours]) if (r.error) throw r.error;
  return {
    staff: staff.data ?? [],
    services: services.data ?? [],
    staffServices: links.data ?? [],
    workingHours: hours.data ?? [],
  };
});

export type TeamAndServices = Awaited<ReturnType<typeof getTeamAndServices>>;

export const getCustomer = cache(async (id: string) => {
  const { supabase } = await requireUser();
  const [stats, customer] = await Promise.all([
    supabase.from("customer_stats").select("*").eq("customer_id", id).maybeSingle(),
    supabase.from("customers").select("notes").eq("id", id).maybeSingle(),
  ]);
  if (stats.error) throw stats.error;
  if (customer.error) throw customer.error;
  if (!stats.data || !customer.data) return null;
  return { ...customerStatsSchema.parse(stats.data), notes: customer.data.notes };
});
