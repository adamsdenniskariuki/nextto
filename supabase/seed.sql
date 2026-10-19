-- =============================================================================
-- Local demo data. Applied by `supabase db reset` (never in production).
-- One demo owner and business per business-type preset, each with a second
-- staff member, a break, a few customers, bookings and an issued invoice.
-- Log in locally with a magic link to owner+<type>@nextto.test and open the
-- email in Studio's mail viewer (http://127.0.0.1:54324).
-- =============================================================================

do $$
declare
  v_type     public.business_type;
  v_uid      uuid;
  v_email    text;
  v_business public.businesses;
  v_owner_staff uuid;
  v_staff2   uuid;
  v_service  public.services;
  v_customer uuid;
  v_invoice  uuid;
  v_tz       text := 'Africa/Nairobi';
  v_today    date := (now() at time zone 'Africa/Nairobi')::date;
  v_names    text[] := array['Wanjiku Kamau', 'Otieno Odhiambo', 'Achieng Atieno', 'Kipchoge Rotich', 'Amina Hassan'];
  v_phones   text[] := array['0712345678', '0723456789', '0110123456', '0798765432', '0734567890'];
  i          integer;
begin
  foreach v_type in array enum_range(null::public.business_type) loop
    v_uid   := gen_random_uuid();
    v_email := format('owner+%s@nextto.test', v_type);

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, '', now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());

    -- Act as that user so create_business() sees auth.uid().
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_uid, 'email', v_email, 'role', 'authenticated')::text, true);

    v_business := public.create_business(
      initcap(v_type::text) || ' Demo ' || case v_type
        when 'salon' then 'Studio' when 'tutor' then 'Academy' when 'cleaner' then 'Services'
        when 'mechanic' then 'Garage' when 'clinic' then 'Clinic' when 'photographer' then 'Studio'
        else 'Co' end,
      'demo-' || v_type::text,
      v_type,
      '+254700000000',
      'Owner'
    );

    update public.businesses
    set address = 'Kimathi Street, Nairobi', vat_registered = (v_type in ('clinic', 'mechanic')),
        email = v_email
    where id = v_business.id;

    select s.id into v_owner_staff from public.staff s where s.business_id = v_business.id;

    -- A second staff member, lunch breaks and a day off.
    insert into public.staff (business_id, display_name, color)
    values (v_business.id, 'Mary Njeri', '#b45309')
    returning id into v_staff2;

    insert into public.staff_services (business_id, staff_id, service_id)
    select v_business.id, v_staff2, s.id from public.services s where s.business_id = v_business.id;

    insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
    select business_id, v_staff2, weekday, start_time, end_time
    from public.working_hours where staff_id = v_owner_staff;

    insert into public.staff_breaks (business_id, staff_id, weekday, start_time, end_time)
    select business_id, staff_id, weekday, '13:00', '14:00'
    from public.working_hours where business_id = v_business.id;

    insert into public.time_off (business_id, staff_id, during, reason)
    values (v_business.id, v_staff2,
            tstzrange((v_today + 3)::timestamp at time zone v_tz, (v_today + 4)::timestamp at time zone v_tz),
            'Annual leave');

    for i in 1 .. array_length(v_names, 1) loop
      insert into public.customers (business_id, name, phone, email)
      values (v_business.id, v_names[i], v_phones[i], null);
    end loop;

    -- Past completed bookings (for reports) and upcoming ones (for the calendar).
    select * into v_service from public.services
    where business_id = v_business.id order by sort_order limit 1;

    for i in 1 .. 10 loop
      insert into public.bookings (business_id, staff_id, service_id, customer_id, during, status, price_cents)
      select v_business.id,
             case when i % 2 = 0 then v_owner_staff else v_staff2 end,
             v_service.id,
             c.id,
             tstzrange(((v_today - i * 3) + time '10:00') at time zone v_tz,
                       ((v_today - i * 3) + time '10:00') at time zone v_tz
                         + make_interval(mins => v_service.duration_minutes)),
             case when i = 4 then 'no_show' else 'completed' end::public.booking_status,
             v_service.price_cents
      from public.customers c
      where c.business_id = v_business.id
      order by c.name
      offset (i % 5) limit 1;
    end loop;

    insert into public.bookings (business_id, staff_id, service_id, customer_id, during, status, price_cents)
    select v_business.id, v_owner_staff, v_service.id, c.id,
           tstzrange(((v_today + 1) + time '11:00') at time zone v_tz,
                     ((v_today + 1) + time '11:00') at time zone v_tz + make_interval(mins => v_service.duration_minutes)),
           'confirmed', v_service.price_cents
    from public.customers c where c.business_id = v_business.id order by c.name limit 1;

    -- An issued invoice with a partial cash payment.
    select c.id into v_customer from public.customers c
    where c.business_id = v_business.id order by c.name limit 1;

    insert into public.invoices (business_id, customer_id, vat_rate_bp)
    values (v_business.id, v_customer, case when v_type in ('clinic', 'mechanic') then 1600 else 0 end)
    returning id into v_invoice;

    insert into public.invoice_items (business_id, invoice_id, description, quantity, unit_price_cents, sort_order)
    values (v_business.id, v_invoice, v_service.name, 2, v_service.price_cents, 1),
           (v_business.id, v_invoice, 'Products and materials', 1, 75000, 2);

    perform public.issue_invoice(v_invoice);

    insert into public.payments (business_id, invoice_id, method, status, amount_cents, paid_at, reference)
    values (v_business.id, v_invoice, 'cash', 'succeeded', 50000, now(), 'Cash at counter');
  end loop;

  perform set_config('request.jwt.claims', '', true);
  refresh materialized view private.business_daily_stats;
end;
$$;
