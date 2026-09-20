# Disaster recovery

**Written for: whoever is on call when the database is gone.**

## Objectives

| Metric | Target | What delivers it |
|---|---|---|
| RPO (max data loss) | **5 minutes** | WAL archiving / managed PITR |
| RPO (logical backup only) | 24 hours | Nightly `backup-postgres.sh` |
| RTO (time to serve traffic) | **1 hour** | Verified restore + documented steps below |

The nightly dump alone gives a 24-hour RPO. For a system holding businesses'
money that is too much, so **WAL archiving or a managed PITR-capable service is
required**, not optional. The dump is the second line of defence and the thing
you use when the primary is fine but the *data* is wrong (a bad migration, a
mistaken bulk delete).

## What is protected

| Data | Where | Recovery |
|---|---|---|
| PostgreSQL (tenants, orders, payments, ledger, journal) | `backup-postgres.sh` + WAL | PITR, then this runbook |
| Redis (queues, rate limits, lockouts) | AOF, not backed up | Rebuilt from empty. Queued outbox events are in PostgreSQL, so nothing is lost — see below |
| Uploaded files | Object storage | Provider versioning/replication |
| Secrets (`JWT_SECRET`, `ENCRYPTION_KEY`) | Secret manager | **See the warning below** |

> **`ENCRYPTION_KEY` is not recoverable from a database backup.** Per-tenant
> Meta access tokens are encrypted with it. Restore the database with a
> different key and every tenant's WhatsApp integration stops working, with a
> `key_mismatch` decryption error. Store it in a secret manager with its own
> backup and rotation record, and treat losing it as a separate incident class.

Redis being empty after a restore is safe by design: the outbox lives in
PostgreSQL, the poller re-claims `pending` rows, and lease recovery returns
anything stuck in `processing`. Rate-limit counters and lockouts simply start
fresh.

## Nightly backup

Run from cron on a host that can reach the database:

```cron
# 02:15 UTC daily
15 2 * * * cd /srv/uzanite/platform && \
  DATABASE_URL="$UZANITE_OWNER_DATABASE_URL" \
  BACKUP_DIR=/var/backups/uzanite \
  BACKUP_ENCRYPTION_PASSPHRASE="$UZANITE_BACKUP_PASSPHRASE" \
  BACKUP_RETENTION_DAYS=30 \
  scripts/backup-postgres.sh >> /var/log/uzanite-backup.log 2>&1
```

The script refuses to keep a dump that fails `pg_restore --list` or that
contains fewer than 10 tables, and it prunes old backups only *after* a
successful verified run — so a failing job can never delete your last good copy.

**Ship the backups off-host.** A backup on the same machine as the database
does not survive the failure mode you are most likely to have. Sync
`/var/backups/uzanite` to object storage with versioning enabled.

## Monthly restore drill — mandatory

An untested backup is not a backup. Once a month:

```bash
createdb uzanite_restore_test
BACKUP_FILE=/var/backups/uzanite/uzanite-<latest>.dump.enc \
TARGET_DATABASE_URL=postgresql://user:pass@host:5432/uzanite_restore_test \
BACKUP_ENCRYPTION_PASSPHRASE="$UZANITE_BACKUP_PASSPHRASE" \
  scripts/restore-postgres.sh
dropdb uzanite_restore_test
```

The script verifies the checksum, restores, then asserts that ~40 tables exist
**and that the double-entry journal balances**. It exits non-zero if either
fails. Record the date and result; a drill that was never recorded did not
happen.

## Recovery procedure

1. **Stop writes.** Scale the API and worker to zero, or take the load balancer
   out of rotation. Restoring underneath a running writer produces a mess that
   is harder to diagnose than the original outage.

2. **Decide what you are recovering from.**
   - Infrastructure loss → restore to the latest PITR point.
   - Bad data (bad migration, bulk delete) → restore to a timestamp *before* the
     bad change. The exact timestamp matters; get it from the audit log or
     `activity_logs` rather than guessing.

3. **Restore.** Managed service: use its PITR to a new instance. Self-managed:
   restore the base backup, then replay WAL to the target time. Logical dump
   only: use `restore-postgres.sh` with `CONFIRM_OVERWRITE=yes`.

4. **Recreate the application role.** The dump is taken with `--no-owner`, so
   re-apply `prisma/sql/ci-roles.sql` to create `uzanite_app` with
   `NOBYPASSRLS` and its grants. **The API must not connect as the owner** — if
   it does, `PrismaService.assertRlsSafety()` refuses to boot in production,
   which is the intended behaviour, not a bug to work around.

5. **Verify before serving traffic.**
   ```bash
   curl -fsS "$API/api/v1/health"                            # → {"status":"ok"}
   curl -fsS "$API/api/v1/ready"                             # → postgres + redis up
   curl -fsS "$API/api/v1/ledger/reconciliation" -H "Authorization: Bearer $TOKEN" \
     | jq '.reconciliation | {balanced, unbalancedJournals}'  # → balanced: true
   ```
   Also confirm the boot log does **not** contain "RLS is not enforceable".

6. **Resume traffic**, then watch `uzanite_outbox_oldest_pending_seconds` and
   `uzanite_operator_actions_unread`. A backlog is expected briefly; it should
   drain.

7. **Write it up.** What broke, when, what data was lost, what the drill would
   have caught. Update this document.

## Known gaps

- WAL archiving is **not configured by these scripts**. It is a property of the
  database host or managed service and must be set up there.
- Point-in-time recovery has not been rehearsed against production-sized data;
  the RTO above is an estimate until it has been.
