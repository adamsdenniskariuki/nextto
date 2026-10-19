-- Reports: window functions over the materialised view, and the invoker reports.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema if not exists tests;
create function tests.login(p_uid uuid, p_email text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text, true);
$$;
create table tests.fx (key text primary key, val text not null);
create function tests.fx(p_key text) returns text
language sql stable as $$ select val from tests.fx where key = p_key $$;
grant usage on schema tests to authenticated;
grant select on tests.fx to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Local Nairobi time on day offset p_day from D0 -> timestamptz.
create function tests.at(p_day int, p_time time) returns timestamptz
language sql stable as $$
  select ((tests.fx('d0')::date + p_day) + p_time) at time zone 'Africa/Nairobi'
$$;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-e@nextto.test'),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'outsider@nextto.test');
select tests.login('eeeeeeee-0000-0000-0000-000000000001', 'owner-e@nextto.test');
select public.create_business('Reports Test', 'test-rep', 'general');

insert into tests.fx
select 'biz', id::text from public.businesses where slug = 'test-rep'
union all
select 'staff', s.id::text from public.staff s join public.businesses b on b.id = s.business_id where b.slug = 'test-rep'
union all
select 'svc', sv.id::text from public.services sv join public.businesses b on b.id = sv.business_id
where b.slug = 'test-rep' and sv.sort_order = 1
union all
select 'd0', ((now() at time zone 'Africa/Nairobi')::date - 10)::text;

-- 09:00–17:00 every day (480 minutes).
delete from public.working_hours where business_id = tests.fx('biz')::uuid;
insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
select tests.fx('biz')::uuid, tests.fx('staff')::uuid, d, '09:00', '17:00' from generate_series(0, 6) d;

insert into public.customers (business_id, name, phone) values
  (tests.fx('biz')::uuid, 'Xavier', '+254700000001'),
  (tests.fx('biz')::uuid, 'Yusuf',  '+254700000002'),
  (tests.fx('biz')::uuid, 'Zawadi', '+254700000003');

-- X: two completed visits, Y: one, Z: one cancelled.
insert into public.bookings (business_id, staff_id, service_id, customer_id, during, status, price_cents)
select tests.fx('biz')::uuid, tests.fx('staff')::uuid, tests.fx('svc')::uuid, c.id,
       tstzrange(tests.at(v.d, v.t), tests.at(v.d, v.t) + interval '1 hour'), v.st::public.booking_status, 100000
from (values ('Xavier', 0, time '10:00', 'completed'),
             ('Xavier', 2, time '10:00', 'completed'),
             ('Yusuf',  2, time '11:00', 'completed'),
             ('Zawadi', 3, time '10:00', 'cancelled')) v(name, d, t, st)
join public.customers c on c.name = v.name and c.business_id = tests.fx('biz')::uuid;

-- Revenue: KES 1,000 on D0, 3,000 on D0+2 (two payments), 2,000 on D0+3.
insert into public.payments (business_id, booking_id, method, status, amount_cents, paid_at)
select tests.fx('biz')::uuid, b.id, 'cash', 'succeeded', v.amt, tests.at(v.d, '12:00')
from (values (0, 100000::bigint), (2, 100000), (2, 200000), (3, 200000)) v(d, amt)
cross join lateral (select id from public.bookings
                    where business_id = tests.fx('biz')::uuid order by lower(during) limit 1) b;

-- The same function pg_cron runs every 10 minutes.
select private.refresh_business_daily_stats();

-- ---------------------------------------------------------------------------
select tests.login('eeeeeeee-0000-0000-0000-000000000001', 'owner-e@nextto.test');
set local role authenticated;

select results_eq(
  $$select revenue_cents, running_total_cents, moving_avg_7d_cents, change_vs_prev_day_cents, bookings_count
    from public.report_revenue_trend(tests.fx('biz')::uuid, tests.fx('d0')::date, tests.fx('d0')::date + 3)$$,
  $$values (100000::bigint, 100000::bigint, 100000::bigint,  100000::bigint, 1::bigint),
           (     0::bigint, 100000::bigint,  50000::bigint, -100000::bigint, 0::bigint),
           (300000::bigint, 400000::bigint, 133333::bigint,  300000::bigint, 2::bigint),
           (200000::bigint, 600000::bigint, 150000::bigint, -100000::bigint, 1::bigint)$$,
  'revenue trend: zero-filled days, running total, 7-day moving average, day-over-day change'
);

