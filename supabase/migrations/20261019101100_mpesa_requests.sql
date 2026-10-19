-- =============================================================================
-- 0012 M-Pesa STK push requests: the rules around asking a phone for money.
--
-- 0007 handled the back half of the flow (the pending payment and the
-- idempotent callback). This migration adds the front half: deciding whether,
-- how much and which phone to ask BEFORE the server calls Daraja.
--
-- Concepts:
--   * Partial UNIQUE indexes as business rules. "At most one M-Pesa prompt
--     waiting per invoice" is a unique index over invoice_id restricted
--     (WHERE ...) to pending M-Pesa rows. Settled rows fall out of the index,
--     so the next attempt is allowed. Two clicks racing each other can't both
--     win: the second INSERT fails with 23505 (unique_violation).
--   * A "preflight" function that keeps every rule in one place (status,
--     amount, attempts per hour, phone) and returns what the server needs to
--     build the Daraja request. TypeScript doesn't re-implement any of it.
--   * Integer division for whole shillings: Daraja's Amount is whole KES, so
--     (cents / 100) * 100 drops the cents of a bigint without any float.
--   * A rolling-window rate limit with count(*) FILTER over a time range.
--   * SECURITY DEFINER + GRANT to service_role only: browsers can't call
--     these. Server actions decide who may ask (membership via RLS, or a
--     capability URL for guests) and then call them with the admin client.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- One waiting prompt per invoice and per booking.
-- ---------------------------------------------------------------------------
create unique index payments_one_pending_mpesa_per_invoice
  on public.payments (invoice_id)
  where method = 'mpesa' and status = 'pending' and invoice_id is not null;

create unique index payments_one_pending_mpesa_per_booking
  on public.payments (booking_id)
  where method = 'mpesa' and status = 'pending' and booking_id is not null;

-- Attempts per hour per target (see prepare_mpesa_request). Composite index:
-- equality on the target column first, then the range on created_at.
create index payments_invoice_created_idx on public.payments (invoice_id, created_at)
  where invoice_id is not null;
create index payments_booking_created_idx on public.payments (booking_id, created_at)
  where booking_id is not null;

