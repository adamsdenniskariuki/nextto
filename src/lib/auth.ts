import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, or a redirect to /login. `cache` dedupes the call
 * within one request, so layouts and pages can both call it cheaply.
 */
export const requireUser = cache(async (next = "/dashboard") => {
  const supabase = await createClient();
  // getClaims() verifies the JWT signature; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect(`/login?next=${encodeURIComponent(next)}`);
  return {
    supabase,
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
  };
});

/** Businesses the user belongs to. RLS only returns their own memberships. */
export const getMemberships = cache(async () => {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("business_members")
    .select("role, business:businesses(id, name, slug, business_type, phone)")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw error;
  // The join is to-one (FK business_id), so `business` is an object, not an array.
  return data.flatMap((m) => (m.business ? [{ role: m.role, business: m.business }] : []));
});

export type Membership = Awaited<ReturnType<typeof getMemberships>>[number];
