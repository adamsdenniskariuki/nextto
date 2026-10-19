import "server-only";
import { cache } from "react";
import { createAnonClient } from "@/lib/supabase/anon";
import {
  publicBookingConfirmationSchema,
  publicBookingPageSchema,
  type PublicBookingConfirmation,
  type PublicBookingPage,
} from "@/lib/validation/booking";

/**
 * Loads everything the public booking page needs in one round trip.
 *
 * Wrapped in React `cache` so that `generateMetadata` and the page component
 * share one database call per request.
 */
export const getBookingPage = cache(async (slug: string): Promise<PublicBookingPage | null> => {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_public_booking_page", { p_slug: slug });
  if (error) throw error;
  return data === null ? null : publicBookingPageSchema.parse(data);
});

export const getPublicBooking = cache(
  async (bookingId: string): Promise<PublicBookingConfirmation | null> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase.rpc("get_public_booking", { p_booking_id: bookingId });
    if (error) throw error;
    return data === null ? null : publicBookingConfirmationSchema.parse(data);
  },
);