select is(
  (select sum(bookings_count)::int from public.report_busiest_hours(
     tests.fx('biz')::uuid, tests.fx('d0')::date, tests.fx('d0')::date + 3)),
  3, 'busiest hours counts attended bookings only (not cancelled)'
);
select is(
  (select array_agg(distinct hour order by hour) from public.report_busiest_hours(
     tests.fx('biz')::uuid, tests.fx('d0')::date, tests.fx('d0')::date + 3)),
  array[10, 11], 'busiest hours are in local (Nairobi) time'
);

-- 3 booked hours / (4 days x 480 min) = 180 / 1920 = 9.375%
select results_eq(
  $$select available_minutes, booked_minutes, utilisation_pct
    from public.report_staff_utilisation(tests.fx('biz')::uuid, tests.fx('d0')::date, tests.fx('d0')::date + 3)$$,
  $$values (1920::bigint, 180::bigint, 9.4)$$,
  'staff utilisation = booked / scheduled minutes'
);

select results_eq(
  $$select customers_in_period, repeat_customers, repeat_rate_pct
    from public.report_repeat_customer_rate(tests.fx('biz')::uuid, tests.fx('d0')::date, tests.fx('d0')::date + 3)$$,
  $$values (2::bigint, 1::bigint, 50.0)$$,
  'repeat-customer rate counts customers with 2+ completed visits'
);

-- Receivables: one invoice 40 days overdue, one not yet due.
with inv as (
  insert into public.invoices (business_id, customer_id, issue_date, due_date)
  select tests.fx('biz')::uuid, c.id, current_date - 45, current_date - 40
  from public.customers c where c.name = 'Xavier' and c.business_id = tests.fx('biz')::uuid
  returning id
), item as (
  insert into public.invoice_items (business_id, invoice_id, description, unit_price_cents)
  select tests.fx('biz')::uuid, id, 'Overdue work', 70000 from inv
  returning invoice_id
)
select 1 from item;
with inv as (
  insert into public.invoices (business_id, customer_id)
  select tests.fx('biz')::uuid, c.id
  from public.customers c where c.name = 'Yusuf' and c.business_id = tests.fx('biz')::uuid
  returning id
), item as (
  insert into public.invoice_items (business_id, invoice_id, description, unit_price_cents)
  select tests.fx('biz')::uuid, id, 'Fresh work', 30000 from inv
  returning invoice_id
)
select 1 from item;
select public.issue_invoice(id) from public.invoices where business_id = tests.fx('biz')::uuid;

select results_eq(
  $$select bucket, invoice_count, balance_cents
    from public.report_receivables_ageing(tests.fx('biz')::uuid, current_date)$$,
  $$values ('Current', 1::bigint, 30000::bigint),
           ('1-30 days', 0::bigint, 0::bigint),
           ('31-60 days', 1::bigint, 70000::bigint),
           ('61-90 days', 0::bigint, 0::bigint),
           ('90+ days', 0::bigint, 0::bigint)$$,
  'receivables are bucketed by days overdue'
);
reset role;

-- An outsider gets nothing.
select tests.login('eeeeeeee-0000-0000-0000-000000000002', 'outsider@nextto.test');
set local role authenticated;
select throws_ok(
  format($$select * from public.report_revenue_trend(%L, current_date - 7, current_date)$$, tests.fx('biz')),
  '42501', null, 'non-members cannot read the revenue trend'
);
select is(
  (select sum(booked_minutes)::int from public.report_staff_utilisation(tests.fx('biz')::uuid, current_date - 30, current_date)),
  null, 'invoker reports return nothing for non-members (RLS)'
);
select is(
  (select sum(invoice_count)::int from public.report_receivables_ageing(tests.fx('biz')::uuid)),
  0, 'non-members see no receivables'
);
reset role;

select * from finish();
rollback;
