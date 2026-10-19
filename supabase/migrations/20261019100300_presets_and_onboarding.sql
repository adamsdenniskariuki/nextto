-- =============================================================================
-- 0004 Business-type presets and onboarding functions.
--
-- Concepts:
--   * Reference data seeded by a migration (needed in production, unlike seed.sql).
--   * jsonb_array_elements(...) WITH ORDINALITY turns a JSON array into rows,
--     keeping the array position for sort_order.
--   * SECURITY DEFINER functions perform multi-table writes that clients are
--     not allowed to do directly, after checking auth.uid() themselves.
-- =============================================================================

insert into public.business_type_presets
  (business_type, label, staff_label, customer_label, booking_label,
   default_open, default_close, working_days, services)
values
  ('salon', 'Salon / Barber', 'Stylist', 'Client', 'Appointment', '08:00', '19:00', '{1,2,3,4,5,6}',
   '[{"name":"Haircut","duration_minutes":30,"price_cents":50000},
     {"name":"Beard trim","duration_minutes":15,"price_cents":30000},
     {"name":"Box braids","duration_minutes":240,"price_cents":450000,"deposit_cents":100000},
     {"name":"Wash and blow-dry","duration_minutes":60,"price_cents":120000},
     {"name":"Manicure","duration_minutes":45,"price_cents":80000}]'),
  ('tutor', 'Tutor', 'Tutor', 'Student', 'Lesson', '15:00', '20:00', '{1,2,3,4,5,6}',
   '[{"name":"One-to-one lesson (1 hour)","duration_minutes":60,"price_cents":150000},
     {"name":"KCSE revision session (2 hours)","duration_minutes":120,"price_cents":250000},
     {"name":"Group lesson","duration_minutes":90,"price_cents":80000}]'),
  ('cleaner', 'Cleaning service', 'Cleaner', 'Client', 'Job', '08:00', '17:00', '{1,2,3,4,5,6}',
   '[{"name":"Standard home clean","duration_minutes":180,"price_cents":250000},
     {"name":"Deep clean","duration_minutes":360,"price_cents":600000,"deposit_cents":150000},
     {"name":"Sofa and carpet cleaning","duration_minutes":120,"price_cents":350000}]'),
  ('mechanic', 'Mechanic / Garage', 'Mechanic', 'Customer', 'Service slot', '08:00', '18:00', '{1,2,3,4,5,6}',
   '[{"name":"Diagnostics","duration_minutes":60,"price_cents":200000},
     {"name":"Oil and filter change","duration_minutes":45,"price_cents":350000},
     {"name":"Brake pads replacement","duration_minutes":120,"price_cents":500000,"deposit_cents":200000},
     {"name":"Wheel alignment","duration_minutes":60,"price_cents":250000}]'),
  ('clinic', 'Clinic', 'Practitioner', 'Patient', 'Appointment', '08:00', '17:00', '{1,2,3,4,5}',
   '[{"name":"General consultation","duration_minutes":20,"price_cents":150000},
     {"name":"Follow-up visit","duration_minutes":15,"price_cents":100000},
     {"name":"Physiotherapy session","duration_minutes":45,"price_cents":300000}]'),
  ('photographer', 'Photographer', 'Photographer', 'Client', 'Session', '09:00', '18:00', '{2,3,4,5,6,0}',
   '[{"name":"Portrait session","duration_minutes":60,"price_cents":800000,"deposit_cents":300000},
     {"name":"Family shoot","duration_minutes":120,"price_cents":1500000,"deposit_cents":500000},
     {"name":"Passport photos","duration_minutes":15,"price_cents":50000}]'),
  ('general', 'General service business', 'Staff member', 'Customer', 'Booking', '09:00', '17:00', '{1,2,3,4,5}',
   '[{"name":"Consultation","duration_minutes":30,"price_cents":100000},
     {"name":"Standard service","duration_minutes":60,"price_cents":200000}]');

-- ---------------------------------------------------------------------------
-- create_business: onboarding. Creates the tenant, makes the caller its
-- owner and first staff member, and applies the preset's services and hours.
-- ---------------------------------------------------------------------------
create function public.create_business(
  p_name          text,
  p_slug          text,
  p_business_type public.business_type default 'general',
  p_phone         text default null,
  p_display_name  text default null
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_business public.businesses;
  v_staff_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a business' using errcode = '42501';
  end if;

  insert into public.businesses (name, slug, business_type, phone, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_business_type, nullif(trim(p_phone), ''), v_uid)
  returning * into v_business;

  insert into public.business_members (business_id, user_id, role)
  values (v_business.id, v_uid, 'owner');

  insert into public.staff (business_id, user_id, display_name)
  values (
    v_business.id,
    v_uid,
    coalesce(nullif(trim(p_display_name), ''), split_part(coalesce(auth.jwt() ->> 'email', 'Owner'), '@', 1))
  )
  returning id into v_staff_id;

  insert into public.services
    (business_id, name, description, duration_minutes, price_cents, deposit_cents, sort_order)
  select v_business.id,
         s ->> 'name',
         s ->> 'description',
         (s ->> 'duration_minutes')::integer,
         (s ->> 'price_cents')::bigint,
         coalesce((s ->> 'deposit_cents')::bigint, 0),
         e.ord::integer
  from public.business_type_presets p
  cross join lateral jsonb_array_elements(p.services) with ordinality as e(s, ord)
  where p.business_type = p_business_type;

  insert into public.staff_services (business_id, staff_id, service_id)
  select v_business.id, v_staff_id, s.id
  from public.services s
  where s.business_id = v_business.id;

  insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
  select v_business.id, v_staff_id, d, p.default_open, p.default_close
  from public.business_type_presets p
  cross join lateral unnest(p.working_days) as d
  where p.business_type = p_business_type;

  return v_business;
end;
$$;

revoke execute on function public.create_business(text, text, public.business_type, text, text) from public, anon;
grant execute on function public.create_business(text, text, public.business_type, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_invitation: the invited user (matched by email) joins the business.
-- ---------------------------------------------------------------------------
create function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv   public.invitations;
begin
  if v_uid is null then
    raise exception 'You must be signed in to accept an invitation' using errcode = '42501';
  end if;

  select * into v_inv
  from public.invitations
  where token = p_token and accepted_at is null and expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation not found or expired' using errcode = 'P0002';
  end if;
  if lower(v_inv.email) <> v_email then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.business_members (business_id, user_id, role)
  values (v_inv.business_id, v_uid, v_inv.role)
  on conflict (business_id, user_id) do nothing;

  if v_inv.staff_id is not null then
    update public.staff set user_id = v_uid
    where id = v_inv.staff_id and user_id is null;
  else
    insert into public.staff (business_id, user_id, display_name)
    values (v_inv.business_id, v_uid, split_part(v_email, '@', 1))
    on conflict (business_id, user_id) do nothing;
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.business_id;
end;
$$;

revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;
