-- =============================================================================
-- 0008 Reports: materialised view, pg_cron refresh, window-function reports.
--
-- Concepts:
--   * A MATERIALIZED VIEW stores the result of an expensive aggregate.
--     REFRESH ... CONCURRENTLY needs a UNIQUE index and lets readers keep
--     reading during the refresh.
--   * Materialised views do NOT support RLS. That is why this one lives in
--     the private schema and is only read through a SECURITY DEFINER
--     function that checks membership first.
--   * Window functions: running totals (SUM OVER ... ROWS UNBOUNDED
--     PRECEDING), moving averages (ROWS 6 PRECEDING), LAG for day-over-day
--     change, and RANK.
--   * Other reports are SECURITY INVOKER: RLS scopes them automatically.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

create materialized view private.business_daily_stats as
with bk as (
  select bk.business_id,
         (lower(bk.during) at time zone b.timezone)::date as day,
         count(*)                                         as bookings_count,
         count(*) filter (where bk.status = 'completed')  as completed_count,
         count(*) filter (where bk.status = 'cancelled')  as cancelled_count,
         count(*) filter (where bk.status = 'no_show')    as no_show_count
  from public.bookings bk
  join public.businesses b on b.id = bk.business_id
  group by 1, 2
),
pay as (
  select p.business_id,
         (p.paid_at at time zone b.timezone)::date as day,
         sum(p.amount_cents)::bigint              as revenue_cents,
         count(*)                                 as payments_count
  from public.payments p
  join public.businesses b on b.id = p.business_id
  where p.status = 'succeeded'
  group by 1, 2
)
select coalesce(bk.business_id, pay.business_id) as business_id,
       coalesce(bk.day, pay.day)                 as day,
       coalesce(bk.bookings_count, 0)            as bookings_count,
       coalesce(bk.completed_count, 0)           as completed_count,
       coalesce(bk.cancelled_count, 0)           as cancelled_count,
       coalesce(bk.no_show_count, 0)             as no_show_count,
       coalesce(pay.revenue_cents, 0)::bigint    as revenue_cents,
       coalesce(pay.payments_count, 0)           as payments_count
from bk
full join pay on pay.business_id = bk.business_id and pay.day = bk.day;

create unique index business_daily_stats_pk on private.business_daily_stats (business_id, day);
revoke all on private.business_daily_stats from public, anon, authenticated;

create function private.refresh_business_daily_stats()
returns void
language sql
security definer
set search_path = ''
as $$
  refresh materialized view concurrently private.business_daily_stats;
$$;

-- pg_cron jobs. cron.schedule(name, ...) upserts by name, so re-running is safe.
select cron.schedule(
  'nextto-refresh-daily-stats', '*/10 * * * *',
  $$select private.refresh_business_daily_stats()$$
);
select cron.schedule(
  'nextto-expire-stale-mpesa', '* * * * *',
  $$select private.expire_stale_mpesa_payments()$$
);

