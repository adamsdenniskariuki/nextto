-- =============================================================================
-- 0007 Payments and idempotent M-Pesa (Daraja STK push) callbacks.
--
-- Flow:
--   1. Server (service role) calls Daraja STK push and receives a CheckoutRequestID.
--   2. Server calls public.create_mpesa_payment(...) -> a 'pending' payment row.
--   3. Safaricom POSTs the result to /api/mpesa/callback/<secret>. The route
--      handler validates the body with Zod and calls
--      public.record_mpesa_callback(payload).
--   4. record_mpesa_callback stores the callback ONCE (unique
--      CheckoutRequestID: INSERT ... ON CONFLICT DO NOTHING) and applies it
--      to the payment inside the same transaction, with the payment row
--      locked (SELECT ... FOR UPDATE). A duplicate delivery is a no-op.
--   5. If the callback beats step 2 (it can), it is stored unmatched. Step 2's
--      trigger picks it up the moment the payment row appears.
-- =============================================================================

-- Validate payment targets before insert.
create function private.payments_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
  v_kind   public.document_kind;
begin
  if new.invoice_id is not null then
    select i.status, i.kind into v_status, v_kind
    from public.invoices i where i.id = new.invoice_id;
    if v_kind <> 'invoice' or v_status not in ('issued', 'partially_paid') then
      raise exception 'Payments can only be taken on issued, unpaid invoices' using errcode = '55000';
    end if;
  end if;
  if new.status = 'succeeded' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

create trigger payments_validate before insert on public.payments
  for each row execute function private.payments_validate();

