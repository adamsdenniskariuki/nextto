import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Logo } from "@/components/logo";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Join a team" };

/**
 * Landing page for the invitation magic link. The user is signed in by the
 * time they get here (/auth/confirm ran first); accepting is a POST (a Server
 * Action), not a side effect of merely opening the page.
 */
export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();
  const { email } = await requireUser(`/invite/${token}`);
  const { error } = await searchParams;

  async function accept() {
    "use server";
    const { supabase } = await requireUser(`/invite/${token}`);
    // accept_invitation() checks the token, its expiry and that the JWT email
    // matches the invited address, then adds the membership atomically.
    const { error } = await supabase.rpc("accept_invitation", { p_token: token });
    if (error) {
      redirect(`/invite/${token}?error=${error.code === "42501" ? "email" : "invalid"}`);
    }
    redirect("/dashboard");
  }

  const message =
    error === "email"
      ? `This invitation was sent to a different email address than ${email}.`
      : error === "invalid"
        ? "This invitation is invalid, already used or has expired. Ask the owner for a new one."
        : null;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Logo className="mb-10" />
      <h1 className="text-3xl font-extrabold tracking-tight">You&rsquo;re invited</h1>
      <p className="mt-2 mb-6 text-muted">
        Join the team as <strong className="text-ink">{email}</strong>.
      </p>
      {message && (
        <p role="alert" className="mb-4 rounded-xl border border-danger/40 p-3 text-sm text-danger">
          {message}
        </p>
      )}
      <form action={accept}>
        <button type="submit" className="btn-primary w-full">
          Accept invitation
        </button>
      </form>
    </main>
  );
}
