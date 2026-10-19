/**
 * Kenyan phone numbers -> E.164. Mirrors `public.normalize_phone()` in SQL
 * (supabase/migrations/20261019100000_foundation.sql) so the browser can give
 * instant feedback while the database stays the final authority.
 */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Returns the E.164 form (e.g. "+254712345678"), or null if invalid. */
export function normalizeKenyanPhone(input: string): string | null {
  let v = input.replace(/[^0-9+]/g, "");
  if (/^0[17][0-9]{8}$/.test(v)) v = `+254${v.slice(1)}`;
  else if (/^254[17][0-9]{8}$/.test(v)) v = `+${v}`;
  else if (/^[17][0-9]{8}$/.test(v)) v = `+254${v}`;
  return E164.test(v) ? v : null;
}

/** "+254712345678" -> "+254 712 345 678" for display. */
export function formatKenyanPhone(e164: string): string {
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
