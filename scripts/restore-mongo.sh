#!/usr/bin/env bash
# Restore MongoDB from a compressed archive.
# Usage: MONGODB_URI="mongodb+srv://..." scripts/restore-mongo.sh <archive.gz> [--drop]
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is required}"
ARCHIVE="${1:?Usage: restore-mongo.sh <archive.gz> [--drop]}"
DROP_FLAG="${2:-}"

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "mongorestore not found. Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
fi

if [[ "$DROP_FLAG" == "--drop" ]]; then
  echo "WARNING: --drop will delete existing collections before restoring."
fi

mongorestore --uri="$MONGODB_URI" --archive="$ARCHIVE" --gzip $DROP_FLAG
echo "Restore complete from $ARCHIVE"
