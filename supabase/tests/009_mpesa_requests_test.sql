-- M-Pesa STK push requests: the preflight rules (prepare_mpesa_request), one
-- waiting prompt per target (partial unique indexes), the hourly attempt cap,
-- the guest status lookup, and who may call what.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

-- A Daraja STK callback body, as Safaricom sends it.
create function tests.stk_callback(p_checkout text, p_code int, p_amount numeric default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('Body', jsonb_build_object('stkCallback', jsonb_build_object(
    'MerchantRequestID', 'mr-' || p_checkout,
    'CheckoutRequestID', p_checkout,
    'ResultCode', p_code,
    'ResultDesc', case p_code when 0 then 'OK' else 'Request cancelled by user' end
  ) || case when p_code = 0 then jsonb_build_object('CallbackMetadata', jsonb_build_object('Item',
         jsonb_build_array(
           jsonb_build_object('Name', 'Amount', 'Value', p_amount),
           jsonb_build_object('Name', 'MpesaReceiptNumber', 'Value', 'R' || p_checkout),
           jsonb_build_object('Name', 'PhoneNumber', 'Value', 254722000123))))
       else '{}'::jsonb end))
$$;
grant execute on function tests.stk_callback(text, int, numeric) to service_role;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-f@nextto.test');
select tests.login('ffffffff-0000-0000-0000-000000000001', 'owner-f@nextto.test');
select public.create_business('Mpesa Test', 'test-mpesa', 'general');

insert into tests.fx
select 'biz', id::text from public.businesses where slug = 'test-mpesa'
union all
select 'staff', s.id::text from public.staff s join public.businesses b on b.id = s.business_id
where b.slug = 'test-mpesa';
insert into public.services (business_id, name, duration_minutes, price_cents, deposit_cents)
values (tests.fx('biz')::uuid, 'Deep clean', 60, 300000, 100050);
insert into tests.fx
select 'svc', id::text from public.services where business_id = tests.fx('biz')::uuid and name = 'Deep clean';
insert into public.customers (business_id, name, phone)
values (tests.fx('biz')::uuid, 'Wanjiru', '+254722000123');
insert into tests.fx
select 'cust', id::text from public.customers where business_id = tests.fx('biz')::uuid;

-- An issued invoice: KES 1,500.50 with a KES 500 deposit.
set local role authenticated;
insert into tests.fx
select 'inv', public.save_invoice_draft(
  tests.fx('biz')::uuid, null, 'invoice', tests.fx('cust')::uuid,
  '[{"description":"Deep clean","quantity":1,"unit_price_cents":150050}]'::jsonb,
  p_deposit_cents => 50000)::text;
select public.issue_invoice(tests.fx('inv')::uuid);
reset role;

-- A pending booking (deposit KES 1,000.50) next week, and one in the past.
insert into public.bookings (business_id, staff_id, service_id, customer_id, during, status,
                             source, price_cents, deposit_cents)
values (tests.fx('biz')::uuid, tests.fx('staff')::uuid, tests.fx('svc')::uuid, tests.fx('cust')::uuid,
        tstzrange(date_trunc('hour', now()) + interval '7 days',
                  date_trunc('hour', now()) + interval '7 days 1 hour'),
        'pending', 'public', 300000, 100050),
       (tests.fx('biz')::uuid, tests.fx('staff')::uuid, tests.fx('svc')::uuid, tests.fx('cust')::uuid,
        tstzrange(date_trunc('hour', now()) - interval '7 days',
                  date_trunc('hour', now()) - interval '7 days' + interval '1 hour'),
        'pending', 'public', 300000, 100050);
insert into tests.fx
select case when lower(during) > now() then 'bk' else 'bk_past' end, id::text
from public.bookings where business_id = tests.fx('biz')::uuid;

-- ---------------------------------------------------------------------------
-- Privileges: only the server (service_role) may prepare or look up prompts.
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.prepare_mpesa_request(uuid, uuid, bigint)', 'execute'),
  'anon cannot call prepare_mpesa_request');
select ok(not has_function_privilege('authenticated', 'public.prepare_mpesa_request(uuid, uuid, bigint)', 'execute'),
  'authenticated cannot call prepare_mpesa_request');
select ok(not has_function_privilege('anon', 'public.latest_mpesa_attempt(uuid, uuid)', 'execute'),
  'anon cannot call latest_mpesa_attempt');
select ok(has_function_privilege('service_role', 'public.prepare_mpesa_request(uuid, uuid, bigint)', 'execute'),
  'service_role can call prepare_mpesa_request');

set local role service_role;

-- ---------------------------------------------------------------------------
-- prepare_mpesa_request: invoices
-- ---------------------------------------------------------------------------
select is(
  public.prepare_mpesa_request(p_invoice_id => tests.fx('inv')::uuid)
    - 'business_id' - 'invoice_id' - 'booking_id',
  jsonb_build_object('amount_cents', 50000, 'phone', '+254722000123',
                     'account_reference', 'INV' || extract(year from now() at time zone 'Africa/Nairobi') || '0001',
                     'description', 'Invoice'),
  'an invoice with an unpaid deposit asks for the deposit, to the customer''s phone'
);
select is(
  (public.prepare_mpesa_request(p_invoice_id => tests.fx('inv')::uuid, p_amount_cents => 150050)
    ->> 'amount_cents')::bigint,
  150000::bigint,
  'staff may ask for up to the balance; cents are dropped (whole shillings only)'
);
select throws_ok(
  format('select public.prepare_mpesa_request(p_invoice_id => %L, p_amount_cents => 150051)', tests.fx('inv')),
  '22023', 'That is more than the balance',
  'cannot ask for more than the balance'
);
select throws_ok(
  format('select public.prepare_mpesa_request(p_invoice_id => %L, p_amount_cents => 99)', tests.fx('inv')),
  '22023', 'M-Pesa needs at least KES 1',
  'less than one shilling is refused'
);
select throws_ok(
  format('select public.prepare_mpesa_request(%L, %L)', tests.fx('inv'), tests.fx('bk')),
  '22023', 'Pass exactly one of an invoice or a booking',
  'exactly one target'
);
select throws_ok(
  'select public.prepare_mpesa_request(p_invoice_id => gen_random_uuid())',
  'P0002', 'Invoice not found',
  'unknown invoice'
);

