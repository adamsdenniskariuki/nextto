-- =============================================================================
-- 0002 Core multi-tenant schema.
--
-- Concepts (see LEARNING.md):
--   * Every tenant-owned row carries business_id. Child tables use COMPOSITE
--     foreign keys such as (staff_id, business_id) -> staff(id, business_id),
--     so a booking can never point at another business's staff, service or
--     customer, even if the application has a bug.
--   * Money is stored as bigint cents (KES 1 = 100 cents). There are no float
--     columns anywhere.
--   * Instants are timestamptz (stored as UTC). Appointment spans are
--     tstzrange with '[)' bounds, so 10:00-11:00 and 11:00-12:00 do not overlap.
--   * Double booking is prevented by an EXCLUSION CONSTRAINT: no two active
--     bookings for the same staff member may have overlapping ranges.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Business-type presets (reference data, also needed in production)
-- ---------------------------------------------------------------------------
create table public.business_type_presets (
  business_type   public.business_type primary key,
  label           text not null,
  staff_label     text not null,               -- e.g. "Stylist", "Tutor"
  customer_label  text not null,               -- e.g. "Client", "Student", "Patient"
  booking_label   text not null,               -- e.g. "Appointment", "Lesson"
  default_open    time not null,
  default_close   time not null,
  working_days    smallint[] not null,         -- 0 = Sunday ... 6 = Saturday (extract(dow))
  services        jsonb not null default '[]', -- [{name, description, duration_minutes, price_cents, deposit_cents}]
  check (default_open < default_close),
  check (jsonb_typeof(services) = 'array')
);

-- ---------------------------------------------------------------------------
-- Businesses (tenants), members and staff
-- ---------------------------------------------------------------------------
create table public.businesses (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name            text not null check (char_length(name) between 2 and 120),
  business_type   public.business_type not null default 'general',
  timezone        text not null default 'Africa/Nairobi',
  currency        char(3) not null default 'KES',
  phone           text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email           text,
  address         text,
  kra_pin         text,
  vat_registered  boolean not null default false,
  vat_rate_bp     integer not null default 1600     -- basis points: 1600 = 16.00 %
                    check (vat_rate_bp between 0 and 10000),
  invoice_footer  text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
-- The PK covers lookups by business. RLS helpers look up by user, so index that.
create index business_members_user_idx on public.business_members (user_id, business_id);

-- Staff are bookable people. They may or may not have a login (user_id).
create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  color        text not null default '#0f766e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (business_id, user_id),
  unique (id, business_id)          -- target for composite foreign keys
);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  role        public.member_role not null default 'staff',
  staff_id    uuid,
  token       uuid not null unique default gen_random_uuid(),
  invited_by  uuid default auth.uid() references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
-- Partial unique index: only one OPEN invitation per email per business.
create unique index invitations_open_email_idx
  on public.invitations (business_id, lower(email))
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Services and schedules
-- ---------------------------------------------------------------------------
create table public.services (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  description      text,
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  buffer_minutes   integer not null default 0 check (buffer_minutes between 0 and 240),
  price_cents      bigint not null default 0 check (price_cents >= 0),
  deposit_cents    bigint not null default 0 check (deposit_cents >= 0),
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (deposit_cents <= price_cents),
  unique (id, business_id)
);
create index services_business_idx on public.services (business_id, sort_order) where active;

create table public.staff_services (
  business_id uuid not null,
  staff_id    uuid not null,
  service_id  uuid not null,
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id)   references public.staff (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);
create index staff_services_service_idx on public.staff_services (service_id);
create index staff_services_business_idx on public.staff_services (business_id);

-- Weekly recurring working hours, in the business's local wall-clock time.
create table public.working_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id    uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  check (start_time < end_time),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
create index working_hours_staff_weekday_idx on public.working_hours (staff_id, weekday);
create index working_hours_business_idx on public.working_hours (business_id);

