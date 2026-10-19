import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/auth";
import { getCustomer, getTeamAndServices } from "@/lib/dashboard";
import { localDay } from "@/lib/datetime";
import { formatKenyanPhone } from "@/lib/phone";
import { newBookingQuerySchema } from "@/lib/validation/dashboard";
import { NewBookingForm } from "./new-booking-form";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage({
  searchParams,
}: PageProps<"/dashboard/bookings/new">) {
  const query = newBookingQuerySchema.parse(await searchParams);
  const { business } = await getCurrentMembership();
  const [team, customer] = await Promise.all([
    getTeamAndServices(business.id),
    query.customer ? getCustomer(query.customer) : null,
  ]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/calendar" className="text-sm text-muted hover:text-ink">
          ← Calendar
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">New booking</h1>
        <p className="mt-1 text-sm text-muted">
          Walk-ins and phone bookings. Times are in {business.timezone.replace("_", " ")} time.
        </p>
      </div>
      {team.services.length === 0 ? (
        <p className="card text-sm text-muted">Add a service before taking bookings.</p>
      ) : (
        <NewBookingForm
          businessId={business.id}
          services={team.services}
          staff={team.staff}
          staffServices={team.staffServices}
          customer={
            customer && customer.business_id === business.id
              ? {
                  id: customer.customer_id,
                  name: customer.name,
                  phone: formatKenyanPhone(customer.phone),
                }
              : undefined
          }
          defaults={{
            date: query.date ?? localDay(new Date(), business.timezone),
            time: query.time ?? "09:00",
            staffId: query.staff,
          }}
        />
      )}
    </div>
  );
}