-- ---------------------------------------------------------------------------
-- Revenue trend with running total, 7-day moving average and day-over-day
-- change. generate_series fills days without activity with zeros.
-- ---------------------------------------------------------------------------
create function public.report_revenue_trend(p_business_id uuid, p_from date, p_to date)
returns table (
  day                     date,
  revenue_cents           bigint,
  running_total_cents     bigint,
  moving_avg_7d_cents     bigint,
  change_vs_prev_day_cents bigint,
  bookings_count          bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_member(p_business_id) then
    raise exception 'Not a member of this business' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;

  return query
  with series as (
    select d::date as day,
           coalesce(s.revenue_cents, 0)::bigint  as revenue_cents,
           coalesce(s.bookings_count, 0)::bigint as bookings_count
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
    left join private.business_daily_stats s
      on s.business_id = p_business_id and s.day = d::date
  )
  select series.day,
         series.revenue_cents,
         (sum(series.revenue_cents) over running)::bigint,
         round(avg(series.revenue_cents) over last7)::bigint,
         series.revenue_cents - lag(series.revenue_cents, 1, 0::bigint) over (order by series.day),
         series.bookings_count
  from series
  window running as (order by series.day rows between unbounded preceding and current row),
         last7   as (order by series.day rows between 6 preceding and current row)
  order by series.day;
end;
$$;

revoke execute on function public.report_revenue_trend(uuid, date, date) from public, anon;
grant execute on function public.report_revenue_trend(uuid, date, date) to authenticated;

-- Busiest hours: demand heat-map by ISO weekday (1 = Monday) and local hour.
create function public.report_busiest_hours(p_business_id uuid, p_from date, p_to date)
returns table (weekday integer, hour integer, bookings_count bigint, rank bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select b.timezone from public.businesses b where b.id = p_business_id
  ),
  local_starts as (
    select lower(bk.during) at time zone tz.timezone as local_start
    from public.bookings bk
    cross join tz
    where bk.business_id = p_business_id
      and bk.status in ('confirmed', 'completed', 'no_show')
      and bk.during && tstzrange(p_from::timestamp at time zone tz.timezone,
                                 (p_to + 1)::timestamp at time zone tz.timezone)
  )
  select extract(isodow from local_start)::integer,
         extract(hour from local_start)::integer,
         count(*),
         rank() over (order by count(*) desc)
  from local_starts
  group by 1, 2
  order by 1, 2;
$$;

-- Staff utilisation = booked minutes / (scheduled minutes - break minutes).
create function public.report_staff_utilisation(p_business_id uuid, p_from date, p_to date)
returns table (
  staff_id          uuid,
  display_name      text,
  available_minutes bigint,
  booked_minutes    bigint,
  utilisation_pct   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select b.timezone from public.businesses b where b.id = p_business_id
  ),
  days as (
    select d::date as day
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  scheduled as (
    select wh.staff_id, sum(extract(epoch from wh.end_time - wh.start_time) / 60) as minutes
    from days
    join public.working_hours wh
      on wh.weekday = extract(dow from days.day) and wh.business_id = p_business_id
    group by wh.staff_id
  ),
  breaks as (
    select br.staff_id, sum(extract(epoch from br.end_time - br.start_time) / 60) as minutes
    from days
    join public.staff_breaks br
      on br.weekday = extract(dow from days.day) and br.business_id = p_business_id
    group by br.staff_id
  ),
  booked as (
    select bk.staff_id, sum(extract(epoch from upper(bk.during) - lower(bk.during)) / 60) as minutes
    from public.bookings bk
    cross join tz
    where bk.business_id = p_business_id
      and bk.status in ('confirmed', 'completed')
      and bk.during && tstzrange(p_from::timestamp at time zone tz.timezone,
                                 (p_to + 1)::timestamp at time zone tz.timezone)
    group by bk.staff_id
  )
  select st.id,
         st.display_name,
         greatest(coalesce(s.minutes, 0) - coalesce(br.minutes, 0), 0)::bigint,
         coalesce(bo.minutes, 0)::bigint,
         case when coalesce(s.minutes, 0) - coalesce(br.minutes, 0) > 0
              then round(100 * coalesce(bo.minutes, 0) / (s.minutes - coalesce(br.minutes, 0)), 1)
         end
  from public.staff st
  left join scheduled s on s.staff_id = st.id
  left join breaks br   on br.staff_id = st.id
  left join booked bo   on bo.staff_id = st.id
  where st.business_id = p_business_id
  order by 5 desc nulls last, st.display_name;
$$;

-- Receivables ageing buckets (uses the partial index invoices_outstanding_idx).
create function public.report_receivables_ageing(p_business_id uuid, p_as_of date default null)
returns table (bucket text, invoice_count bigint, balance_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with as_of as (
    select coalesce(p_as_of, (now() at time zone b.timezone)::date) as d
    from public.businesses b where b.id = p_business_id
  ),
  open_invoices as (
    select i.balance_cents, as_of.d - i.due_date as days_overdue
    from public.invoices i
    cross join as_of
    where i.business_id = p_business_id
      and i.kind = 'invoice'
      and i.status in ('issued', 'partially_paid')
  ),
  buckets (bucket, lo, hi, ord) as (
    values ('Current', -100000, 0, 1),
           ('1-30 days', 1, 30, 2),
           ('31-60 days', 31, 60, 3),
           ('61-90 days', 61, 90, 4),
           ('90+ days', 91, 100000, 5)
  )
  select bk.bucket,
         count(o.balance_cents),
         coalesce(sum(o.balance_cents), 0)::bigint
  from buckets bk
  left join open_invoices o on o.days_overdue between bk.lo and bk.hi
  group by bk.bucket, bk.ord
  order by bk.ord;
$$;

-- Repeat-customer rate: share of customers seen in the period who have at
-- least two completed visits ever up to the end of the period.
create function public.report_repeat_customer_rate(p_business_id uuid, p_from date, p_to date)
returns table (customers_in_period bigint, repeat_customers bigint, repeat_rate_pct numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select b.timezone from public.businesses b where b.id = p_business_id
  ),
  visits as (
    select bk.customer_id,
           lower(bk.during) as starts_at,
           row_number() over (partition by bk.customer_id order by lower(bk.during)) as visit_no
    from public.bookings bk
    cross join tz
    where bk.business_id = p_business_id
      and bk.status = 'completed'
      and lower(bk.during) < (p_to + 1)::timestamp at time zone tz.timezone
  ),
  in_period as (
    select v.customer_id, max(v.visit_no) as visits_to_date
    from visits v
    cross join tz
    where v.starts_at >= p_from::timestamp at time zone tz.timezone
    group by v.customer_id
  )
  select count(*),
         count(*) filter (where visits_to_date >= 2),
         case when count(*) > 0
              then round(100.0 * count(*) filter (where visits_to_date >= 2) / count(*), 1)
         end
  from in_period;
$$;

revoke execute on function public.report_busiest_hours(uuid, date, date) from public, anon;
revoke execute on function public.report_staff_utilisation(uuid, date, date) from public, anon;
revoke execute on function public.report_receivables_ageing(uuid, date) from public, anon;
revoke execute on function public.report_repeat_customer_rate(uuid, date, date) from public, anon;
grant execute on function public.report_busiest_hours(uuid, date, date) to authenticated;
grant execute on function public.report_staff_utilisation(uuid, date, date) to authenticated;
grant execute on function public.report_receivables_ageing(uuid, date) to authenticated;
grant execute on function public.report_repeat_customer_rate(uuid, date, date) to authenticated;
