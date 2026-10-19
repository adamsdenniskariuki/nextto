import type { Database } from "@/lib/database.types";

export type BookingStatus = Database["public"]["Enums"]["booking_status"];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Awaiting deposit",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/**
 * Allowed status changes. This mirrors the trigger
 * private.guard_booking_change() (migration 20261019100900_dashboard.sql),
 * which is the real authority; the UI uses this copy to decide which
 * buttons to show.
 */
export const NEXT_STATUSES: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: ["confirmed"],
  no_show: ["confirmed"],
  cancelled: [],
};

export function canChangeStatus(from: BookingStatus, to: BookingStatus): boolean {
  return NEXT_STATUSES[from].includes(to);
}

/** Only upcoming (pending/confirmed) bookings may be moved. */
export function canReschedule(status: BookingStatus): boolean {
  return status === "pending" || status === "confirmed";
}
