-- =============================================================================
-- 0001 Foundation: extensions, schemas, enum types and shared helpers.
--
-- Concepts (see LEARNING.md):
--   * Extensions live in the `extensions` schema, which Supabase puts on the
--     search_path. btree_gist lets a GiST index combine "=" on scalar columns
--     with "&&" on ranges. We need that for the double-booking exclusion
--     constraint.
--   * The `private` schema is NOT exposed through the Data API (PostgREST only
--     serves the schemas in config.toml -> api.schemas). Internal tables,
--     helpers and the materialised view live there.
--   * Enums give us a closed set of states that the database enforces.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies run as the calling role, so callers need USAGE on the schema
-- holding the helper functions they reference. This does not expose the
-- schema over HTTP.
grant usage on schema private to anon, authenticated, service_role;

create type public.business_type as enum (
  'salon', 'tutor', 'cleaner', 'mechanic', 'clinic', 'photographer', 'general'
);
create type public.member_role    as enum ('owner', 'staff');
create type public.booking_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.booking_source as enum ('public', 'dashboard');
create type public.document_kind  as enum ('invoice', 'quote');
create type public.invoice_status as enum (
  'draft', 'issued', 'partially_paid', 'paid', 'void', 'accepted', 'declined'
);
create type public.payment_method as enum ('mpesa', 'cash', 'card', 'bank');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled');

-- Generic updated_at trigger.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normalise Kenyan phone numbers to E.164 (+2547XXXXXXXX / +2541XXXXXXXX).
-- Accepts 07.., 01.., 7.., 254.., +254.. with spaces/dashes. Other
-- international E.164 numbers pass through unchanged.
create function public.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  if v ~ '^0[17][0-9]{8}$' then
    v := '+254' || substr(v, 2);
  elsif v ~ '^254[17][0-9]{8}$' then
    v := '+' || v;
  elsif v ~ '^[17][0-9]{8}$' then
    v := '+254' || v;
  end if;

  if v !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid phone number: %', p_phone using errcode = '22023';
  end if;
  return v;
end;
$$;

comment on function public.normalize_phone(text) is
  'Normalise a phone number to E.164, with Kenyan local formats (07.., 01.., 254..) mapped to +254.';
