# Setup and deployment

This guide covers everything needed to run Nextto locally and deploy it to
Supabase and Vercel. **Never commit real keys.** The repository is public, so all
secrets live in Vercel/Supabase/GitHub environment settings or in your untracked
`.env.local`. `.env.example` lists every variable with placeholder values only.

- [1. Local development](#1-local-development)
- [2. Supabase project](#2-supabase-project)
- [3. Link the Supabase CLI and run migrations](#3-link-the-supabase-cli-and-run-migrations)
- [4. Vercel](#4-vercel)
- [5. Environment variables](#5-environment-variables)
- [6. M-Pesa Daraja sandbox](#6-m-pesa-daraja-sandbox)
- [7. Domains and DNS](#7-domains-and-dns)
- [8. GitHub Actions secrets](#8-github-actions-secrets)

---

## 1. Local development

Prerequisites: Node.js 20+, npm, Docker Desktop (for the local Supabase stack),
and the Supabase CLI (`npm i -g supabase`, `scoop install supabase`, or
`brew install supabase/tap/supabase`).

```bash
git clone https://github.com/adamsdenniskariuki/nextto.git
cd nextto
cp .env.example .env.local        # then fill in values from `supabase status`
supabase start                    # Postgres, Auth, Realtime, Storage, Studio in Docker
supabase db reset                 # applies supabase/migrations/* and supabase/seed.sql
supabase test db                  # runs the pgTAP tests in supabase/tests
```

`supabase status` prints the local API URL, the anon (publishable) key and the
service-role key. Copy them into `.env.local`. Local URLs:

| Service       | URL                                                     |
| ------------- | ------------------------------------------------------- |
| API           | http://127.0.0.1:54321                                  |
| Postgres      | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Studio        | http://127.0.0.1:54323                                  |
| Email testing | http://127.0.0.1:54324 (magic-link emails land here)    |

Seeded demo logins (local only): `owner+salon@nextto.test`,
`owner+tutor@nextto.test`, and so on, one per business-type preset. Request a
magic link and open it from the email testing UI.

Then run the web app:

```bash
npm install
npm run dev                       # http://localhost:3000
```

Sign in at http://localhost:3000/login. The magic-link email lands in Mailpit
(http://127.0.0.1:54324); click the button there. A new account goes to
`/onboarding`, where you pick a business-type preset. Staff invitations work the
same way: the invitee's email also lands in Mailpit.

Each seeded business has a public booking page at `/b/demo-<type>`, for
example http://localhost:3000/b/demo-salon. Book a time as a guest; no login is
needed.

For M-Pesa callbacks during local
development, expose port 3000 with a tunnel (for example `cloudflared tunnel
--url http://localhost:3000` or `ngrok http 3000`) and set `MPESA_CALLBACK_URL`
to the tunnel URL. See [section 6](#6-m-pesa-daraja-sandbox).

Useful commands:

```bash
npm run typecheck                 # next typegen + tsc (strict)
npm run lint                      # ESLint (next/core-web-vitals + typescript)
npm test                          # Vitest unit tests (src/**/*.test.ts)
npm run test:e2e                  # Playwright (needs `supabase start`; starts `npm run dev` itself)
npm run db:types                  # regenerate src/lib/database.types.ts after a migration
supabase migration new <name>     # new timestamped migration file
supabase db lint                  # plpgsql_check over all functions
supabase db diff                  # compare local DB with migrations
supabase stop                     # stop the containers
```

First-time Playwright setup: `npx playwright install chromium`. The tests read
emails from Mailpit; override its address with `MAILPIT_URL` if needed.

## 2. Supabase project

1. Go to https://supabase.com/dashboard and choose **New project**.
2. Name: `nextto`. Region: the closest available to Kenya (for example
   `eu-central-1` Frankfurt or `eu-west-1` Ireland). Generate a strong database
   password and keep it in your password manager (`SUPABASE_DB_PASSWORD`).
3. When the project is ready, open **Project Settings → API** (or **API Keys**):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe in the
     browser; row-level security protects data)
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY` (server only,
     bypasses RLS; never expose it to the browser or commit it)
   - **Project ref** (the `xxxx` in `https://xxxx.supabase.co`) → `SUPABASE_PROJECT_REF`
4. **Authentication → URL Configuration**:
   - Site URL: `https://nextto.app`
   - Redirect URLs: `https://nextto.app/**`,
     `https://*-adamsdenniskariuki.vercel.app/**` (preview deployments) and
     `http://localhost:3000/**`. Sign-in links redirect to `/dashboard` and
     staff invitations to `/invite/<token>`, so allow whole paths.
5. **Authentication → Providers → Email**: keep Email enabled (magic links).
   For production email volume configure custom SMTP under
   **Authentication → Emails → SMTP Settings**.
6. **Authentication → Emails → Templates**: set **Magic Link** and
   **Confirm signup** to the HTML in
   [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html)
   (subjects: "Your Nextto sign-in link" and "Welcome to Nextto: confirm your
   email"). Their link points at `/auth/confirm?token_hash=…`, which works in
   any browser. That matters for invitations, which the owner requests and the
   invitee opens. The default templates use PKCE, which only works in the
   requesting browser. `/auth/confirm` accepts both, so this step is needed for
   invitations rather than for owner sign-in.
7. **Database → Extensions**: nothing to click. The migrations enable
   `btree_gist` and `pg_cron` themselves.

## 3. Link the Supabase CLI and run migrations

```bash
supabase login                                       # opens the browser, creates an access token
supabase link --project-ref <SUPABASE_PROJECT_REF>   # prompts for the DB password
supabase db push --dry-run                           # review what will be applied
supabase db push                                     # apply supabase/migrations to the cloud DB
```

- Never run `supabase/seed.sql` against production. It holds demo data for
  local use only (`db push` does not run it unless you pass `--include-seed`).
- Migrations are append-only. To change the schema, add a new migration with
  `supabase migration new` instead of editing an applied one.
- Generate types from the cloud project with
  `supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`.

## 4. Vercel

1. https://vercel.com/new → **Import Git Repository** →
   `adamsdenniskariuki/nextto`.
2. Framework preset: **Next.js**. Keep the default root directory, build
   command and output settings.
3. Add the variables from [section 5](#5-environment-variables) under
   **Settings → Environment Variables**. Set them for **Production** and
   **Preview**. Use sandbox M-Pesa credentials for both until go-live.
4. Deploy. Every PR gets a preview URL. Pushes to `main` deploy to production.
5. Optional: install the Supabase integration from the Vercel marketplace. It
   syncs the Supabase URL and keys automatically. Check the names match
   section 5.

## 5. Environment variables

"Public" variables (`NEXT_PUBLIC_*`) are compiled into the browser bundle.
Everything else is a server-side secret. `.env.example` mirrors this table.

| Name                            | Where to get it                                                                            | Public / secret                  | Used by                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | `https://nextto.app` in production, `http://localhost:3000` locally                        | Public                           | Absolute links (share links, auth redirects)            |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API → Project URL (local: `supabase status`)                 | Public                           | Browser and server Supabase clients                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API Keys → anon / publishable key (local: `supabase status`)                    | Public                           | Browser and server Supabase clients (RLS applies)       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → API Keys → service_role / secret key (local: `supabase status`)                 | **Secret**                       | Server-only admin client (M-Pesa callback, invitations) |
| `SUPABASE_PROJECT_REF`          | The subdomain of your Supabase URL                                                         | Secret (CI only)                 | `supabase link` in GitHub Actions                       |
| `SUPABASE_ACCESS_TOKEN`         | Supabase → Account → Access Tokens                                                         | **Secret** (CI only)             | `supabase link` / `db push` in GitHub Actions           |
| `SUPABASE_DB_PASSWORD`          | Chosen when creating the project                                                           | **Secret** (CI only)             | `supabase db push` in GitHub Actions                    |
| `MPESA_ENV`                     | `mock` locally and in CI, `sandbox` on Vercel, `production` at go-live; unset hides M-Pesa | Secret                           | Chooses fake prompts or the Daraja base URL             |
| `MPESA_CONSUMER_KEY`            | Daraja portal → My Apps → your app                                                         | **Secret**                       | OAuth token for Daraja                                  |
| `MPESA_CONSUMER_SECRET`         | Daraja portal → My Apps → your app                                                         | **Secret**                       | OAuth token for Daraja                                  |
| `MPESA_SHORTCODE`               | Sandbox: `174379` (Daraja test credentials)                                                | Secret                           | STK push `BusinessShortCode`                            |
| `MPESA_PASSKEY`                 | Daraja → APIs → M-Pesa Express → Simulate (test credentials)                               | **Secret**                       | STK password = base64(shortcode + passkey + timestamp)  |
| `MPESA_CALLBACK_SECRET`         | Generate: `openssl rand -hex 32`                                                           | **Secret**                       | Unguessable path segment that authenticates callbacks   |
| `MPESA_CALLBACK_URL`            | `${NEXT_PUBLIC_SITE_URL}/api/mpesa/callback/${MPESA_CALLBACK_SECRET}`                      | **Secret** (contains the secret) | Sent to Daraja as `CallBackURL` (checked at startup)    |
| `MPESA_CALLBACK_ALLOWED_IPS`    | Optional: Safaricom's published callback IPs, comma-separated                              | Secret                           | Extra IP allow-list on the callback route (empty = off) |

## 6. M-Pesa Daraja sandbox

### Mock mode (no Safaricom account)

Set `MPESA_ENV=mock`, `MPESA_CALLBACK_SECRET` (any 8+ characters) and
`SUPABASE_SERVICE_ROLE_KEY`. Pressing **Send M-Pesa request** then creates a
real pending payment, and about 1.5 seconds later the server POSTs a
Safaricom-shaped callback to its own `/api/mpesa/callback/<secret>` route.
The whole path (route, Zod, SQL idempotency, booking confirmation) runs; only
Safaricom is skipped. CI and the Playwright tests use this mode. The outcome
depends on the customer's phone:

| Phone ends in | Result                    |
| ------------- | ------------------------- |
| `1032`        | Customer cancels          |
| `0001`        | Fails: insufficient funds |
| anything else | Paid, with a fake receipt |

### Sandbox (real Daraja)

1. Create an account at https://developer.safaricom.co.ke and log in.
2. **My Apps → Create new app**. Tick **Lipa Na M-Pesa Sandbox (M-Pesa
   Express)**. Copy the **Consumer Key** and **Consumer Secret** into
   `MPESA_CONSUMER_KEY` and `MPESA_CONSUMER_SECRET`.
3. Open **APIs → M-Pesa Express → Simulate** (test credentials) to get the
   sandbox **Business Shortcode** (`174379`) and **Passkey**. Put them in
   `MPESA_SHORTCODE` and `MPESA_PASSKEY`.
4. Callback URL: Daraja posts the STK result to the `CallBackURL` sent with
   every STK push request. No portal configuration is needed. It must be
   public HTTPS:
   - Production / preview: `https://nextto.app/api/mpesa/callback/<MPESA_CALLBACK_SECRET>`
   - Local: `https://<your-tunnel>/api/mpesa/callback/<MPESA_CALLBACK_SECRET>`
5. How callbacks are trusted (defence in depth):
   - The secret path segment must match `MPESA_CALLBACK_SECRET` (compared in
     constant time). Anything else gets a 404.
   - Optionally, the source IP must be in `MPESA_CALLBACK_ALLOWED_IPS`.
   - The body is validated with Zod.
   - The database function `public.record_mpesa_callback` (service role only)
     stores every callback once, keyed by a unique `CheckoutRequestID`. It is
     idempotent, so a replayed or duplicated callback cannot double-credit a
     payment.
   - Prompts that never get a callback are expired by `pg_cron` after 15
     minutes, so the customer can try again.
   - Before go-live, consider also confirming high-value results with the STK
     Query API (not built in v1).
6. Sandbox test phone: use the number shown on the Daraja simulator page
   (for example `254708374149`). Sandbox prompts are simulated, so no real money
   moves.
7. Go-live (later): apply for production via the Daraja portal, then set
   `MPESA_ENV=production` and replace the shortcode, passkey, key and secret
   in the Vercel **Production** environment only.

## 7. Domains and DNS

Primary domain: **nextto.app**. Secondary: **nextto.madebyfavor.com**, which
redirects to the primary.

1. Vercel → Project → **Settings → Domains → Add** `nextto.app`. Also add
   `www.nextto.app` and choose **Redirect to nextto.app**.
2. At the nextto.app DNS provider, create the records Vercel shows. Typical
   values are below; always copy the exact ones from the Vercel UI:

   | Type  | Name  | Value                  |
   | ----- | ----- | ---------------------- |
   | A     | `@`   | `76.76.21.21`          |
   | CNAME | `www` | `cname.vercel-dns.com` |

   Alternatively, point the domain's nameservers to Vercel
   (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`).

3. Add `nextto.madebyfavor.com` in Vercel → Domains and choose **Redirect to
   nextto.app** (308, permanent). In the madebyfavor.com DNS add:

   | Type  | Name     | Value                  |
   | ----- | -------- | ---------------------- |
   | CNAME | `nextto` | `cname.vercel-dns.com` |

4. Vercel issues TLS certificates automatically once DNS resolves.
5. If the domain changes, update Supabase **Authentication → URL
   Configuration** (Site URL and redirect URLs) and `NEXT_PUBLIC_SITE_URL`.
6. `.app` is on the HSTS preload list, so HTTPS is mandatory. Vercel handles it.

## 8. GitHub Actions secrets

CI runs migrations and pgTAP tests against an ephemeral local Supabase stack,
so it needs **no secrets**. To deploy migrations from CI later, add these
under GitHub → Settings → Secrets and variables → Actions:
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
