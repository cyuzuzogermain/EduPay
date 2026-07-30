# EduPay

Cross-border student fee payment orchestration and reconciliation layer between students, a
payment partner, and institutional Student Information Systems (SIS). Students pay tuition in
their local currency; institutions receive funds in their preferred currency.

This is an MVP scoped for demonstration purposes: payments run through a **simulated payment
partner** (instant success/failure, no real money moves) built behind a shared `PaymentPartner`
adapter interface (`src/payment-partners/interfaces/payment-partner.interface.ts`), so a real
partner (an MTN MoMo adapter is scaffolded at `src/payment-partners/mtn-momo/`) can be plugged in
later without touching orchestration logic.

## Who uses it

Three actor types, each with their own login and their own area of the app:

- **Students** - register (gated: must match an existing school record), submit KYC documents,
  pay charges (cross-border FX quote + fee shown up front), track payment history and receipts.
- **Institution admins** - provisioned by a platform admin, scoped to one institution; manage that
  institution's financial records (manually or via CSV bulk import), review/approve KYC
  submissions and payments, run reports.
- **Platform admins** - EduPay staff; provision institutions and institution admin accounts, and
  can view/review across every institution.
  NOTE: For setup in the already in production app, purposes only, use:
  Platform Admin Email: admin@edupay.com
  Platform Admin Password: PlatformAdmin123!

## Tech stack

- Node.js v20 LTS, TypeScript 5, NestJS 10
- PostgreSQL via Prisma ORM (also used for refresh-token session tracking - no separate cache)
- JWT auth (passport-jwt + passport-local) shared across all three actor types, bcrypt password
  hashing, role-based guards (`@Roles()` + `RolesGuard`)
