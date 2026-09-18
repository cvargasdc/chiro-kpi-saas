#!/usr/bin/env bash
# DANGER: restores a pg_dump over DATABASE_URL. This DESTROYS current data.
# Usage: CONFIRM=YES DATABASE_URL=... ./scripts/restore-db.sh backups/chirokpi-YYYYMMDDTHHMMSSZ.sql
set -euo pipefail

echo "WARNING: restore-db.sh overwrites the target database."
echo "This is a drill/recovery tool, not a merge. Wrong DATABASE_URL = wrong tenant data."
echo

if [ "${CONFIRM:-}" != "YES" ]; then
  echo "Refusing to run. Re-run with CONFIRM=YES and an explicit dump file."
  echo "Example:"
  echo "  CONFIRM=YES DATABASE_URL=postgres://... ./scripts/restore-db.sh backups/chirokpi-20260101T000000Z.sql"
  exit 1
fi

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: CONFIRM=YES ./scripts/restore-db.sh <dump.sql>"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Restore via Docker instead:"
  echo "  docker compose exec -T postgres psql -U chirokpi -d chirokpi < $DUMP"
  exit 1
fi

echo "Restoring $DUMP into DATABASE_URL (credentials redacted)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DUMP"
echo "Restore finished. Run a tenant isolation check (npm test) against a copy, not production, before declaring success."
