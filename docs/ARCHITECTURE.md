# Connected local prototype

The existing React/Vite/Express stack is retained. The new entry is `src/app.tsx`; legacy `src/main.jsx` and styles remain as source history but are not loaded. Routes use the History API with SPA fallback. Record deep links open contextual drawers.

## Backend authority

`backend/service.ts` owns commands and invariants. All UI writes use POST `/api/commands` with a CSRF token and idempotency key. The wholesale-state write endpoint is removed. Critical commands use SQLite BEGIN IMMEDIATE: orders, reservations, invoices, payments, fulfillment, outbox and audits commit together or roll back. Two actual independent processes racing for stock are tested against one database.

`backend/db.ts` handles parameterized statements, WAL, timeouts and migrations. Entities have separate tables with real foreign keys; extensible attributes use JSON columns. This is a pragmatic prototype schema, not the fully expanded PostgreSQL/Prisma schema in the master specification. Unique phones/numbers/event keys and immutable stock/audit triggers are enforced. Finalized invoice charges, items, date and business name cannot be overwritten.

## Transaction rules

- Money uses integer paise; stock uses integer eggs. Historical items snapshot tray size, prices and costs.
- On hand = signed physical movements. Available = on hand minus active reservations.
- Confirmation reserves eggs and finalizes an invoice without reducing physical stock.
- Dispatch consumes reservations, reduces physical stock and records in-transit quantities atomically.
- Partial delivery records exact quantities and manual recipient proof. Undelivered eggs return to the warehouse, reserved for rescheduling. Failed stops do not fail other stops.
- Cancellation preserves delivered history, blocks unresolved transit/overpayments, releases remaining reservations and posts invoice credits.
- Pre-fulfillment revision cancels/credits the original and creates a linked replacement atomically. Allocated original payments must first be reconciled.
- Only accepted goods receipts increase stock. Rejected/damaged quantities are separate. Approved supplier invoices create payables independently of receipts.
- Customer receipts allocate oldest invoices first or remain advances. Multiple allocations are supported; the UI allocates advances one invoice at a time. Reversal retains receipts while excluding allocations from balance queries.
- Supplier payments allocate to approved bills and never move stock.
- Driver cash remains pending until exact office verification posts one customer receipt. Differences are blocked for investigation.
- Damaged returns are quarantined, not saleable. Separate credit approval cannot exceed the unallocated invoice balance.

## Reporting scope

Perpetual weighted-average cost comes from movement value/quantity. Orders snapshot cost. Invoices are finalized on confirmation, so profit is explicitly an **operational estimate based on confirmed order cost**, including unfulfilled orders. It is not a statutory accrual/GST report or cash-profit calculation. Procurement and operating expenses are separated. Customer/product/area/aging report rows are derived by the backend. Product revenue allocation preserves invoice paise totals.

Date filters query backend transaction metrics and chart buckets. Stock, receivables, payables and advances are current balances, not historical as-of balances. Charts use actual transaction records.

## Communication

Outbox entries commit with business transactions. Providers never run before commit. `backend/communication.ts` defines the provider boundary; the official provider fails explicitly as unconfigured. UI delivery states, replies, STOP opt-out, campaigns and retry/failure controls are simulated.

Every minute the local process checks reorder rules: consent, customer pause, daily frequency, quiet hours, persisted deduplication and equivalent pending orders. New orders reset schedules. Due scheduled campaigns use the same queue; drafts run manually. No process means no scheduler. Redis/BullMQ and real WhatsApp are not connected.

## Access boundary

Random HttpOnly SameSite sessions, CSRF and origin checks, read/write role enforcement and authorized exports are implemented. Demo switching is explicit and disabled in password mode. Password mode requires a private environment password of 12+ characters, compares with scrypt/constant-time verification, and limits login attempts.

This is one business per installation. There is no tenant system, SSO, MFA, per-staff production credential enrollment or custom per-user permission overrides. Demo mode must not be publicly exposed. Production security readiness is not claimed.

## API

| Endpoint | Purpose |
|---|---|
| GET `/api/bootstrap` | Session, actor, permitted modules and available demo users |
| POST `/api/login`, `/api/logout` | Local administrator password session |
| POST `/api/demo/switch` | Explicit demo-only role switching |
| GET `/api/workspace?page=&from=&to=` | Authorized records, balances and filtered metrics/reports |
| POST `/api/commands` | Validated, authorized, atomic business operation |
| GET `/api/export?kind=&ids=` | Authorized CSV for currently filtered IDs |
| GET `/api/invoices/:id/print` | Finalized invoice and browser Print / Save as PDF |

Migration 1 creates schema and integrity constraints. Migration 2 repairs duplicate generated order numbers with a preserved `previousNumber`, adds unique number indexes, and backfills labelled historical fulfillment trips/stops without fabricating original POD. Legacy JSON and its pre-migration backup remain untouched. Foreign-key and SQLite integrity checks are tested.
