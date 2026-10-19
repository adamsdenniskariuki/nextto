-- Invoice documents: atomic draft saving, invoices from bookings (with their
-- paid deposits), quotes -> invoices, over-payment guard, the summary view
-- and tenant isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-e@nextto.test'),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'outsider-e@nextto.test');

select tests.login('eeeeeeee-0000-0000-0000-000000000001', 'owner-e@nextto.test');
select public.create_business('Docs Test', 'test-docs', 'general');
update public.businesses set vat_registered = true where slug = 'test-docs';

insert into tests.fx
select 'biz', id::text from public.businesses where slug = 'test-docs'
union all
select 'staff', s.id::text from public.staff s join public.businesses b on b.id = s.business_id
where b.slug = 'test-docs';

insert into public.services (business_id, name, duration_minutes, price_cents, deposit_cents)
values (tests.fx('biz')::uuid, 'Full shoot', 60, 200000, 50000);
insert into tests.fx
select 'svc', id::text from public.services where business_id = tests.fx('biz')::uuid and name = 'Full shoot';
insert into public.staff_services (business_id, staff_id, service_id)
values (tests.fx('biz')::uuid, tests.fx('staff')::uuid, tests.fx('svc')::uuid);
insert into public.customers (business_id, name, phone)
values (tests.fx('biz')::uuid, 'Achieng Otieno', '+254733000001');
insert into tests.fx
select 'cust', id::text from public.customers where business_id = tests.fx('biz')::uuid;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- save_invoice_draft
-- ---------------------------------------------------------------------------
insert into tests.fx
select 'd1', public.save_invoice_draft(
  tests.fx('biz')::uuid, null, 'invoice', tests.fx('cust')::uuid,
  '[{"description":" Editing ","quantity":1.5,"unit_price_cents":10001},
    {"description":"Prints","quantity":3,"unit_price_cents":2500}]'::jsonb,
  p_vat_rate_bp => 1600, p_notes => 'Thanks!')::text;

-- 1.5 x 100.01 = 150.015 -> 150.02 ; + 75.00 = 225.02 ; VAT 16% = 36.0032 -> 36.00
select results_eq(
  format($$select subtotal_cents, vat_cents, total_cents, status::text from public.invoices where id = %L$$,
         tests.fx('d1')),
  $$values (22502::bigint, 3600::bigint, 26102::bigint, 'draft')$$,
  'draft totals come from the line items, rounded once per line'
);
select results_eq(
  format($$select description, sort_order from public.invoice_items where invoice_id = %L order by sort_order$$,
         tests.fx('d1')),
  $$values ('Editing', 1), ('Prints', 2)$$,
  'items keep their JSON order (WITH ORDINALITY) and are trimmed'
);

-- Saving again replaces the items.
select public.save_invoice_draft(
  tests.fx('biz')::uuid, tests.fx('d1')::uuid, 'invoice', tests.fx('cust')::uuid,
  '[{"description":"Editing","quantity":2,"unit_price_cents":10000}]'::jsonb,
  p_vat_rate_bp => 0, p_deposit_cents => 5000);
select results_eq(
  format($$select (select count(*)::int from public.invoice_items where invoice_id = i.id),
                  i.total_cents, i.deposit_cents from public.invoices i where i.id = %L$$, tests.fx('d1')),
  $$values (1, 20000::bigint, 5000::bigint)$$,
  'saving a draft again replaces its items and fields'
);

select throws_ok(
  format($$select public.save_invoice_draft(%L, null, 'invoice', %L, '[]'::jsonb)$$,
         tests.fx('biz'), tests.fx('cust')),
  '22023', null, 'a draft needs at least one item'
);
select throws_ok(
  format($$select public.save_invoice_draft(%L, null, 'invoice', %L,
           '[{"description":"A","quantity":1,"unit_price_cents":100}]'::jsonb, p_deposit_cents => 101)$$,
         tests.fx('biz'), tests.fx('cust')),
  '22023', null, 'the deposit cannot exceed the total'
);
select throws_ok(
  format($$select public.save_invoice_draft(%L, null, 'invoice', %L,
           '[{"description":"A","quantity":0,"unit_price_cents":100}]'::jsonb)$$,
         tests.fx('biz'), tests.fx('cust')),
  '23514', null, 'item CHECK constraints still apply (quantity > 0)'
);
select is(
  (select count(*)::int from public.invoices where business_id = tests.fx('biz')::uuid),
  1, 'failed saves leave nothing behind (all or nothing)'
);

