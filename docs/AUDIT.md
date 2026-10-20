# Repository audit — 20 October 2026

Before implementation: React 19, Vite 7, JavaScript, Lucide, custom CSS. Express 5 served Vite and GET/PUT `/api/state`. All modules lived in `src/main.jsx`; screen navigation used component state rather than URL routes. No authentication, server authorization, database migrations, tests or backend business services existed. The only persisted data was `data/state.json`.

Working features: customer creation/search/consent, single-product orders, integer egg stock, dispatch assignment/completion, partial payments, CSV export, simulated follow-up messages, basic daily deduplication. Preserve the source data and working user journeys.

Defects: wholesale browser state overwrite; no concurrency protection; no reservation/on-hand distinction; editable payment totals without allocations; no immutable invoices; decorative date filter and sample sales chart; no procurement, supplier balances, partial fulfillment, cash reconciliation, configurable settings or RBAC; limited record details and routing. Existing old order payments and stock must migrate without being reposted or deducted again.

Implementation order: (1) SQLite migration and backup/import, validated transactional command service, RBAC and demo sessions; (2) shared routed responsive shell; (3) customers, orders/reservations, inventory, purchases/receipts, suppliers; (4) trips/stops, invoice ledger, payments/advances/reversals, expenses; (5) follow-ups, simulated durable outbox, campaigns; (6) server-derived metrics/reports/settings/staff; (7) scenario tests and visual QA.

Architecture decision: preserve React/Vite/Express. Node's built-in SQLite provides one authoritative relational database with WAL, foreign keys and transactional mutations without requiring a separately installed server. SQLite is a local prototype choice, not a claim of PostgreSQL/Redis production equivalence. Document any outstanding production and feature gaps in DELIVERY.md. Legacy JSON is retained and copied before migration. Money is integer paise; quantities are integer eggs.
