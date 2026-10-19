/**
 * Shown instantly while a dashboard page's Server Component loads its data.
 * Next wraps the page in a <Suspense> boundary with this as the fallback, so
 * the header and nav (from the layout) stay put and only the content swaps.
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
        <div className="h-8 w-56 animate-pulse rounded-lg bg-surface-2" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-24 animate-pulse" />
        ))}
      </div>
      <div aria-hidden="true" className="card h-72 animate-pulse" />
    </div>
  );
}
