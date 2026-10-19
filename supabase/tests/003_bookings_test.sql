-- Bookings: exclusion constraint, slot generation, public booking, recurrence.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema if not exists tests;
create function tests.login(p_uid uuid, p_email text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text, true);
$$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Fixture values, readable from any role in this transaction.
create table tests.fx (key text primary key, val text not null);
grant select on tests.fx to anon, authenticated;
create function tests.fx(p_key text) returns text
language sql stable as $$ select val from tests.fx where key = p_key $$;
grant execute on function tests.fx(text) to anon, authenticated;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-c@nextto.test');
select tests.login('cccccccc-0000-0000-0000-000000000001', 'owner-c@nextto.test');
select public.create_business('Booking Test', 'test-book', 'general');

insert into tests.fx
select 'biz', id::text from public.businesses where slug = 'test-book'
union all
select 'staff', s.id::text from public.staff s join public.businesses b on b.id = s.business_id
where b.slug = 'test-book'
-- A test day 30 days out, in Nairobi local time.
union all
select 'day', ((now() at time zone 'Africa/Nairobi')::date + 30)::text;

-- Deterministic schedule: every day 09:00–17:00 local.
delete from public.working_hours where business_id = tests.fx('biz')::uuid;
insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
select tests.fx('biz')::uuid, tests.fx('staff')::uuid, d, '09:00', '17:00'
from generate_series(0, 6) d;

-- Two services: a plain 60-min one, and a 60-min one with a 15-min buffer and a deposit.
insert into public.services (business_id, name, duration_minutes, buffer_minutes, price_cents, deposit_cents)
values (tests.fx('biz')::uuid, 'Plain hour', 60, 0, 200000, 0),
       (tests.fx('biz')::uuid, 'Buffered hour', 60, 15, 300000, 100000);
insert into public.staff_services (business_id, staff_id, service_id)
select business_id, tests.fx('staff')::uuid, id from public.services
where business_id = tests.fx('biz')::uuid and name in ('Plain hour', 'Buffered hour');
insert into tests.fx
select 'plain', id::text from public.services where business_id = tests.fx('biz')::uuid and name = 'Plain hour'
union all
select 'buffered', id::text from public.services where business_id = tests.fx('biz')::uuid and name = 'Buffered hour';

insert into public.customers (business_id, name, phone)
values (tests.fx('biz')::uuid, 'Akinyi', '+254711111111');
insert into tests.fx
select 'cust', id::text from public.customers where business_id = tests.fx('biz')::uuid;

-- Helper: local wall-clock time on the test day -> timestamptz.
create function tests.at(p_time time) returns timestamptz
language sql stable as $$ select (tests.fx('day')::date + p_time) at time zone 'Africa/Nairobi' $$;
grant execute on function tests.at(time) to anon, authenticated;

create function tests.slot_count(p_service text) returns int
language sql stable as $$
  select count(*)::int from public.available_slots(
    tests.fx('biz')::uuid, tests.fx(p_service)::uuid, tests.fx('day')::date)
$$;
grant execute on function tests.slot_count(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Slot generation
-- ---------------------------------------------------------------------------
-- 09:00..16:00 on a 15-minute grid = 29 starts for a 60-minute service.
select is(tests.slot_count('plain'), 29, 'open day: 29 hourly slots on a 15-minute grid');
select is(
  (select min(starts_at) from public.available_slots(
     tests.fx('biz')::uuid, tests.fx('plain')::uuid, tests.fx('day')::date)),
  tests.at('09:00'),
  'first slot is 09:00 Nairobi time'
);
select is(
  (select to_char(min(starts_at) at time zone 'UTC', 'HH24:MI') from public.available_slots(
     tests.fx('biz')::uuid, tests.fx('plain')::uuid, tests.fx('day')::date)),
  '06:00',
  '09:00 in Nairobi is 06:00 UTC (EAT is UTC+3)'
);

insert into public.staff_breaks (business_id, staff_id, weekday, start_time, end_time)
values (tests.fx('biz')::uuid, tests.fx('staff')::uuid,
        extract(dow from tests.fx('day')::date)::smallint, '13:00', '14:00');
-- [09,13) gives 13 starts, [14,17) gives 9.
select is(tests.slot_count('plain'), 22, 'a lunch break removes the slots that overlap it');

insert into public.bookings (business_id, staff_id, service_id, customer_id, during, price_cents)
values (tests.fx('biz')::uuid, tests.fx('staff')::uuid, tests.fx('buffered')::uuid,
        tests.fx('cust')::uuid, tstzrange(tests.at('10:00'), tests.at('11:00')), 300000);
-- Busy 10:00–11:15 (buffer). Free [09,10) = 1, [11:15,13) = 4, [14,17) = 9.
select is(tests.slot_count('plain'), 14, 'an existing booking plus its buffer is not offered');

insert into public.time_off (business_id, staff_id, during)
values (tests.fx('biz')::uuid, tests.fx('staff')::uuid, tstzrange(tests.at('15:00'), tests.at('17:00')));
select is(tests.slot_count('plain'), 6, 'time off removes slots');

select is(
  (select count(*)::int from public.available_slots(
     tests.fx('biz')::uuid, tests.fx('plain')::uuid,
     ((now() at time zone 'Africa/Nairobi')::date - 1))),
  0, 'no slots are offered in the past'
);

-- ---------------------------------------------------------------------------
-- Exclusion constraint
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.bookings (business_id, staff_id, service_id, customer_id, during, price_cents)
           values (%L, %L, %L, %L, tstzrange(%L::timestamptz, %L::timestamptz), 0)$$,
         tests.fx('biz'), tests.fx('staff'), tests.fx('plain'), tests.fx('cust'),
         tests.at('10:30'), tests.at('11:30')),
  '23P01', null, 'overlapping bookings for the same staff member are rejected'
);
select lives_ok(
  format($$insert into public.bookings (business_id, staff_id, service_id, customer_id, during, price_cents)
           values (%L, %L, %L, %L, tstzrange(%L::timestamptz, %L::timestamptz), 0)$$,
         tests.fx('biz'), tests.fx('staff'), tests.fx('plain'), tests.fx('cust'),
         tests.at('11:00'), tests.at('12:00')),
  'back-to-back bookings are allowed because ranges are [) half-open'
);
update public.bookings set status = 'cancelled'
where business_id = tests.fx('biz')::uuid and lower(during) = tests.at('10:00');
select isnt(
  (select cancelled_at from public.bookings
   where business_id = tests.fx('biz')::uuid and lower(during) = tests.at('10:00')),
  null, 'cancelling stamps cancelled_at'
);
select lives_ok(
  format($$insert into public.bookings (business_id, staff_id, service_id, customer_id, during, price_cents)
           values (%L, %L, %L, %L, tstzrange(%L::timestamptz, %L::timestamptz), 0)$$,
         tests.fx('biz'), tests.fx('staff'), tests.fx('plain'), tests.fx('cust'),
         tests.at('10:00'), tests.at('11:00')),
  'a cancelled booking frees its slot'
);
select throws_ok(
  format($$insert into public.bookings (business_id, staff_id, service_id, customer_id, during, price_cents)
           values (%L, %L, %L, %L, tstzrange(%L::timestamptz, %L::timestamptz, '[]'), 0)$$,
         tests.fx('biz'), tests.fx('staff'), tests.fx('plain'), tests.fx('cust'),
         tests.at('07:00'), tests.at('08:00')),
  '23514', null, 'booking ranges must be [) half-open'
);

