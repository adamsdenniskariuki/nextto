-- =============================================================================
-- 0011 Invoice documents: drafting, quotes, deposits and partial payments.
--
-- Concepts:
--   * SECURITY INVOKER functions. save_invoice_draft runs as the caller, so
--     RLS and the column GRANTs from 0003 still apply to every statement in
--     it. The function only adds atomicity: the invoice row and all of its
--     line items are saved in one transaction, or not at all.
--   * ROWS FROM (jsonb_to_recordset(...) AS (...)) WITH ORDINALITY turns a
--     JSON array of line items into rows, keeping their order for sort_order.
--   * A SECURITY DEFINER function where the caller lacks a column privilege
--     (quote status), with an explicit membership check instead of RLS.
--   * Row locks against over-payment: the payment trigger locks the invoice
--     (SELECT ... FOR UPDATE), so two cashiers recording payments at the same
--     moment are serialised and can't take the balance below zero.
--   * An AFTER UPDATE trigger with a WHEN clause carries a booking's paid
--     deposit onto its invoice the moment the invoice is issued.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Payments: no over-payment. Replaces the version from 0007, keeping its rules.
-- ---------------------------------------------------------------------------
create or replace function private.payments_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  if new.invoice_id is not null then
    -- Lock the invoice: a concurrent payment waits here until we commit, then
    -- sees the balance our payment left behind.
    select * into v_inv from public.invoices i where i.id = new.invoice_id for update;
    if v_inv.kind <> 'invoice' or v_inv.status not in ('issued', 'partially_paid') then
      raise exception 'Payments can only be taken on issued, unpaid invoices' using errcode = '55000';
    end if;
    if new.amount_cents > v_inv.balance_cents then
      raise exception 'That is more than the balance of % cents', v_inv.balance_cents
        using errcode = '22023';
    end if;
  end if;
  if new.status = 'succeeded' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_invoice_draft: create or update a draft and replace its line items.
-- ---------------------------------------------------------------------------
create function public.save_invoice_draft(
  p_business_id   uuid,
  p_invoice_id    uuid,                 -- null: create a new draft
  p_kind          public.document_kind,
  p_customer_id   uuid,
  p_items         jsonb,                -- [{description, quantity, unit_price_cents}, ...]
  p_vat_rate_bp   integer default 0,
  p_deposit_cents bigint default 0,
  p_due_date      date default null,
  p_notes         text default null,
  p_booking_id    uuid default null
)
returns uuid
language plpgsql
security invoker      -- RLS applies to everything below.
set search_path = ''
as $$
declare
  v_id uuid := p_invoice_id;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one line item' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.invoices (business_id, kind, customer_id, booking_id, vat_rate_bp,
                                 deposit_cents, due_date, notes)
    values (p_business_id, p_kind, p_customer_id, p_booking_id, p_vat_rate_bp,
            p_deposit_cents, p_due_date, p_notes)
    returning id into v_id;
  else
    update public.invoices
    set customer_id = p_customer_id, vat_rate_bp = p_vat_rate_bp,
        deposit_cents = p_deposit_cents, due_date = p_due_date, notes = p_notes
    where id = v_id and business_id = p_business_id and status = 'draft';
    if not found then
      -- Missing, another tenant's (hidden by RLS) or already issued.
      raise exception 'Draft not found' using errcode = 'P0002';
    end if;
    delete from public.invoice_items where invoice_id = v_id;
  end if;

  -- One row per array element; WITH ORDINALITY numbers them 1, 2, 3... A
  -- column definition list plus ordinality needs the ROWS FROM (...) form.
  insert into public.invoice_items (business_id, invoice_id, description, quantity,
                                    unit_price_cents, sort_order)
  select p_business_id, v_id, trim(item.description), item.quantity, item.unit_price_cents, item.n
  from rows from (
         jsonb_to_recordset(p_items) as (description text, quantity numeric, unit_price_cents bigint)
       ) with ordinality as item(description, quantity, unit_price_cents, n);

  -- A deposit larger than the total makes no sense; the trigger-maintained
  -- subtotal is final now, so check it here.
  if exists (select 1 from public.invoices
             where id = v_id and deposit_cents > total_cents) then
    raise exception 'The deposit can''t be more than the total' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_invoice_draft from public, anon;
