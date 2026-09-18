#!/usr/bin/env bash
# Local / operator Postgres dump. Output is ePHI — never commit or upload to CI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "backup:db: pg_dump not found on PATH."
  echo "Install PostgreSQL client tools, or dump from Docker:"
  echo "  mkdir -p backups"
  echo "  docker compose exec -T postgres pg_dump -U chirokpi --no-owner --no-acl chirokpi > backups/chirokpi-\$(date -u +%Y%m%dT%H%M%SZ).sql"
  echo "No dump was written."
  exit 0
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "backup:db: DATABASE_URL is not set. No-op."
  echo "Copy .env.example to .env or export DATABASE_URL, then re-run npm run backup:db."
  exit 0
fi

mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/chirokpi-${STAMP}.sql"

pg_dump --no-owner --no-acl --format=plain "$DATABASE_URL" > "$OUT"
echo "Wrote $OUT"
echo "This file may contain ePHI. Keep it off git, off CI, and in an encrypted volume."
echo "Restore drill: see docs/BACKUPS.md"
