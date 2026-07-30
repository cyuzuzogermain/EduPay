# EduPay

Cross-border student fee payment orchestration and reconciliation layer between students, a
licensed payment partner, and institutional Student Information Systems (SIS). Students pay
tuition in their local currency; institutions receive funds in their preferred currency.

This is an MVP scoped for demonstration purposes: **MTN MoMo only**, kept deliberately simple. The
payment-partner layer is built behind a shared `PaymentPartner` adapter interface
(`src/payment-partners/interfaces/payment-partner.interface.ts`) so additional partners can be
added later without touching orchestration logic.

## Who uses it

Three actor types, each with their own login and their own area of the app:

- **Students** - self-register, manage their profile, submit KYC documents.
- **Institution admins** - provisioned by a platform admin, scoped to one institution; review and
  approve/reject KYC submissions for that institution's students.
- **Platform admins** - EduPay staff; provision institutions and institution admin accounts, and
  can view/review across every institution.

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

## Getting started

```bash
git clone <repo-url> edupay
cd edupay
npm install
cp .env.example .env   # fill in real secrets before deploying anywhere shared
```

### 1. Create the database

Make sure PostgreSQL is running locally, then create a database matching `DATABASE_URL` in
`.env` (defaults to db/user/password `edupay`/`edupay`/`edupay`):

```bash
createdb edupay   # or: psql -c "CREATE DATABASE edupay;"
```

### 2. Apply the database schema

```bash
npx prisma migrate dev
```

### 3. Seed a platform admin account

Every institution and institution-admin account is provisioned from inside the app, so you need
one platform admin to start with:

```bash
npm run prisma:seed
```

This creates `admin@edupay.example` / `PlatformAdmin123!` (printed to the console too). Change
this password immediately in any non-throwaway environment - the seed script has no other purpose
than bootstrapping a fresh database.

### 4. Run the app

```bash
npm run start:dev
```

The app listens on `http://localhost:3000` by default (`PORT` in `.env`).
- Web UI: `http://localhost:3000`
- Interactive API docs: `http://localhost:3000/api/docs`

### 5. Run tests

```bash
npm test          # unit tests
npm run test:cov  # unit tests with coverage (Auth/Students/Institutions services gated at 80%)
npm run test:e2e  # end-to-end tests (requires Postgres running)
```

## Demo walkthrough

1. Log in as the seeded platform admin (`/login`) → **Institutions** → create an institution.
2. On that institution's page, provision an institution admin account.
3. Log out, register a new student account (`/register`), optionally linking it to that
   institution.
4. As the student: go to **KYC**, submit a document.
5. Log out, log back in as the institution admin you created → **Students** → open the student →
   **Approve** or **Reject** the submitted document.
6. Log back in as the student to see the updated KYC status.

## Project structure

```
edupay/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                 # bootstraps a demo platform admin
├── views/                      # EJS templates for the server-rendered UI
│   ├── partials/nav.ejs         # role-aware nav bar
│   ├── landing.ejs / login.ejs / register.ejs / error.ejs
│   ├── student/                 # dashboard.ejs, kyc.ejs
│   ├── institution/             # overview.ejs, students.ejs, student-detail.ejs
│   └── admin/                   # overview.ejs, institutions.ejs, institution-detail.ejs, students.ejs, student-detail.ejs
├── public/css/styles.css       # shared stylesheet (static, served by NestJS)
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/                 # env loading + validation
│   ├── common/                 # filters, guards (JWT + roles), decorators, shared types
│   ├── prisma/                 # PrismaService (global module)
│   ├── auth/                   # login / logout / refresh across all actor types
│   ├── students/                # registration, profile, KYC submission + review
│   ├── institutions/            # institution + institution-admin provisioning
│   ├── web/                     # page controllers, cookie auth guard, EJS rendering
│   └── payment-partners/
│       ├── interfaces/          # PaymentPartner adapter contract
│       └── mtn-momo/            # placeholder module - implementation lands in the next sprint
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
| Institution overview | `/institution` | Institution admin |
| Institution students + review | `/institution/students`, `/institution/students/:id` | Institution admin |
| Platform overview | `/admin` | Platform admin |
| Institutions CRUD | `/admin/institutions`, `/admin/institutions/:id` | Platform admin |
| All students + review | `/admin/students`, `/admin/students/:id` | Platform admin |

## API overview

The JSON REST API backs the web UI and is fully documented in Swagger at `/api/docs`. Highlights:

### Auth (`/auth`)
- `POST /auth/login` — email + password (any actor type) → access token + refresh token + role
- `POST /auth/logout` — JWT-protected, invalidates the given refresh token's session
- `POST /auth/refresh` — exchanges a valid refresh token for a new access/refresh pair (rotated)

Refresh-token sessions are tracked in Postgres (`RefreshToken` model, keyed by `subjectId` +
`role` since the subject lives in one of three different tables) - logout and refresh-rotation
actually revoke the row, so reused tokens are rejected.

### Students (`/students`)
- `POST /students/register` — create a student account
- `GET /students` — institution admin (own institution) / platform admin (everyone), with latest KYC status
- `GET /students/:id` — JWT-protected, fetch a profile
- `PATCH /students/:id` — JWT-protected, update your own profile only
- `POST /students/:id/kyc` — JWT-protected, submit a KYC document for review
- `GET /students/:id/kyc/status` — JWT-protected, current KYC status + document history
- `PATCH /students/:id/kyc/:documentId/review` — institution admin (own institution) / platform admin, approve or reject

### Institutions (`/institutions`)
- `GET /institutions/public` — no auth, `{id, name, country}` only, used to populate registration dropdowns
- `POST /institutions`, `GET /institutions`, `GET /institutions/:id` — platform admin (detail also open to that institution's admin)
- `POST /institutions/:id/admins`, `GET /institutions/:id/admins` — provision/list institution admins
- `GET /institutions/:id/students` — students at that institution, with latest KYC status

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