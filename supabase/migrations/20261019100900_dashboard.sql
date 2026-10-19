-- =============================================================================
-- 0010 Dashboard: calendar reads, staff-side booking, rescheduling, a status
-- state machine and customer history.
--
-- Concepts:
--   * Views with (security_invoker = true) (Postgres 15+). A plain view runs
--     as its OWNER and would bypass RLS; security_invoker makes it run with
--     the caller's rights, so the policies on the underlying tables apply.
--   * Range overlap (&&) pushed through a view into the GiST index on
--     bookings (business_id, during). See docs/sql-notes.md for EXPLAIN.
--   * A trigger-enforced state machine for booking status.
--   * Aggregate FILTER clauses for per-customer stats in one pass.
--   * pg_trgm: a GIN trigram index makes ILIKE '%term%' searches indexable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- booking_details: one row per booking with the names the UI needs.
-- ---------------------------------------------------------------------------
create view public.booking_details
with (security_invoker = true) as
select bk.id,
       bk.business_id,
       bk.staff_id,
       bk.service_id,
       bk.customer_id,
       bk.series_id,
       bk.during,
       lower(bk.during) as starts_at,
       upper(bk.during) as ends_at,
       bk.status,
       bk.source,
       bk.price_cents,
       bk.deposit_cents,
       bk.notes,
       bk.created_at,
       c.name           as customer_name,
       c.phone          as customer_phone,
       s.name           as service_name,
       st.display_name  as staff_name,
       st.color         as staff_color
from public.bookings bk
join public.customers c on c.id = bk.customer_id
join public.services  s on s.id = bk.service_id
join public.staff    st on st.id = bk.staff_id;

revoke all on public.booking_details from anon;
grant select on public.booking_details to authenticated;

-- ---------------------------------------------------------------------------
-- Calendar window: every booking overlapping [p_from, p_to).
-- `d.during && tstzrange(...)` is inlined into the view's query, so the
-- planner can use the GiST index bookings_business_during_idx.
-- ---------------------------------------------------------------------------
create function public.calendar_bookings(
  p_business_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
)
returns setof public.booking_details
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_to <= p_from or p_to - p_from > interval '42 days' then
    raise exception 'The calendar window must be between 0 and 42 days' using errcode = '22023';
  end if;

  return query
    select d.*
    from public.booking_details d
    where d.business_id = p_business_id
      and d.during && tstzrange(p_from, p_to, '[)')
    order by d.starts_at, d.staff_name;
end;
$$;

