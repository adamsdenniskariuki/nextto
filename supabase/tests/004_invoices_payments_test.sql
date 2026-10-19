-- Invoices (gapless numbers, VAT, freezing) and payments (manual + M-Pesa callbacks).
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
grant usage on schema tests to anon, authenticated, service_role;
grant select, insert on tests.fx to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Builds a Daraja STK callback body like Safaricom sends it.
create function tests.stk_callback(p_checkout text, p_code int, p_amount numeric default null,
                                   p_receipt text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('Body', jsonb_build_object('stkCallback', jsonb_build_object(
    'MerchantRequestID', 'mr-' || p_checkout,
    'CheckoutRequestID', p_checkout,
    'ResultCode', p_code,
    'ResultDesc', case p_code when 0 then 'The service request is processed successfully.'
                              when 1032 then 'Request cancelled by user' else 'Failed' end
  ) || case when p_code = 0 then jsonb_build_object('CallbackMetadata', jsonb_build_object('Item',
         jsonb_build_array(
           jsonb_build_object('Name', 'Amount', 'Value', p_amount),
           jsonb_build_object('Name', 'MpesaReceiptNumber', 'Value', p_receipt),
           jsonb_build_object('Name', 'TransactionDate', 'Value', 20261019102115),
           jsonb_build_object('Name', 'PhoneNumber', 'Value', 254711111111))))
       else '{}'::jsonb end))
$$;
grant execute on function tests.stk_callback(text, int, numeric, text) to service_role;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-d@nextto.test');
select tests.login('dddddddd-0000-0000-0000-000000000001', 'owner-d@nextto.test');
select public.create_business('Invoice Test', 'test-inv', 'photographer');
insert into tests.fx select 'biz', id::text from public.businesses where slug = 'test-inv';
insert into public.customers (business_id, name, phone)
values (tests.fx('biz')::uuid, 'Kamau', '+254711111111');
insert into tests.fx select 'cust', id::text from public.customers where business_id = tests.fx('biz')::uuid;
select set_config('tests.year', extract(year from now() at time zone 'Africa/Nairobi')::text, true);

-- ---------------------------------------------------------------------------
-- As the owner: draft, items, VAT, issue.
-- ---------------------------------------------------------------------------
set local role authenticated;

with ins as (
  insert into public.invoices (business_id, customer_id, vat_rate_bp)
  values (tests.fx('biz')::uuid, tests.fx('cust')::uuid, 1600)
  returning id
)
insert into tests.fx select 'inv1', id::text from ins;

insert into public.invoice_items (business_id, invoice_id, description, quantity, unit_price_cents)
values (tests.fx('biz')::uuid, tests.fx('inv1')::uuid, 'Portrait session', 2, 150000),
       (tests.fx('biz')::uuid, tests.fx('inv1')::uuid, 'Half print', 0.5, 999);

-- 2 x 1,500.00 + 0.5 x 9.99 (= 4.995, rounds to 5.00) = 3,005.00 KES
select is((select subtotal_cents from public.invoices where id = tests.fx('inv1')::uuid), 300500::bigint,
  'subtotal is the sum of exactly rounded line totals');
select is((select vat_cents from public.invoices where id = tests.fx('inv1')::uuid), 48080::bigint,
  'VAT at 16% (1600 basis points) is computed in integer cents');
select is((select total_cents from public.invoices where id = tests.fx('inv1')::uuid), 348580::bigint,
  'total = subtotal + VAT (generated column)');

select is((public.issue_invoice(tests.fx('inv1')::uuid)).number,
  'INV-' || current_setting('tests.year') || '-0001', 'first invoice gets number 0001');

-- An invoice that fails to issue must not consume a number.
with ins as (
  insert into public.invoices (business_id, customer_id)
  values (tests.fx('biz')::uuid, tests.fx('cust')::uuid) returning id
)
insert into tests.fx select 'empty', id::text from ins;
select throws_ok(format('select public.issue_invoice(%L)', tests.fx('empty')),
  '22023', null, 'an invoice without items cannot be issued');

with ins as (
  insert into public.invoices (business_id, customer_id)
  values (tests.fx('biz')::uuid, tests.fx('cust')::uuid) returning id
)
insert into tests.fx select 'inv2', id::text from ins;
insert into public.invoice_items (business_id, invoice_id, description, unit_price_cents)
values (tests.fx('biz')::uuid, tests.fx('inv2')::uuid, 'Retouching', 50000);
select is((public.issue_invoice(tests.fx('inv2')::uuid)).number,
  'INV-' || current_setting('tests.year') || '-0002', 'numbering is gapless after a failed issue');

with ins as (
  insert into public.invoices (business_id, customer_id, kind)
  values (tests.fx('biz')::uuid, tests.fx('cust')::uuid, 'quote') returning id
)
insert into tests.fx select 'quote', id::text from ins;
insert into public.invoice_items (business_id, invoice_id, description, unit_price_cents)
values (tests.fx('biz')::uuid, tests.fx('quote')::uuid, 'Wedding package', 5000000);
select is((public.issue_invoice(tests.fx('quote')::uuid)).number,
  'QUO-' || current_setting('tests.year') || '-0001', 'quotes have their own sequence');

select is((select due_date - issue_date from public.invoices where id = tests.fx('inv1')::uuid), 14,
  'due date defaults to 14 days after issue');
select throws_ok(format('select public.issue_invoice(%L)', tests.fx('inv1')),
  '55000', null, 'an issued invoice cannot be issued again');
select throws_ok(
  format($$insert into public.invoice_items (business_id, invoice_id, description, unit_price_cents)
           values (%L, %L, 'Sneaky extra', 100)$$, tests.fx('biz'), tests.fx('inv1')),
  '55000', null, 'line items are locked once issued');
select throws_ok(
  format($$update public.invoices set vat_rate_bp = 0 where id = %L$$, tests.fx('inv1')),
  '55000', null, 'commercial fields are frozen once issued');

-- Manual cash payment (allowed for clients).
insert into public.payments (business_id, invoice_id, method, status, amount_cents)
values (tests.fx('biz')::uuid, tests.fx('inv1')::uuid, 'cash', 'succeeded', 100000);
select results_eq(
  format('select status::text, amount_paid_cents, balance_cents from public.invoices where id = %L', tests.fx('inv1')),
  $$values ('partially_paid', 100000::bigint, 248580::bigint)$$,
  'a part payment makes the invoice partially_paid with the right balance'
);
select throws_ok(
  format($$insert into public.payments (business_id, invoice_id, method, status, amount_cents)
           values (%L, %L, 'cash', 'succeeded', 100)$$, tests.fx('biz'), tests.fx('quote')),
  '55000', null, 'payments cannot be taken on quotes'
);
reset role;

-- ---------------------------------------------------------------------------
-- M-Pesa: as the server (service_role), the way the route handler calls it.
-- ---------------------------------------------------------------------------
set local role service_role;

select is(
  (public.create_mpesa_payment(tests.fx('biz')::uuid, 248580, '+254711111111', 'ws_CO_1',
                               'mr-1', tests.fx('inv1')::uuid)).status::text,
  'pending', 'an STK push creates a pending payment'
);
select is(
  public.record_mpesa_callback(tests.stk_callback('ws_CO_1', 0, 2485.80, 'TJK1ABC2DE')) ->> 'outcome',
  'applied', 'a success callback is applied'
);
select results_eq(
  $$select status::text, mpesa_receipt, amount_cents from public.payments where mpesa_checkout_request_id = 'ws_CO_1'$$,
  $$values ('succeeded', 'TJK1ABC2DE', 248580::bigint)$$,
  'the payment succeeded with the receipt and the amount converted to cents'
);
select results_eq(
  format('select status::text, balance_cents from public.invoices where id = %L', tests.fx('inv1')),
  $$values ('paid', 0::bigint)$$,
  'the invoice is now paid'
);

-- Safaricom retries callbacks; a duplicate must be a no-op.
select is(
  public.record_mpesa_callback(tests.stk_callback('ws_CO_1', 0, 2485.80, 'TJK1ABC2DE')) ->> 'outcome',
  'duplicate', 'a duplicate callback is detected by CheckoutRequestID'
);
select is((select count(*)::int from public.payments where invoice_id = tests.fx('inv1')::uuid and status = 'succeeded'),
  2, 'the duplicate did not create or double-count a payment');

select throws_ok(
  format($$insert into public.payments (business_id, invoice_id, method, status, amount_cents)
           values (%L, %L, 'cash', 'succeeded', 100)$$, tests.fx('biz'), tests.fx('inv1')),
  '55000', null, 'a paid invoice takes no more payments'
);

-- The user cancels the prompt on their phone.
select public.create_mpesa_payment(tests.fx('biz')::uuid, 50000, '+254711111111', 'ws_CO_2',
                                   null, tests.fx('inv2')::uuid);
select is(
  public.record_mpesa_callback(tests.stk_callback('ws_CO_2', 1032)) ->> 'status',
  'cancelled', 'result code 1032 marks the payment cancelled'
);
select is((select status::text from public.invoices where id = tests.fx('inv2')::uuid), 'issued',
  'a cancelled payment leaves the invoice unpaid');

select is(
  public.record_mpesa_callback(tests.stk_callback('ws_CO_3', 1)) ->> 'outcome',
  'unmatched', 'a callback for an unknown CheckoutRequestID is stored as unmatched'
);
select throws_ok(
  $$select public.record_mpesa_callback('{"Body":{"stkCallback":{}}}'::jsonb)$$,
  '22023', null, 'malformed callbacks are rejected'
);
reset role;

-- A callback that arrives before the payment row (race) is applied when the row appears.
insert into public.bookings (business_id, staff_id, service_id, customer_id, during, status, price_cents, deposit_cents)
select tests.fx('biz')::uuid, s.id, sv.id, tests.fx('cust')::uuid,
       tstzrange(now() + interval '40 days', now() + interval '40 days 1 hour'), 'pending', 1000000, 200000
from public.staff s, public.services sv
where s.business_id = tests.fx('biz')::uuid and sv.business_id = tests.fx('biz')::uuid
limit 1;
insert into tests.fx select 'booking', id::text from public.bookings where business_id = tests.fx('biz')::uuid;

set local role service_role;
select is(
  public.record_mpesa_callback(tests.stk_callback('ws_CO_4', 0, 2000, 'TJK9EARLY1')) ->> 'outcome',
  'unmatched', 'early callback is stored'
);
select is(
  (public.create_mpesa_payment(tests.fx('biz')::uuid, 200000, '+254711111111', 'ws_CO_4',
                               null, null, tests.fx('booking')::uuid)).status::text,
  'succeeded', 'the payment claims the early callback as soon as it is created'
);
reset role;
select is((select status::text from public.bookings where id = tests.fx('booking')::uuid), 'confirmed',
  'a paid deposit confirms the pending booking');

-- Stale STK pushes expire.
set local role service_role;
select public.create_mpesa_payment(tests.fx('biz')::uuid, 50000, '+254711111111', 'ws_CO_5',
                                   null, tests.fx('inv2')::uuid);
reset role;
update public.payments set created_at = now() - interval '20 minutes' where mpesa_checkout_request_id = 'ws_CO_5';
select is(private.expire_stale_mpesa_payments(), 1, 'pending STK pushes older than 15 minutes expire');

-- ---------------------------------------------------------------------------
-- Void and share
-- ---------------------------------------------------------------------------
select tests.login('dddddddd-0000-0000-0000-000000000001', 'owner-d@nextto.test');
set local role authenticated;
select throws_ok(format('select public.void_invoice(%L)', tests.fx('inv1')),
  '55000', null, 'invoices with payments cannot be voided');
select is((public.void_invoice(tests.fx('inv2')::uuid)).status::text, 'void',
  'an unpaid invoice can be voided (its number stays used)');
reset role;

insert into tests.fx select 'share', share_token::text from public.invoices where id = tests.fx('inv1')::uuid;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(
  public.get_shared_invoice(tests.fx('share')::uuid) -> 'invoice' ->> 'number',
  'INV-' || current_setting('tests.year') || '-0001',
  'anyone with the share link can view the invoice'
);
select is(public.get_shared_invoice(gen_random_uuid()), null, 'unknown share tokens return null');
reset role;

select * from finish();
rollback;
