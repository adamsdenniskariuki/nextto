/**
 * Schemas for invoices and quotes: list filters, the editor form, manual
 * payments, rows from public.invoice_summaries, and the jsonb document from
 * public.get_shared_invoice() (used by the share page and both PDFs).
 */
import { z } from "zod";
import { Constants } from "@/lib/database.types";
import { isISODay } from "@/lib/datetime";
import { parseKESToCents } from "@/lib/money";
import { parseQuantity } from "@/lib/invoice-math";
import { phoneSchema } from "@/lib/validation/schemas";

const cents = z.number().int().nonnegative();
const day = z.string().refine(isISODay, "Choose a date");
const instant = z.iso.datetime({ offset: true });

export const invoiceStatusSchema = z.enum(Constants.public.Enums.invoice_status);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export const documentKindSchema = z.enum(Constants.public.Enums.document_kind);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Unpaid",
  partially_paid: "Part paid",
  paid: "Paid",
  void: "Void",
  accepted: "Accepted",
  declined: "Declined",
};

/** Quotes are "issued" too, but "Unpaid" would be wrong for them. */
export function statusLabel(kind: DocumentKind, status: InvoiceStatus): string {
  return kind === "quote" && status === "issued" ? "Sent" : INVOICE_STATUS_LABEL[status];
}

// ---------------------------------------------------------------------------
// The list: /dashboard/invoices?show=...
// ---------------------------------------------------------------------------
export const INVOICE_FILTERS = {
  all: "All",
  unpaid: "Unpaid",
  overdue: "Overdue",
  draft: "Drafts",
  paid: "Paid",
  quotes: "Quotes",
} as const;
export type InvoiceFilter = keyof typeof INVOICE_FILTERS;
const filterKeys = Object.keys(INVOICE_FILTERS) as [InvoiceFilter, ...InvoiceFilter[]];

export const invoiceListQuerySchema = z.object({
  show: z.enum(filterKeys).catch("all"),
});

export const newInvoiceQuerySchema = z.object({
  customer: z.uuid().optional().catch(undefined),
  kind: documentKindSchema.catch("invoice"),
});

