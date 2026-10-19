-- =============================================================================
-- 0005 Booking functions.
--
-- Concepts:
--   * available_slots: generate_series over each shift, MINUS busy time,
--     using multirange arithmetic (PG14+):
--         free = range_agg(shifts) - range_agg(bookings + buffers, breaks, time off)
--     A candidate slot is offered when tstzrange(start, end) <@ free.
--   * Time zones: weekly hours are wall-clock `time` in the business's zone.
--     `(date + time) AT TIME ZONE 'Africa/Nairobi'` turns local wall-clock
--     time into an absolute timestamptz. Never convert dates through the
--     session time zone.
--   * Recurring bookings with WITH RECURSIVE, inserted atomically. One
--     clash rolls back the whole series.
--   * SECURITY DEFINER read/write entry points for anonymous visitors that
--     expose only what the public page needs.
-- =============================================================================

create function public.available_slots(
  p_business_id  uuid,
  p_service_id   uuid,
  p_day          date,
  p_staff_id     uuid default null,
  p_step_minutes integer default 15
)
returns table (staff_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with biz as (
    select b.timezone as tz
    from public.businesses b
    where b.id = p_business_id
  ),
  svc as (
    select make_interval(mins => s.duration_minutes) as dur
    from public.services s
    where s.id = p_service_id and s.business_id = p_business_id and s.active
  ),
  -- Wide window around the local day, to catch buffers spilling across midnight.
  win as (
    select tstzrange((p_day - 1)::timestamp at time zone biz.tz,
                     (p_day + 2)::timestamp at time zone biz.tz) as r
    from biz
  ),
  eligible as (
    select st.id
    from public.staff st
    join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
    where st.business_id = p_business_id
      and st.active
      and (p_staff_id is null or st.id = p_staff_id)
  ),
  shifts as (
    select wh.staff_id,
           tstzrange((p_day + wh.start_time) at time zone biz.tz,
                     (p_day + wh.end_time)   at time zone biz.tz, '[)') as shift
    from public.working_hours wh
    join eligible e on e.id = wh.staff_id
    cross join biz
    where wh.weekday = extract(dow from p_day)
  ),
  busy as (
    -- Active bookings, extended by the booked service's cleanup buffer.
    select bk.staff_id,
           tstzrange(lower(bk.during),
                     upper(bk.during) + make_interval(mins => s.buffer_minutes), '[)') as r
    from public.bookings bk
    join public.services s on s.id = bk.service_id
    join eligible e on e.id = bk.staff_id
    cross join win
    where bk.status in ('pending', 'confirmed', 'completed')
      and bk.during && win.r
    union all
    select t.staff_id, t.during
    from public.time_off t
    join eligible e on e.id = t.staff_id
    cross join win
    where t.during && win.r
    union all
    select br.staff_id,
           tstzrange((p_day + br.start_time) at time zone biz.tz,
                     (p_day + br.end_time)   at time zone biz.tz, '[)')
    from public.staff_breaks br
    join eligible e on e.id = br.staff_id
    cross join biz
    where br.weekday = extract(dow from p_day)
  ),
  free as (
    select sh.staff_id,
           range_agg(sh.shift)
             - coalesce((select range_agg(b.r) from busy b where b.staff_id = sh.staff_id),
                        '{}'::tstzmultirange) as free
    from shifts sh
    group by sh.staff_id
  )
  select sh.staff_id, gs as starts_at, gs + svc.dur as ends_at
  from shifts sh
  cross join svc
  cross join lateral generate_series(lower(sh.shift),
                                     upper(sh.shift) - svc.dur,
                                     make_interval(mins => greatest(p_step_minutes, 5))) as gs
  join free f on f.staff_id = sh.staff_id
  where tstzrange(gs, gs + svc.dur, '[)') <@ f.free
    and gs >= now()
  order by starts_at, sh.staff_id;
$$;

comment on function public.available_slots(uuid, uuid, date, uuid, integer) is
  'Bookable slots for a service on a local date. Slots lie on a p_step_minutes grid from each shift start.';

grant execute on function public.available_slots(uuid, uuid, date, uuid, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public booking page data, in one round trip, built with jsonb_agg.
-- ---------------------------------------------------------------------------
create function public.get_public_booking_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'business_type', b.business_type,
      'timezone', b.timezone, 'currency', b.currency, 'phone', b.phone, 'address', b.address
    ),
    'labels', (
      select jsonb_build_object(
        'staff', p.staff_label, 'customer', p.customer_label, 'booking', p.booking_label)
      from public.business_type_presets p
      where p.business_type = b.business_type
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'description', s.description,
               'duration_minutes', s.duration_minutes, 'price_cents', s.price_cents,
               'deposit_cents', s.deposit_cents,
               'staff_ids', coalesce((
                 select jsonb_agg(ss.staff_id order by ss.staff_id)
                 from public.staff_services ss
                 join public.staff st on st.id = ss.staff_id and st.active
                 where ss.service_id = s.id), '[]'::jsonb))
             order by s.sort_order, s.name)
      from public.services s
      where s.business_id = b.id and s.active), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'display_name', st.display_name, 'color', st.color)
             order by st.display_name)
      from public.staff st
      where st.business_id = b.id and st.active), '[]'::jsonb)
  )
  from public.businesses b
  where b.slug = lower(p_slug);
