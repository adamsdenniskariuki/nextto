"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Status = "connecting" | "live" | "offline";

/**
 * Subscribes to Supabase Realtime "postgres_changes" on this business's
 * bookings. On any insert/update/delete it calls router.refresh(), which
 * re-runs the Server Components and streams fresh HTML: the calendar stays a
 * Server Component, and this is the only client code it needs.
 *
 * Realtime checks RLS for every subscriber, so a user only receives changes
 * to rows they are allowed to SELECT. The filter just narrows it to one
 * business.
 *
 * useEffect is the right tool here: it synchronises with an external system
 * (a websocket) and cleans up when the business changes or the page unmounts.
 */
export function LiveUpdates({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    void (async () => {
      // The browser client reads its session from cookies asynchronously. Hand
      // the user's JWT to Realtime BEFORE joining: a join made with only the
      // anon key is checked as role `anon`, which can't see bookings, and
      // Realtime rejects the subscription.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      channel = supabase
        .channel(`bookings:${businessId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "bookings",
            filter: `business_id=eq.${businessId}`,
          },
          () => {
            // Debounce: a recurring series inserts many rows at once.
            clearTimeout(timer);
            timer = setTimeout(() => {
              router.refresh();
              setChanges((n) => n + 1);
            }, 250);
          },
        )
        .on("system", {}, (payload: { status?: string; extension?: string }) => {
          // SUBSCRIBED (below) only means the channel was joined. Realtime then
          // sets up the Postgres listener and confirms with a "system" message;
          // changes made before that are not delivered. So "Live" waits for
          // this, then refreshes once to pick up anything that changed between
          // the server render and now.
          if (payload.status === "error") setStatus("offline");
          else if (payload.status === "ok" && payload.extension === "postgres_changes") {
            setStatus("live");
            router.refresh();
          }
        })
        .subscribe((state) => {
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED")
            setStatus("offline");
        });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [businessId, router]);

  const label =
    status === "live"
      ? changes > 0
        ? `Live · updated ${changes === 1 ? "once" : `${changes} times`}`
        : "Live"
      : status === "connecting"
        ? "Connecting…"
        : "Offline: refresh to update";

  return (
    <p
      role="status"
      data-live={status}
      className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-medium text-muted"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${
          status === "live" ? "bg-mpesa" : status === "connecting" ? "bg-muted" : "bg-danger"
        }`}
      />
      {label}
    </p>
  );
}
