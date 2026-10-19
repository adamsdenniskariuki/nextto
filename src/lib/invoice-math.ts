/**
 * Invoice arithmetic in integer cents, mirroring the SQL exactly so the
 * editor's live totals always match what Postgres stores:
 *
 *   invoice_items.line_total_cents = round(quantity * unit_price_cents)
 *   invoices.vat_cents             = round(subtotal_cents * vat_rate_bp / 10000)
 *
 * Postgres `round(numeric)` rounds halves away from zero. Quantities have two
 * decimals (numeric(10,2)), so we hold them as whole hundredths and use
 * BigInt for the multiplication: no floats anywhere.
 */

/** Largest quantity numeric(10,2) can hold. */
const MAX_HUNDREDTHS = 99_999_999_99;

/** "1.5" -> 150 hundredths; null if not a positive number with at most 2 decimals. */
export function parseQuantity(input: string): number | null {
  const m = /^\s*([0-9]+)(?:\.([0-9]{1,2}))?\s*$/.exec(input);
  if (!m || !m[1]) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return hundredths > 0 && hundredths <= MAX_HUNDREDTHS ? hundredths : null;
}

/** 150 -> "1.5", 200 -> "2": the text sent to Postgres (JSON numbers are exact decimals there). */
export function quantityToString(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const frac = hundredths % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Divide non-negative a by b, rounding halves up (= away from zero for a >= 0). */
function divRoundHalfUp(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

export function lineTotalCents(quantityHundredths: number, unitPriceCents: number): number {
  return Number(divRoundHalfUp(BigInt(quantityHundredths) * BigInt(unitPriceCents), 100n));
}

export function vatCents(subtotalCents: number, vatRateBp: number): number {
  return Number(divRoundHalfUp(BigInt(subtotalCents) * BigInt(vatRateBp), 10_000n));
}

export type LineInput = { quantityHundredths: number; unitPriceCents: number };

export function invoiceTotals(lines: readonly LineInput[], vatRateBp: number) {
  const subtotal = lines.reduce(
    (sum, l) => sum + lineTotalCents(l.quantityHundredths, l.unitPriceCents),
    0,
  );
  const vat = vatCents(subtotal, vatRateBp);
  return { subtotalCents: subtotal, vatCents: vat, totalCents: subtotal + vat };
}

/** 1600 -> "16%", 1250 -> "12.5%" */
export function formatVatRate(bp: number): string {
  return `${bp / 100}%`;
}
