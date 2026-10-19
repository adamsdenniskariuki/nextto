"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fieldErrors, onboardingSchema } from "@/lib/validation/schemas";

export type OnboardingState = { errors: Record<string, string> };

/** Server Action: create the business and everything a preset implies, in one SQL call. */
export async function createBusiness(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser("/onboarding");
  const { name, slug, businessType, phone, displayName } = parsed.data;

  // create_business() is SECURITY DEFINER: it inserts the business, the owner
  // membership, a staff row, preset services and working hours atomically.
  const { error } = await supabase.rpc("create_business", {
    p_name: name,
    p_slug: slug,
    p_business_type: businessType,
    p_phone: phone,
    p_display_name: displayName || undefined,
  });

  if (error) {
    // 23505 = unique_violation (Postgres error codes are part of the API).
    if (error.code === "23505") return { errors: { slug: "That link is taken. Try another." } };
    if (error.code === "22023" || error.code === "23514") {
      return { errors: { _form: error.message } };
    }
    return { errors: { _form: "Something went wrong creating your business. Please try again." } };
  }

  redirect("/dashboard");
}
