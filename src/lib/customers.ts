import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

/** Find-or-create a customer by phone. The phone is unique per business. */
export async function customerIdFor(
  businessId: string,
  phone: string,
  name: string,
): Promise<{ id: string } | { error: PostgrestError }> {
  const { supabase } = await requireUser();
  // ignoreDuplicates -> ON CONFLICT DO NOTHING: an existing customer keeps their name.
  const { error: upsertError } = await supabase
    .from("customers")
    .upsert(
      { business_id: businessId, phone, name },
      { onConflict: "business_id,phone", ignoreDuplicates: true },
    );
  if (upsertError) return { error: upsertError };
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .single();
  return error ? { error } : { id: data.id };
}
