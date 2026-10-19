"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Error boundary for every route below the root layout. It must be a Client
 * Component: it receives the error and a `reset` function that re-renders the
 * segment. In production `error.message` is replaced by a generic message, so
 * only the `digest` (which matches the server log entry) is safe to show.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-4">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="text-3xl font-extrabold tracking-tight">We hit a snag</h1>
      <p className="text-muted">
        Nothing you did. Try again, and if it keeps happening, let us know the reference below.
      </p>
      {error.digest && (
        <p className="text-sm text-muted">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Go to Nextto
        </Link>
      </div>
    </main>
  );
}