export const invoiceSummarySchema = z.object({
  id: z.uuid(),
  business_id: z.uuid(),
  kind: documentKindSchema,
  number: z.string().nullable(),
  status: invoiceStatusSchema,
  customer_id: z.uuid(),
  customer_name: z.string(),
  customer_phone: z.string(),
  booking_id: z.uuid().nullable(),
  issue_date: day.nullable(),
  due_date: day.nullable(),
  created_at: instant,
  total_cents: cents,
  amount_paid_cents: cents,
  balance_cents: z.number().int(),
  deposit_cents: cents,
  amount_due_now_cents: cents,
  is_overdue: z.boolean(),
  days_overdue: z.number().int().nonnegative(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

// ---------------------------------------------------------------------------
// get_shared_invoice(share_token): the document as customers see it
// ---------------------------------------------------------------------------
export const sharedInvoiceSchema = z.object({
  invoice: z.object({
    id: z.uuid(),
    kind: documentKindSchema,
    number: z.string(),
    status: invoiceStatusSchema,
    issue_date: day,
    due_date: day.nullable(),
    currency: z.string(),
    vat_rate_bp: z.number().int(),
    subtotal_cents: cents,
    vat_cents: cents,
    total_cents: cents,
    deposit_cents: cents,
    amount_paid_cents: cents,
    balance_cents: z.number().int(),
    notes: z.string().nullable(),
  }),
  business: z.object({
    name: z.string(),
    slug: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    kra_pin: z.string().nullable(),
    invoice_footer: z.string().nullable(),
  }),
  customer: z.object({
    name: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
  }),
  items: z.array(
    z.object({
      description: z.string(),
      // numeric(10,2) arrives as a JSON number such as 1.5
      quantity: z.number().positive(),
      unit_price_cents: cents,
      line_total_cents: cents,
    }),
  ),
});
export type SharedInvoice = z.infer<typeof sharedInvoiceSchema>;

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(z.uuid().optional());

/** "1,500.50" -> 150050; empty -> 0. */
const kesAmount = (message: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return 0;
      const c = parseKESToCents(v);
      if (c === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return c;
    });

/** One editor row, as typed by the user. */
export const lineItemInputSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Describe the item")
    .max(300, "Keep it under 300 characters"),
  quantity: z.string().transform((v, ctx) => {
    const q = parseQuantity(v);
    if (q === null) {
      ctx.addIssue({ code: "custom", message: "A quantity like 1 or 1.5" });
      return z.NEVER;
    }
    return q;
  }),
  unitPrice: kesAmount("A price like 1,500 or 1500.50"),
});
export type LineItemInput = z.input<typeof lineItemInputSchema>;

/**
 * The editor posts its rows as one JSON string in a hidden field, so the
 * number of rows can change without renaming inputs.
 */
const itemsField = z
  .string()
  .transform((v, ctx) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Could not read the line items" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(lineItemInputSchema)
      .min(1, "Add at least one line item")
      .max(100, "At most 100 line items"),
  );

export const VAT_RATES = [
  { bp: 0, label: "No VAT" },
  { bp: 1600, label: "VAT 16%" },
] as const;

/** The standard choices, plus the business's own rate and the document's current one. */
export function vatOptions(...rates: number[]): { bp: number; label: string }[] {
  const options: { bp: number; label: string }[] = [...VAT_RATES];
  for (const bp of rates) {
    if (!options.some((o) => o.bp === bp)) options.push({ bp, label: `VAT ${bp / 100}%` });
  }
  return options;
}

export const invoiceDraftSchema = z
  .object({
    businessId: z.uuid(),
    invoiceId: optionalUuid,
    bookingId: optionalUuid,
    kind: documentKindSchema.default("invoice"),
    customerId: optionalUuid,
    customerName: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => v || undefined),
    customerPhone: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined)
      .pipe(phoneSchema.optional()),
    vatRateBp: z.coerce.number().int().min(0).max(10_000),
    deposit: kesAmount("An amount like 500").optional().default(0),
    dueDate: z
      .string()
      .optional()
      .transform((v) => v || undefined)
      .pipe(day.optional()),
    notes: z
      .string()
      .trim()
      .max(1000, "Keep notes under 1,000 characters")
      .optional()
      .transform((v) => v || undefined),
    items: itemsField,
  })
  .superRefine((v, ctx) => {
    if (v.customerId) return;
    if (!v.customerPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["customerPhone"],
        message: "Enter the customer's phone",
      });
    }
    if (!v.customerName || v.customerName.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["customerName"],
        message: "Enter the customer's name",
      });
    }
  });
export type InvoiceDraftInput = z.output<typeof invoiceDraftSchema>;

/** M-Pesa payments are STK pushes (increment 6); these are recorded by hand. */
export const MANUAL_PAYMENT_METHODS = {
  cash: "Cash",
  bank: "Bank transfer",
  card: "Card",
} as const;
type ManualMethod = keyof typeof MANUAL_PAYMENT_METHODS;
const methodKeys = Object.keys(MANUAL_PAYMENT_METHODS) as [ManualMethod, ...ManualMethod[]];

export const manualPaymentSchema = z.object({
  invoiceId: z.uuid(),
  method: z.enum(methodKeys, { error: "Choose how they paid" }),
  amount: kesAmount("An amount like 1,500").pipe(
    z.number().int().positive("Enter the amount paid"),
  ),
  reference: z
    .string()
    .trim()
    .max(100, "Keep the reference under 100 characters")
    .optional()
    .transform((v) => v || undefined),
});

export const documentActionSchema = z.object({ invoiceId: z.uuid() });
/**
 * Staff asking a customer to pay with M-Pesa (STK push). Exactly one target.
 * M-Pesa takes whole shillings; SQL (prepare_mpesa_request) re-checks the
 * amount against the balance, so this is only for instant feedback.
 */
export const mpesaRequestSchema = z
  .object({
    invoiceId: z.uuid().optional(),
    bookingId: z.uuid().optional(),
    phone: phoneSchema,
    amount: kesAmount("An amount like 1,500")
      .pipe(
        z
          .number()
          .int()
          .refine((c) => c % 100 === 0, "M-Pesa takes whole shillings only")
          .refine((c) => c <= 25_000_000, "M-Pesa allows at most Ksh 250,000"),
      )
      .optional()
      .transform((c) => c || undefined),
  })
  .refine((v) => Boolean(v.invoiceId) !== Boolean(v.bookingId), {
    message: "Choose an invoice or a booking",
    path: ["_form"],
  });

export type MpesaRequestInput = z.output<typeof mpesaRequestSchema>;
