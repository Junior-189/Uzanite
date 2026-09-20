#!/usr/bin/env bash
# Backup MongoDB to a compressed archive.
# Usage: MONGODB_URI="mongodb+srv://..." [BACKUP_DIR=./backups] scripts/backup-mongo.sh
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is required}"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/uzanite-$STAMP.archive.gz"

if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump not found. Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
fi

mongodump --uri="$MONGODB_URI" --archive="$FILE" --gzip
echo "Backup written to $FILE"