create table public.staff_breaks (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id    uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  check (start_time < end_time),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
create index staff_breaks_staff_weekday_idx on public.staff_breaks (staff_id, weekday);
create index staff_breaks_business_idx on public.staff_breaks (business_id);

-- One-off absences (leave, sick days), as absolute instants.
create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id    uuid not null,
  during      tstzrange not null check (not isempty(during)),
  reason      text,
  created_at  timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
create index time_off_staff_during_idx on public.time_off using gist (staff_id, during);
create index time_off_business_idx on public.time_off (business_id);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  phone       text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, phone),     -- one customer per phone per business
  unique (id, business_id)
);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
create table public.booking_series (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  repeat_every interval not null check (repeat_every > interval '0'),
  occurrences integer not null check (occurrences between 2 and 52),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (id, business_id)
);

create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  staff_id      uuid not null,
  service_id    uuid not null,
  customer_id   uuid not null,
  series_id     uuid,
  during        tstzrange not null,
  status        public.booking_status not null default 'confirmed',
  source        public.booking_source not null default 'dashboard',
  price_cents   bigint not null check (price_cents >= 0),
  deposit_cents bigint not null default 0 check (deposit_cents >= 0),
  notes         text,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint bookings_during_valid check (
    not isempty(during)
    and lower_inc(during) and not upper_inc(during)
    and not lower_inf(during) and not upper_inf(during)
  ),
  constraint bookings_deposit_le_price check (deposit_cents <= price_cents),

  -- THE double-booking guard. For rows matching the WHERE clause, no two rows
  -- may have staff_id equal AND during overlapping. btree_gist provides the
  -- GiST "=" support for uuid. Cancelled and no-show bookings free the slot.
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    during   with &&
  ) where (status in ('pending', 'confirmed', 'completed')),

  foreign key (staff_id, business_id)    references public.staff (id, business_id),
  foreign key (service_id, business_id)  references public.services (id, business_id),
  foreign key (customer_id, business_id) references public.customers (id, business_id),
  foreign key (series_id, business_id)   references public.booking_series (id, business_id)
    on delete set null (series_id),
  unique (id, business_id)
);
-- Calendar queries: "bookings of business X overlapping this week".
create index bookings_business_during_idx on public.bookings using gist (business_id, during);
-- Customer history, newest first (expression index on the range's lower bound).
create index bookings_customer_start_idx on public.bookings (customer_id, lower(during) desc);
create index bookings_service_idx on public.bookings (service_id);
-- Partial index: most bookings are not recurring.
create index bookings_series_idx on public.bookings (series_id) where series_id is not null;

-- ---------------------------------------------------------------------------
-- Invoices and quotes
-- ---------------------------------------------------------------------------
-- Gapless numbering: one counter row per (business, kind, year). Issuing a
-- document UPDATEs the row, which takes a row lock held until commit, so
-- concurrent issuers queue up and a rolled-back transaction never burns a
-- number. A SEQUENCE would be faster but can leave gaps, which tax
-- authorities do not accept.
create table private.invoice_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind        public.document_kind not null,
  year        integer not null,
  last_value  integer not null default 0 check (last_value >= 0),
  primary key (business_id, kind, year)
);

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  kind              public.document_kind not null default 'invoice',
  customer_id       uuid not null,
  booking_id        uuid,
  number            text,                 -- e.g. INV-2026-0001, assigned on issue
  number_year       integer,
  number_seq        integer,
  status            public.invoice_status not null default 'draft',
  issue_date        date,
  due_date          date,
  currency          char(3) not null default 'KES',
  vat_rate_bp       integer not null default 0 check (vat_rate_bp between 0 and 10000),
  subtotal_cents    bigint not null default 0 check (subtotal_cents >= 0),
  vat_cents         bigint not null default 0 check (vat_cents >= 0),
  total_cents       bigint generated always as (subtotal_cents + vat_cents) stored,
  deposit_cents     bigint not null default 0 check (deposit_cents >= 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  balance_cents     bigint generated always as (subtotal_cents + vat_cents - amount_paid_cents) stored,
  notes             text,
  share_token       uuid not null unique default gen_random_uuid(),
  issued_at         timestamptz,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (business_id, kind, number),
  unique (business_id, kind, number_year, number_seq),
  unique (id, business_id),
  check (number is not null or status in ('draft', 'void')),
  check (kind = 'invoice' or status in ('draft', 'issued', 'accepted', 'declined', 'void')),
  check (kind = 'quote'   or status not in ('accepted', 'declined')),
  check (due_date is null or issue_date is null or due_date >= issue_date),
  foreign key (customer_id, business_id) references public.customers (id, business_id),
  foreign key (booking_id, business_id)  references public.bookings (id, business_id)
    on delete set null (booking_id)
);
create index invoices_customer_idx on public.invoices (customer_id);
create index invoices_booking_idx on public.invoices (booking_id) where booking_id is not null;
create index invoices_business_created_idx on public.invoices (business_id, created_at desc);
-- Partial index for receivables: only unpaid issued invoices, ordered by due date.
create index invoices_outstanding_idx on public.invoices (business_id, due_date)
  where kind = 'invoice' and status in ('issued', 'partially_paid');

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  invoice_id       uuid not null,
  description      text not null check (char_length(description) between 1 and 300),
  quantity         numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  -- numeric * bigint stays numeric (exact). round() then cast back to cents.
  line_total_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  foreign key (invoice_id, business_id) references public.invoices (id, business_id) on delete cascade
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order);

