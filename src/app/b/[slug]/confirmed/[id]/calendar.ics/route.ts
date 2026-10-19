import { publicEnv } from "@/lib/env";
import { buildICS } from "@/lib/ics";
import { getPublicBooking } from "@/lib/public-booking";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /b/<slug>/confirmed/<id>/calendar.ics
 * A Route Handler that returns a file rather than JSON. The folder is named
 * "calendar.ics", so the URL ends in .ics and phones open it in their calendar app.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/b/[slug]/confirmed/[id]/calendar.ics">,
) {
  const { slug, id } = await params;
  const booking = UUID.test(id) ? await getPublicBooking(id) : null;
  if (!booking || booking.business.slug !== slug.toLowerCase() || booking.status === "cancelled") {
    return new Response("Not found", { status: 404 });
  }

  const ics = buildICS({
    uid: `${booking.booking_id}@nextto.app`,
    start: new Date(booking.starts_at),
    end: new Date(booking.ends_at),
    summary: `${booking.service_name} at ${booking.business.name}`,
    description: `With ${booking.staff_name}. Reference ${booking.reference}.`,
    ...(booking.business.address ? { location: booking.business.address } : {}),
    url: new URL(`/b/${slug}/confirmed/${id}`, publicEnv.NEXT_PUBLIC_SITE_URL).href,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="nextto-${booking.reference}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