-- Recalculate amount_paid and status of the affected invoice.
create function private.refresh_invoice_payment_state(p_invoice_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with paid as (
    select coalesce(sum(p.amount_cents), 0)::bigint as amt
    from public.payments p
    where p.invoice_id = p_invoice_id and p.status = 'succeeded'
  )
  update public.invoices i
  set amount_paid_cents = paid.amt,
      status = case
                 when i.status not in ('issued', 'partially_paid', 'paid') then i.status
                 when paid.amt > 0 and paid.amt >= i.total_cents then 'paid'
                 when paid.amt > 0 then 'partially_paid'
                 else 'issued'
               end::public.invoice_status
  from paid
  where i.id = p_invoice_id;
$$;

create function private.payments_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invoice_id is not null then
    perform private.refresh_invoice_payment_state(new.invoice_id);
  end if;
  -- A paid deposit confirms a pending booking.
  if new.booking_id is not null and new.status = 'succeeded' then
    update public.bookings set status = 'confirmed'
    where id = new.booking_id and status = 'pending';
  end if;
  return null;
end;
$$;

create trigger payments_after_change
  after insert or update of status, amount_cents on public.payments
  for each row execute function private.payments_after_change();

-- ---------------------------------------------------------------------------
-- Apply a stored callback to a payment (both rows locked by the caller's tx).
-- ---------------------------------------------------------------------------
create function private.apply_mpesa_callback(p_payment_id uuid, p_callback_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment  public.payments;
  v_callback private.mpesa_callbacks;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  select * into v_callback from private.mpesa_callbacks where id = p_callback_id for update;

  if v_payment.status = 'pending' then
    update public.payments
    set status = case
                   when v_callback.result_code = 0    then 'succeeded'
                   when v_callback.result_code = 1032 then 'cancelled'   -- user cancelled the prompt
                   else 'failed'
                 end::public.payment_status,
        result_code   = v_callback.result_code,
        result_desc   = v_callback.result_desc,
        mpesa_receipt = v_callback.receipt,
        amount_cents  = case when v_callback.result_code = 0 and v_callback.amount_cents > 0
                             then v_callback.amount_cents else amount_cents end,
        paid_at       = case when v_callback.result_code = 0 then v_callback.received_at end
    where id = p_payment_id
    returning * into v_payment;
  end if;

  update private.mpesa_callbacks
  set processed_at = coalesce(processed_at, now()), payment_id = p_payment_id
  where id = p_callback_id;

  return v_payment;
end;
$$;

revoke all on function private.apply_mpesa_callback(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Entry point for the Daraja callback route handler (service role only).
-- Parses the Daraja JSON in SQL with jsonb operators.
-- ---------------------------------------------------------------------------
create function public.record_mpesa_callback(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cb          jsonb := p_payload -> 'Body' -> 'stkCallback';
  v_checkout    text  := v_cb ->> 'CheckoutRequestID';
  v_items       jsonb := coalesce(v_cb #> '{CallbackMetadata,Item}', '[]'::jsonb);
  v_callback_id uuid;
  v_payment_id  uuid;
  v_payment     public.payments;
begin
  if v_checkout is null or (v_cb ->> 'ResultCode') is null then
    raise exception 'Malformed STK callback' using errcode = '22023';
  end if;

  insert into private.mpesa_callbacks
    (checkout_request_id, merchant_request_id, result_code, result_desc,
     receipt, amount_cents, phone, payload)
  values (
    v_checkout,
    v_cb ->> 'MerchantRequestID',
    (v_cb ->> 'ResultCode')::integer,
    v_cb ->> 'ResultDesc',
    (select i ->> 'Value' from jsonb_array_elements(v_items) i where i ->> 'Name' = 'MpesaReceiptNumber'),
    (select round((i ->> 'Value')::numeric * 100)::bigint
       from jsonb_array_elements(v_items) i where i ->> 'Name' = 'Amount'),
    (select '+' || (i ->> 'Value')
       from jsonb_array_elements(v_items) i where i ->> 'Name' = 'PhoneNumber'),
    p_payload
  )
  on conflict (checkout_request_id) do nothing
  returning id into v_callback_id;

  if v_callback_id is null then
    -- Duplicate delivery: already recorded. Idempotent no-op.
    return jsonb_build_object('outcome', 'duplicate', 'checkout_request_id', v_checkout);
  end if;

  select p.id into v_payment_id
  from public.payments p
  where p.mpesa_checkout_request_id = v_checkout;

  if v_payment_id is null then
    return jsonb_build_object('outcome', 'unmatched', 'checkout_request_id', v_checkout);
  end if;

  v_payment := private.apply_mpesa_callback(v_payment_id, v_callback_id);
  return jsonb_build_object(
    'outcome', 'applied',
    'checkout_request_id', v_checkout,
    'payment_id', v_payment.id,
    'status', v_payment.status
  );
end;
$$;

revoke execute on function public.record_mpesa_callback(jsonb) from public, anon, authenticated;
grant execute on function public.record_mpesa_callback(jsonb) to service_role;

-- When a payment gets its CheckoutRequestID, apply any callback that arrived first.
create function private.payments_claim_early_callback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_callback_id uuid;
begin
  select c.id into v_callback_id
  from private.mpesa_callbacks c
  where c.checkout_request_id = new.mpesa_checkout_request_id
    and c.processed_at is null;

  if v_callback_id is not null then
    perform private.apply_mpesa_callback(new.id, v_callback_id);
  end if;
  return null;
end;
$$;

create trigger payments_claim_early_callback
  after insert or update of mpesa_checkout_request_id on public.payments
  for each row
  when (new.mpesa_checkout_request_id is not null)
  execute function private.payments_claim_early_callback();

-- ---------------------------------------------------------------------------
-- Server-side creation of the pending M-Pesa payment after an STK push.
-- ---------------------------------------------------------------------------
create function public.create_mpesa_payment(
  p_business_id         uuid,
  p_amount_cents        bigint,
  p_phone               text,
  p_checkout_request_id text,
  p_merchant_request_id text default null,
  p_invoice_id          uuid default null,
  p_booking_id          uuid default null,
  p_created_by          uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  insert into public.payments
    (business_id, invoice_id, booking_id, method, status, amount_cents, phone,
     mpesa_checkout_request_id, mpesa_merchant_request_id, created_by)
  values
    (p_business_id, p_invoice_id, p_booking_id, 'mpesa', 'pending', p_amount_cents, p_phone,
     p_checkout_request_id, p_merchant_request_id, p_created_by)
  returning * into v_payment;

  -- Re-read: the early-callback trigger may already have settled it.
  select * into v_payment from public.payments where id = v_payment.id;
  return v_payment;
end;
$$;

revoke execute on function public.create_mpesa_payment(uuid, bigint, text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_mpesa_payment(uuid, bigint, text, text, text, uuid, uuid, uuid)
  to service_role;

-- Pending STK pushes that never got a callback expire after 15 minutes.
create function private.expire_stale_mpesa_payments()
returns integer
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.payments
    set status = 'failed', result_desc = 'Timed out waiting for M-Pesa confirmation'
    where status = 'pending'
      and method = 'mpesa'
      and created_at < now() - interval '15 minutes'
    returning 1
  )
  select count(*)::integer from expired;
$$;
