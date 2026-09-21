# Legacy Removal Plan (Batch D)

How to retire the legacy Express + MongoDB + Baileys app **after** the platform
has carried production traffic for a soak period. This is a destructive, staged
operation — do not start until the preconditions below hold.

> Do the cutover first, per [`CUTOVER_PLAYBOOK.md`](./CUTOVER_PLAYBOOK.md), and
> deploy per [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md). This plan is the
> last step, not part of the cutover.

---

## 1. Preconditions (all must be true)

1. `VITE_API_V1=true` in production with **every domain enabled** (no
   `VITE_API_V1_DOMAINS` restriction) and every domain has soaked for the agreed
   window with no rollback.
2. All **functional blockers** in §3 are resolved (platform implementations or
   deliberately retired).
3. A **pre-removal backup** exists and has been restore-tested
   (`platform/scripts/backup-postgres.sh`), plus a MongoDB dump and a snapshot of
   the upload directory.
4. The last legacy deploy is frozen (no new writes are being introduced by an
   old image), and the platform has been the system of record long enough that
   any in-flight legacy data has been drained.
5. A rollback path exists: keep the pre-removal git tag, the last legacy image,
   and the MongoDB snapshot until decommission is declared final.

---

## 2. What "legacy" is

| Component | Location | Notes |
|---|---|---|
| Express server | `server.js`, `src/routes/*` (30 routers) | API surface being replaced |
| MongoDB models | `src/models/*` (28 models), `mongoose` | system of record **until** migration completes |
| Baileys transport | `src/whatsapp/*` (`transport.js`, `client.js`, `messageHandler.js`, `metaClient.js`) | replaced by Meta Cloud API on the platform |
| Legacy services/jobs | `src/services/*`, `src/jobs/*`, `src/queue/*`, `worker.js` | email, receipts, expiry, analytics, broadcast |
| Legacy client fallbacks | `client/src/db/helpers.js` legacy base, `apiRouting` legacy-only paths | removed once nothing routes to `/api` |
| Legacy deploy | `render.yaml`, root `Dockerfile`, legacy env vars | replaced by the platform stack |
| Legacy deps | `baileys`, `mongoose`, `multer`, legacy `pdfkit`, etc. | removed with the code |

---

## 3. Functional blockers (resolve before removal)

These still have **no platform equivalent**; either build them or explicitly
decide to retire the feature. Deleting now would break them.

- ~~`/products/bulk` CSV import~~ — **done**: platform endpoint with legacy
  column aliases.
- ~~`/auth/staff`~~ — **done**: no legacy route and no client caller; retired from
  the routing layer.
- ~~Admin server-only routes~~ — **done**: `/admin/queues` + `/dead-letters` ported;
  admin tenant **export** ported; tenant-wide **erase** intentionally not ported
  (subject-scoped `/privacy/erase` is the supported path).
- **Historical data**: MongoDB still holds pre-cutover records for every domain.
  Run identity/reconcile migrations and a final delta drain, and reconcile
  counts per domain before dropping Mongo (see §4.2).

---

## 4. Removal sequence

Each step is independently reversible until the Mongo snapshot is deleted.

### 4.1 Freeze and verify

- Confirm no `/api/*` (non-`v1`) requests in proxy logs for the soak window.
- Confirm platform error rate / latency within baseline.

### 4.2 Data reconciliation (do this before deleting anything)

```bash
# Idempotent identity/tenancy migration, then reconcile
MONGODB_URI=... DATABASE_URL=... pnpm --filter @uzanite/api migrate:identity
MONGODB_URI=... DATABASE_URL=... pnpm --filter @uzanite/api migrate:reconcile
```

Compare per-domain row counts (orders, payments, contacts, staff, expenses,
purchases, debts) between Mongo and PostgreSQL. Investigate any gap before
proceeding. Export any Mongo-only data that has no platform home.

### 4.3 Retire client legacy paths

- Remove `LEGACY_ONLY_PREFIXES` (once `/products/bulk` and `/auth/staff` are
  handled) and the legacy base URL branches from `client/src/utils/apiRouting.ts`.
- Remove the legacy base from `db/helpers.js` / `db/sync.js` once `resolveApiUrl`
  always resolves to the platform.
- Ship the client change and verify no `/api/*` calls remain (Network tab).

### 4.4 Point the edge fully at the platform

- Remove the legacy upstream (`express_api`) from `platform/gateway/nginx.conf`.
- Route `/api/v1/*` to the platform and drop the legacy `/api/*` fallback.
- Retire the legacy service in `render.yaml` (and any legacy host/secret).

### 4.5 Remove the runtime

- Stop the legacy service; remove its environment variables and secrets.
- Take the final MongoDB dump, verify it restores, then decommission the cluster.
- Remove the Baileys session storage and upload directory after migrating any
  remaining files to platform storage.

### 4.6 Delete the code

- Delete `src/`, `server.js`, legacy `Dockerfile`, and legacy-only scripts.
- Remove legacy dependencies (`baileys`, `mongoose`, legacy `pdfkit`/`qrcode` if
  unused, `multer` if only legacy used it) from `package.json` and refresh the
  lockfile.
- Keep git history; tag the removal commit (`legacy-removal-v1`).

---

## 5. Rollback

| Stage | Rollback |
|---|---|
| Client legacy-path removal | Revert the client release |
| Proxy re-point | Restore `express_api` upstream and `/api/*` fallback |
| Post-code-deletion | Checkout the pre-removal tag and redeploy the last legacy image; restore the MongoDB snapshot and re-run the legacy service |

Once the MongoDB snapshot and legacy image are deleted, rollback is no longer
possible — that is the point of no return, so delete them only after a final
sign-off.

---

## 6. Verification checklist

- [ ] No `/api/*` (non-`v1`) traffic in proxy logs for the whole soak window.
- [ ] Per-domain Mongo↔PostgreSQL counts reconciled; deltas explained.
- [ ] Every client call resolves to `/api/v1` (Network tab, all pages).
- [ ] Login, one write per domain, broadcasts, chat, and a receipt download
      succeed on the platform.
- [ ] Backups: PostgreSQL verified, MongoDB dump verified, uploads snapshotted.
- [ ] Pre-removal tag and legacy image preserved until final sign-off.
