#!/usr/bin/env bash
# =============================================================================
# PostgreSQL logical backup with integrity verification.
#
# Before M13 there was NO PostgreSQL backup capability at all: no script, no
# WAL archiving, no restore runbook. For a system holding the money ledger of
# real businesses, that was the single largest operational gap in the audit.
#
# This produces a compressed, encrypted, verified custom-format dump. It is the
# baseline; see docs/DISASTER_RECOVERY.md for the point-in-time recovery setup
# that must sit alongside it for a recovery point measured in minutes rather
# than hours.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/db \
#   BACKUP_DIR=/var/backups/uzanite \
#   BACKUP_ENCRYPTION_PASSPHRASE='...' \
#   scripts/backup-postgres.sh
#
# Exit codes: 0 ok, 1 configuration error, 2 dump failed, 3 verification failed.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

for tool in pg_dump pg_restore; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "ERROR: $tool not found. Install the PostgreSQL client tools." >&2
    exit 1
  }
done

mkdir -p "$BACKUP_DIR"
BASE="$BACKUP_DIR/uzanite-$STAMP"
DUMP="$BASE.dump"

echo "==> Dumping to $DUMP"
# Custom format (-Fc): compressed, and restorable selectively with pg_restore.
# --no-owner/--no-privileges so a restore into a differently-owned database
# (the common case in a real recovery) does not fail on role mismatches.
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$DUMP" || {
  echo "ERROR: pg_dump failed" >&2
  exit 2
}

# ── Verify the dump is readable BEFORE we rely on it.
# An unverified backup is not a backup. `pg_restore --list` parses the whole
# archive header and TOC, so a truncated or corrupt file fails here rather than
# during an incident.
echo "==> Verifying archive integrity"
if ! pg_restore --list "$DUMP" >/dev/null 2>&1; then
  echo "ERROR: dump failed verification — refusing to keep a corrupt backup" >&2
  rm -f "$DUMP"
  exit 3
fi

TABLE_COUNT="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
echo "    archive readable, $TABLE_COUNT table(s) with data"
if [ "$TABLE_COUNT" -lt 10 ]; then
  echo "ERROR: only $TABLE_COUNT tables in the dump — the schema has ~40. Refusing." >&2
  rm -f "$DUMP"
  exit 3
fi

# ── Encrypt at rest. Backups contain every tenant's customer PII and financial
# records, so an unencrypted archive on disk or in object storage is a breach
# waiting for a misconfigured bucket.
FINAL="$DUMP"
if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  if command -v openssl >/dev/null 2>&1; then
    echo "==> Encrypting (AES-256)"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -in "$DUMP" -out "$DUMP.enc" \
      -pass env:BACKUP_ENCRYPTION_PASSPHRASE
    rm -f "$DUMP"
    FINAL="$DUMP.enc"
  elif [ "${ALLOW_UNENCRYPTED_BACKUP:-}" = "true" ]; then
    echo "WARNING: openssl not found — backup left UNENCRYPTED" >&2
  else
    echo "ERROR: openssl not found and ALLOW_UNENCRYPTED_BACKUP != true — refusing to write an unencrypted backup" >&2
    rm -f "$DUMP"
    exit 4
  fi
else
  # Fair warning by default: backups contain every tenant's PII and financial
  # records, so an unencrypted archive is a breach risk.
  if [ "${ALLOW_UNENCRYPTED_BACKUP:-}" = "true" ]; then
    echo "WARNING: BACKUP_ENCRYPTION_PASSPHRASE not set — backup is UNENCRYPTED" >&2
  else
    echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE not set — refusing to write an unencrypted backup (set ALLOW_UNENCRYPTED_BACKUP=true to override)" >&2
    rm -f "$DUMP"
    exit 4
  fi
fi

# Checksum so corruption in transit or at rest is detectable later.
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$FINAL" > "$FINAL.sha256"
fi

SIZE="$(du -h "$FINAL" | cut -f1)"
echo "==> Backup complete: $FINAL ($SIZE)"

# ── Retention. Applied only after a successful, verified backup, so a failing
# job never deletes the last good copy.
if [ "$RETENTION_DAYS" -gt 0 ]; then
  echo "==> Pruning backups older than $RETENTION_DAYS day(s)"
  find "$BACKUP_DIR" -maxdepth 1 -name 'uzanite-*.dump*' -type f -mtime "+$RETENTION_DAYS" -print -delete || true
fi

echo "==> Reminder: a backup you have never restored is not a backup."
echo "    Run scripts/restore-postgres.sh against a scratch database monthly."
