-- Dashboard: calendar window, staff booking, reschedule, status machine,
-- customer stats, and RLS on the new views and functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create schema if not exists tests;
create function tests.login(p_uid uuid, p_email text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text, true);
$$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create table tests.fx (key text primary key, val text not null);
grant select, insert on tests.fx to anon, authenticated;
create function tests.fx(p_key text) returns text
language sql stable as $$ select val from tests.fx where key = p_key $$;
grant execute on function tests.fx(text) to anon, authenticated;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-d@nextto.test'),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'outsider-d@nextto.test');

select tests.login('dddddddd-0000-0000-0000-000000000001', 'owner-d@nextto.test');
select public.create_business('Dashboard Test', 'test-dash', 'general');

insert into tests.fx
select 'biz', id::text from public.businesses where slug = 'test-dash'
union all
select 'staff', s.id::text from public.staff s join public.businesses b on b.id = s.business_id
where b.slug = 'test-dash'
union all
select 'day', ((now() at time zone 'Africa/Nairobi')::date + 20)::text;

-- A second staff member who offers nothing yet.
insert into public.staff (business_id, display_name)
values (tests.fx('biz')::uuid, 'Second');
insert into tests.fx
select 'staff2', id::text from public.staff where business_id = tests.fx('biz')::uuid and display_name = 'Second';

insert into public.services (business_id, name, duration_minutes, price_cents)
values (tests.fx('biz')::uuid, 'Hour', 60, 150000);
insert into tests.fx
select 'svc', id::text from public.services where business_id = tests.fx('biz')::uuid and name = 'Hour';
insert into public.staff_services (business_id, staff_id, service_id)
values (tests.fx('biz')::uuid, tests.fx('staff')::uuid, tests.fx('svc')::uuid);

insert into public.customers (business_id, name, phone)
values (tests.fx('biz')::uuid, 'Wanjiru Kamau', '+254722000001');
insert into tests.fx
select 'cust', id::text from public.customers where business_id = tests.fx('biz')::uuid;

create function tests.at(p_time time, p_plus_days int default 0) returns timestamptz
language sql stable as $$
  select ((tests.fx('day')::date + p_plus_days) + p_time) at time zone 'Africa/Nairobi'
$$;
grant execute on function tests.at(time, int) to anon, authenticated;

-- Everything below runs as the owner, through RLS.
set local role authenticated;

-- ---------------------------------------------------------------------------
-- create_booking
-- ---------------------------------------------------------------------------
insert into tests.fx
select 'b1', (public.create_booking(tests.fx('svc')::uuid, tests.fx('staff')::uuid,
                                    tests.fx('cust')::uuid, tests.at('10:00'), ' Walk-in ')).id::text;

select is(
  (select row(status, source, price_cents, upper(during) - lower(during), notes)::text
   from public.bookings where id = tests.fx('b1')::uuid),
  row('confirmed'::public.booking_status, 'dashboard'::public.booking_source, 150000::bigint,
      interval '1 hour', 'Walk-in')::text,
  'create_booking: confirmed, priced and sized from the service, notes trimmed'
);
select throws_ok(
  format($$select public.create_booking(%L, %L, %L, %L)$$,
         tests.fx('svc'), tests.fx('staff'), tests.fx('cust'), tests.at('10:30')),
  '23P01', null, 'create_booking: an overlapping booking is rejected'
);
select throws_ok(
  format($$select public.create_booking(%L, %L, %L, %L)$$,
         tests.fx('svc'), tests.fx('staff2'), tests.fx('cust'), tests.at('12:00')),
  '22023', 'That team member does not offer this service',
  'create_booking: staff must offer the service'
);
select lives_ok(
  format($$select public.create_booking(%L, %L, %L, %L)$$,
         tests.fx('svc'), tests.fx('staff'), tests.fx('cust'), tests.at('06:00')),
  'create_booking: staff may book outside working hours (no clash)'
);

-- ---------------------------------------------------------------------------
-- calendar_bookings and booking_details
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.calendar_bookings(
     tests.fx('biz')::uuid, tests.at('00:00'), tests.at('00:00', 1))),
  2, 'calendar_bookings returns bookings overlapping the window'
);
select is(
  (select count(*)::int from public.calendar_bookings(
     tests.fx('biz')::uuid, tests.at('10:59'), tests.at('11:30'))),
  1, 'a booking that started before the window but overlaps it is included'
);
select is(
  (select count(*)::int from public.calendar_bookings(
     tests.fx('biz')::uuid, tests.at('11:00'), tests.at('12:00'))),
  0, 'a booking ending exactly at the window start is excluded ([) ranges)'
);
select throws_ok(
  format($$select * from public.calendar_bookings(%L, %L, %L)$$,
         tests.fx('biz'), tests.at('00:00'), tests.at('00:00', 60)),
  '22023', null, 'calendar_bookings caps the window at 42 days'
);
select is(
  (select row(customer_name, service_name, starts_at)::text
   from public.booking_details where id = tests.fx('b1')::uuid),
  row('Wanjiru Kamau', 'Hour', tests.at('10:00'))::text,
  'booking_details joins customer and service names'
);