select public.issue_invoice(tests.fx('d1')::uuid);
select throws_ok(
  format($$select public.save_invoice_draft(%L, %L, 'invoice', %L,
           '[{"description":"A","quantity":1,"unit_price_cents":100}]'::jsonb)$$,
         tests.fx('biz'), tests.fx('d1'), tests.fx('cust')),
  'P0002', null, 'issued invoices cannot be saved as drafts'
);

-- ---------------------------------------------------------------------------
-- Partial payments and the over-payment guard
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.payments (business_id, invoice_id, method, status, amount_cents)
           values (%L, %L, 'cash', 'succeeded', 20001)$$, tests.fx('biz'), tests.fx('d1')),
  '22023', null, 'a payment larger than the balance is refused'
);
insert into public.payments (business_id, invoice_id, method, status, amount_cents, reference)
values (tests.fx('biz')::uuid, tests.fx('d1')::uuid, 'bank', 'succeeded', 5000, 'EFT 123');

select results_eq(
  format($$select status::text, balance_cents, amount_due_now_cents, is_overdue
           from public.invoice_summaries where id = %L$$, tests.fx('d1')),
  $$values ('partially_paid', 15000::bigint, 15000::bigint, false)$$,
  'after the deposit is paid, the rest of the balance is due'
);

insert into public.payments (business_id, invoice_id, method, status, amount_cents)
values (tests.fx('biz')::uuid, tests.fx('d1')::uuid, 'cash', 'succeeded', 15000);
select results_eq(
  format($$select status::text, balance_cents, amount_due_now_cents from public.invoice_summaries where id = %L$$,
         tests.fx('d1')),
  $$values ('paid', 0::bigint, 0::bigint)$$,
  'paying the balance marks the invoice paid'
);

-- ---------------------------------------------------------------------------
-- invoice_summaries: overdue in Nairobi time
-- ---------------------------------------------------------------------------
insert into tests.fx
select 'late', public.save_invoice_draft(
  tests.fx('biz')::uuid, null, 'invoice', tests.fx('cust')::uuid,
  '[{"description":"Old job","quantity":1,"unit_price_cents":30000}]'::jsonb,
  p_deposit_cents => 10000)::text;
select results_eq(
  format($$select amount_due_now_cents, is_overdue from public.invoice_summaries where id = %L$$,
         tests.fx('late')),
  $$values (0::bigint, false)$$,
  'drafts are never due or overdue'
);
reset role;
-- Back-date it: issued 30 days ago, due 16 days ago.
update public.invoices
set issue_date = (now() at time zone 'Africa/Nairobi')::date - 30,
    due_date   = (now() at time zone 'Africa/Nairobi')::date - 16
where id = tests.fx('late')::uuid;
set local role authenticated;
select public.issue_invoice(tests.fx('late')::uuid);
select results_eq(
  format($$select amount_due_now_cents, is_overdue, days_overdue from public.invoice_summaries where id = %L$$,
         tests.fx('late')),
  $$values (10000::bigint, true, 16)$$,
  'an unpaid issued invoice past its due date is overdue; the deposit is due first'
);

-- ---------------------------------------------------------------------------
-- create_invoice_from_booking (+ adopting the paid deposit on issue)
-- ---------------------------------------------------------------------------
insert into tests.fx
select 'bk', (public.create_booking(tests.fx('svc')::uuid, tests.fx('staff')::uuid, tests.fx('cust')::uuid,
  (((now() at time zone 'Africa/Nairobi')::date + 9) + time '10:00') at time zone 'Africa/Nairobi')).id::text;
-- A cash payment taken against the booking before any invoice exists.
insert into public.payments (business_id, booking_id, method, status, amount_cents)
values (tests.fx('biz')::uuid, tests.fx('bk')::uuid, 'cash', 'succeeded', 50000);

