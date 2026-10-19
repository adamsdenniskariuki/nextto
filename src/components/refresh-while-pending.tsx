"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * While an M-Pesa prompt is waiting on someone's phone, re-render the page
 * every few seconds so it flips to "Paid" (or "Cancelled") as soon as the
 * callback lands. router.refresh() re-runs the Server Components only; client
 * state and scroll position survive.
 *
 * Why polling and not Realtime? Guests are the `anon` role and RLS (rightly)
 * hides payments from them, so Realtime would deliver nothing. A short poll
 * of a capability page is simple and works for everyone. It stops by itself:
 * prompts expire after about a minute on the phone and 15 minutes in SQL.
 */
export function RefreshWhilePending({
  intervalMs = 2500,
  maxMs = 3 * 60_000,
  label = "Waiting for the M-Pesa PIN…",
}: {
  intervalMs?: number;
  maxMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > maxMs) {
        clearInterval(id);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, maxMs]);

  return (
    <p role="status" className="flex items-center gap-2 text-sm font-medium">
      <span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-mpesa" />
      {gaveUp ? "Still waiting. Refresh the page to check again." : label}
    </p>
  );
}
