-- Schema-level invariants: extensions, RLS coverage, key constraints.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_extension('btree_gist', 'btree_gist is installed');
select has_extension('pg_cron', 'pg_cron is installed');

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has row level security enabled'
);

select is(
  (select array_agg(c.relname order by c.relname)::text
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)),
  null,
  'every public table has at least one policy'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'bookings_no_overlap' and contype = 'x'),
  'bookings has the no-overlap exclusion constraint'
);

select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public' and data_type in ('real', 'double precision')),
  0,
  'no floating point columns anywhere (money is integer cents)'
);

select col_type_is('public', 'invoices', 'total_cents', 'bigint', 'invoice totals are bigint cents');
select col_type_is('public', 'bookings', 'during', 'tstzrange', 'booking spans are tstzrange');

select hasnt_table('public', 'invoice_counters', 'invoice counters are not exposed via the API schema');
select has_materialized_view('private', 'business_daily_stats', 'dashboard stats materialised view exists');
select ok(
  exists (select 1 from cron.job where jobname = 'nextto-refresh-daily-stats'),
  'pg_cron refreshes the dashboard stats'
);
select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bookings'),
  'bookings are published to Realtime'
);

select is((select count(*)::int from public.business_type_presets), 7, 'seven business-type presets');

select * from finish();
rollback;
