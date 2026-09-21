# Run & Verify — Manual Inspection Guide

Step-by-step to bring UZANITE up locally and inspect it by hand (with optional
Playwright automation). Commands mirror what was used for the 2026-09-21 audit.

## 0. Prerequisites

- Node 20+, `pnpm` 9 (`corepack enable`), `npm`.
- PostgreSQL 16 and Redis 7 (this workspace already had them on `:5432`/`:6379`).
- Optional: `podman`/`docker` to run the **legacy** app's MongoDB.
- `jq` for tidy JSON (optional).

```bash
node -v && pnpm -v
(ss -ltn || netstat -ltn) | grep -E ':5432|:6379'   # expect Postgres + Redis
```

## 1. Platform environment

Create `platform/.env` (or export inline). Production-like values:

```bash
export DATABASE_URL='postgresql://uzanite_app:uzanite_app@localhost:5432/uzanite?schema=public'  # NON-owner, RLS-enforced
export REDIS_URL='redis://localhost:6379'
export RLS_ENABLED='true'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export STORAGE_SIGNING_SECRET="$(openssl rand -hex 32)"
export NODE_ENV='development'          # production disables /docs
export CORS_ORIGINS='http://localhost:5173,http://localhost:4173'
export PORT=4000
```

Migrations run as the **owner** (`uzanite`), the app runs as **`uzanite_app`**
(created by `apps/api/prisma/sql/ci-roles.sql` during CI/compose).

```bash
cd platform
pnpm install --frozen-lockfile
pnpm --filter @uzanite/contracts build
pnpm --filter @uzanite/api exec prisma generate
DATABASE_URL='postgresql://uzanite:uzanite@localhost:5432/uzanite?schema=public' \
  pnpm --filter @uzanite/api exec prisma migrate deploy
# optional bootstrap super admin:
BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_PASSWORD='ChangeMe123!' \
  pnpm --filter @uzanite/api prisma:seed
```

## 2. Start the API (and worker)

```bash
cd platform/apps/api
node dist/main.js           # or: pnpm --filter @uzanite/api start:dev
# worker (separate terminal):
pnpm --filter @uzanite/worker start:dev
```

Smoke-check (this is a **paste-able verification checklist**):

```bash
curl -s localhost:4000/api/v1/health              # {"status":"ok",...}
curl -s localhost:4000/api/v1/ready               # {"checks":{"postgres":"up","redis":"up"}}
curl -si localhost:4000/api/v1/health | grep -iE 'x-frame|content-security|permissions-policy|x-api-version'
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/v1/auth/me    # 401
```

Watch the log for `RLS safety check passed` and any `Database guard rails not set`
warning (set `statement_timeout`/`lock_timeout` via `ALTER ROLE` or the URL).

## 3. Start the client

Dev server (fastest, uses absolute API URLs so no proxy needed):

```bash
cd client
VITE_API_V1='true' \
VITE_API_URL='http://localhost:4000/api' \
VITE_PLATFORM_API_URL='http://localhost:4000/api/v1' \
npx vite --port 5173 --strictPort        # app at http://localhost:5173/admin/
```

Or a production build: `VITE_API_V1=true VITE_PLATFORM_API_URL=/api/v1 npm run build && npx vite preview --port 4173`.

## 4. Seed a usable tenant (no admin needed)

```bash
curl -s -X POST localhost:4000/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Audit Owner","businessName":"Audit Shop","email":"audit@example.com","password":"AuditPass1!"}'
# approve directly (dev only):
psql 'postgresql://uzanite:uzanite@localhost:5432/uzanite' -c \
  "UPDATE tenants SET status='approved' WHERE name='Audit Shop'; UPDATE users SET status='active' WHERE email='audit@example.com';"
```

## 5. (Optional) Run the legacy stack

```bash
podman run -d --name uzanite-mongo -p 27017:27017 mongo:7
export MONGODB_URI='mongodb://localhost:27017/uzanite' JWT_SECRET='...' PORT=3000
node server.js            # legacy API at :3000 (/api)
```

Then run the SPA with `VITE_API_V1=false` to exercise the legacy path, and
`VITE_API_V1=true` to exercise the platform path — compare behaviour.

## 6. Automated UI pass (Playwright)

With both servers up:

1. Navigate to `http://localhost:5173/admin/login.html`.
2. Snapshot; confirm SW/EN toggle and that the form has labelled inputs.
3. Fill `audit@example.com` / `AuditPass1!`, submit, expect `/admin/dashboard`.
4. Read console + network: any 4xx/5xx, any console error.
5. Resize to `360x640`, screenshot; check tap targets and overflow.
6. Repeat for Orders, Products, Expenses, Purchases, Debts, Reports, WhatsApp,
   Broadcast, Contacts; for each confirm the list loads and one write persists.

## 7. Manual inspection checklist (by area)

- **Auth/security headers**: `curl -si` shows Helmet headers; unauth → 401;
  wrong member → 403; other tenant's id → 404. Check `/api/v1/docs` is **absent**
  with `NODE_ENV=production`.
- **RLS**: `psql "$DATABASE_URL" -c '\d+ orders'` shows RLS enabled+forced; as
  `uzanite_app`, `SELECT count(*) FROM orders;` returns only the current tenant's
  rows (or 0 with no GUC), never another tenant's.
- **Rate limiting**: hammer `POST /api/v1/auth/login` (bad creds) 30× → 429 once
  the window trips; repeat with Redis stopped to confirm behaviour (currently
  fails **open** — see audit).
- **Idempotency**: replay `POST /orders` with the same `clientRef` → same order;
  replay a webhook → no duplicate credit.
- **Money**: create a cash order, then call confirm-payment — verify the ledger
  does **not** double-credit (see audit C3 before trusting this).
- **Plan limits**: create beyond the plan cap through the normal route and
  through `/products/bulk` and the WhatsApp flow to see if limits hold.
- **Pagination**: list Orders, page with `cursor`; confirm no duplicates/skips.
- **Offline/tenant isolation**: log in as tenant A, browse, log out, log in as
  tenant B on the same browser profile — confirm no A data flashes (audit C2).
- **Low bandwidth**: throttle to Slow 3G in devtools; check first paint, font/CDN
  requests, and that lists still paginate.

## 8. Teardown

```bash
pkill -f 'vite --port 5173'; pkill -f 'node dist/main.js'; podman rm -f uzanite-mongo
```

## 9. What "good" looks like

- Health/ready green, RLS assertion passed, no unbounded queries on dashboard.
- Every routed call reaches `/api/v1`; no legacy `/api` calls while `VITE_API_V1=true`.
- No console errors on the primary pages (watch the PWA manifest path).
- Money/stock/ledger invariants hold under replay and concurrency.
- No cross-tenant data in the UI, cache, or API responses.