insert into tests.fx select 'bi', public.create_invoice_from_booking(tests.fx('bk')::uuid)::text;
select results_eq(
  format($$select i.booking_id::text, i.vat_rate_bp, i.deposit_cents, it.description, it.unit_price_cents
           from public.invoices i join public.invoice_items it on it.invoice_id = i.id where i.id = %L$$,
         tests.fx('bi')),
  -- Dashboard bookings carry no deposit requirement (only online ones do), so 0.
  format($$values (%L, 1600, 0::bigint, 'Full shoot', 200000::bigint)$$, tests.fx('bk')),
  'invoice from a booking: the service line, the booking''s deposit, and VAT for a VAT-registered business'
);
select is(public.create_invoice_from_booking(tests.fx('bk')::uuid)::text, tests.fx('bi'),
  'creating it again returns the same invoice (idempotent)');

select public.issue_invoice(tests.fx('bi')::uuid);
select results_eq(
  format($$select status::text, amount_paid_cents, balance_cents from public.invoices where id = %L$$,
         tests.fx('bi')),
  -- 2,000 + 16% VAT = 2,320; the 500 deposit already paid on the booking counts.
  $$values ('partially_paid', 50000::bigint, 182000::bigint)$$,
  'issuing adopts the deposit already paid on the booking'
);

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
insert into tests.fx
select 'q', public.save_invoice_draft(
  tests.fx('biz')::uuid, null, 'quote', tests.fx('cust')::uuid,
  '[{"description":"Wedding","quantity":1,"unit_price_cents":5000000},
    {"description":"Album","quantity":2,"unit_price_cents":750000}]'::jsonb, p_vat_rate_bp => 1600)::text;
select throws_ok(format('select public.convert_quote_to_invoice(%L)', tests.fx('q')),
  '55000', null, 'a draft quote cannot be converted');
select public.issue_invoice(tests.fx('q')::uuid);

insert into tests.fx select 'qi', public.convert_quote_to_invoice(tests.fx('q')::uuid)::text;
select results_eq(
  format($$select (select status::text from public.invoices where id = %L), i.kind::text, i.status::text,
                  i.total_cents, (select count(*)::int from public.invoice_items where invoice_id = i.id)
           from public.invoices i where i.id = %L$$, tests.fx('q'), tests.fx('qi')),
  $$values ('accepted', 'invoice', 'draft', 7540000::bigint, 2)$$,
  'converting accepts the quote and copies it into a draft invoice'
);
select throws_ok(format('select public.decline_quote(%L)', tests.fx('q')),
  '55000', null, 'an accepted quote cannot be declined');
select throws_ok(format('select public.decline_quote(%L)', tests.fx('qi')),
  '55000', null, 'decline_quote only works on quotes');

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------
select tests.login('eeeeeeee-0000-0000-0000-000000000002', 'outsider-e@nextto.test');
select is((select count(*)::int from public.invoice_summaries), 0,
  'outsiders see no invoice summaries (security_invoker view + RLS)');
select throws_ok(
  format($$select public.save_invoice_draft(%L, null, 'invoice', %L,
           '[{"description":"A","quantity":1,"unit_price_cents":100}]'::jsonb)$$,
         tests.fx('biz'), tests.fx('cust')),
  '42501', null, 'outsiders cannot create drafts in another business (RLS WITH CHECK)'
);
select throws_ok(format('select public.convert_quote_to_invoice(%L)', tests.fx('q')),
  'P0002', null, 'outsiders cannot convert another business''s quote');
select throws_ok(format('select public.create_invoice_from_booking(%L)', tests.fx('bk')),
  'P0002', null, 'outsiders cannot invoice another business''s booking');

reset role;
select results_eq(
  $$select has_function_privilege('anon', 'public.save_invoice_draft(uuid, uuid, public.document_kind, uuid, jsonb, integer, bigint, date, text, uuid)', 'execute'),
           has_function_privilege('anon', 'public.convert_quote_to_invoice(uuid)', 'execute')$$,
  $$values (false, false)$$,
  'anon cannot call the drafting functions'
);

select * from finish();
rollback;
