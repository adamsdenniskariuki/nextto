-- =============================================================================
-- 0006 Invoicing: totals, VAT, locking, gapless numbering and sharing.
--
-- Concepts:
--   * Exact money maths: line totals are numeric(quantity) * bigint(cents),
--     rounded once. VAT = round(subtotal * rate_bp / 10000) in numeric.
--   * Triggers keep denormalised totals correct. They are SECURITY DEFINER
--     because clients have no UPDATE privilege on the total columns.
--   * Gapless numbering with a counter row locked by UPDATE (see 0002).
-- =============================================================================

-- Recompute VAT whenever subtotal or rate change (BEFORE trigger edits NEW).
create function private.invoice_compute_vat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.vat_cents := round(new.subtotal_cents::numeric * new.vat_rate_bp / 10000)::bigint;
  return new;
end;
$$;

create trigger invoice_compute_vat
  before insert or update of subtotal_cents, vat_rate_bp on public.invoices
  for each row execute function private.invoice_compute_vat();

-- Once issued, the commercial content of a document is frozen.
create function private.invoice_freeze_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and (new.customer_id, new.vat_rate_bp, new.currency, new.kind)
         is distinct from (old.customer_id, old.vat_rate_bp, old.currency, old.kind)
  then
    raise exception 'Issued documents cannot be edited; void it and create a new one'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger invoice_freeze_issued before update on public.invoices
  for each row execute function private.invoice_freeze_issued();

-- Line items may only change while the parent is a draft.
create function private.invoice_items_require_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
begin
  select i.status into v_status
  from public.invoices i
  where i.id = coalesce(new.invoice_id, old.invoice_id);

  -- Parent already gone: this is an ON DELETE CASCADE, allow it.
  if not found then
    return coalesce(new, old);
  end if;
  if v_status <> 'draft' then
    raise exception 'Line items can only be changed on draft documents' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger invoice_items_require_draft
  before insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_require_draft();

-- Keep the parent's subtotal in sync with its items.
create function private.invoice_items_sync_subtotal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices i
  set subtotal_cents = coalesce((
        select sum(it.line_total_cents)
        from public.invoice_items it
        where it.invoice_id = i.id), 0)
  where i.id in (new.invoice_id, old.invoice_id);
  return null;
end;
$$;

create trigger invoice_items_sync_subtotal
  after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_sync_subtotal();

-- ---------------------------------------------------------------------------
-- issue_invoice: assign the next gapless number and freeze the document.
-- ---------------------------------------------------------------------------
create function public.issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv   public.invoices;
  v_tz    text;
  v_today date;
  v_year  integer;
  v_seq   integer;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found or not private.is_member(v_inv.business_id) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'Only draft documents can be issued' using errcode = '55000';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice_id) then
    raise exception 'Add at least one line item before issuing' using errcode = '22023';
  end if;

  select b.timezone into v_tz from public.businesses b where b.id = v_inv.business_id;
  v_today := (now() at time zone v_tz)::date;
  v_year  := extract(year from v_today)::integer;

  insert into private.invoice_counters (business_id, kind, year)
  values (v_inv.business_id, v_inv.kind, v_year)
  on conflict do nothing;

  -- Row lock: concurrent issuers for the same business/kind/year wait here.
  update private.invoice_counters
  set last_value = last_value + 1
  where business_id = v_inv.business_id and kind = v_inv.kind and year = v_year
  returning last_value into v_seq;

  update public.invoices
  set status      = 'issued',
      number_year = v_year,
      number_seq  = v_seq,
      number      = format('%s-%s-%s',
                           case v_inv.kind when 'invoice' then 'INV' else 'QUO' end,
                           v_year,
                           lpad(v_seq::text, greatest(4, length(v_seq::text)), '0')),
      issue_date  = coalesce(issue_date, v_today),
      due_date    = coalesce(due_date, coalesce(issue_date, v_today) + 14),
      issued_at   = now()
  where id = p_invoice_id
  returning * into v_inv;

  return v_inv;
end;
$$;

revoke execute on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- Owners can void documents (numbers are never reused).
create function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found or not private.is_owner(v_inv.business_id) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if v_inv.amount_paid_cents > 0 then
    raise exception 'Documents with payments cannot be voided' using errcode = '55000';
  end if;
  update public.invoices set status = 'void' where id = p_invoice_id returning * into v_inv;
  return v_inv;
end;
$$;

revoke execute on function public.void_invoice(uuid) from public, anon;
grant execute on function public.void_invoice(uuid) to authenticated;

-- Shared link (WhatsApp-friendly): anyone holding the token can view the
-- document, never anything else.
create function public.get_shared_invoice(p_share_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', i.id, 'kind', i.kind, 'number', i.number, 'status', i.status,
      'issue_date', i.issue_date, 'due_date', i.due_date, 'currency', i.currency,
      'vat_rate_bp', i.vat_rate_bp, 'subtotal_cents', i.subtotal_cents,
      'vat_cents', i.vat_cents, 'total_cents', i.total_cents,
      'deposit_cents', i.deposit_cents, 'amount_paid_cents', i.amount_paid_cents,
      'balance_cents', i.balance_cents, 'notes', i.notes),
    'business', jsonb_build_object(
      'name', b.name, 'slug', b.slug, 'phone', b.phone, 'email', b.email,
      'address', b.address, 'kra_pin', b.kra_pin, 'invoice_footer', b.invoice_footer),
    'customer', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'description', it.description, 'quantity', it.quantity,
               'unit_price_cents', it.unit_price_cents, 'line_total_cents', it.line_total_cents)
             order by it.sort_order, it.created_at)
      from public.invoice_items it where it.invoice_id = i.id), '[]'::jsonb)
  )
  from public.invoices i
  join public.businesses b on b.id = i.business_id
  join public.customers c on c.id = i.customer_id
  where i.share_token = p_share_token
    and i.status <> 'draft';
$$;

grant execute on function public.get_shared_invoice(uuid) to anon, authenticated;