- Server-rendered web UI: NestJS + EJS views, cookie-based sessions (no client framework, no
  build step) - see [Web UI](#web-ui) below
- Swagger (`/api/docs`) for the underlying JSON API, Jest + Supertest, ESLint + Prettier, Husky

## Prerequisites

- Node.js 20+
- A local PostgreSQL server (v14+)

---

## Running it locally

These steps take you from a fresh clone to a running app with realistic demo data already loaded.

### 1. Clone and install

```bash
git clone <repo-url> edupay
cd edupay
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in real values. For a local run the only things you strictly need to change
are `DATABASE_URL` (if your Postgres user/password/db name differ from the defaults) and, if you
want KYC email notifications or MoMo to actually call out, the SendGrid/MoMo keys - everything
else has a sane local default already filled in. `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`
are **not** used locally (see step 5) - they only matter for the production bootstrap script.

### 3. Create the database

Make sure PostgreSQL is running, then create a database matching `DATABASE_URL`:

```bash
createdb edupay   # or: psql -c "CREATE DATABASE edupay;"
```

### 4. Apply the database schema

```bash
npx prisma migrate dev
```

This applies every migration and generates the Prisma client.

### 5. Seed demo data

```bash
npm run prisma:seed
```

The seed script is idempotent (safe to re-run - it only fills in what's missing) and creates a
full demo dataset: a platform admin, **21 institutions** (one admin each), 50+ financial records
per institution with itemized charges, a handful of pre-claimed student accounts, and a few
payments already sitting in different states so every page has real data on first run. Full
credential list in [Seeded demo data](#seeded-demo-data) below.

### 6. Run the app

```bash
npm run start:dev
```

You now have a running system:
- Web UI: `http://localhost:3000`
- Interactive API docs: `http://localhost:3000/api/docs`

### 7. Run the tests (optional but recommended)

```bash
npm test          # unit tests
npm run test:cov  # unit tests with coverage (core services gated at 80%)
npm run test:e2e  # end-to-end tests (requires Postgres running)
```

---

## Seeded demo data

### Platform admin
- `admin@edupay.example` / `PlatformAdmin123!`

### Institution admins
All 21 seeded institutions share the same admin password: `InstitutionAdmin123!`. Pick any one -
e.g. `admin@demo-university.edupay.example` (EduPay Demo University, Rwanda). The full list of
institutions and admin emails is printed to the console when the seed script runs.

### Pre-claimed student accounts (log in immediately, no registration needed)
Password for all of these: `StudentPass123!`

| Email | Institution | School ID | What to expect |
|---|---|---|---|
| aline.uwase@example.com | EduPay Demo University | STU-1001 | No payments yet - good for the full Initiate → Confirm → Approve flow from scratch |
| eric.niyonzima@example.com | EduPay Demo University | STU-1002 | A completed payment (has a receipt) + one pending admin review |
| david.otieno@example.com | Nairobi Heights University | STU-KES-0001 | A payment pending admin review |
| faith.wanjiru@example.com | Nairobi Heights University | STU-KES-0002 | A rejected payment - see the reviewer note |

Every other seeded record is **unclaimed** - register a new student at `/register` with the
institution's name, a school ID, and the matching name-on-file to claim it.

---

## Step-by-step: local testing walkthrough

Run through this after [Running it locally](#running-it-locally) to exercise every major flow.

1. **Log in as the platform admin** (`/login`, `admin@edupay.example` / `PlatformAdmin123!`) -
   lands on `/admin`.
2. **Create an institution** - `/admin/institutions` → fill in the "Create institution" form
   (name, country, contact email, preferred currency).
3. **Provision an institution admin** for it, from that institution's detail page
   (`/admin/institutions/:id`).
4. **Log out**, then **register a new student** at `/register` - type the institution's name, a
   school ID that doesn't exist yet, and a name. Since no financial record exists yet for that
   school ID, registration will tell you it can't find a match.
5. Instead, **log in as the institution admin** you just created (lands on `/institution/records`,
   its default landing page) and either:
   - **create a record manually** via the "Create record" card (`schoolId`, `studentName`,
     `program`), then add a charge to it, or
   - **bulk-import records via CSV** using the "Bulk import (CSV)" card - download the sample CSV
     linked there, edit a row or two, and upload it. The result banner shows how many records/
     charges were created and lists any skipped rows with a reason.
6. **Log out**, then **register the student again** at `/register`, this time matching the school
   ID and name-on-file you just created - registration succeeds.
7. **As the student**: go to **KYC** (`/kyc`) and submit a document.
8. **Log out**, log back in as the **institution admin** → **Students** → open the student →
   **Approve** the KYC submission.
9. **Log back in as the student** → **Payments** (`/payments`) - the charge(s) you created are now
   listed. Select one, optionally pick a different send currency to see the live FX quote and fee,
   enter a phone number, and **Initiate** the payment, then **Confirm** it in the modal.
10. **Log back in as the institution admin** → **Payments** (`/institution/payments`) - the
    payment is `PENDING_APPROVAL`. Open the review drawer and **Approve** (or **Reject**, to see
    the rejection note flow) it.
11. **Log back in as the student** to see the updated payment status, transaction history, and -
    if approved - download the receipt.
12. Back as the **institution admin**, check **Reports** (`/institution/reports`) to see the
    payment attempt logged there, filterable by date/status/school ID.

Everything above is also reachable as a JSON API (Bearer-token auth) documented at
`/api/docs` - useful for testing the same flows with `curl`/Postman instead of the browser.

---

## Step-by-step: live/deployed testing walkthrough

Use this once the app is deployed somewhere real (a hosted Postgres + the Node app - this repo has
been run on Render, but nothing here is Render-specific). Substitute your actual deployed base URL
for `https://your-deployed-app.example` below.

### First-time production setup (once per environment)

1. **Provision a Postgres database** on your host and set `DATABASE_URL` (plus `JWT_SECRET`,
   `JWT_REFRESH_SECRET`, `SENDGRID_*`, `MOMO_*` as needed) in the deployment's environment
   variables - never commit real secrets to `.env`.
2. **Set `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD`** in the same environment - choose a
   real email and a strong, unique password. This account can manage every institution on the
   platform.
3. **Apply migrations** against the production database:
   ```bash
   npx prisma migrate deploy
   ```
4. **Bootstrap the platform admin** - production does **not** use `prisma/seed.ts` (that's
   local-dev-only demo data). Instead:
   ```bash
   npm run bootstrap
   ```
   This creates exactly one platform admin from `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`
   and is safe to re-run on every deploy - it's a no-op once that admin already exists.
5. **Start the app** (however your host runs it, typically `npm run build && npm run start:prod`).

### Testing the live deployment

Once it's up, the walkthrough is the same shape as the [local one](#step-by-step-local-testing-walkthrough)
above, just against your real URL and with no demo data pre-loaded - everything is created through
the app itself, which is the point of a production test.

If you're visiting the hosted instance to try it out rather than standing up your own deployment,
log in with the platform admin account that's already been bootstrapped there:

- `admin@edupay.com` / `PlatformAdmin123!`

1. **Log in** at `https://your-deployed-app.example/login` with the platform admin credentials
   above (or the ones you set in step 2 above, if this is your own deployment).
2. **Create a real (or realistic test) institution** at `/admin/institutions`, then **provision an
   institution admin** for it.
3. **Log out**, then have the institution admin **create financial records** at
   `/institution/records` - manually, or by uploading a CSV (download the sample from the "Bulk
   import (CSV)" card to see the exact expected column format first).
4. **Register a student** at `/register`, matching one of those records by school ID and name.
5. **Submit KYC as the student**, then **approve it as the institution admin**.
6. **Initiate and confirm a payment as the student**, then **review (approve/reject) it as the
   institution admin**.
7. **Confirm the student sees the updated status and, once approved, can download a receipt.**
8. **Check `/institution/reports`** to confirm the attempt is logged correctly.
9. Sanity-check the JSON API is reachable and documented at
   `https://your-deployed-app.example/api/docs`.

If any step fails on the live deployment but passes locally, the most common causes are a missing
environment variable (re-check step 1-2 above), migrations not having been applied
(`npx prisma migrate deploy`), or the bootstrap script never having been run (no platform admin
exists to log in as).

---

## Project structure

```
edupay/
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                  # local-dev-only: full demo dataset
│   └── bootstrap.ts             # production-safe: creates one platform admin (npm run bootstrap)
├── views/                       # EJS templates for the server-rendered UI
│   ├── partials/                # nav, footer, pagination, badges, payment review drawer
│   ├── landing.ejs / login.ejs / register.ejs / error.ejs
│   ├── student/                 # dashboard, kyc, payments, notifications
│   ├── institution/              # students, payments, records (+ CSV import), reports
│   └── admin/                   # overview, institutions, students, payments
├── public/                      # static assets (css, sample CSV) served by NestJS
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/                  # env loading + validation
│   ├── common/                  # filters, guards (JWT + roles), decorators, shared types
│   ├── prisma/                  # PrismaService (global module)
│   ├── auth/                    # login / logout / refresh + platform admin bootstrap
│   ├── students/                # registration, profile, KYC submission + review
│   ├── institutions/             # institution + institution-admin provisioning
│   ├── institution-records/      # SchoolFinancialRecord CRUD + CSV bulk import
│   ├── payments/                 # initiate / confirm / cancel / review, FX-aware
│   ├── fx/                       # exchange-rate lookup (live + offline fallback)
│   ├── finance/                  # balance/outstanding-charge calculations
│   ├── receipts/                 # PDF receipt generation for completed payments
│   ├── reports/                  # institution payment reports (+ CSV export)
│   ├── notifications/            # in-app notifications
│   ├── web/                      # page controllers, cookie auth guard, EJS rendering
│   └── payment-partners/
│       ├── interfaces/           # PaymentPartner adapter contract
│       ├── simulated/            # the partner actually wired up in this MVP
│       └── mtn-momo/             # scaffolded real adapter, not wired up yet
├── test/
└── .env.example
```

## Web UI

Server-rendered with NestJS + EJS - forms `POST` directly to page routes, which redirect on
success (POST/redirect/GET) or bounce back with `?error=` on failure. Auth is a JWT pair stored in
`httpOnly` cookies (`access_token`, `refresh_token`); an `OptionalAuthMiddleware` decodes the
cookie on every request (harmless if absent/invalid), and page controllers are gated with a
cookie-based `WebAuthGuard` plus the same `@Roles()` decorator the JSON API uses.

| Area | Path | Role |
| --- | --- | --- |
| Landing / login / register | `/`, `/login`, `/register` | Public |
| Student dashboard | `/dashboard` | Student |
| Student KYC | `/kyc` | Student |
| Student payments | `/payments` | Student |
| Student notifications | `/notifications` | Student |
| Institution students + KYC review | `/institution/students`, `/institution/students/:id` | Institution admin |
| Institution payment review | `/institution/payments` | Institution admin |
| Institution records (landing page) + CSV import | `/institution/records`, `/institution/records/:id` | Institution admin |
| Institution reports | `/institution/reports` | Institution admin |
| Platform overview | `/admin` | Platform admin |
| Institutions CRUD | `/admin/institutions`, `/admin/institutions/:id` | Platform admin |
| All students + KYC review | `/admin/students`, `/admin/students/:id` | Platform admin |
| All payments review | `/admin/payments` | Platform admin |

## API overview

The JSON REST API backs the web UI and is fully documented in Swagger at `/api/docs`. Highlights:

### Auth (`/auth`)
- `POST /auth/login` — email + password (any actor type) → access token + refresh token + role
- `POST /auth/logout` — JWT-protected, invalidates the given refresh token's session
- `POST /auth/refresh` — exchanges a valid refresh token for a new access/refresh pair (rotated)

### Students (`/students`)
- `POST /students/register` — create a student account (must match an existing financial record)
- `GET /students` — institution admin (own institution) / platform admin (everyone)
- `POST /students/:id/kyc` — JWT-protected, submit a KYC document for review
- `PATCH /students/:id/kyc/:documentId/review` — institution admin (own institution) / platform admin

### Institutions (`/institutions`)
- `GET /institutions/public` — no auth, used to populate registration dropdowns
- `POST /institutions`, `GET /institutions`, `GET /institutions/:id` — platform admin

### Financial records (`/school-financial-records`)
- `GET/POST /school-financial-records`, `GET /school-financial-records/:id` — institution admin, scoped to own institution
- `POST /school-financial-records/import` — multipart CSV bulk import, returns `{ recordsCreated, chargesCreated, skipped }`

### Payments (`/payments`)
- `POST /payments/quote`, `POST /payments/initiate`, `POST /payments/:id/confirm`, `POST /payments/:id/cancel` — student
- `PATCH /payments/:id/review` — institution admin (own institution) / platform admin

All responses exclude `password`. Errors follow a consistent shape:

```json
{
  "statusCode": 400,
  "timestamp": "2026-07-16T12:00:00.000Z",
  "path": "/students/register",
  "method": "POST",
  "message": ["email must be an email"],
  "error": "Bad Request"
}
```
