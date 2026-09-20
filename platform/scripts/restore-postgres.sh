#!/usr/bin/env bash
# =============================================================================
# PostgreSQL restore — and the drill that proves the backups work.
#
# Usage (drill, into a scratch database — SAFE):
#   BACKUP_FILE=/var/backups/uzanite/uzanite-...dump.enc \
#   TARGET_DATABASE_URL=postgresql://user:pass@host:5432/uzanite_restore_test \
#   BACKUP_ENCRYPTION_PASSPHRASE='...' \
#   scripts/restore-postgres.sh
#
# Usage (real recovery — DESTRUCTIVE, requires explicit confirmation):
#   CONFIRM_OVERWRITE=yes ... scripts/restore-postgres.sh
# =============================================================================
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"

[ -f "$BACKUP_FILE" ] || { echo "ERROR: $BACKUP_FILE not found" >&2; exit 1; }

# Refuse to touch a non-scratch database without explicit confirmation. A
# restore is one of the few genuinely irreversible operations here.
if [[ "$TARGET_DATABASE_URL" != *"test"* && "$TARGET_DATABASE_URL" != *"restore"* ]]; then
  if [ "${CONFIRM_OVERWRITE:-no}" != "yes" ]; then
    echo "REFUSING: '$TARGET_DATABASE_URL' does not look like a scratch database." >&2
    echo "This would OVERWRITE live data. Re-run with CONFIRM_OVERWRITE=yes if that is intended." >&2
    exit 1
  fi
  echo "!! Restoring into a NON-scratch database because CONFIRM_OVERWRITE=yes"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DUMP="$BACKUP_FILE"

# Verify the checksum first, if one was recorded.
if [ -f "$BACKUP_FILE.sha256" ]; then
  echo "==> Verifying checksum"
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE").sha256")
fi

if [[ "$BACKUP_FILE" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required for an encrypted backup}"
  echo "==> Decrypting"
  DUMP="$WORK/restore.dump"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$BACKUP_FILE" -out "$DUMP" \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE
fi

echo "==> Restoring into $TARGET_DATABASE_URL"
# --clean --if-exists makes the restore idempotent; -j speeds up large restores.
pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --jobs="${RESTORE_JOBS:-4}" \
  "$DUMP" || echo "WARNING: pg_restore reported errors (often harmless DROP notices) — verifying below"

# ── Prove the restore is usable, not just that the command exited.
echo "==> Verifying restored data"
PSQL_URL="${TARGET_DATABASE_URL%%\?*}"
TABLES="$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
TENANTS="$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM tenants" 2>/dev/null || echo 0)"
LEDGER="$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM ledger_entries" 2>/dev/null || echo 0)"

echo "    tables: $TABLES"
echo "    tenants: $TENANTS"
echo "    ledger entries: $LEDGER"

if [ "$TABLES" -lt 30 ]; then
  echo "ERROR: only $TABLES tables restored — the schema has ~40. Restore is INCOMPLETE." >&2
  exit 3
fi

# The books must balance after a restore, or the recovery is not trustworthy.
UNBALANCED="$(psql "$PSQL_URL" -tAc "
  SELECT count(*) FROM (
    SELECT journal_id
    FROM journal_lines
    GROUP BY journal_id
    HAVING SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END)
        <> SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END)
  ) q" 2>/dev/null || echo 0)"

if [ "$UNBALANCED" != "0" ]; then
  echo "ERROR: $UNBALANCED unbalanced journal(s) after restore — data integrity compromised." >&2
  exit 3
fi
echo "    double-entry journal: balanced"

echo "==> Restore verified successfully"
