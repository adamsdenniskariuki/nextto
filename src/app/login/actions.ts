"use server";

import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, loginSchema } from "@/lib/validation/schemas";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; errors: Record<string, string> };

/** Server Action: email a magic link. Works for new and returning users. */
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const { email, next } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // Becomes {{ .RedirectTo }} in the email template; /auth/confirm sends the user here.
      emailRedirectTo: new URL(next, publicEnv.NEXT_PUBLIC_SITE_URL).toString(),
    },
  });

  if (error) {
    const message =
      error.status === 429
        ? "Too many requests. Please wait a minute and try again."
        : "We couldn't send the link. Please try again.";
    return { status: "error", errors: { _form: message } };
  }
  return { status: "sent", email };
}