-- ---------------------------------------------------------------------------
-- Payments and M-Pesa callbacks
-- ---------------------------------------------------------------------------
create table public.payments (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses (id) on delete cascade,
  invoice_id                uuid,
  booking_id                uuid,
  method                    public.payment_method not null,
  status                    public.payment_status not null default 'pending',
  amount_cents              bigint not null check (amount_cents > 0),
  phone                     text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  reference                 text,
  mpesa_merchant_request_id text,
  mpesa_checkout_request_id text unique,   -- idempotency key for STK callbacks
  mpesa_receipt             text unique,   -- M-Pesa transaction code, never reused
  result_code               integer,
  result_desc               text,
  paid_at                   timestamptz,
  created_by                uuid default auth.uid() references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (invoice_id is not null or booking_id is not null),
  check (status <> 'succeeded' or paid_at is not null),
  foreign key (invoice_id, business_id) references public.invoices (id, business_id),
  foreign key (booking_id, business_id) references public.bookings (id, business_id)
);
create index payments_invoice_idx on public.payments (invoice_id) where invoice_id is not null;
create index payments_booking_idx on public.payments (booking_id) where booking_id is not null;
create index payments_business_paid_idx on public.payments (business_id, paid_at) where status = 'succeeded';
-- Partial index for the "expire stale STK pushes" sweep.
create index payments_pending_idx on public.payments (created_at) where status = 'pending';

-- Raw Daraja callbacks. A unique CheckoutRequestID makes delivery idempotent.
create table private.mpesa_callbacks (
  id                  uuid primary key default gen_random_uuid(),
  checkout_request_id text not null unique,
  merchant_request_id text,
  result_code         integer not null,
  result_desc         text,
  receipt             text,
  amount_cents        bigint,
  phone               text,
  payload             jsonb not null,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  payment_id          uuid references public.payments (id) on delete set null
);
create index mpesa_callbacks_unprocessed_idx on private.mpesa_callbacks (received_at)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- updated_at and phone normalisation triggers
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.services
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.bookings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.payments
  for each row execute function private.set_updated_at();

create function private.normalize_phone_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is not null then
    new.phone := public.normalize_phone(new.phone);
  end if;
  return new;
end;
$$;

create trigger normalize_phone before insert or update of phone on public.customers
  for each row execute function private.normalize_phone_column();
create trigger normalize_phone before insert or update of phone on public.businesses
  for each row execute function private.normalize_phone_column();
create trigger normalize_phone before insert or update of phone on public.payments
  for each row execute function private.normalize_phone_column();

-- A business must always keep at least one owner.
create function private.protect_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.business_members m
       where m.business_id = old.business_id
         and m.role = 'owner'
         and m.user_id <> old.user_id
     )
     -- During ON DELETE CASCADE from businesses the parent row is already gone.
     and exists (select 1 from public.businesses b where b.id = old.business_id)
  then
    raise exception 'A business must have at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger protect_last_owner before update of role or delete on public.business_members
  for each row execute function private.protect_last_owner();

-- Realtime: stream booking changes to the dashboard calendar (RLS applies).
alter publication supabase_realtime add table public.bookings;
