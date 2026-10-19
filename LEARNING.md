# Learning map

Nextto doubles as a learning project for **Next.js, TypeScript, Postgres
and Supabase**. This file maps each feature to the concepts it demonstrates
and where to find them. It grows with each increment.

Legend: ✅ shipped · 🚧 planned in a later increment

## Postgres (complex SQL)

| Concept | Where | Why it's here |
| --- | --- | --- |
| ✅ `tstzrange` + **exclusion constraint** (`btree_gist`) | `bookings_no_overlap` in [`core_schema`](supabase/migrations/20261019100100_core_schema.sql) | The database itself makes double booking impossible, even under concurrent requests. Violations raise SQLSTATE `23P01`. |
| ✅ Half-open ranges `[)` | `bookings_during_valid` check | 10:00–11:00 and 11:00–12:00 touch but don't overlap. |
| ✅ **Partial** exclusion constraint | `... where (status in ('pending','confirmed','completed'))` | Cancelling a booking frees its slot automatically. |
| ✅ `generate_series` + **multiranges** (`range_agg`, `-`, `<@`) | `available_slots()` in [`booking_functions`](supabase/migrations/20261019100400_booking_functions.sql) | Free time = shifts − (bookings + buffers, breaks, time off). Slots are a series over the free multirange. |
| ✅ **Recursive CTE** | `create_recurring_bookings()` | Generates N occurrences in local wall-clock time; one clash rolls back the whole series. |
| ✅ Time zones (`timestamptz`, `at time zone`) | `available_slots`, reports | Store instants; convert to `Africa/Nairobi` only at the edges. `date + time` gives a local timestamp, and `at time zone tz` turns it into an instant. |
| ✅ **Money as `bigint` cents** | every `*_cents` column | No floats (a test asserts this). VAT uses basis points: `round(subtotal::numeric * bp / 10000)`. |
| ✅ **Generated columns** | `invoices.total_cents`, `balance_cents`, `invoice_items.line_total_cents` | Derived values can never drift from their inputs. |
| ✅ **Gapless numbering** with row locks | `issue_invoice()` + `private.invoice_counters` in [`invoicing`](supabase/migrations/20261019100500_invoicing.sql) | An `UPDATE ... RETURNING` on a counter row serialises issuers. Rollbacks don't burn numbers, unlike a `SEQUENCE`. |
| ✅ Triggers (BEFORE vs AFTER) | VAT, freeze-issued, subtotal sync, payment state | BEFORE edits `NEW`; AFTER updates *other* rows. |
| ✅ **Idempotency**: unique key + `ON CONFLICT DO NOTHING` | `record_mpesa_callback()` in [`payments_mpesa`](supabase/migrations/20261019100600_payments_mpesa.sql) | Safaricom retries callbacks; the second delivery is a no-op. |
| ✅ Row locks (`FOR UPDATE`) and race handling | `apply_mpesa_callback()`, early-callback trigger | Handles a callback that arrives before the payment row is committed. |
| ✅ `jsonb` parsing | `record_mpesa_callback()` | `->`, `->>`, `#>` and `jsonb_array_elements` over the Daraja payload. |
| ✅ **Window functions** | `report_revenue_trend()` in [`reports`](supabase/migrations/20261019100700_reports.sql) | Running total, 7-day moving average (`rows between 6 preceding`), and `lag()` for day-over-day change. `rank()` in busiest hours, `row_number()` in repeat customers. |
| ✅ **Materialised view** + `refresh concurrently` | `private.business_daily_stats` | Pre-aggregated daily stats for fast dashboards; it needs a unique index. |
| ✅ **pg_cron** | `nextto-refresh-daily-stats`, `nextto-expire-stale-mpesa` | Scheduled jobs inside the database. |
| ✅ Partial / composite / expression / GiST indexes | See [docs/sql-notes.md](docs/sql-notes.md) | Each one comes with an `EXPLAIN` showing it in use. |
| ✅ `FULL JOIN`, `FILTER`, `LATERAL`, `WITH ORDINALITY` | matview, `create_business()` | Combining sparse daily series; expanding preset JSON into rows. |

## Supabase

| Concept | Where | Why it's here |
| --- | --- | --- |
| ✅ Versioned **migrations** | `supabase/migrations/` | Every schema change is a reviewed, ordered file. CI rebuilds from scratch. |
| ✅ **Row level security** per tenant and role | [`rls`](supabase/migrations/20261019100200_rls.sql) | Members read; owners configure; staff manage their own time off; anon sees nothing. |
| ✅ SECURITY DEFINER helpers in a private schema | `private.member_business_ids()` etc. | Avoids recursive policies, and the private schema isn't exposed by the API. |
| ✅ Column-level `GRANT`s | businesses, invoices, payments | Clients can't set an invoice number, status or totals, even on rows RLS allows. |
| ✅ Public access through functions only | `get_public_booking_page`, `book_public`, `get_shared_invoice` | The anon key can do exactly these things and nothing else. |
| ✅ `auth.uid()` / `auth.jwt()` inside SQL | `create_business`, `accept_invitation` | Identity flows from the JWT into Postgres. |
| ✅ Realtime publication | `bookings` in `supabase_realtime` | Live calendar updates (UI in increment 4). |
| ✅ **pgTAP tests** incl. RLS impersonation | [`supabase/tests/`](supabase/tests) | `set local role authenticated` plus `request.jwt.claims` to act as any user. |
| ✅ Seed data per preset | [`supabase/seed.sql`](supabase/seed.sql) | Demo businesses for every business type. |
| 🚧 Auth magic links + invitations | increment 2 | |
| 🚧 Generated TypeScript types (`supabase gen types`) | increment 2 | |
| 🚧 Storage (logos, invoice PDFs) | increment 5 | |

## Next.js and TypeScript (from increment 2)

| Concept | Where |
| --- | --- |
| 🚧 App Router, server components, `generateMetadata` | Public booking page `/b/[slug]` (inc. 3) |
| 🚧 Server actions + Zod shared validation | Onboarding, booking forms (inc. 2–3) |
| 🚧 Route handlers | Daraja callback `/api/mpesa/callback` (inc. 6) |
| 🚧 Supabase SSR auth in middleware | inc. 2 |
| 🚧 Strict TypeScript, discriminated unions | throughout |
| 🚧 Vitest, Playwright | inc. 2+ |

## How to explore

```powershell
npm install
npm run db:start      # Postgres + Auth etc. in Docker, applies migrations + seed
npm run db:test       # 100+ pgTAP assertions
docker exec -it supabase_db_nextto psql -U postgres
```

Then try, for example:

```sql
select * from available_slots(
  (select id from businesses where slug = 'demo-salon'),
  (select s.id from services s join businesses b on b.id = s.business_id
   where b.slug = 'demo-salon' order by s.sort_order limit 1),
  current_date + 1);
```
