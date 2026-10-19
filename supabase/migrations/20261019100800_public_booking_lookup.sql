-- =============================================================================
-- 0009 Public booking confirmation lookup.
--
-- Concepts:
--   * Capability URLs: a booking's random uuid acts as an unguessable secret
--     (122 random bits). Whoever holds the link can see that one booking's
--     confirmation, much like a share link. Anonymous visitors still cannot
--     SELECT from public.bookings; RLS forbids it.
--   * SECURITY DEFINER plus a narrow return shape: the function runs as its
--     owner (bypassing RLS) but returns only display fields. It never returns
--     the customer's phone or email, or any notes.
-- =============================================================================

create function public.get_public_booking(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id',    bk.id,
    'reference',     upper(left(replace(bk.id::text, '-', ''), 8)),
    'status',        bk.status,
    'starts_at',     lower(bk.during),
    'ends_at',       upper(bk.during),
    'price_cents',   bk.price_cents,
    'deposit_cents', bk.deposit_cents,
    -- First name only: enough to greet the guest, little to leak.
    'customer_first_name', split_part(trim(c.name), ' ', 1),
    'service_name',  s.name,
    'staff_name',    st.display_name,
    'business', jsonb_build_object(
      'slug', b.slug, 'name', b.name, 'timezone', b.timezone,
      'phone', b.phone, 'address', b.address)
  )
  from public.bookings bk
  join public.businesses b on b.id = bk.business_id
  join public.services s   on s.id = bk.service_id
  join public.staff st     on st.id = bk.staff_id
  join public.customers c  on c.id = bk.customer_id
  where bk.id = p_booking_id;
$$;

comment on function public.get_public_booking(uuid) is
  'Confirmation details for one booking, looked up by its unguessable id. Display fields only.';

grant execute on function public.get_public_booking(uuid) to anon, authenticated;