-- ---------------------------------------------------------------------------
-- reschedule_booking
-- ---------------------------------------------------------------------------
select is(
  (select lower(during) from public.reschedule_booking(tests.fx('b1')::uuid, tests.at('14:00'))),
  tests.at('14:00'), 'reschedule moves the booking'
);
select is(
  (select upper(during) - lower(during) from public.bookings where id = tests.fx('b1')::uuid),
  interval '1 hour', 'reschedule keeps the booked length'
);
select throws_ok(
  format($$select public.reschedule_booking(%L, %L)$$, tests.fx('b1'), tests.at('06:30')),
  '23P01', null, 'reschedule into another booking is rejected'
);
select throws_ok(
  format($$select public.reschedule_booking(%L, %L, %L)$$,
         tests.fx('b1'), tests.at('15:00'), tests.fx('staff2')),
  '22023', null, 'reschedule to staff who do not offer the service is rejected'
);

-- ---------------------------------------------------------------------------
-- Status state machine
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$update public.bookings set status = 'no_show' where id = %L$$, tests.fx('b1')),
  'confirmed -> no_show is allowed'
);
select throws_ok(
  format($$select public.reschedule_booking(%L, %L)$$, tests.fx('b1'), tests.at('16:00')),
  '23514', 'Only upcoming bookings can be moved', 'a no-show cannot be rescheduled'
);
select lives_ok(
  format($$update public.bookings set status = 'confirmed' where id = %L$$, tests.fx('b1')),
  'no_show -> confirmed (undo) is allowed'
);
select lives_ok(
  format($$update public.bookings set status = 'completed' where id = %L$$, tests.fx('b1')),
  'confirmed -> completed is allowed'
);
select throws_ok(
  format($$update public.bookings set status = 'cancelled' where id = %L$$, tests.fx('b1')),
  '23514', 'A completed booking cannot become cancelled', 'completed -> cancelled is rejected'
);

insert into tests.fx
select 'b2', (public.create_booking(tests.fx('svc')::uuid, tests.fx('staff')::uuid,
                                    tests.fx('cust')::uuid, tests.at('10:00', 1))).id::text;
update public.bookings set status = 'cancelled' where id = tests.fx('b2')::uuid;
select throws_ok(
  format($$update public.bookings set status = 'confirmed' where id = %L$$, tests.fx('b2')),
  '23514', null, 'cancelled is final'
);

-- ---------------------------------------------------------------------------
-- customer_stats
-- ---------------------------------------------------------------------------
select is(
  (select row(visits, cancellations, upcoming, completed_value_cents)::text
   from public.customer_stats where customer_id = tests.fx('cust')::uuid),
  row(1::bigint, 1::bigint, 1::bigint, 150000::bigint)::text,
  'customer_stats counts visits, cancellations, upcoming and completed value'
);

-- ---------------------------------------------------------------------------
-- Isolation: an outsider and anon see nothing.
-- ---------------------------------------------------------------------------
select tests.login('dddddddd-0000-0000-0000-000000000002', 'outsider-d@nextto.test');
select is(
  (select count(*)::int from public.booking_details where business_id = tests.fx('biz')::uuid)
  + (select count(*)::int from public.customer_stats where business_id = tests.fx('biz')::uuid)
  + (select count(*)::int from public.calendar_bookings(
       tests.fx('biz')::uuid, tests.at('00:00'), tests.at('00:00', 7))),
  0, 'an outsider sees no booking_details, customer_stats or calendar rows'
);
select throws_ok(
  format($$select public.reschedule_booking(%L, %L)$$, tests.fx('b1'), tests.at('09:00', 2)),
  'P0002', null, 'an outsider cannot reschedule (the booking is invisible to them)'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  'select * from public.booking_details', '42501', null, 'anon cannot read booking_details'
);
select throws_ok(
  format($$select public.create_booking(%L, %L, %L, %L)$$,
         tests.fx('svc'), tests.fx('staff'), tests.fx('cust'), tests.at('09:00', 3)),
  '42501', null, 'anon cannot call create_booking'
);

select * from finish();
rollback;