-- ---------------------------------------------------------------------------
-- Public (guest) booking, as anon
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select is(
  public.book_public('test-book', tests.fx('plain')::uuid, tests.at('14:00'),
                     'Akinyi Renamed', '0711 111 111') ->> 'status',
  'confirmed',
  'a guest can book an available slot; no deposit means confirmed'
);
select throws_ok(
  format($$select public.book_public('test-book', %L, %L, 'Second', '+254799999999')$$,
         tests.fx('plain'), tests.at('14:00')),
  '23P01', null, 'the same slot cannot be booked twice'
);
select throws_ok(
  format($$select public.book_public('test-book', %L, %L, 'Off grid', '+254799999999')$$,
         tests.fx('plain'), tests.at('14:07')),
  '23P01', null, 'times that are not offered slots are rejected'
);
select throws_ok(
  format($$select public.book_public('test-book', %L, %L, '  ', '+254799999999')$$,
         tests.fx('plain'), tests.at('09:00')),
  '22023', null, 'a name is required'
);
reset role;

select is(
  (select name from public.customers where phone = '+254711111111'),
  'Akinyi', 'guest booking reuses the customer by phone and does not rename them'
);

-- Deposit service books as pending. Use the next day (no break/time off there).
select is(
  public.book_public('test-book', tests.fx('buffered')::uuid,
                     tests.at('09:00') + interval '1 day', 'Baraka', '+254 733 000 000') ->> 'status',
  'pending', 'a service with a deposit books as pending until the deposit is paid'
);

-- ---------------------------------------------------------------------------
-- Recurring bookings (recursive CTE), as the owner
-- ---------------------------------------------------------------------------
select tests.login('cccccccc-0000-0000-0000-000000000001', 'owner-c@nextto.test');
set local role authenticated;

select results_eq(
  format($$select to_char(lower(during) at time zone 'Africa/Nairobi', 'HH24:MI')
           from public.create_recurring_bookings(%L, %L, %L, %L, interval '7 days', 4)$$,
         tests.fx('staff'), tests.fx('plain'), tests.fx('cust'),
         tests.at('12:00') + interval '2 days'),
  $$values ('12:00'), ('12:00'), ('12:00'), ('12:00')$$,
  'a weekly series creates 4 bookings, all at 12:00 local time'
);
select is(
  (select count(distinct series_id)::int from public.bookings
   where business_id = tests.fx('biz')::uuid and series_id is not null),
  1, 'the series rows share one series_id'
);

-- Second occurrence lands on the test day at 10:00, which is taken.
select throws_ok(
  format($$select * from public.create_recurring_bookings(%L, %L, %L, %L, interval '7 days', 3)$$,
         tests.fx('staff'), tests.fx('plain'), tests.fx('cust'),
         tests.at('10:00') - interval '7 days'),
  '23P01', null, 'a series that clashes with an existing booking is rejected'
);
select is(
  (select count(*)::int from public.booking_series where business_id = tests.fx('biz')::uuid),
  1, 'the clashing series was rolled back entirely (atomic)'
);
reset role;

select * from finish();
rollback;
