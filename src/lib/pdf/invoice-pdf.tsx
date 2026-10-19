/**
 * The invoice / quote PDF, drawn with @react-pdf/renderer.
 *
 * react-pdf uses React components (Document, Page, View, Text) and a subset
 * of CSS (flexbox) to lay out a PDF. Route handlers render it to a Buffer on
 * the server with renderToBuffer(); nothing here runs in the browser.
 *
 * Fonts: the built-in Helvetica keeps the bundle small and needs no files,
 * but it only covers Latin-1, so fixed strings avoid characters like "−".
 */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDayShort } from "@/lib/datetime";
import { formatVatRate } from "@/lib/invoice-math";
import { formatKES } from "@/lib/money";
import { formatKenyanPhone } from "@/lib/phone";
import { statusLabel, type SharedInvoice } from "@/lib/validation/invoices";

const BRAND = "#ff5a36";
const INK = "#15171f";
const MUTED = "#5b5f6b";
const LINE = "#e2ded3";

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  business: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: MUTED },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: BRAND, textAlign: "right" },
  meta: { textAlign: "right" },
  parties: { marginBottom: 20 },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  bold: { fontFamily: "Helvetica-Bold" },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: INK,
    paddingBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 6,
  },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 50, textAlign: "right" },
  colPrice: { width: 90, textAlign: "right" },
  colTotal: { width: 90, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.5,
    borderTopColor: INK,
    marginTop: 4,
    paddingTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  notes: { marginTop: 24 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: MUTED,
    textAlign: "center",
  },
});

export function InvoicePdf({ doc }: { doc: SharedInvoice }) {
  const { invoice: inv, business: biz, customer, items } = doc;
  const isQuote = inv.kind === "quote";
  const title = isQuote ? "Quote" : "Invoice";
  const footer = [biz.invoice_footer, "Pay by M-Pesa, cash or bank transfer", "Sent with Nextto"]
    .filter(Boolean)
    .join("  |  ");

  return (
    <Document
      title={`${title} ${inv.number} - ${biz.name}`}
      author={biz.name}
      creator="Nextto"
      producer="Nextto"
      language="en-KE"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.business}>{biz.name}</Text>
            {biz.address && <Text style={s.muted}>{biz.address}</Text>}
            {biz.phone && <Text style={s.muted}>{formatKenyanPhone(biz.phone)}</Text>}
            {biz.email && <Text style={s.muted}>{biz.email}</Text>}
            {biz.kra_pin && <Text style={s.muted}>KRA PIN: {biz.kra_pin}</Text>}
          </View>
          <View>
            <Text style={s.title}>{title}</Text>
            <Text style={[s.meta, s.bold]}>{inv.number}</Text>
            <Text style={[s.meta, s.muted]}>Date: {formatDayShort(inv.issue_date)}</Text>
            {inv.due_date && (
              <Text style={[s.meta, s.muted]}>
                {isQuote ? "Valid until" : "Due"}: {formatDayShort(inv.due_date)}
              </Text>
            )}
            <Text style={[s.meta, s.bold]}>{statusLabel(inv.kind, inv.status)}</Text>
          </View>
        </View>

        <View style={s.parties}>
          <Text style={s.label}>{isQuote ? "Prepared for" : "Bill to"}</Text>
          <Text style={s.bold}>{customer.name}</Text>
          <Text>{formatKenyanPhone(customer.phone)}</Text>
          {customer.email && <Text>{customer.email}</Text>}
        </View>

        {/* `fixed` repeats the header row on every page of a long invoice. */}
        <View style={s.tableHead} fixed>
          <Text style={s.colDesc}>Description</Text>
          <Text style={s.colQty}>Qty</Text>
          <Text style={s.colPrice}>Unit price</Text>
          <Text style={s.colTotal}>Amount</Text>
        </View>
        {items.map((it, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.colDesc}>{it.description}</Text>
            <Text style={s.colQty}>{String(it.quantity)}</Text>
            <Text style={s.colPrice}>{formatKES(it.unit_price_cents)}</Text>
            <Text style={s.colTotal}>{formatKES(it.line_total_cents)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{formatKES(inv.subtotal_cents)}</Text>
          </View>
          {inv.vat_rate_bp > 0 && (
            <View style={s.totalRow}>
              <Text>VAT {formatVatRate(inv.vat_rate_bp)}</Text>
              <Text>{formatKES(inv.vat_cents)}</Text>
            </View>
          )}
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{formatKES(inv.total_cents)}</Text>
          </View>
          {!isQuote && inv.amount_paid_cents > 0 && (
            <View style={s.totalRow}>
              <Text>Paid</Text>
              <Text>-{formatKES(inv.amount_paid_cents)}</Text>
            </View>
          )}
          {!isQuote && (
            <View style={[s.totalRow, s.bold]}>
              <Text>Balance due</Text>
              <Text>{formatKES(Math.max(inv.balance_cents, 0))}</Text>
            </View>
          )}
          {inv.deposit_cents > 0 && (
            <View style={[s.totalRow, s.muted]}>
              <Text>{isQuote ? "Deposit to confirm" : "Deposit requested"}</Text>
              <Text>{formatKES(inv.deposit_cents)}</Text>
            </View>
          )}
        </View>

        {inv.notes && (
          <View style={s.notes} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text>{inv.notes}</Text>
          </View>
        )}

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${footer}  |  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

/** "INV-2026-0001-mama-njeri.pdf" */
export function pdfFilename(doc: SharedInvoice): string {
  return `${doc.invoice.number}-${doc.business.slug}.pdf`;
}
