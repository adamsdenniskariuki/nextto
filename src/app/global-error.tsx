"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * whole document, so it renders its own <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-KE">
      <body>
        <main id="main" className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-4">
          <title>Something went wrong · Nextto</title>
          <h1 className="text-3xl font-extrabold tracking-tight">We hit a snag</h1>
          <p className="text-muted">Please try again in a moment.</p>
          {error.digest && (
            <p className="text-sm text-muted">
              Reference: <code className="font-mono">{error.digest}</code>
            </p>
          )}
          <button type="button" onClick={reset} className="btn-primary w-fit">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
