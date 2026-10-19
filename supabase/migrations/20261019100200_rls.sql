-- =============================================================================
-- 0003 Row-level security.
--
-- Model:
--   * A user can see data of businesses where they are a member
--     (business_members). Owners can additionally manage settings, staff,
--     services and schedules, and delete things.
--   * anon (logged-out visitors) gets NO direct table access. The public
--     booking page uses narrow SECURITY DEFINER functions instead
--     (get_public_booking_page, available_slots, book_public, get_shared_invoice).
--   * Helpers are SECURITY DEFINER so they can read business_members without
--     triggering RLS on business_members itself (which would recurse).
--
-- Performance pattern: policies use `business_id in (select private.member_business_ids())`.
-- The sub-select is uncorrelated, so Postgres evaluates it ONCE per statement
-- (a hashed SubPlan / InitPlan) instead of once per row. See docs/sql-notes.md.
-- =============================================================================

create function private.member_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.business_members m
  where m.user_id = (select auth.uid());
$$;

create function private.owned_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.business_members m
  where m.user_id = (select auth.uid())
    and m.role = 'owner';
$$;

create function private.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = (select auth.uid())
  );
$$;

create function private.is_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

revoke all on function private.member_business_ids() from public;
revoke all on function private.owned_business_ids() from public;
revoke all on function private.is_member(uuid) from public;
revoke all on function private.is_owner(uuid) from public;
grant execute on function private.member_business_ids() to authenticated, service_role;
grant execute on function private.owned_business_ids() to authenticated, service_role;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.is_owner(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges. Supabase grants ALL on public tables to anon and
-- authenticated by default; RLS then filters rows. We tighten this further:
-- anon gets nothing, and some columns are not writable by clients at all.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from public, anon, authenticated;
grant select on public.business_type_presets to anon, authenticated;
revoke insert, update, delete on public.business_type_presets from authenticated;

-- Businesses are created through public.create_business(), never directly.
revoke insert on public.businesses from authenticated;
revoke update on public.businesses from authenticated;
grant update (name, timezone, phone, email, address, kra_pin, vat_registered,
              vat_rate_bp, invoice_footer)
  on public.businesses to authenticated;

-- Invoice numbers, statuses and totals are maintained by the database.
revoke insert, update on public.invoices from authenticated;
grant insert (business_id, kind, customer_id, booking_id, issue_date, due_date,
              currency, vat_rate_bp, deposit_cents, notes)
  on public.invoices to authenticated;
grant update (customer_id, booking_id, issue_date, due_date, currency,
              vat_rate_bp, deposit_cents, notes)
  on public.invoices to authenticated;

-- Payments: clients may record manual (non M-Pesa) payments; nothing else.
revoke update, delete on public.payments from authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (also on the presets table, with a read-all policy).
-- ---------------------------------------------------------------------------
alter table public.business_type_presets enable row level security;
alter table public.businesses            enable row level security;
alter table public.business_members      enable row level security;
alter table public.staff                 enable row level security;
alter table public.invitations           enable row level security;
alter table public.services              enable row level security;
alter table public.staff_services        enable row level security;
alter table public.working_hours         enable row level security;
alter table public.staff_breaks          enable row level security;
alter table public.time_off              enable row level security;
alter table public.customers             enable row level security;
alter table public.booking_series        enable row level security;
alter table public.bookings              enable row level security;
alter table public.invoices              enable row level security;
alter table public.invoice_items         enable row level security;
alter table public.payments              enable row level security;

-- Presets: public reference data.
create policy "presets are readable by everyone"
  on public.business_type_presets for select
  to anon, authenticated
  using (true);

-- Businesses
create policy "members read their businesses"
  on public.businesses for select to authenticated
  using (id in (select private.member_business_ids()));
create policy "owners update their businesses"
  on public.businesses for update to authenticated
  using (id in (select private.owned_business_ids()))
  with check (id in (select private.owned_business_ids()));
create policy "owners delete their businesses"
  on public.businesses for delete to authenticated
  using (id in (select private.owned_business_ids()));

-- Members
create policy "members read the team"
  on public.business_members for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners add members"
  on public.business_members for insert to authenticated
  with check (business_id in (select private.owned_business_ids()));
create policy "owners change roles"
  on public.business_members for update to authenticated
  using (business_id in (select private.owned_business_ids()))
  with check (business_id in (select private.owned_business_ids()));
create policy "owners remove members, members can leave"
  on public.business_members for delete to authenticated
  using (
    business_id in (select private.owned_business_ids())
    or user_id = (select auth.uid())
  );

-- Owner-managed configuration tables share the same shape:
-- members read, owners write.
create policy "members read staff" on public.staff for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners insert staff" on public.staff for insert to authenticated
  with check (business_id in (select private.owned_business_ids()));
create policy "owners update staff" on public.staff for update to authenticated
  using (business_id in (select private.owned_business_ids()))
  with check (business_id in (select private.owned_business_ids()));
create policy "owners delete staff" on public.staff for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

create policy "owners manage invitations" on public.invitations for all to authenticated
  using (business_id in (select private.owned_business_ids()))
  with check (business_id in (select private.owned_business_ids()));

create policy "members read services" on public.services for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners insert services" on public.services for insert to authenticated
  with check (business_id in (select private.owned_business_ids()));
create policy "owners update services" on public.services for update to authenticated
  using (business_id in (select private.owned_business_ids()))
  with check (business_id in (select private.owned_business_ids()));
create policy "owners delete services" on public.services for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

create policy "members read staff_services" on public.staff_services for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners insert staff_services" on public.staff_services for insert to authenticated
  with check (business_id in (select private.owned_business_ids()));
create policy "owners delete staff_services" on public.staff_services for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

create policy "members read working_hours" on public.working_hours for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners insert working_hours" on public.working_hours for insert to authenticated
  with check (business_id in (select private.owned_business_ids()));
create policy "owners update working_hours" on public.working_hours for update to authenticated
  using (business_id in (select private.owned_business_ids()))
  with check (business_id in (select private.owned_business_ids()));
create policy "owners delete working_hours" on public.working_hours for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

create policy "members read staff_breaks" on public.staff_breaks for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners insert staff_breaks" on public.staff_breaks for insert to authenticated
  with check (business_id in (select private.owned_business_ids()));
create policy "owners update staff_breaks" on public.staff_breaks for update to authenticated
  using (business_id in (select private.owned_business_ids()))
  with check (business_id in (select private.owned_business_ids()));
create policy "owners delete staff_breaks" on public.staff_breaks for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

-- Time off: owners manage everyone's; staff manage their own.
create policy "members read time_off" on public.time_off for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "owners or self insert time_off" on public.time_off for insert to authenticated
  with check (
    business_id in (select private.owned_business_ids())
    or (
      business_id in (select private.member_business_ids())
      and staff_id in (select s.id from public.staff s where s.user_id = (select auth.uid()))
    )
  );
create policy "owners or self update time_off" on public.time_off for update to authenticated
  using (
    business_id in (select private.owned_business_ids())
    or staff_id in (select s.id from public.staff s where s.user_id = (select auth.uid()))
  )
  with check (
    business_id in (select private.owned_business_ids())
    or (
      business_id in (select private.member_business_ids())
      and staff_id in (select s.id from public.staff s where s.user_id = (select auth.uid()))
    )
  );
create policy "owners or self delete time_off" on public.time_off for delete to authenticated
  using (
    business_id in (select private.owned_business_ids())
    or staff_id in (select s.id from public.staff s where s.user_id = (select auth.uid()))
  );

-- Day-to-day operational tables: every member (owner or staff) reads and
-- writes; only owners delete.
create policy "members read customers" on public.customers for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "members insert customers" on public.customers for insert to authenticated
  with check (business_id in (select private.member_business_ids()));
create policy "members update customers" on public.customers for update to authenticated
  using (business_id in (select private.member_business_ids()))
  with check (business_id in (select private.member_business_ids()));
create policy "owners delete customers" on public.customers for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

create policy "members read booking_series" on public.booking_series for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "members insert booking_series" on public.booking_series for insert to authenticated
  with check (business_id in (select private.member_business_ids()));

create policy "members read bookings" on public.bookings for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "members insert bookings" on public.bookings for insert to authenticated
  with check (business_id in (select private.member_business_ids()));
create policy "members update bookings" on public.bookings for update to authenticated
  using (business_id in (select private.member_business_ids()))
  with check (business_id in (select private.member_business_ids()));
create policy "owners delete bookings" on public.bookings for delete to authenticated
  using (business_id in (select private.owned_business_ids()));

create policy "members read invoices" on public.invoices for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "members insert invoices" on public.invoices for insert to authenticated
  with check (business_id in (select private.member_business_ids()));
create policy "members update invoices" on public.invoices for update to authenticated
  using (business_id in (select private.member_business_ids()))
  with check (business_id in (select private.member_business_ids()));
create policy "owners delete draft invoices" on public.invoices for delete to authenticated
  using (business_id in (select private.owned_business_ids()) and status = 'draft');

create policy "members read invoice_items" on public.invoice_items for select to authenticated
  using (business_id in (select private.member_business_ids()));
create policy "members insert invoice_items" on public.invoice_items for insert to authenticated
  with check (business_id in (select private.member_business_ids()));
create policy "members update invoice_items" on public.invoice_items for update to authenticated
  using (business_id in (select private.member_business_ids()))
  with check (business_id in (select private.member_business_ids()));
create policy "members delete invoice_items" on public.invoice_items for delete to authenticated
  using (business_id in (select private.member_business_ids()));

create policy "members read payments" on public.payments for select to authenticated
  using (business_id in (select private.member_business_ids()));
-- M-Pesa payments are created by the server (service role) only.
create policy "members record manual payments" on public.payments for insert to authenticated
  with check (
    business_id in (select private.member_business_ids())
    and method <> 'mpesa'
  );