-- ---------------------------------------------------------------------------
-- prepare_mpesa_request: validate a request and describe the STK push.
--
-- Exactly one of p_invoice_id / p_booking_id. p_amount_cents is optional:
-- without it, the invoice's amount due now (or the booking's deposit) is used.
-- Returns {business_id, invoice_id, booking_id, amount_cents, phone,
--          account_reference, description}.
-- ---------------------------------------------------------------------------
create function public.prepare_mpesa_request(
  p_invoice_id   uuid default null,
  p_booking_id   uuid default null,
  p_amount_cents bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_attempts_per_hour constant integer := 5;
  c_max_amount_cents      constant bigint  := 25000000;  -- KES 250,000 per transaction
  v_inv      public.invoices;
  v_booking  public.bookings;
  v_phone    text;
  v_due      bigint;
  v_amount   bigint;
  v_ref      text;
  v_desc     text;
  v_business uuid;
  v_pending  boolean;
  v_recent   integer;
begin
  if (p_invoice_id is null) = (p_booking_id is null) then
    raise exception 'Pass exactly one of an invoice or a booking' using errcode = '22023';
  end if;

  if p_invoice_id is not null then
    select * into v_inv from public.invoices where id = p_invoice_id;
    if not found then
      raise exception 'Invoice not found' using errcode = 'P0002';
    end if;
    if v_inv.kind <> 'invoice' or v_inv.status not in ('issued', 'partially_paid') then
      raise exception 'Only issued, unpaid invoices can be paid' using errcode = '55000';
    end if;
    select c.phone into v_phone from public.customers c where c.id = v_inv.customer_id;
    v_business := v_inv.business_id;
    -- Same rule as invoice_summaries.amount_due_now_cents.
    v_due := case when v_inv.deposit_cents > v_inv.amount_paid_cents
                  then v_inv.deposit_cents - v_inv.amount_paid_cents
                  else v_inv.balance_cents end;
    -- AccountReference is at most 12 characters: INV-2026-0001 -> INV20260001.
    v_ref  := left(replace(v_inv.number, '-', ''), 12);
    v_desc := 'Invoice';

    select bool_or(p.status = 'pending'),
           count(*) filter (where p.created_at > now() - interval '1 hour')
      into v_pending, v_recent
    from public.payments p
    where p.invoice_id = p_invoice_id and p.method = 'mpesa';
  else
    select * into v_booking from public.bookings where id = p_booking_id;
    if not found then
      raise exception 'Booking not found' using errcode = 'P0002';
    end if;
    if v_booking.status <> 'pending' or v_booking.deposit_cents <= 0 then
      raise exception 'This booking has no deposit waiting to be paid' using errcode = '55000';
    end if;
    if upper(v_booking.during) <= now() then
      raise exception 'This booking is in the past' using errcode = '55000';
    end if;
    select c.phone into v_phone from public.customers c where c.id = v_booking.customer_id;
    v_business := v_booking.business_id;
    v_due  := v_booking.deposit_cents;
    v_ref  := upper(left(replace(v_booking.id::text, '-', ''), 8));
    v_desc := 'Deposit';

    select bool_or(p.status = 'pending'),
           count(*) filter (where p.created_at > now() - interval '1 hour')
      into v_pending, v_recent
    from public.payments p
    where p.booking_id = p_booking_id and p.method = 'mpesa';
  end if;

  if coalesce(v_pending, false) then
    raise exception 'An M-Pesa request is already waiting on the customer''s phone'
      using errcode = '55000';
  end if;
  if v_recent >= c_max_attempts_per_hour then
    raise exception 'Too many M-Pesa requests in the last hour. Please try again later'
      using errcode = '55000';
  end if;

  v_amount := coalesce(p_amount_cents, v_due);
  if v_amount > v_due and p_amount_cents is not null and p_invoice_id is not null then
    -- Staff may ask for more than the deposit, up to the balance.
    if v_amount > v_inv.balance_cents then
      raise exception 'That is more than the balance' using errcode = '22023';
    end if;
  elsif v_amount > v_due then
    raise exception 'That is more than is due' using errcode = '22023';
  end if;
  -- M-Pesa takes whole shillings: drop the cents (integer division).
  v_amount := (v_amount / 100) * 100;
  if v_amount < 100 then
    raise exception 'M-Pesa needs at least KES 1' using errcode = '22023';
  end if;
  if v_amount > c_max_amount_cents then
    raise exception 'M-Pesa allows at most KES 250,000 per payment' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'business_id',       v_business,
    'invoice_id',        p_invoice_id,
    'booking_id',        p_booking_id,
    'amount_cents',      v_amount,
    'phone',             v_phone,
    'account_reference', v_ref,
    'description',       v_desc
  );
end;
$$;

comment on function public.prepare_mpesa_request(uuid, uuid, bigint) is
  'Checks an M-Pesa STK push is allowed and returns its amount, phone and reference. Service role only.';

revoke execute on function public.prepare_mpesa_request(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.prepare_mpesa_request(uuid, uuid, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- latest_mpesa_attempt: the most recent prompt for an invoice or booking, for
-- the guest pages ("Check your phone", "Paid, receipt QK12...").
-- ---------------------------------------------------------------------------
create function public.latest_mpesa_attempt(
  p_invoice_id uuid default null,
  p_booking_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status',        p.status,
    'amount_cents',  p.amount_cents,
    'receipt',       p.mpesa_receipt,
    'result_desc',   p.result_desc,
    -- Last three digits only: enough to recognise your own phone.
    'phone_last3',   right(p.phone, 3),
    'created_at',    p.created_at
  )
  from public.payments p
  where p.method = 'mpesa'
    and ((p_invoice_id is not null and p.invoice_id = p_invoice_id)
      or (p_booking_id is not null and p.booking_id = p_booking_id))
  order by p.created_at desc
  limit 1;
$$;

revoke execute on function public.latest_mpesa_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.latest_mpesa_attempt(uuid, uuid) to service_role;
