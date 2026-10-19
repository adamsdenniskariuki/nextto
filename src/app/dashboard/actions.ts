"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";
import { fieldErrors, inviteSchema } from "@/lib/validation/schemas";

export type InviteState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; errors: Record<string, string> };

/**
 * Owner invites a team member. RLS ("owners manage invitations") rejects the
 * insert unless the caller owns the business, so no extra role check is needed.
 */
export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const { supabase, userId } = await requireUser();
  const { businessId, email, role } = parsed.data;

  const { data: invitation, error } = await supabase
    .from("invitations")
    .insert({ business_id: businessId, email, role, invited_by: userId })
    .select("token")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        errors: { email: "That person already has a pending invitation." },
      };
    }
    if (error.code === "42501") {
      return { status: "error", errors: { _form: "Only owners can invite people." } };
    }
    return { status: "error", errors: { _form: "Couldn't create the invitation." } };
  }

  // Email the invitee a magic link that lands on /invite/<token>. A fresh
  // session-less client is used so the owner's own cookies are untouched.
  const mailer = createAnonClient();
  const { error: mailError } = await mailer.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: new URL(`/invite/${invitation.token}`, publicEnv.NEXT_PUBLIC_SITE_URL).href,
    },
  });

  revalidatePath("/dashboard");
  if (mailError) {
    return {
      status: "error",
      errors: { _form: "Invitation saved, but the email failed. Share the invite link instead." },
    };
  }
  return { status: "sent", email };
}

export async function revokeInvitation(formData: FormData) {
  const id = z.uuid().parse(formData.get("id"));
  const { supabase } = await requireUser();
  const { error } = await supabase.from("invitations").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/dashboard");
}
