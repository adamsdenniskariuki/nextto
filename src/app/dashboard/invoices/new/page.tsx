import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/auth";
import { getCustomer, getTeamAndServices } from "@/lib/dashboard";
import { getInvoiceSettings } from "@/lib/invoices";
import { formatKenyanPhone } from "@/lib/phone";
import { newInvoiceQuerySchema, vatOptions } from "@/lib/validation/invoices";
import { InvoiceEditor } from "../invoice-editor";

export async function generateMetadata({
  searchParams,
}: PageProps<"/dashboard/invoices/new">): Promise<Metadata> {
  const { kind } = newInvoiceQuerySchema.parse(await searchParams);
  return { title: kind === "quote" ? "New quote" : "New invoice" };
}

export default async function NewInvoicePage({
  searchParams,
}: PageProps<"/dashboard/invoices/new">) {
  const query = newInvoiceQuerySchema.parse(await searchParams);
  const { business } = await getCurrentMembership();
  const [team, settings, customer] = await Promise.all([
    getTeamAndServices(business.id),
    getInvoiceSettings(business.id),
    query.customer ? getCustomer(query.customer) : null,
  ]);
  const isQuote = query.kind === "quote";

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/dashboard/invoices" className="text-sm text-muted hover:text-ink">
          ← Invoices
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
          {isQuote ? "New quote" : "New invoice"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Saved as a draft first. It gets its number when you issue it.
        </p>
      </div>
      <InvoiceEditor
        businessId={business.id}
        kind={query.kind}
        customer={
          customer && customer.business_id === business.id
            ? {
                id: customer.customer_id,
                name: customer.name,
                phone: formatKenyanPhone(customer.phone),
              }
            : undefined
        }
        services={team.services}
        vatOptions={vatOptions(settings.defaultVatRateBp)}
        initial={{
          items: [],
          vatRateBp: settings.defaultVatRateBp,
          deposit: "",
          dueDate: "",
          notes: "",
        }}
      />
    </div>
  );
}
