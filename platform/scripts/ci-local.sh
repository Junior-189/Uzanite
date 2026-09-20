#!/usr/bin/env bash
# =============================================================================
# UZANITE platform CI — single source of truth for GitHub Actions and local runs.
#
# Mirrors .github/workflows/platform-ci.yml. Run from anywhere:
#
#   DATABASE_URL=... TEST_DATABASE_URL=... TEST_APP_DATABASE_URL=... \
#   SHADOW_DATABASE_URL=... JWT_SECRET=... bash scripts/ci-local.sh
#
# Set SKIP_INSTALL=1 to skip `pnpm install --frozen-lockfile` (already installed).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
: "${TEST_APP_DATABASE_URL:?TEST_APP_DATABASE_URL is required}"
: "${SHADOW_DATABASE_URL:?SHADOW_DATABASE_URL is required}"
: "${JWT_SECRET:?JWT_SECRET is required}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# Prisma URLs carry a `?schema=public` query string that psql rejects; strip it.
pg_url() { printf '%s' "${1%%\?*}"; }

step "Install dependencies"
if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  pnpm install --frozen-lockfile
fi

step "Build shared packages"
pnpm --filter @uzanite/contracts build
pnpm --filter @uzanite/messaging build

step "Prisma generate + validate"
pnpm --filter @uzanite/api exec prisma generate
pnpm --filter @uzanite/api exec prisma validate

step "Schema drift check (migrations must match schema.prisma)"
psql "$(pg_url "$DATABASE_URL")" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS shadow;" >/dev/null
psql "$(pg_url "$DATABASE_URL")" -v ON_ERROR_STOP=1 -c "CREATE DATABASE shadow;" >/dev/null
pnpm --filter @uzanite/api exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code

step "Create non-owner app role (RLS) before migrations"
psql "$(pg_url "$TEST_DATABASE_URL")" -v ON_ERROR_STOP=1 -f apps/api/prisma/sql/ci-roles.sql >/dev/null

step "Apply migrations"
pnpm --filter @uzanite/api exec prisma migrate deploy

step "Re-grant privileges on migrated tables"
psql "$(pg_url "$TEST_DATABASE_URL")" -v ON_ERROR_STOP=1 -f apps/api/prisma/sql/ci-roles.sql >/dev/null

step "Typecheck"
pnpm -r typecheck

step "Tests (unit + integration)"
# Integration suites share one database; run workspace packages serially.
pnpm -r --workspace-concurrency=1 test

step "Build"
pnpm -r build

printf '\n\033[1;32m✅ CI pipeline passed\033[0m\n'
