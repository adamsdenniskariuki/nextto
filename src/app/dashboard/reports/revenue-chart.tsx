import { formatDayShort } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import { niceCeiling, type TrendBucket } from "@/lib/reports-math";

const W = 720;
const H = 220;

/**
 * Revenue bars with the 7-day moving average as a line, drawn as plain SVG on
 * the server: no chart library, no client JavaScript, crisp at every width.
 *
 * The SVG stretches to its container (`preserveAspectRatio="none"`), so text
 * lives outside it in HTML and lines use `vector-effect: non-scaling-stroke`
 * to keep their width. Each bar has a <title> tooltip; the exact figures are
 * also in a table below the chart for screen readers and copying.
 */
export function RevenueChart({ buckets, weekly }: { buckets: TrendBucket[]; weekly: boolean }) {
  const top = niceCeiling(Math.max(0, ...buckets.map((b) => b.revenue_cents)));
  const slot = W / Math.max(1, buckets.length);
  const barWidth = Math.max(1, slot * 0.7);
  const y = (cents: number) => H - (cents / top) * H;
  const avg = weekly
    ? null
    : buckets.map((b, i) => `${(i + 0.5) * slot},${y(b.moving_avg_7d_cents ?? 0)}`).join(" ");
  const total = buckets.reduce((sum, b) => sum + b.revenue_cents, 0);
  const first = buckets[0];
  const last = buckets.at(-1);

  return (
    <figure className="space-y-2">
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex w-20 shrink-0 flex-col justify-between text-right text-xs text-muted tabular-nums"
        >
          <span>{formatKES(top)}</span>
          <span>{formatKES(Math.round(top / 2))}</span>
          <span>0</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Revenue ${weekly ? "per week" : "per day"}, ${formatKES(total)} in total.`}
          className="h-48 w-full min-w-0 sm:h-56"
        >
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={H * f}
              y2={H * f}
              className="stroke-line"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {buckets.map((b, i) => (
            <rect
              key={b.start}
              x={i * slot + (slot - barWidth) / 2}
              y={y(b.revenue_cents)}
              width={barWidth}
              height={H - y(b.revenue_cents)}
              className="fill-brand"
            >
              <title>
                {`${weekly ? "Week of " : ""}${formatDayShort(b.start)}: ${formatKES(b.revenue_cents)}`}
              </title>
            </rect>
          ))}
          {avg && (
            <polyline
              points={avg}
              fill="none"
              className="stroke-ink"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <figcaption className="flex flex-wrap justify-between gap-x-4 gap-y-1 pl-22 text-xs text-muted">
        <span>
          {first && formatDayShort(first.start)} – {last && formatDayShort(last.end)}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-brand" />
            Revenue {weekly ? "per week" : "per day"}
          </span>
          {!weekly && (
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block w-4 border-t-2 border-dashed border-ink"
              />
              7-day average
            </span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
