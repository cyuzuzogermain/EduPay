# EduPay — End-to-End Flow

This walks through the app exactly as it runs today: real routes, real form field names, real
button labels, pulled from the actual controllers and views in this repo (`src/web/`, `views/`).
Nothing here is aspirational — if a step isn't listed, it isn't built yet (see
[What isn't here yet](#what-isnt-here-yet) at the end).

Three actor types, three separate logins, one shared `/login` form that routes each to their own
area based on the account's role.

## 0. One-time setup

```bash
npm install
cp .env.example .env            # edit DATABASE_URL etc. to match your local Postgres
createdb edupay
npx prisma migrate dev          # applies all 9 migrations, generates the Prisma client
npm run prisma:seed             # see the full dataset this creates below
npm run start:dev
```

The seed script (`prisma/seed.ts`) is idempotent (safe to re-run — it checks what already exists
and only fills in what's missing, so re-running never duplicates data) and creates a realistic,
demo-scale dataset: a platform admin, **21 institutions** (each in a different country, each with
its own institution admin), **50+ `SchoolFinancialRecord` rows per institution** (1,050+ total,
each with 2-4 itemized charges and at least one overdue), a handful of pre-claimed student
accounts so payments/notifications/receipts/reports all have real data on first run, and a few
payments seeded in `PENDING_APPROVAL` / `COMPLETED` / `REJECTED` states. Full credential list in
[Seeded demo data](#seeded-demo-data) below.

The app serves everything on one port (`PORT` in `.env`, default `3000`):
- Web UI: `http://localhost:3000`
- JSON API + Swagger: `http://localhost:3000/api/docs`

---

## Seeded demo data

### Platform admin
- `admin@edupay.example` / `PlatformAdmin123!`

### Institutions (21, one admin each, same password `InstitutionAdmin123!`)

| Institution | Country | Admin email |
|---|---|---|
| EduPay Demo University | Rwanda | admin@demo-university.edupay.example |
| Nairobi Heights University | Kenya | admin@nairobi-heights.edupay.example |
| Lagos Metropolitan University | Nigeria | admin@lagos-metropolitan.edupay.example |
| Accra Coastal University | Ghana | admin@accra-coastal.edupay.example |
| Cairo Nile University | Egypt | admin@cairo-nile.edupay.example |
| Cape Town Peninsula University | South Africa | admin@cape-town-peninsula.edupay.example |
| Kampala Ridge University | Uganda | admin@kampala-ridge.edupay.example |
| Dar es Salaam Bay University | Tanzania | admin@dar-bay.edupay.example |
| Addis Highlands University | Ethiopia | admin@addis-highlands.edupay.example |
| Dakar Atlantic University | Senegal | admin@dakar-atlantic.edupay.example |
| Abidjan Lagoon University | Ivory Coast | admin@abidjan-lagoon.edupay.example |
| Yaounde Central University | Cameroon | admin@yaounde-central.edupay.example |
| Casablanca Maritime University | Morocco | admin@casablanca-maritime.edupay.example |
| Lusaka Plains University | Zambia | admin@lusaka-plains.edupay.example |
| Gaborone Kalahari University | Botswana | admin@gaborone-kalahari.edupay.example |
| Maputo Bay University | Mozambique | admin@maputo-bay.edupay.example |
| Lilongwe Lakeside University | Malawi | admin@lilongwe-lakeside.edupay.example |
| Windhoek Desert University | Namibia | admin@windhoek-desert.edupay.example |
| Harare Highveld University | Zimbabwe | admin@harare-highveld.edupay.example |
| Kinshasa River University | DR Congo | admin@kinshasa-river.edupay.example |
| Algiers Coastal University | Algeria | admin@algiers-coastal.edupay.example |

Every institution has **50+ `SchoolFinancialRecord` rows** — a mix of hand-curated "showcase"
records (below) plus bulk-generated ones (varied student names, programs, and 2-4 charges each,
always including at least one overdue charge so the Overdue badge is demonstrable immediately).
Amounts are invented per-institution for realism, and every institution's `preferredCurrency` is
set to a plausible currency for its country (e.g. RWF for Rwanda, KES for Kenya, XOF for
Senegal/Ivory Coast) — charges on that institution's records are always denominated in it. A
handful of institutions whose real local currency isn't in EduPay's curated send-currency list
(Ethiopia's ETB, Zambia's ZMW, Botswana's BWP, Mozambique's MZN, Malawi's MWK, Namibia's NAD, DR
Congo's CDF, Algeria's DZD) are seeded with the nearest curated substitute instead (mostly USD or
ZAR, matching real informal/de-facto usage in several of those countries) so every seeded
institution can actually be re-selected through the constrained currency dropdown described in
[Cross-border payments & FX](#cross-border-payments--fx) below.

### Pre-claimed student accounts (log in immediately, no registration needed)
Password for all of these: `StudentPass123!`

| Email | Institution | School ID | What to expect |
|---|---|---|---|
| aline.uwase@example.com | EduPay Demo University | STU-1001 | No payments yet — try the full Initiate → Confirm → (admin) Approve flow from scratch |
| eric.niyonzima@example.com | EduPay Demo University | STU-1002 | A `COMPLETED` payment (has a receipt) + a `PENDING_APPROVAL` one ready for an admin to review |
| david.otieno@example.com | Nairobi Heights University | STU-KES-0001 | A `PENDING_APPROVAL` payment ready for an admin to review |
| faith.wanjiru@example.com | Nairobi Heights University | STU-KES-0002 | A `REJECTED` payment — see the reviewer note in transaction history and the notification it generated |

Every other record across all 21 institutions is **unclaimed** — register at `/register` typing
the institution's name, a school ID, and the matching name-on-file (visible to that institution's
admin at `/institution/records`) to claim one and demo the gated-registration flow end to end.

---

## 1. Platform admin flow

**Log in** at `/login` with the seeded credentials above. `POST /login` checks the email/password
against `Student`, then `InstitutionAdmin`, then `PlatformAdmin` (in that order) and redirects by
role — a platform admin lands on `/admin`.

### Create an institution
`/admin/institutions` shows two things side by side: a paginated table of existing institutions
(20 per page — with 21+ seeded, you'll see the pager in action immediately - including each one's
preferred currency), and a "Create institution" form with four required fields:
- `name` (text, min 2 chars)
- `country` (text, min 2 chars)
- `contactEmail` (email, must be unique across institutions)
- `preferredCurrency` (dropdown, one of the [13 curated currencies](#the-curated-send-currency-list))
  — see [Cross-border payments & FX](#cross-border-payments--fx) for what this drives.

Submitting redirects to `/admin/institutions/:id` with a success banner. That detail page also has
its own "Preferred currency" card to change it later, same as the institution admin's own
`/institution` page.

### Provision an institution admin
Still on `/admin/institutions/:id`, the right-hand card ("Provision an institution admin") takes:
- `name` (text, min 2 chars)
- `email` (email, must be unique across institution admins)
- `password` (min 8 chars) — this is a real, immediately-usable login, not a temp/invite link

There is no self-registration path for this role — institution admin accounts only come into
existence when a platform admin creates one here.

### View everything platform-wide
- `/admin` — overview stats: institution count, total student count, pending-KYC count (each a
  cheap scalar count, not derived from a page of paginated results — accurate even at 1,000+ rows)
- `/admin/institutions/:id` — one institution's students (with latest KYC status, capped at the
  first 100 with a link to the full paginated `/admin/students` list if there are more) and
  admins, side by side with the provisioning form
- `/admin/students` — every student across every institution, with latest KYC status, paginated
- `/admin/students/:id` — one student's full KYC document history

### Review any KYC document
On `/admin/students/:id`, each `PENDING` document row has one form with a free-text `note` field
(optional, max 500 chars) and two submit buttons — **Approve** and **Reject** — both posting to
`/admin/students/:id/kyc/:documentId/review`. The note is stored either way and shown to the
student. A platform admin can review a document for any student at any institution.

### Review any payment
`/admin/payments` lists every payment currently `PENDING_APPROVAL`, across every institution,
paginated — each row shows the student (name + email, if an EduPay account has claimed that
school ID), the charge(s) it covers, the total, and a note field (optional, max 500 chars) with
**Approve** and **Reject** buttons, posting to `/admin/payments/:id/review`. Same pattern as KYC
review, same page (no separate detail page - the list itself is the review surface).
- **Approve** → `COMPLETED`. The covered charge(s) are now settled and the student's balance
  drops by that amount the next time it's computed. If an EduPay account has claimed the
  record, it gets an in-app notification and a PDF receipt becomes downloadable (see
  [Receipts](#receipts) below).
- **Reject** → `REJECTED`. Balance unaffected; the covered charge(s) become selectable again on
  the student's Payments page; the note is stored and shown to the student in their transaction
  history, and (if claimed) they get a notification.

Both outcomes are written as an immutable `AuditLog` row (who reviewed it, from what status to
what, when) in the same database transaction as the status change itself — see
[Payment architecture](#payment-architecture-payment-partner-abstraction--audit-trail) below.

### Log out
The nav bar's "Log out" is a `POST /logout` form (not a link) — it revokes the current refresh
token server-side and clears both auth cookies, then redirects to `/login`.

---

## 2. Student flow

### Register (two steps - identity is verified before you ever see a password field)
There's no open sign-up: an account can only be created for a student the institution has already
preloaded a `SchoolFinancialRecord` for (see [setup](#0-one-time-setup)). Registration is gated on
proving that before anything gets created.

**Step 1 - verify (`/register`, `POST /register/verify`)** collects, all required:
- `name` (min 2 chars) and `email`
- `institution` — a free-text field (not a dropdown), matched case-insensitively and trimmed
  against existing institution names. If it doesn't resolve to exactly one institution (none, or
  more than one), that counts as a failed verification.
- `schoolId` — the student's ID in their institution's own records system (e.g. `STU-1001`)

The server looks up a `SchoolFinancialRecord` at the resolved institution whose `schoolId` and
name-on-file both match what was typed (case-insensitive, trimmed). No match - wrong institution
name, wrong school ID, or a name that doesn't match the record - all produce the exact same
generic error: *"We couldn't verify your details. Please check your student ID or contact your
institution."* It deliberately never says which field was wrong, so the form can't be used to
enumerate institutions or school IDs. If that record is already claimed by another student
account, you get a distinct `409` ("already registered - log in instead") rather than the generic
verification error.

A successful match issues a short-lived (15 minute) signed token binding the verified `name`,
`email`, `institutionId`, and `schoolId` together, and redirects to `GET /register/complete?token=...`.

**Step 2 - set a password (`GET`/`POST /register/complete`, actual account creation is
`POST /register`)** only asks for `password` (min 8 chars) and `country` (min 2 chars) - the
verified identity travels forward as that opaque token in a hidden field, never as editable
inputs the client could tamper with. `POST /register` re-verifies the match server-side (the
record could have been claimed, or the token could be forged/expired) before creating anything -
there is no way to reach account creation with an institutionId/schoolId pair that wasn't actually
verified. On success it creates the student already linked to the verified institution + school
ID, logs them in immediately (no separate login step), and redirects to `/dashboard`, same as
before.

The JSON API mirrors this exactly: `POST /students/register/verify` returns
`{ verificationToken, institutionName, studentName, schoolId }`, then
`POST /students/register` takes `{ verificationToken, password, country }`.

### Dashboard (`/dashboard`)
Shows name, email, country, linked institution (or "Not linked"), school ID (or "Not set"), and
member-since date, plus an edit form for `name`, `country`, `institutionId`, and `schoolId`.
Unlike registration, this edit path is unchanged and *not* gated on a `SchoolFinancialRecord`
match - it only enforces the same (`institutionId`, `schoolId`) uniqueness rule registration
always had, via a plain dropdown (`GET /institutions/public`). `POST /dashboard` updates only the
fields shown — email and password can't be changed here (see
[limitations](#what-isnt-here-yet)).

### Payments (`/payments`)
EduPay doesn't own this data — it simulates pulling a record from the institution's own Student
Information System (SIS), matched by the pair (`institutionId`, `schoolId`) against the
`SchoolFinancialRecord` table (seeded independently of any student account - see
[setup](#0-one-time-setup)). Three top-level states, same as before:
- **Not linked**: institution and/or school ID missing → prompt to set them on the dashboard.
- **No match**: both are set, but no `SchoolFinancialRecord` exists for that exact pair → likely a
  typo, or the institution hasn't uploaded records for that school ID yet.
- **Matched**: shows the school's name-on-file for the student and program, an **itemized list of
  outstanding charges** (not a single balance figure), and the full transaction history below it.

Each charge in the itemized list shows its description, amount, due date, and one of four states:
- **Open** — selectable, no badge. Pick one and pay it individually.
- **Overdue** (`dueDate` in the past) — shown with an "Overdue" badge, greyed out, cannot be
  selected individually - but it's still swept into "Pay full outstanding balance".
- **Payment pending** — a payment already covers this charge and hasn't been rejected
  (`INITIATED`, `PENDING_APPROVAL`, or `COMPLETED`); greyed out, cannot be selected again. This is
  the double-pay guard, enforced server-side in `PaymentsService` (not just hidden in the UI) - the
  same charge cannot be attached to two live payments at once.
- Charges fully covered by a `COMPLETED` payment disappear from this list entirely (they're
  settled) - they still show up in the transaction history below.

**"Pay full outstanding balance"** appears as an extra option whenever at least one charge is
Open or Overdue; picking it bundles every Open + Overdue charge (never Payment-pending ones) into
a single payment.

**KYC gate.** Before any of the below is usable, the student's *latest* `KYCDocument` must be
`APPROVED` (see [Submit KYC](#submit-kyc-kyc) below) - if it isn't (no document submitted yet,
still `PENDING`, or `REJECTED`), the page shows a blocking notice with a link to `/kyc` instead of
the payment form, and the charge/currency/phone inputs are disabled. This isn't just a UI
affordance: `PaymentsService.assertKycApproved` runs at the top of both `quotePayment` and
`initiatePayment`, so a direct `POST /payments/initiate` JSON call from an un-approved student gets
the exact same `403 Forbidden` the web form is hidden behind - there's no way to route around it.

**Paying in your own currency (cross-border FX).** Every institution charges in its own
`preferredCurrency`, but a student doesn't need an account in that currency to pay - see
[Cross-border payments & FX](#cross-border-payments--fx) below for the full model. On this page
that means, once KYC-approved and a charge (or "pay full balance") is selected:
- A **send currency** dropdown, defaulting to none selected - one of EduPay's 13 curated
  currencies (see below), independent of the institution's own currency.
- A **phone number** field (used for the simulated MoMo prompt), required and validated as a
  plausible format (`InitiatePaymentDto.phoneNumber`, `@Matches` against a permissive
  international pattern) - both client-side and server-side.
- As soon as a charge and a send currency are both picked, a live disclosure box appears, driven
  by `fetch()` calls to `POST /payments/quote` on every change (no payment is created by this
  call - it's a pure preview): the charge total in the institution's currency, the FX rate applied,
  the converted amount in the chosen send currency, EduPay's fee as its own line (1.5% of the
  converted amount), and the final total the student will actually pay.

**Initiating a payment** (select a charge, choose a send currency, enter a phone number, then click
*Initiate payment*) does not reload the page — it's a `fetch()` call to `POST /payments/initiate`,
which re-derives the same quote server-side (never trusts the client-side preview), locks the FX
rate/converted amount/fee onto the new row, creates the payment in `INITIATED` state, and returns
it. A modal then appears with a spinner and "Approve the payment on your phone…", simulating the
MTN MoMo prompt, showing the total in the student's chosen send currency:
- **Done** → `POST /payments/:id/confirm`, flips `INITIATED` → `PENDING_APPROVAL`, then reloads
  the page. The charge(s) now show "Payment pending".
- **Cancel** → `POST /payments/:id/cancel`, **deletes** the payment and its allocations outright
  (not a status change - it never existed as far as the balance or history is concerned), then
  reloads. The charge(s) become selectable again.

**The balance never moves during initiate/confirm/cancel** - only an institution or platform
admin approving the payment (below) changes it. The balance itself is never stored; it's computed
live as charges minus `COMPLETED` payments every time the page loads, always in the institution's
own `preferredCurrency` - so there's nothing to keep in sync across these state transitions, and
the institution never has to think in any currency but its own.

The transaction history table (unchanged in spirit) lists every charge and payment with a type
badge and status badge, plus a reviewer-note column - if a payment was rejected, this is where the
student sees why. Every `COMPLETED` payment row also has a **Receipt** link (see below).

---

## Cross-border payments & FX

A student and the institution they're paying rarely share a currency, so every payment now carries
two currencies: the institution's own (what it's owed and always receives, untouched) and the
student's chosen send currency (what actually leaves their pocket, fee included).

### The institution's currency
Every `Institution` has a `preferredCurrency` - the currency all of its charges, balances, and
reports are denominated in. It's set when the institution is created (platform admin,
`/admin/institutions`) and can be changed afterwards from either side:
- **Institution admin** - a "Preferred currency" card on `/institution` (`POST /institution/currency`).
- **Platform admin** - the same card on `/admin/institutions/:id` (`POST /admin/institutions/:id/currency`).

Changing it only affects *new* charges going forward - it's a snapshot used at record-creation
time (`InstitutionRecordsService.create`), never retroactive, so a charge already on file keeps the
currency it was created in even if the institution's preference changes later.

### The curated send-currency list
Students can pay in any of 13 currencies, defined in one place
(`src/payments/currencies.ts`, `SEND_CURRENCIES`) and enforced everywhere a currency is chosen or
stored (`@IsIn(SEND_CURRENCIES)` on the relevant DTOs): RWF, KES, NGN, GHS, ZAR, UGX, TZS, XOF,
XAF, EGP, MAD, USD, EUR. An institution's `preferredCurrency` is validated against this same list,
so every institution's own currency is always one a student could also choose to pay in.

### FX rates: live, cached, and locked
`FxService` (`src/fx/`) sits behind an `FxProvider` interface - the same DI-token pattern as
`PAYMENT_PARTNER` - so the live rate source can be swapped without touching anything that calls it.
The only implementation today, `PublicApiFxProvider`, calls a free, keyless FX API
(`open.er-api.com`); a rate is cached in-memory per currency pair for 60 seconds (no Redis - a
plain `Map`, matching this app's "no new infrastructure" constraint everywhere else), and if the
live call fails for any reason (network error, timeout, rate limiting) it falls back to a small
static approximate-rate table baked into `FxService` itself, so quoting and paying never hard-fail
just because the network is unavailable.

Critically, the rate is **fetched once and locked onto the payment at `initiate` time** - the
`sendCurrency`, `fxRate`, `convertedAmount`, and `feeAmount` columns on the payment row are set
inside `initiatePayment` and never recomputed afterwards. A quote from `POST /payments/quote`
(used to drive the live disclosure box) always uses the exact same charge-resolution and
rate/fee math as `initiatePayment` itself, so what a student is shown before confirming is exactly
what gets locked in - but the two are still separate calls, and only `initiatePayment` writes
anything. Receipts, transaction history, and institution reports always read back the rate that
was actually applied at the time, even if the live market rate has since moved.

### The fee
EduPay charges the student 1.5% of the converted amount, on top of what's owed - the institution
always receives the full charge amount in its own `preferredCurrency`, untouched. Given a charge of
`chargeAmount` in the institution's currency and a chosen `fxRate`:
```
convertedAmount = round2(chargeAmount * fxRate)
feeAmount        = round2(convertedAmount * 0.015)
totalToPay        = round2(convertedAmount + feeAmount)   # what the student's phone prompt shows
```
The institution's own `amount`/`currency` columns are completely unaffected by any of this - the
fee and FX conversion exist purely as additional disclosure columns (`sendCurrency`, `fxRate`,
`convertedAmount`, `feeAmount`, `phoneNumber`) alongside the original institution-currency amount,
so nothing about the existing balance math (`FinanceService`, `/institution/records`) had to change.

### Payment architecture (payment partner abstraction + audit trail)
Formalized behind a single interface (`src/payment-partners/interfaces/payment-partner.interface.ts`)
that any real partner (MTN MoMo, Flutterwave, ...) would implement: `initiatePayment` (kick off a
collection request, get back a partner reference + status) and `getPaymentStatus` (poll it). The
only implementation today is `SimulatedPartner` — it stands in for MTN MoMo exactly the way this
build already behaved (instant, in-process, no real request ever leaves the app), but now
`PaymentsService` only ever depends on the interface via a `PAYMENT_PARTNER` DI token
(`payment-partners.module.ts`), so a real adapter can be swapped in later (bind the token to a new
class) without touching `PaymentsService` at all. `payment-partners/mtn-momo/` is still the
unimplemented placeholder it always was.

Every payment state transition — `initiate` (→ `INITIATED`), `confirm` (→ `PENDING_APPROVAL`,
after checking the partner reports success), `review` (→ `COMPLETED`/`REJECTED`), and `cancel`
(the row is deleted, not re-statused) — writes one immutable `AuditLog` row synchronously in the
*same database transaction* as the change itself (`prisma.$transaction`, no queue). Each row
captures the actor (role + id), the from/to status, and a snapshot of the description/amount/
currency so the row still reads correctly even after a cancelled payment's own row is gone (there's
deliberately no foreign key from `AuditLog` to the transaction, same reasoning as
`RefreshToken.subjectId` — the log must survive the thing it's logging being deleted). Nothing in
the UI reads `AuditLog` today; it exists purely as an append-only internal record.

`POST /payments/initiate` also accepts an optional `idempotencyKey` (a client-generated string,
e.g. a UUID minted once per click). A repeat request with the same key returns the *original*
payment instead of creating a duplicate — including under a genuine race (two near-simultaneous
requests with the same key both reach the database; the loser's unique-constraint violation is
caught and it re-fetches and returns the winner rather than erroring). This guards the classic
double-click-the-button double-submit without any new infrastructure.

### Receipts
Once a payment reaches `COMPLETED`, a PDF receipt (student, institution, charges covered, amount,
date, payment reference) is available at `GET /payments/:id/receipt` — generated on demand with
`pdf-lib`, not stored. Downloadable by the owning student or a reviewing admin of that institution
only (same scoping pattern as everywhere else); anyone else gets a 403, and asking for a receipt
before the payment is `COMPLETED` gets a 409. Linked from the transaction history table's Receipt
column and from the institution admin's [reports page](#institution-reports). For a cross-border
payment, the PDF also includes a "Cross-border payment details" section - send currency, the FX
rate applied, the converted amount, and the fee - alongside the institution-currency amount it
actually received; this section is simply omitted for a payment with no FX data attached.

### Notifications (`/notifications`)
Replaces email (there's no mailer in this build): a row is created for the student whenever one of
their payments is approved or rejected, in the *same transaction* as the status change and its
`AuditLog` entry. The nav bar shows an unread-count badge next to "Notifications" for students;
opening `/notifications` lists them newest-first and marks them all read. `GET /notifications/list`
(JSON) lists without side effects; `POST /notifications/read-all` marks them read explicitly — the
web page's controller calls both in sequence server-side for convenience. (The JSON list route is
`/notifications/list`, not the bare `/notifications`, specifically so it doesn't collide with the
web page's own route at that exact path.)

### Submit KYC (`/kyc`)
A real file upload (`multipart/form-data`), handled server-side with `multer` via NestJS's
`FileInterceptor`:
- `documentType` — a fixed dropdown: Passport, National ID, Student ID, Proof of address
- `file` — the document itself. Accepted types: JPEG, PNG, or PDF only; max size 5MB. Both are
  enforced server-side (`KycStorageService`), not just via the `<input accept="...">` hint on the
  form - a disallowed type or oversized file gets a clear `400` either way, whether the request
  came from this page or a direct `POST /students/:id/kyc` JSON call.

The file is written to disk under `UPLOADS_DIR` (`.env`, default `./uploads/kyc`) under a
**randomly generated filename** - never the client's original filename, so nothing about the
stored path is guessable or attacker-controlled. The original filename is kept on the
`KYCDocument` row (`originalFileName`) purely for display; `fileName` (what's actually on disk),
`mimeType`, and `fileSize` are also stored, all populated by `KycStorageService`, never
client-supplied directly. `uploads/` is git-ignored and, critically, **never served as a static
directory** (see `main.ts` - only `public/` is) - the only way to ever read a file back out is the
guarded route below.

**Viewing a document (`GET /kyc/:documentId/file`)** streams the file back (correct
`Content-Type`, `Content-Disposition: inline` so a browser previews it directly) to one of three
authorized viewers only: the owning student, a reviewing admin of that student's institution, or a
platform admin - anyone else gets a `403`, same `assertReviewerAccess` scoping pattern as
everywhere else (`StudentsService.getKycFile`). A KYCDocument id is globally unique, so this route
doesn't need a studentId in the path (same reasoning as `GET /payments/:id/receipt`). Since
`JwtAuthGuard` accepts the same `access_token` cookie a browser page already has, a plain
`<a href="/kyc/:documentId/file" target="_blank">` - used both on this page for the student's own
submissions and on the reviewer detail pages below - works with no JS, exactly like the receipt
download link.

Below the form, every document the student has ever submitted is listed with its status
(`PENDING` / `APPROVED` / `REJECTED`), a link to the file itself, and, once reviewed, the
reviewer's note if one was left — this is the only place a student sees *why* something was
rejected.

A student can submit multiple documents; there's no limit and no de-duplication.

Getting an `APPROVED` document here is also what unlocks the [Payments](#payments-payments) page -
see the KYC gate described there.

---

## 3. Institution admin flow

Accounts only exist if a platform admin created one (see §1). Logging in at `/login` with those
credentials lands on `/institution/records` - there's no separate overview page; `GET /institution`
just redirects there. Financial records are the day-to-day surface an institution admin actually
works from, so it doubles as home.

### Students (`/institution/students`)
Every student whose `institutionId` matches this admin's institution, with latest KYC status,
paginated, plus a "Pending KYC reviews" stat tile at the top (scoped to this institution, computed
as a cheap scalar count - not derived from a page of results, so it stays accurate regardless of
pagination). Clicking a row opens `/institution/students/:id`.

### Review KYC (`/institution/students/:id`)
Identical review UI to the platform admin's student-detail page (note field + Approve/Reject
buttons posting to `/institution/students/:id/kyc/:documentId/review`) — but scoped: attempting to
open a student from a *different* institution (by guessing/editing the URL, or via the JSON API)
returns a 403 "Forbidden" page, not the student's data. This is enforced in
`StudentsService.getForReview`/`reviewKyc` via `assertReviewerAccess`, not just hidden in the UI.

An institution admin cannot see or manage other institutions, other institutions' admins, or the
platform-wide `/admin` area — those routes are guarded by `@Roles(PLATFORM_ADMIN)` and will bounce
to a Forbidden page.

### Review payments (`/institution/payments`)
Lists every payment `PENDING_APPROVAL` for this institution's students only, paginated - scoped
the same way as KYC review, via a `PaymentsService.assertReviewerAccess` check on the payment's
underlying `SchoolFinancialRecord.institutionId`. Trying to review a payment belonging to a
different institution's student (by ID, whether through this page, the web form, or the JSON API
directly) returns a 403, not the payment. Each row shows the student, the charge(s) the payment
covers, the amount the institution is owed (always in its own `preferredCurrency`), and - for a
cross-border payment - what the student actually paid: send currency, FX rate applied, and the
EduPay fee as its own line, alongside the same note + Approve/Reject pattern as KYC and the
platform admin's payment review (see §1) - approving moves the payment to `COMPLETED`, writes the
audit log entry, notifies the student if claimed, and drops the student's balance (still computed
in the institution's own currency, unaffected by whatever the student actually paid in); rejecting
moves it to `REJECTED`, frees the charge(s), and stores the note (and notification) for the
student to see.

### Manage financial records (`/institution/records`)
This is the institution admin's landing page and the management UI for the
`SchoolFinancialRecord` rows students match against on their Payments page (see
[above](#payments-payments)) - until now these only ever existed via the seed script. Everything
here is scoped to the admin's own institution via the same `assertReviewerAccess`-style pattern
used by KYC and payment review: fetching, editing, or deleting anything that belongs to another
institution's record - by guessing an ID through the web UI or the JSON API directly - returns a
403, not the data.

Four stat tiles sit above the table, all real, institution-wide aggregates (not derived from
whatever page/search filter the table below happens to be showing): **Total Records**, **Fully
Settled** (records with a zero outstanding balance), **Preferred Currency**, and **Outstanding
Balance** - the sum of every record's outstanding balance that's still denominated in the
institution's *current* `preferredCurrency` (`InstitutionRecordsService.getInstitutionStats`).
Records left over from before a currency change keep their own original currency (see
[The institution's currency](#the-institutions-currency)) and are deliberately excluded from that
sum, since adding amounts in two different currencies together would be meaningless - they're
still shown correctly on their own row in the table below.

A **"Preferred currency" card** (moved here from the old standalone overview page) lets the admin
change the institution's own currency (`POST /institution/currency`, one of the
[13 curated currencies](#the-curated-send-currency-list)) - see
[The institution's currency](#the-institutions-currency) for what changing it does and doesn't
affect.

- **List** (`GET /institution/records`) - every record for this institution: school ID,
  name-on-file, program, and the current outstanding balance (computed the same way as everywhere
  else - charges minus `COMPLETED` payments, never cached) - paginated, with a search box
  (case-insensitive contains match against school ID or student name — genuinely useful once an
  institution has 50+ records).
- **Create** (`POST /institution/records`) - `schoolId`, `studentName`, `program`. The pair
  (institution, `schoolId`) must be unique, same rule a student's own `schoolId` is matched
  against - a duplicate returns a 409.
- **Add a charge** (`GET`/`POST /institution/records/:id`) - the detail page lists every charge on
  the record and a form (`description`, `amount`, `dueDate`) to append a new one. A charge created
  here shows up on the matching student's Payments page in exactly the same shape as a
  seed-created one.
- **Edit / delete a charge** - only while it has no non-rejected payment attached (`INITIATED`,
  `PENDING_APPROVAL`, or `COMPLETED`) - the same rule the double-pay guard on `/payments` already
  enforces, reused here so an admin can't rewrite a charge a student has already paid or is
  mid-paying. Attempting it anyway returns a 409 with a clear message. Since HTML forms can't send
  `PATCH`/`DELETE`, these two actions are the one part of this page that calls the JSON API
  directly via `fetch()` from the browser (same pattern as the student Payments page's
  initiate/confirm/cancel flow) - see below.

The JSON API backing all of this lives at `/school-financial-records` (not `/institution/records`)
- mirroring how `/payments` and `/students` are separate, unprefixed, Bearer-testable JSON APIs
sitting alongside their role-prefixed web pages. `GET/POST /school-financial-records`,
`GET /school-financial-records/:id`, and `POST/PATCH/DELETE .../:id/charges[/:chargeId]` are fully
documented in Swagger, `@Roles(INSTITUTION_ADMIN)`-guarded, and scoped identically to the web
pages - an institution admin's Bearer token works against both.

### Institution reports (`/institution/reports`)
A payments report for the admin's own institution — every payment attempt (any status), filterable
by date range (`dateFrom`/`dateTo`), `status`, and `schoolId` (contains match), paginated. There's
no `:id` in this URL to guess: it's always scoped to the caller's own `institutionId` straight from
their token, which is a stronger guarantee than the usual `assertReviewerAccess` check (there is
nothing to enumerate). Each row shows the amount received in the institution's own currency
alongside, when the payment was cross-border, the send currency, FX rate, converted amount, and
fee the student paid on top. Each `COMPLETED` row links to its [receipt](#receipts).

**Export CSV** downloads the same filtered result set, unpaginated, as `text/csv`
(`GET /reports/institution/export`) — one row per payment: payment id, student, school ID,
description, charges covered, amount received (institution currency), institution currency, send
currency, FX rate, converted amount, fee amount, status, initiated/reviewed timestamps. The last
four FX columns are blank for a payment with no cross-border data. The JSON list view lives at
`GET /reports/institution`, same filters, `{ items, meta }` paginated shape,
`@Roles(INSTITUTION_ADMIN)`-guarded, fully documented in Swagger.

### Pagination
Every list page that can realistically grow past a screenful — `/admin/institutions`,
`/admin/students`, `/admin/payments`, `/institution/students`, `/institution/records`,
`/institution/payments`, `/institution/reports` — is paginated server-side (`?page=`, 20 per page
by default), with a Prev/Next control at the bottom of each table showing the current page and
total count. The matching JSON list endpoints (`GET /students`, `GET /institutions`,
`GET /institutions/:id/students`, `GET /school-financial-records`, `GET /payments/pending`,
`GET /reports/institution`) accept `page`/`pageSize` query params and return
`{ items, meta: { total, page, pageSize, totalPages } }` instead of a bare array. Stat tiles
(institution/student/pending-KYC counts) are computed as separate scalar queries, not derived from
a page of results, so they stay accurate regardless of how many pages exist.

---

## Auth mechanics (what's actually happening under the hood)

- The web UI uses **httpOnly cookies** (`access_token`, `refresh_token`), set on login/register,
  cleared on logout. You cannot read them from browser JS by design.
- The JSON API (Swagger, or any external client) uses the same tokens as a **Bearer header**
  instead — `POST /auth/login` returns `{ accessToken, refreshToken, expiresIn, role }` in the
  response body rather than cookies.
- Every request (web and API) is checked against the same `RolesGuard`/`@Roles()` logic — the web
  guard just resolves the actor from a cookie instead of a header, then the exact same role check
  runs either way.
- One exception: `JwtStrategy` (the Bearer-guarded strategy used by `/payments/*`, `/finance/me`,
  `/notifications/*`, `/reports/*`, and every other `JwtAuthGuard`-protected JSON route) reads the
  access token from the `Authorization` header **or**, failing that, from the `access_token`
  cookie. This is what lets the Payments page's popup call `POST /payments/initiate` /
  `:id/confirm` / `:id/cancel` directly with `fetch()`, the record-detail page's charge
  edit/delete calls `PATCH`/`DELETE /school-financial-records/...` directly, and a plain
  `<a href="/payments/:id/receipt">` or `<a href="/reports/institution/export">` link trigger a
  same-origin download - the cookie is `httpOnly`, so page JS can never construct a Bearer header
  itself, but it's still sent automatically on a same-origin request. Verification and `@Roles()`
  are identical either way; only where the token came from differs. This is the same trust
  boundary every other cookie-authenticated request in this app already has (no CSRF token
  anywhere, relying on `SameSite=Lax` cookies) - just extended to routes that also serve as a
  real, Bearer-testable JSON API.
- Refresh tokens are single-use and tracked in Postgres (`RefreshToken` table, not an in-memory
  cache): logging out or refreshing revokes the row immediately, so a stolen/reused token stops
  working the moment the legitimate session moves on.
- A 401 (not logged in / expired token) redirects the browser to `/login`. A 403 (logged in, wrong
  role, or wrong institution) renders a "Forbidden" page instead of leaking data or crashing.

---

## Design system

Server-rendered EJS views styled with Tailwind CSS, loaded via CDN script + an inline
`tailwind.config` (colours, spacing, radius, and a named type scale) — still no build step, no
frontend framework, just a `<script>` tag shared by every page through `views/partials/head.ejs`.
The palette and type scale ("Soft Corporate Security": deep indigo/slate primary, Plus Jakarta
Sans headlines, Inter body text, JetBrains Mono for reference IDs/amounts, Material Symbols
icons) come from a design spec supplied for this pass; every view was rebuilt against it.

Shared partials carry the system everywhere so no page reinvents it:
- `partials/head.ejs` — the Tailwind config + Google Fonts/Material Symbols links, included in
  every `<head>`.
- `partials/nav.ejs` — the sticky top nav (role-aware links, the student unread-notification
  badge, account menu, logout form) - unchanged in behaviour, restyled.
- `partials/footer.ejs` — the consistent footer every page ends with.
- `partials/badge.ejs` — one place mapping every status string (payment/KYC/charge state) to its
  semantic pill color, so `COMPLETED`, `APPROVED`, etc. always render identically everywhere.
- `partials/pagination.ejs` — prev/next + numbered page buttons, still driven purely by the same
  `{ meta, baseUrl }` every paginated page already passed in - no backend change.
- `partials/payment-review-drawer.ejs` — a slide-in side panel (open via a "Review" button, close
  via the × / overlay / Escape) that both `/institution/payments` and `/admin/payments` include,
  parameterized by which base URL their review POST goes to. It replaced the old inline
  per-row approve/reject form with a fuller transaction-detail view (charges, FX breakdown when
  the payment was cross-border, phone number) but submits to the exact same
  `POST .../:id/review` endpoint with the same `status`/`note` fields as before - a real HTML
  form, not a fetch call, so it degrades the same way on error as everywhere else in this app.

Two small, real (non-visual) changes came out of this pass:
- **`/dashboard`** now also loads the student's balance and KYC status (via the same
  `FinanceService`/`StudentsService` methods `/payments` and `/kyc` already used) so its bento
  layout can show a real "Total Outstanding Balance" tile and recent activity instead of a bare
  profile form.
- **The JSON notifications list endpoint moved from `GET /notifications` to
  `GET /notifications/list`.** Both it and the student's `/notifications` *web page* were
  registered at the exact same path - Express only ever reaches whichever route registers first,
  so the web page had been silently unreachable. Moving the JSON route's path is the fix (see the
  [Notifications](#notifications-notifications) section above).

Layout collapses gracefully on narrow screens (stacked bento cards, wrapping nav, a two-column
stat grid). Every other behavior, route, and field name is unchanged from before this pass.

---

## What isn't here yet

Gaps found and deliberately left out of this pass — not oversights, just out of scope for the
current MVP:

- **No real MTN MoMo integration.** The `PaymentPartner` interface is now formalized and actually
  used (via a `PAYMENT_PARTNER` DI token) rather than sitting unused - but the only implementation
  is `SimulatedPartner`, which still does everything in-process with no real request ever leaving
  the app. `payment-partners/mtn-momo/` is still an empty placeholder module. Wiring a real adapter
  in means implementing `PaymentPartner` and rebinding the token - `PaymentsService` shouldn't need
  to change at all.
- **An `INITIATED` payment left open indefinitely never expires.** If a student starts a payment
  and closes the tab without clicking Done or Cancel, that charge stays stuck showing "Payment
  pending" until they come back to `/payments` and explicitly cancel it (no auto-expiry/cron
  cleanup exists).
- **No partial payments.** A payment always covers the full amount of whichever charge(s) it's
  attached to - there's no way to pay part of a charge.
- **No password change or account recovery**, for any role. If you forget a password, the only
  fix today is re-seeding (platform admin) or having a platform admin recreate the account
  (institution admin) — students have no reset path at all.
- **No institution/institution-admin editing or deactivation.** Platform admins can create, not
  update or delete, either.
- **`AuditLog` has no UI or API surface.** It's written on every payment transition (see
  [Payment architecture](#payment-architecture-payment-partner-abstraction--audit-trail)) but
  nothing lets an admin browse it yet - it exists purely as an internal, append-only record for
  now.
