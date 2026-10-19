import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { serviceRoleKey } from "@/lib/server-env";

/**
 * The service-role client: it acts as `service_role`, which BYPASSES row-level
 * security. Use it only on the server, only after your own code has decided
 * the caller may do this (a membership check, a capability URL, a verified
 * webhook), and prefer calling narrow SECURITY DEFINER functions over
 * reading or writing tables directly.
 *
 * Nextto uses it for M-Pesa: the Daraja callback (no user at all) and STK
 * requests (the functions are granted to service_role only).
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
