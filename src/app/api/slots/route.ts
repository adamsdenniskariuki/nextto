import { NextResponse, type NextRequest } from "next/server";
import { fieldErrors } from "@/lib/validation/schemas";
import { slotsQuerySchema, type Slot } from "@/lib/validation/booking";
import { createAnonClient } from "@/lib/supabase/anon";

/**
 * GET /api/slots?business=<uuid>&service=<uuid>&day=YYYY-MM-DD[&staff=<uuid>]
 *
 * A Route Handler, the App Router's way to build an HTTP endpoint. The
 * booking page's client component calls it whenever the visitor picks a day.
 * Free slots are computed in SQL by available_slots(): working hours minus
 * bookings, breaks and time off.
 */
export async function GET(request: NextRequest) {
  const parsed = slotsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ errors: fieldErrors(parsed.error) }, { status: 400 });
  }
  const { business, service, day, staff } = parsed.data;

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("available_slots", {
    p_business_id: business,
    p_service_id: service,
    p_day: day,
    ...(staff ? { p_staff_id: staff } : {}),
  });
  if (error) {
    console.error("available_slots failed", error);
    return NextResponse.json({ error: "Could not load times" }, { status: 500 });
  }

  const slots: Slot[] = data.map((s) => ({
    staffId: s.staff_id,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
  }));

  // Availability changes with every booking, so never cache it.
  return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
}