grant execute on function public.save_invoice_draft to authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice_from_booking: a draft with the booked service as its line.
-- Idempotent: returns the booking's existing (non-void) invoice if there is one.
-- ---------------------------------------------------------------------------
create function public.create_invoice_from_booking(p_booking_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_b  record;
  v_id uuid;
begin
  select bk.business_id, bk.customer_id, bk.price_cents, bk.deposit_cents, bk.status,
         s.name as service_name,
         case when b.vat_registered then b.vat_rate_bp else 0 end as vat_rate_bp
  into v_b
  from public.bookings bk
  join public.services s on s.id = bk.service_id
  join public.businesses b on b.id = bk.business_id
  where bk.id = p_booking_id;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_b.status = 'cancelled' then
    raise exception 'Cancelled bookings can''t be invoiced' using errcode = '22023';
  end if;

  select id into v_id from public.invoices
  where booking_id = p_booking_id and kind = 'invoice' and status <> 'void'
  order by created_at limit 1;
  if found then
    return v_id;
  end if;

  return public.save_invoice_draft(
    p_business_id   => v_b.business_id,
    p_invoice_id    => null,
    p_kind          => 'invoice',
    p_customer_id   => v_b.customer_id,
    p_items         => jsonb_build_array(jsonb_build_object(
                         'description', v_b.service_name,
                         'quantity', 1,
                         'unit_price_cents', v_b.price_cents)),
    p_vat_rate_bp   => v_b.vat_rate_bp,
    p_deposit_cents => v_b.deposit_cents,
    p_booking_id    => p_booking_id
  );
end;
$$;

revoke execute on function public.create_invoice_from_booking(uuid) from public, anon;
grant execute on function public.create_invoice_from_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Quotes: accept (copying it into a new draft invoice) or decline.
-- Clients can't UPDATE invoices.status, hence SECURITY DEFINER + is_member().
-- ---------------------------------------------------------------------------
create function public.convert_quote_to_invoice(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q  public.invoices;
  v_id uuid;
begin
  select * into v_q from public.invoices where id = p_quote_id for update;
  if not found or v_q.kind <> 'quote' or not private.is_member(v_q.business_id) then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  if v_q.status not in ('issued', 'accepted') then
    raise exception 'Only issued quotes can be turned into invoices' using errcode = '55000';
  end if;

  update public.invoices set status = 'accepted' where id = p_quote_id;

  insert into public.invoices (business_id, kind, customer_id, booking_id, vat_rate_bp,
                               deposit_cents, notes, created_by)
  values (v_q.business_id, 'invoice', v_q.customer_id, v_q.booking_id, v_q.vat_rate_bp,
          v_q.deposit_cents, v_q.notes, auth.uid())
  returning id into v_id;

  insert into public.invoice_items (business_id, invoice_id, description, quantity,
                                    unit_price_cents, sort_order)
  select business_id, v_id, description, quantity, unit_price_cents, sort_order
  from public.invoice_items where invoice_id = p_quote_id;

  return v_id;
end;
$$;

revoke execute on function public.convert_quote_to_invoice(uuid) from public, anon;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated;

create function public.decline_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices set status = 'declined'
  where id = p_quote_id and kind = 'quote' and status = 'issued'
    and private.is_member(business_id);
  if not found then
    raise exception 'Only issued quotes can be declined' using errcode = '55000';
  end if;
end;
$$;

revoke execute on function public.decline_quote(uuid) from public, anon;
grant execute on function public.decline_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Issuing an invoice for a booking adopts the booking's paid deposit.
-- WHEN (...) means the trigger only fires for the draft -> issued change, so
-- the nested UPDATE in refresh_invoice_payment_state doesn't re-trigger it.
-- ---------------------------------------------------------------------------
create function private.invoice_adopt_booking_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set invoice_id = new.id
  where booking_id = new.booking_id
    and invoice_id is null
    and status = 'succeeded';
  if found then
    perform private.refresh_invoice_payment_state(new.id);
  end if;
  return null;
end;
$$;

create trigger invoice_adopt_booking_payments
  after update of status on public.invoices
  for each row
  when (old.status = 'draft' and new.status = 'issued'
        and new.kind = 'invoice' and new.booking_id is not null)
  execute function private.invoice_adopt_booking_payments();

-- ---------------------------------------------------------------------------
-- invoice_summaries: the list view, with overdue status in the business's
-- own time zone ("today" in Nairobi, not in UTC).
-- ---------------------------------------------------------------------------
create view public.invoice_summaries
with (security_invoker = true) as
select i.id, i.business_id, i.kind, i.number, i.status, i.customer_id,
       c.name  as customer_name,
       c.phone as customer_phone,
       i.booking_id, i.issue_date, i.due_date, i.created_at,
       i.total_cents, i.amount_paid_cents, i.balance_cents, i.deposit_cents,
       -- What the customer should pay now: the rest of the deposit if one was
       -- asked for, otherwise the whole balance.
       case
         when i.kind <> 'invoice' or i.status not in ('issued', 'partially_paid') then 0
         when i.deposit_cents > i.amount_paid_cents then i.deposit_cents - i.amount_paid_cents
         else i.balance_cents
       end::bigint as amount_due_now_cents,
       (i.kind = 'invoice' and i.status in ('issued', 'partially_paid')
        and i.due_date < (now() at time zone b.timezone)::date) as is_overdue,
       case when i.kind = 'invoice' and i.status in ('issued', 'partially_paid')
            then greatest((now() at time zone b.timezone)::date - i.due_date, 0)
            else 0 end as days_overdue
from public.invoices i
join public.customers c on c.id = i.customer_id
join public.businesses b on b.id = i.business_id;

grant select on public.invoice_summaries to authenticated;
