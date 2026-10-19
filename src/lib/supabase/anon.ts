import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/**
 * A session-less client that always acts as the `anon` role.
 *
 * Use it for public pages: it reads no cookies, so Next.js can cache and
 * statically regenerate (ISR) the pages that use it. Anything it can do is
 * limited to what RLS and the SECURITY DEFINER functions grant to `anon`.
 */
export function createAnonClient() {
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