$$;

grant execute on function public.get_public_booking_page(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guest booking from the public page.
-- ---------------------------------------------------------------------------
create function public.book_public(
  p_slug           text,
  p_service_id     uuid,
  p_starts_at      timestamptz,
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text default null,
  p_staff_id       uuid default null,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business    public.businesses;
  v_service     public.services;
  v_staff_id    uuid;
  v_customer_id uuid;
  v_booking     public.bookings;
begin
  select * into v_business from public.businesses where slug = lower(p_slug);
  if not found then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and business_id = v_business.id and active;
  if not found then
    raise exception 'Service not found' using errcode = 'P0002';
  end if;

  if char_length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  -- Re-check availability on the server. Never trust the slot the client sent.
  select s.staff_id into v_staff_id
  from public.available_slots(
         v_business.id, p_service_id,
         (p_starts_at at time zone v_business.timezone)::date,
         p_staff_id) as s
  where s.starts_at = p_starts_at
  order by s.staff_id
  limit 1;

  if v_staff_id is null then
    raise exception 'That time is no longer available' using errcode = '23P01';
  end if;

  insert into public.customers (business_id, name, phone, email)
  values (v_business.id, trim(p_customer_name), public.normalize_phone(p_customer_phone),
          nullif(trim(p_customer_email), ''))
  on conflict (business_id, phone)
    -- Do not let an anonymous visitor rename an existing customer.
    do update set email = coalesce(public.customers.email, excluded.email)
  returning id into v_customer_id;

  -- If two visitors race for the same slot, the exclusion constraint rejects
  -- the second insert with SQLSTATE 23P01.
  insert into public.bookings
    (business_id, staff_id, service_id, customer_id, during, status, source,
     price_cents, deposit_cents, notes)
  values
    (v_business.id, v_staff_id, v_service.id, v_customer_id,
     tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes), '[)'),
     case when v_service.deposit_cents > 0 then 'pending' else 'confirmed' end::public.booking_status,
     'public', v_service.price_cents, v_service.deposit_cents, nullif(trim(p_notes), ''))
  returning * into v_booking;

  return jsonb_build_object(
    'booking_id',    v_booking.id,
    'reference',     upper(left(replace(v_booking.id::text, '-', ''), 8)),
    'status',        v_booking.status,
    'staff_id',      v_booking.staff_id,
    'starts_at',     lower(v_booking.during),
    'ends_at',       upper(v_booking.during),
    'price_cents',   v_booking.price_cents,
    'deposit_cents', v_booking.deposit_cents
  );
end;
$$;

grant execute on function public.book_public(text, uuid, timestamptz, text, text, text, uuid, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recurring bookings via a recursive CTE (runs with the caller's RLS).
-- The recursion steps in LOCAL time, so "every Tuesday 10:00" stays at 10:00
-- wall-clock even in zones with daylight saving (Nairobi has none, but the
-- code is correct anywhere).
-- ---------------------------------------------------------------------------
create function public.create_recurring_bookings(
  p_staff_id    uuid,
  p_service_id  uuid,
  p_customer_id uuid,
  p_first_start timestamptz,
  p_every       interval,
  p_occurrences integer,
  p_notes       text default null
)
returns setof public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_service   public.services;
  v_tz        text;
  v_series_id uuid;
begin
  if p_occurrences not between 2 and 52 then
    raise exception 'Occurrences must be between 2 and 52' using errcode = '22023';
  end if;

  select * into v_service from public.services where id = p_service_id;
  if not found then
    raise exception 'Service not found' using errcode = 'P0002';
  end if;
  select b.timezone into v_tz from public.businesses b where b.id = v_service.business_id;

  insert into public.booking_series (business_id, repeat_every, occurrences)
  values (v_service.business_id, p_every, p_occurrences)
  returning id into v_series_id;

  with recursive occurrence (n, local_start) as (
    select 1, p_first_start at time zone v_tz
    union all
    select o.n + 1, o.local_start + p_every
    from occurrence o
    where o.n < p_occurrences
  )
  insert into public.bookings
    (business_id, staff_id, service_id, customer_id, series_id, during, status, source,
     price_cents, deposit_cents, notes)
  select v_service.business_id, p_staff_id, p_service_id, p_customer_id, v_series_id,
         tstzrange(o.local_start at time zone v_tz,
                   (o.local_start + make_interval(mins => v_service.duration_minutes)) at time zone v_tz,
                   '[)'),
         'confirmed', 'dashboard', v_service.price_cents, 0, p_notes
  from occurrence o;

  return query
    select * from public.bookings b
    where b.series_id = v_series_id
    order by lower(b.during);
end;
$$;

revoke execute on function public.create_recurring_bookings(uuid, uuid, uuid, timestamptz, interval, integer, text) from public, anon;
grant execute on function public.create_recurring_bookings(uuid, uuid, uuid, timestamptz, interval, integer, text) to authenticated;

-- Stamp cancelled_at when a booking is cancelled.
create function private.stamp_booking_cancellation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
  elsif new.status <> 'cancelled' then
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

create trigger stamp_booking_cancellation before update of status on public.bookings
  for each row execute function private.stamp_booking_cancellation();
