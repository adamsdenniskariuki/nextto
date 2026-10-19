/**
 * Pure layout maths for the dashboard calendar. Kept free of React and
 * Supabase so it is easy to unit test.
 */

export type TimedItem = { start: number; end: number }; // minutes since local midnight
export type Placed<T> = T & { lane: number; lanes: number };

/**
 * Side-by-side layout for overlapping items in one column (like Google
 * Calendar). Items that overlap form a cluster; each gets the first free
 * lane, and every item in the cluster is as wide as 1 / (lanes in cluster).
 */
export function layoutLanes<T extends TimedItem>(items: readonly T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const close = () => {
    for (const item of cluster) item.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.push(item.end) - 1;
    else laneEnds[lane] = item.end;
    cluster.push({ ...item, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  close();
  return out;
}

/**
 * Where an instant range falls within one calendar column, in minutes from
 * the column's local midnight (`dayStart`), clamped to the day. Measuring
 * from the day's start instant (rather than reading the wall clock) means a
 * booking that runs past midnight is simply cut off at the bottom.
 */
export function placeInDay(
  startsAt: string | Date,
  endsAt: string | Date,
  dayStart: Date,
): TimedItem {
  const clamp = (m: number) => Math.min(1440, Math.max(0, m));
  const minutesFrom = (d: string | Date) => (new Date(d).getTime() - dayStart.getTime()) / 60_000;
  return { start: clamp(minutesFrom(startsAt)), end: clamp(minutesFrom(endsAt)) };
}

/** "09:30:00" -> 570 */
export function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The visible hours of the time grid: the business's working hours,
 * stretched to include any booking outside them. Defaults to 08:00–18:00.
 */
export function visibleHours(
  workingHours: readonly { start_time: string; end_time: string }[],
  items: readonly TimedItem[],
): { startHour: number; endHour: number } {
  const starts = [
    ...workingHours.map((w) => timeToMinutes(w.start_time)),
    ...items.map((i) => i.start),
  ];
  const ends = [...workingHours.map((w) => timeToMinutes(w.end_time)), ...items.map((i) => i.end)];
  if (starts.length === 0) return { startHour: 8, endHour: 18 };
  const startHour = Math.max(0, Math.floor(Math.min(...starts) / 60));
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(Math.max(...ends) / 60)));
  return { startHour, endHour };
}
