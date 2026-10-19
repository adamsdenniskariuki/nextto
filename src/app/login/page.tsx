import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const errorMessages: Record<string, string> = {
  link: "That sign-in link is invalid or has expired. Request a new one below.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // In Next.js 15+, searchParams is a Promise: awaiting it opts into dynamic rendering.
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const error = typeof params.error === "string" ? errorMessages[params.error] : undefined;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Logo className="mb-10" />
      <h1 className="text-3xl font-extrabold tracking-tight">Sign in</h1>
      <p className="mt-2 mb-6 text-muted">
        No passwords. We&rsquo;ll email you a link: new here? The same link creates your account.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-danger/40 p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="card">
        <LoginForm next={next} />
      </div>
    </main>
  );
}
