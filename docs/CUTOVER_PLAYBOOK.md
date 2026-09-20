# UZANITE Cutover Playbook

How to move a domain from the legacy Express + MongoDB app to the NestJS +
PostgreSQL platform **safely, one domain at a time**, with a fast rollback.

> Deployment mechanics (provisioning, proxy, migrations) live in
> [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md). Per-domain status lives in
> [`CUTOVER_COVERAGE.md`](./CUTOVER_COVERAGE.md).

---

## 1. How routing works

The client decides which base URL a request uses, at **build time**:

| Variable | Effect |
|---|---|
| `VITE_API_V1=false` (default) | Every request goes to legacy `/api` |
| `VITE_API_V1=true` | Domains below route to the platform `/api/v1` |
| `VITE_API_V1_DOMAINS=auth,billing` | When set, **only** these domains route; the rest stay legacy |

Domains are matched by path prefix (`auth`, `/auth`, `/auth/...`). The effective
list is compiled into the bundle by `client/src/utils/apiRouting.ts`.

The server side is fixed: the proxy sends **all** `/api/v1/*` to the platform and
everything else to legacy (see the routing table in the runbook). So the client
flag is what determines whether migrated traffic is sent to `/api/v1` at all.

Rollback is therefore always available and does **not** require touching data:

- **One domain:** remove it from `VITE_API_V1_DOMAINS` and redeploy the client.
- **Everything:** set `VITE_API_V1=false` and redeploy the client.

---

## 2. Preconditions (do not start without these)

1. Platform deployed and `GET /api/v1/ready` is green in the target environment.
2. Migrations applied; the CI drift gate is green on the release commit.
3. The proxy routes `/api/v1/*` to the platform (verified with an unauthenticated
   probe returning `401`, not `502`/`404`).
4. A **pre-cutover database backup** exists (runbook §7).
5. The **parity harness** is green for the domains you are about to enable:

   ```bash
   LEGACY_BASE=https://<legacy>/api \
   PLATFORM_BASE=https://<platform>/api/v1 \
   API_TOKEN=<token> \
   node platform/scripts/api-parity-check.mjs
   ```

6. Staging has already run the same domains with real traffic for at least one
   business day, with no 5xx spike.

---

## 3. Recommended rollout order

Read-only / low-blast-radius first; writes and money last.

| Order | Domain(s) | Why this position |
|---|---|---|
| 1 | `auth` | Everything depends on login; highest confidence, best observed |
| 2 | `tenants`, `billing`, `notifications`, `dashboard` | Read-mostly; no financial writes |
| 3 | `files`, `contacts`, `recycle-bin` | Writes, but scoped and easily reversible |
| 4 | `products` | Writes inventory; `/products/bulk` stays legacy-only |
| 5 | `staff` | Staff login + management; see the caveat in §6 |
| 6 | `admin/users`, `admin/sub-admins`, `admin/stats`, `admin/impersonate` | Admin panel user management. Only these sub-paths route; `/admin/feature-flags` and `/admin/activity-logs` stay legacy |
| 7 | `orders` | Order lifecycle + receipt PDFs. POS cash sales post to the platform and persist as PAID/DELIVERED |
| 8 | `payments` | Money movement — last, after everything above is stable |

Widen **one step per release**, with a soak period, not several domains at once.

---

## 4. Per-domain procedure

For each step (example: enabling `billing` on top of already-live `auth`):

1. **Set the scope** — `VITE_API_V1_DOMAINS=auth,billing` (list every currently
   enabled domain, not just the new one).
2. **Build & deploy the client.** Static deploy; no API changes.
3. **Smoke test the domain** in the target environment:
   - one read that renders (e.g. a plan/status page),
   - one representative write if the domain has one,
   - confirm the response shape in DevTools matches what the page expects.
4. **Watch for 10–15 minutes**: 5xx rate, `requestId`-tagged errors, p95 latency,
   429 spikes, outbox backlog. Compare against the pre-cutover baseline.
5. **Confirm legacy is untouched**: an unmigrated path (e.g. `/api/orders`)
   still behaves exactly as before.
6. **Record the change** (domain, release SHA, time, operator) so rollback is a
   one-line diff.

If any signal degrades, go to §5.

---

## 5. Rollback

Rollback is a client-scope change plus a redeploy. No database action is needed
for a routing rollback.

| Scope | Action |
|---|---|
| Single domain | Remove it from `VITE_API_V1_DOMAINS`, rebuild, redeploy |
| All domains | `VITE_API_V1=false`, rebuild, redeploy |
| Bad platform release (not routing) | Redeploy the previous **API** image; leave flags as-is |

After rollback, verify the affected pages load from legacy again and that no
requests are still hitting `/api/v1/<domain>` in the proxy logs.

> **Data written on the platform while a domain was live stays in PostgreSQL.**
> Routing rollback does not migrate those rows back to Mongo. Before enabling a
> **write-heavy** domain, confirm the platform is the intended system of record
> for it (it is, for every domain listed as READY in `CUTOVER_COVERAGE.md`).

---

## 6. Domain-specific caveats

- **auth** — both stacks share `JWT_SECRET` and identity aliases, so a token from
  either authenticates against both. Enabling `auth` moves login/refresh/me to
  the platform; legacy staff/Google/theme login stays on `/auth/staff`,
  `/auth/google`, `/auth/theme` (legacy-only).
- **products** — `/products/bulk` (CSV import) is legacy-only and remains so even
  when `products` is enabled.
- **admin** — the admin-panel **users** surface routes to the platform, but the
  admin **feature-flags** and **activity-logs/login-attempts** pages remain
  legacy (see `CUTOVER_COVERAGE.md`). Platform admin endpoints require TOTP MFA
  on the admin account (`AdminMfaGuard`); enable it before cutting over or the
  admin panel returns `mfa_setup_required`.
- **staff** — staff login is now served by the platform
  (`POST /api/v1/staff/login`). Staff sessions are **access-token only** (no
  refresh), so staff re-authenticate when the access token expires. Keep an eye
  on staff support tickets during the soak window.
- **payments / webhooks** — provider callbacks are idempotent on the platform
  (`/api/v1/payments/webhook`, `/api/v1/whatsapp/webhook`). Confirm the provider
  callback URLs are updated to the `/api/v1` paths **before** enabling payments,
  or callbacks will keep hitting legacy.

---

## 7. Staging → production

1. Run the full sequence in staging with a copy of production-like data.
2. Fix any shape/latency issues found (usually a client adapter, not a schema
   change).
3. Freeze writes or choose a low-traffic window for the first production step.
4. Repeat §4 in production, one step per release.
5. Keep the previous client build and previous API image pinned and ready to
   redeploy.

---

## 8. Completion

The migration is complete for a domain only when:

- it is listed **READY** in `CUTOVER_COVERAGE.md`,
- it has run in production for the agreed soak window with no rollback,
- and the legacy routes for it return `410 Gone` or are removed **in a later,
  separate change** (never in the same release that flips the flag).

Deleting the legacy app (Baileys, Mongo models, Express routes) is the **final**
step, after every domain is cut over — see the target architecture notes in
[`TARGET_ARCHITECTURE_ALIGNMENT.md`](./TARGET_ARCHITECTURE_ALIGNMENT.md).
