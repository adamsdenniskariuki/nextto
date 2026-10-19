import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/** Root 404: any URL that matches no route, or a `notFound()` without a closer boundary. */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-4">
      <Logo />
      <p className="eyebrow">404</p>
      <h1 className="text-3xl font-extrabold tracking-tight">This page isn&apos;t in the queue</h1>
      <p className="text-muted">
        The link may be mistyped or out of date. If a business sent it, ask them for their current
        Nextto link.
      </p>
      <Link href="/" className="btn-secondary w-fit">
        Go to Nextto
      </Link>
    </main>
  );
}
