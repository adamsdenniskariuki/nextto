# Nextto: You're next.

Bookings, invoicing and M-Pesa payments for small service businesses in
Kenya, such as salons, barbers, tutors, cleaners, mechanics, clinics and
photographers.

- **Public booking page** (`/b/your-business`): services, prices and live
  availability; guests book with a phone number.
- **Dashboard**: a live calendar, booking management and customer history.
- **Invoices and quotes**: gapless numbering, 16% VAT, deposits, part
  payments, a PDF and a WhatsApp share link.
- **M-Pesa**: an STK push from an invoice or a booking deposit (Daraja
  sandbox in v1).
- **Reports**: revenue trend, busiest hours, staff utilisation, receivables
  ageing and repeat customers.

Built with Next.js (App Router), strict TypeScript and Supabase (Postgres,
Auth, RLS, Realtime, pg_cron), and hosted on Vercel.

## Docs

| Doc                                    | What's in it                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/SETUP.md](docs/SETUP.md)         | **Setup and deployment**: local development, the Supabase project and keys, migrations, Vercel and the env var table, the Daraja sandbox and callback URL, DNS for nextto.app and the nextto.madebyfavor.com redirect. |
| [LEARNING.md](LEARNING.md)             | Each feature mapped to the Next.js, TypeScript, Postgres and Supabase concepts it demonstrates.                                                                                                                        |
| [docs/sql-notes.md](docs/sql-notes.md) | Indexes, with `EXPLAIN` plans showing they're used.                                                                                                                                                                    |
| [.env.example](.env.example)           | Every environment variable, with placeholders only.                                                                                                                                                                    |

## Quick start (local)

Requires Node 20+ and Docker.

```powershell
npm install
npm run db:start   # local Supabase: applies supabase/migrations + seed.sql
npm run db:test    # pgTAP schema, RLS, booking, invoice, M-Pesa and report tests
npm run db:lint
cp .env.example .env.local   # fill in from `npx supabase status`
npm run dev        # http://localhost:3000 (magic-link emails: http://127.0.0.1:54324)
npm test           # Vitest
npm run test:e2e   # Playwright
```

See [docs/SETUP.md](docs/SETUP.md#1-local-development) for the full steps,
including the seeded demo logins.

## Repository layout

```
src/
  app/          Next.js App Router pages, server actions, route handlers
  lib/          Supabase clients, Zod schemas, money/phone helpers (+ unit tests)
  proxy.ts      session refresh (Next 16's renamed middleware)
e2e/            Playwright tests
supabase/
  migrations/   versioned schema, RLS, SQL functions, pg_cron jobs
  tests/        pgTAP tests (run with `supabase test db`)
  seed.sql      one demo business per business-type preset
  templates/    auth email templates (token_hash magic links)
docs/           setup and SQL notes
```

## Status

Delivered in increments, each a PR with CI passing:

1. ✅ Schema, RLS and SQL functions with tests
2. ✅ Auth, onboarding and presets
3. ✅ Public booking (try http://localhost:3000/b/demo-salon after `npm run db:start`)
4. ✅ Dashboard and calendar (live updates via Supabase Realtime)
5. ✅ Invoices and quotes: VAT, deposits, part payments, PDF and a WhatsApp share link
6. ✅ M-Pesa: STK push from invoices, booking deposits and share links (mock mode locally, Daraja sandbox in the cloud)
7. ✅ Reports: revenue trend, busiest hours, staff utilisation, receivables ageing and repeat customers
8. Polish and deploy

> This repository is public. Never commit secrets: use `.env.local`
> (gitignored) locally, and Vercel or Supabase environment variables in the
> cloud.