revoke execute on function public.calendar_bookings(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_bookings(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- A staff member must offer the service and be active.
-- ---------------------------------------------------------------------------
create function private.assert_staff_offers(p_staff_id uuid, p_service_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_services ss
    join public.staff st on st.id = ss.staff_id
    where ss.staff_id = p_staff_id and ss.service_id = p_service_id and st.active
  ) then
    raise exception 'That team member does not offer this service' using errcode = '22023';
  end if;
end;
$$;

grant execute on function private.assert_staff_offers(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff-side booking (walk-ins, phone bookings). SECURITY INVOKER: the
-- "members insert bookings" policy decides who may call it. Working hours
-- are deliberately NOT enforced here (staff may squeeze someone in), but the
-- exclusion constraint still prevents double booking.
-- ---------------------------------------------------------------------------
create function public.create_booking(
  p_service_id  uuid,
  p_staff_id    uuid,
  p_customer_id uuid,
  p_starts_at   timestamptz,
  p_notes       text default null
)
returns public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_service public.services;
  v_booking public.bookings;
begin
  select * into v_service from public.services where id = p_service_id;
  if not found then
    raise exception 'Service not found' using errcode = 'P0002';
  end if;
  perform private.assert_staff_offers(p_staff_id, p_service_id);

  insert into public.bookings
    (business_id, staff_id, service_id, customer_id, during, status, source,
     price_cents, deposit_cents, notes)
  values
    (v_service.business_id, p_staff_id, p_service_id, p_customer_id,
     tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes), '[)'),
     'confirmed', 'dashboard', v_service.price_cents, 0, nullif(trim(p_notes), ''))
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reschedule: move a booking to a new start (and optionally another staff
-- member), keeping its booked length. SELECT ... FOR UPDATE locks the row so
-- two people rescheduling at once are serialised; the exclusion constraint
-- rejects a clash with SQLSTATE 23P01.
-- ---------------------------------------------------------------------------
create function public.reschedule_booking(
  p_booking_id uuid,
  p_starts_at  timestamptz,
  p_staff_id   uuid default null
)
returns public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_staff   uuid;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    -- Also what a non-member sees: RLS hides the row entirely.
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;

  v_staff := coalesce(p_staff_id, v_booking.staff_id);
  if v_staff <> v_booking.staff_id then
    perform private.assert_staff_offers(v_staff, v_booking.service_id);
  end if;

  update public.bookings
  set staff_id = v_staff,
      during   = tstzrange(p_starts_at, p_starts_at + (upper(during) - lower(during)), '[)')
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function public.reschedule_booking(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.reschedule_booking(uuid, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Booking status state machine.
--
--   pending ──► confirmed ──► completed
--      │            │  ▲          │
--      ├──► no_show ◄┘  └─ undo ───┘ (completed/no_show can go back to confirmed)
--      └──► cancelled ◄┘            (cancelled is final: book again instead)
--
-- Only pending/confirmed bookings may be moved (time or staff).
-- ---------------------------------------------------------------------------
create function private.guard_booking_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[];
begin
  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'pending'   then array['confirmed', 'cancelled', 'no_show']
      when 'confirmed' then array['completed', 'cancelled', 'no_show']
      when 'completed' then array['confirmed']
      when 'no_show'   then array['confirmed']
      else array[]::text[]
    end;
    if not (new.status::text = any (v_allowed)) then
      raise exception 'A % booking cannot become %', old.status, new.status
        using errcode = '23514';
    end if;
  end if;

  if (new.during is distinct from old.during or new.staff_id is distinct from old.staff_id)
     and old.status not in ('pending', 'confirmed') then
    raise exception 'Only upcoming bookings can be moved' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Fires before stamp_booking_cancellation (triggers run in name order).
create trigger guard_booking_change before update of status, during, staff_id on public.bookings
  for each row execute function private.guard_booking_change();

-- ---------------------------------------------------------------------------
-- Customer history: one pass over a customer's bookings with FILTER.
-- ---------------------------------------------------------------------------
create view public.customer_stats
with (security_invoker = true) as
select c.id          as customer_id,
       c.business_id,
       c.name,
       c.phone,
       c.email,
       c.created_at,
       count(bk.id) filter (where bk.status = 'completed')                    as visits,
       count(bk.id) filter (where bk.status = 'no_show')                      as no_shows,
       count(bk.id) filter (where bk.status = 'cancelled')                    as cancellations,
       count(bk.id) filter (where bk.status in ('pending', 'confirmed')
                              and lower(bk.during) > now())                   as upcoming,
       coalesce(sum(bk.price_cents) filter (where bk.status = 'completed'), 0)::bigint
                                                                              as completed_value_cents,
       max(lower(bk.during)) filter (where bk.status = 'completed')           as last_visit_at,
       min(lower(bk.during)) filter (where bk.status in ('pending', 'confirmed')
                                       and lower(bk.during) > now())          as next_visit_at
from public.customers c
left join public.bookings bk on bk.customer_id = c.id
group by c.id;   -- c.* is functionally dependent on the primary key

revoke all on public.customer_stats from anon;
grant select on public.customer_stats to authenticated;

-- ---------------------------------------------------------------------------
-- Customer search: ILIKE '%wanj%' cannot use a btree index (the pattern
-- doesn't start with a constant). A trigram GIN index can.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create index customers_name_trgm_idx on public.customers
  using gin (name extensions.gin_trgm_ops);
