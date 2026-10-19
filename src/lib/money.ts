/** Money is stored as integer cents (bigint in Postgres); never as floats. */
const kesWhole = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});
const kesCents = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 150000 -> "Ksh 1,500" ; 150050 -> "Ksh 1,500.50" */
export function formatKES(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Invalid cents: ${cents}`);
  return (cents % 100 === 0 ? kesWhole : kesCents).format(cents / 100);
}

/** 150000 -> "1500", 150050 -> "1500.50": how a price is typed into a form, not displayed. */
export function centsToInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** "1,500.50" or "1500.5" -> 150050. Parses with string maths, not floats. */
export function parseKESToCents(input: string): number | null {
  const m = /^\s*(?:ksh|kes)?\s*([0-9][0-9,]*)(?:\.([0-9]{1,2}))?\s*$/i.exec(input);
  if (!m || !m[1]) return null;
  const shillings = Number(m[1].replaceAll(",", ""));
  const cents = Number((m[2] ?? "").padEnd(2, "0"));
  const total = shillings * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}
