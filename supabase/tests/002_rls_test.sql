-- Row level security: tenant isolation, owner vs staff, anon, column grants.
--
-- Pattern used throughout:
--   select tests.login('<uuid>', '<email>');  -- as postgres: set JWT claims
--   set local role authenticated;             -- now RLS applies
--   ... assertions ...
--   reset role;                               -- back to postgres (bypasses RLS)
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

-- Fixture: owner A (business A), staff S (member of A), owner B (business B).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-a@nextto.test'),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'staff-a@nextto.test'),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-b@nextto.test');

select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@nextto.test');
select public.create_business('Test Salon A', 'test-a', 'salon');
select tests.login('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@nextto.test');
select public.create_business('Test Garage B', 'test-b', 'mechanic');
-- Remember A's id so other tenants can try to target it explicitly.
select set_config('tests.biz_a', (select id::text from public.businesses where slug = 'test-a'), true);

-- Invite S to A and accept it (exercises accept_invitation).
insert into public.invitations (business_id, email, role)
select id, 'Staff-A@nextto.test', 'staff' from public.businesses where slug = 'test-a';
select tests.login('aaaaaaaa-0000-0000-0000-000000000002', 'staff-a@nextto.test');
select is(
  public.accept_invitation((select token from public.invitations where email = 'Staff-A@nextto.test')),
  (select id from public.businesses where slug = 'test-a'),
  'accept_invitation matches email case-insensitively and returns the business'
);
select is(
  (select role::text from public.business_members
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'staff', 'invited user joins as staff'
);

insert into public.customers (business_id, name, phone)
select id, 'Wanjiku', '0712345678' from public.businesses where slug = 'test-a';
insert into public.customers (business_id, name, phone)
select id, 'Otieno', '+254 722 000 111' from public.businesses where slug = 'test-b';

select is((select phone from public.customers where name = 'Wanjiku'), '+254712345678',
  'local 07xx phone numbers are normalised to E.164');
select is((select phone from public.customers where name = 'Otieno'), '+254722000111',
  'spaces are stripped from +254 numbers');

-- ---------------------------------------------------------------------------
-- Owner B sees only business B.
-- ---------------------------------------------------------------------------
select tests.login('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@nextto.test');
set local role authenticated;

select results_eq('select slug from public.businesses', $$values ('test-b')$$,
  'owner B sees only their own business');
select results_eq('select name from public.customers', $$values ('Otieno')$$,
  'owner B sees only their own customers');
select is((select count(*)::int from public.services s
           join public.businesses b on b.id = s.business_id where b.slug = 'test-a'), 0,
  'owner B cannot see business A services');

select throws_ok(
  $$insert into public.customers (business_id, name, phone)
    values (current_setting('tests.biz_a')::uuid, 'Intruder', '+254700000000')$$,
  '42501', null, 'owner B cannot insert customers into business A'
);

-- Updates to invisible rows silently affect 0 rows.
update public.businesses set name = 'Hacked' where slug = 'test-a';
reset role;
select is((select name from public.businesses where slug = 'test-a'), 'Test Salon A',
  'owner B cannot rename business A');

-- ---------------------------------------------------------------------------
-- Staff S: reads A, works with customers, cannot manage configuration.
-- ---------------------------------------------------------------------------
select tests.login('aaaaaaaa-0000-0000-0000-000000000002', 'staff-a@nextto.test');
set local role authenticated;

select results_eq('select slug from public.businesses', $$values ('test-a')$$,
  'staff see the business they belong to');
select ok((select count(*) from public.services) > 0, 'staff can read services');
select lives_ok(
  $$update public.customers set notes = 'Prefers mornings' where name = 'Wanjiku'$$,
  'staff can add customer notes'
);
select throws_ok(
  $$insert into public.services (business_id, name, duration_minutes)
    select id, 'Sneaky', 30 from public.businesses$$,
  '42501', null, 'staff cannot create services'
);
update public.services set price_cents = 1 where true;
update public.businesses set name = 'Staff renamed' where true;
delete from public.customers where true;
select throws_ok(
  $$insert into public.business_members (business_id, user_id, role)
    select id, auth.uid(), 'owner' from public.businesses$$,
  '42501', null, 'staff cannot promote themselves to owner'
);
select is((select count(*)::int from public.invitations), 0, 'staff cannot read invitations');
reset role;

select is((select count(*)::int from public.services where price_cents = 1), 0,
  'staff updates to services are filtered out by RLS');
select is((select name from public.businesses where slug = 'test-a'), 'Test Salon A',
  'staff cannot rename the business');
select is((select count(*)::int from public.customers where name = 'Wanjiku'), 1,
  'staff cannot delete customers');
select is((select notes from public.customers where name = 'Wanjiku'), 'Prefers mornings',
  'staff note was saved');

-- ---------------------------------------------------------------------------
-- Column-level privileges.
-- ---------------------------------------------------------------------------
select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@nextto.test');
set local role authenticated;

select throws_ok(
  $$insert into public.businesses (name, slug) values ('Direct', 'direct-insert')$$,
  '42501', null, 'businesses cannot be inserted directly (use create_business)'
);
select throws_ok(
  $$update public.businesses set slug = 'stolen-slug'$$,
  '42501', null, 'the slug column is not updatable by clients'
);
select lives_ok(
  $$update public.businesses set vat_registered = true where slug = 'test-a'$$,
  'owners can update whitelisted business columns'
);
select throws_ok(
  $$insert into public.invoices (business_id, customer_id, number, status)
    select c.business_id, c.id, 'INV-FAKE-1', 'paid' from public.customers c limit 1$$,
  '42501', null, 'clients cannot set invoice number or status'
);
select throws_ok(
  $$insert into public.payments (business_id, invoice_id, method, status, amount_cents)
    select business_id, null, 'mpesa', 'succeeded', 100 from public.customers limit 1$$,
  '42501', null, 'clients cannot record M-Pesa payments'
);
select throws_ok('select * from private.invoice_counters', '42501', null,
  'private tables are not readable by clients');
select throws_ok(
  $$select public.record_mpesa_callback('{}'::jsonb)$$,
  '42501', null, 'only the service role may record M-Pesa callbacks'
);

-- The last owner cannot be removed or demoted.
select throws_ok(
  $$delete from public.business_members where user_id = auth.uid()$$,
  null, null, 'the last owner cannot leave the business'
);
reset role;

-- ---------------------------------------------------------------------------
-- Anonymous visitors: no table access, only the public functions.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.businesses', '42501', null, 'anon cannot read businesses');
select throws_ok('select * from public.customers', '42501', null, 'anon cannot read customers');
select throws_ok('select * from public.bookings', '42501', null, 'anon cannot read bookings');
select ok((select count(*) from public.business_type_presets) = 7, 'anon can read presets');
select is(
  (public.get_public_booking_page('test-a') -> 'business' ->> 'name'),
  'Test Salon A',
  'anon can load the public booking page'
);
select ok(
  public.get_public_booking_page('test-a') -> 'business' -> 'kra_pin' is null
  and public.get_public_booking_page('test-a')::text not like '%Wanjiku%',
  'the public booking page exposes no private data'
);
select throws_ok(
  $$select public.create_business('Anon Biz', 'anon-biz')$$,
  '42501', null, 'anon cannot create businesses'
);
reset role;

select * from finish();
rollback;
