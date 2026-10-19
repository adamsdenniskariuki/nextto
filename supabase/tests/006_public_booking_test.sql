-- Public booking page and confirmation lookup, as an anonymous visitor.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create schema if not exists tests;
create table tests.fx (key text primary key, val text not null);
grant usage on schema tests to anon;
grant select, insert on tests.fx to anon;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-d@nextto.test');
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated","email":"owner-d@nextto.test"}', true);
select public.create_business('Public Page Test', 'test-public', 'salon');

-- Open every day 09:00–17:00 so the test does not depend on today's weekday.
delete from public.working_hours
where business_id = (select id from public.businesses where slug = 'test-public');
insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
select s.business_id, s.id, d, '09:00', '17:00'
from public.staff s join public.businesses b on b.id = s.business_id, generate_series(0, 6) d
where b.slug = 'test-public';

insert into tests.fx
select 'service', (p -> 'services' -> 0 ->> 'id')
from public.get_public_booking_page('test-public') p;

-- ---------------------------------------------------------------------------
-- Booking page payload
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(public.get_public_booking_page('no-such-business'), null,
  'an unknown slug returns null (the page renders 404)');
select is(public.get_public_booking_page('TEST-PUBLIC') -> 'business' ->> 'name', 'Public Page Test',
  'slugs are case-insensitive');
select ok(jsonb_array_length(public.get_public_booking_page('test-public') -> 'services') > 0,
  'the salon preset services are listed');
select is(public.get_public_booking_page('test-public') -> 'labels' ->> 'staff', 'Stylist',
  'preset labels are included');

-- ---------------------------------------------------------------------------
-- Book, then look the booking up by id
-- ---------------------------------------------------------------------------
insert into tests.fx
select 'booking', public.book_public(
  'test-public', (select val::uuid from tests.fx where key = 'service'),
  ((current_date + 20) + time '10:00') at time zone 'Africa/Nairobi',
  'Wanjiru Kamau', '0722 000 111', 'wanjiru@example.com') ->> 'booking_id';

select is(
  public.get_public_booking((select val::uuid from tests.fx where key = 'booking')) ->> 'customer_first_name',
  'Wanjiru', 'the confirmation greets the guest by first name');
select ok(
  not (public.get_public_booking((select val::uuid from tests.fx where key = 'booking'))
       ?| array['customer_phone', 'phone_number', 'email', 'notes']),
  'the confirmation exposes no customer contact details or notes');
select is(
  to_char((public.get_public_booking((select val::uuid from tests.fx where key = 'booking')) ->> 'starts_at')::timestamptz
          at time zone 'Africa/Nairobi', 'HH24:MI'),
  '10:00', 'starts_at round-trips as 10:00 Nairobi time');
select is(public.get_public_booking(gen_random_uuid()), null, 'an unknown id returns null');
select throws_ok('select 1 from public.bookings', '42501', null,
  'anonymous visitors still cannot read bookings directly');

reset role;
select * from finish();
rollback;
