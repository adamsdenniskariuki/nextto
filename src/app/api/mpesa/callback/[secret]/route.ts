import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import { stkCallbackSchema } from "@/lib/mpesa/format";
import { mpesaCallbackAllowedIps, mpesaConfig } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/mpesa/callback/<MPESA_CALLBACK_SECRET>
 *
 * Safaricom calls this with the STK push result. Daraja doesn't sign its
 * callbacks, so trust is layered:
 *   1. The secret path segment, compared in constant time.
 *   2. An optional source-IP allow-list (MPESA_CALLBACK_ALLOWED_IPS).
 *   3. Zod validation of the body.
 *   4. public.record_mpesa_callback: stores each CheckoutRequestID once
 *      (unique key + ON CONFLICT DO NOTHING) and applies it to the matching
 *      pending payment inside one transaction. Replays are harmless no-ops.
 *
 * Route Handlers run on the Node.js runtime by default, which `node:crypto` needs.
 */

const accepted = () => NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
const notFound = () => new NextResponse(null, { status: 404 });

/**
 * Hash both sides first: timingSafeEqual needs equal lengths, and hashing
 * means the comparison takes the same time whatever the guess's length.
 */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function clientIp(request: Request): string | null {
  // Vercel sets x-forwarded-for; the first entry is the original client.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function POST(request: Request, ctx: RouteContext<"/api/mpesa/callback/[secret]">) {
  const { secret } = await ctx.params;

  let expected: string;
  try {
    expected = mpesaConfig().MPESA_CALLBACK_SECRET;
  } catch {
    return notFound(); // M-Pesa isn't configured on this deployment.
  }
  // 404, not 401: don't confirm to a scanner that this endpoint exists.
  if (!secretMatches(secret, expected)) return notFound();

  const allowed = mpesaCallbackAllowedIps();
  if (allowed.length > 0) {
    const ip = clientIp(request);
    if (!ip || !allowed.includes(ip)) {
      console.warn("M-Pesa callback from a non-allow-listed IP", ip);
      return new NextResponse(null, { status: 403 });
    }
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = stkCallbackSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Malformed callback" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Pass the original JSON, not the parsed copy: the database keeps the raw
  // payload for audit, and its own jsonb checks are the final authority.
  const { data, error } = await admin.rpc("record_mpesa_callback", { p_payload: json as Json });
  if (error) {
    if (error.code === "22023") {
      return NextResponse.json({ ResultCode: 1, ResultDesc: error.message }, { status: 400 });
    }
    console.error("record_mpesa_callback failed", error);
    // A 5xx tells Safaricom (and our logs) that this delivery wasn't stored.
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Try again" }, { status: 500 });
  }

  console.info("M-Pesa callback", data);
  return accepted();
}
