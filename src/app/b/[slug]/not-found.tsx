import Link from "next/link";
import { Logo } from "@/components/logo";

export default function BusinessNotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-4">
      <Logo />
      <h1 className="text-3xl font-extrabold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="text-muted">
        The booking link may be mistyped, or the business may have changed its address. Ask them for
        their current Nextto link.
      </p>
      <Link href="/" className="btn-secondary w-fit">
        Go to Nextto
      </Link>
    </main>
  );
}