-- ---------------------------------------------------------------------------
-- prepare_mpesa_request: booking deposits
-- ---------------------------------------------------------------------------
select is(
  public.prepare_mpesa_request(p_booking_id => tests.fx('bk')::uuid)
    - 'business_id' - 'invoice_id' - 'booking_id',
  jsonb_build_object('amount_cents', 100000, 'phone', '+254722000123',
                     'account_reference', upper(left(replace(tests.fx('bk'), '-', ''), 8)),
                     'description', 'Deposit'),
  'a pending booking asks for its deposit in whole shillings, referenced by the booking code'
);
select throws_ok(
  format('select public.prepare_mpesa_request(p_booking_id => %L, p_amount_cents => 100051)', tests.fx('bk')),
  '22023', 'That is more than is due',
  'cannot ask a guest for more than the deposit'
);
select throws_ok(
  format('select public.prepare_mpesa_request(p_booking_id => %L)', tests.fx('bk_past')),
  '55000', 'This booking is in the past',
  'no deposits for bookings that are over'
);

-- ---------------------------------------------------------------------------
-- One waiting prompt per target, enforced by the partial unique index.
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$select public.create_mpesa_payment(%L, 50000, '+254722000123', 'ws_CO_inv_1', null, %L)$$,
         tests.fx('biz'), tests.fx('inv')),
  'the first prompt is recorded as pending'
);
select throws_ok(
  format('select public.prepare_mpesa_request(p_invoice_id => %L)', tests.fx('inv')),
  '55000', 'An M-Pesa request is already waiting on the customer''s phone',
  'preflight refuses a second prompt while one is waiting'
);
select throws_ok(
  format($$select public.create_mpesa_payment(%L, 50000, '+254722000123', 'ws_CO_inv_2', null, %L)$$,
         tests.fx('biz'), tests.fx('inv')),
  '23505', null,
  'and the unique index stops a racing second insert'
);
select is(
  public.latest_mpesa_attempt(p_invoice_id => tests.fx('inv')::uuid) ->> 'status', 'pending',
  'latest_mpesa_attempt reports the waiting prompt'
);

-- The customer cancels: the index no longer covers the row, so a retry is allowed.
select public.record_mpesa_callback(tests.stk_callback('ws_CO_inv_1', 1032));
select lives_ok(
  format('select public.prepare_mpesa_request(p_invoice_id => %L)', tests.fx('inv')),
  'after a cancelled prompt, a new one is allowed'
);

-- Booking deposit: prompt, then success confirms the booking.
select public.create_mpesa_payment(tests.fx('biz')::uuid, 100000, '+254722000123', 'ws_CO_bk_1',
                                   p_booking_id => tests.fx('bk')::uuid);
select public.record_mpesa_callback(tests.stk_callback('ws_CO_bk_1', 0, 1000));
select is(
  public.latest_mpesa_attempt(p_booking_id => tests.fx('bk')::uuid)
    - 'created_at' - 'result_desc',
  jsonb_build_object('status', 'succeeded', 'amount_cents', 100000, 'receipt', 'Rws_CO_bk_1',
                     'phone_last3', '123'),
  'a paid deposit shows its receipt and only the last digits of the phone'
);
select is(
  (select status::text from public.bookings where id = tests.fx('bk')::uuid), 'confirmed',
  'and confirms the booking'
);
select throws_ok(
  format('select public.prepare_mpesa_request(p_booking_id => %L)', tests.fx('bk')),
  '55000', 'This booking has no deposit waiting to be paid',
  'a confirmed booking needs no more deposit prompts'
);

-- ---------------------------------------------------------------------------
-- Hourly attempt cap: four more cancelled prompts make five in the hour.
-- ---------------------------------------------------------------------------
select public.create_mpesa_payment(tests.fx('biz')::uuid, 50000, '+254722000123', 'ws_CO_cap_' || n,
                                   p_invoice_id => tests.fx('inv')::uuid),
       public.record_mpesa_callback(tests.stk_callback('ws_CO_cap_' || n, 1032))
from generate_series(1, 4) n;
select throws_ok(
  format('select public.prepare_mpesa_request(p_invoice_id => %L)', tests.fx('inv')),
  '55000', 'Too many M-Pesa requests in the last hour. Please try again later',
  'at most five prompts per invoice per hour'
);

-- The rule lives in partial unique indexes (settled rows drop out of them).
reset role;
select ok(
  (select indisunique and indpred is not null from pg_index
   where indexrelid = 'public.payments_one_pending_mpesa_per_invoice'::regclass),
  'one-pending-per-invoice is a partial unique index'
);
select ok(
  (select indisunique and indpred is not null from pg_index
   where indexrelid = 'public.payments_one_pending_mpesa_per_booking'::regclass),
  'one-pending-per-booking is a partial unique index'
);
select * from finish();
rollback;
