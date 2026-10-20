# Sri Balaji Organic Farms — Business Operations CRM

A persistent, connected local prototype for Anandaraj's Chennai egg distribution business. React + TypeScript + Vite, Express and Node's built-in SQLite. Requires **Node.js 24+**.

```powershell
npm install
npm run dev
```

Open http://localhost:3000/dashboard. Phone preview: http://localhost:3000/mobile-preview.html.

```powershell
npm run db:migrate
npm run db:seed
npm run typecheck
npm run lint
npm test
npm run build
```

`lint` is a targeted UTF-8/source hygiene check, not ESLint. Typecheck covers semantic and syntax checking. Tests use isolated disposable databases.

Read the [delivery status](docs/DELIVERY.md), [architecture](docs/ARCHITECTURE.md), and [repository audit](docs/AUDIT.md) for exact implementation scope and remaining limitations.

## Database and recovery

First startup creates `data/crm.sqlite`, backs up/imports the previous `data/state.json` if present, then adds internally reconciled demo history. Legacy records remain. Fresh seeds include 30 customers, 120 historical orders, 6 suppliers, 5 drivers, 4 products, 3 warehouses, receipts, invoices, allocations, trips, tasks, expenses and simulated messages. New seed contacts use fictional numbers.

```powershell
npm run db:backup
# Stop the app first. Reset archives the current database:
npm run db:reset -- --confirm-reset
```

Restore: stop the app; retain the current database and any WAL/SHM files together; restore a verified standalone backup as `data/crm.sqlite`; restart. Never restore over an actively used database. Backup uses SQLite VACUUM INTO.

## Environment and compiled serving

See `.env.example`. Environment variables are not automatically loaded from `.env`; use `node --env-file=.env server.js` or set them in your shell.

| Variable | Default | Purpose |
|---|---|---|
| PORT | 3000 | HTTP port |
| HOST | 127.0.0.1 | Local bind; Docker sets 0.0.0.0 |
| DATABASE_PATH | data/crm.sqlite | Database file |
| DEMO_MODE | true | Explicit role switching and local automatic session |
| ADMIN_PASSWORD | none | Private 12+ character value required when demo mode is false |
| COOKIE_SECURE | false | Use true behind verified HTTPS |
| NODE_ENV | development | production serves compiled dist |

After building, set NODE_ENV to production and run `npm start` to serve compiled assets. Dockerfile is supplied for deployment preparation. Docker/Ubuntu/Nginx/HTTPS deployment has **not** been executed or certified. Persist `/app/data`, disable demo mode and provide private authentication configuration before any external exposure.

SQLite is a local prototype choice. Expanded PostgreSQL migration, external job workers and production staff credential enrollment remain deployment work.

## Simulation and accounting boundary

WhatsApp is entirely simulated. Live GPS, banking settlement, photo/signature/OTP uploads and cloud file storage are not connected. The local scheduler runs only while the server is running. Profit is explicitly estimated under the confirmation-invoicing/cost snapshot policy. Browser printing supports saving PDF; XLSX export and standalone server-generated PDF files are not included.
