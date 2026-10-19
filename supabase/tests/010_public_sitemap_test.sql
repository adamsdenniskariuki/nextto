-- Sitemap listing of public booking pages, as an anonymous visitor.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-e@nextto.test');
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated","email":"owner-e@nextto.test"}', true);
select public.create_business('Sitemap Listed', 'test-sitemap-listed', 'salon');
select public.create_business('Sitemap Empty', 'test-sitemap-empty', 'general');
-- Nothing bookable: no active services.
update public.services set active = false
where business_id = (select id from public.businesses where slug = 'test-sitemap-empty');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select ok(exists (select 1 from public.public_booking_pages() where slug = 'test-sitemap-listed'),
  'a business with active services is listed');
select ok(not exists (select 1 from public.public_booking_pages() where slug = 'test-sitemap-empty'),
  'a business with nothing to book is not listed');
select is((select count(*) from public.public_booking_pages() where slug = 'test-sitemap-listed'),
  1::bigint, 'each business appears once, however many services it has');
select throws_ok('select 1 from public.businesses', '42501', null,
  'anonymous visitors still cannot read businesses directly');

reset role;
select * from finish();
rollback;
