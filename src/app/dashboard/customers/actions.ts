"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { customerNotesSchema } from "@/lib/validation/dashboard";
import { fieldErrors } from "@/lib/validation/schemas";
import type { FormState } from "../bookings/actions";

export async function saveCustomerNotes(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  const parsed = customerNotesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: fieldErrors(parsed.error),
      values: { notes: String(raw.notes ?? "") },
    };
  }
  const { supabase } = await requireUser();
  // RLS ("members update customers") limits this to the caller's businesses.
  const { data, error } = await supabase
    .from("customers")
    .update({ notes: parsed.data.notes || null })
    .eq("id", parsed.data.customerId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("saveCustomerNotes failed", error);
    return { status: "error", errors: { _form: "Couldn't save the notes." } };
  }
  revalidatePath(`/dashboard/customers/${parsed.data.customerId}`);
  return { status: "ok", message: "Notes saved." };
}
