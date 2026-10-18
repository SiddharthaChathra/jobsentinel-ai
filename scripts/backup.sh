#!/usr/bin/env bash
# Logical backup of the JobSentinel database (docs 11 §2, 14 §5; F10, D123).
#
# Requires pg_dump matching the server's major version (17) and DATABASE_DIRECT_URL — a session
# connection (Supabase session pooler, port 5432; the transaction pooler cannot run pg_dump) — in
# the environment or the root .env.
#
#   AGE_RECIPIENT       age public key. When set, the dump is streamed pg_dump | gzip | age
#                       straight into the .age file: the plain dump never touches the disk.
#   REQUIRE_ENCRYPTION  1 = refuse to run without AGE_RECIPIENT (the GitHub Action sets it).
#   BACKUP_DIR          default ./backups
#
# What is in it: the public and drizzle schemas (all tables, data, policies, and the migration
# ledger, so `pnpm db:migrate` knows where it stands), plus the rows of auth.users and
# auth.identities, so restored users can still sign in. NOT in it: Supabase Storage files
# (resumes) — see docs/deployment.md "Backups".
#
# Restore: docs/deployment.md "Backups" (age -d -i key.txt <file> | gunzip -c | psql "$TARGET").
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DATABASE_DIRECT_URL:-}" && -f "$ROOT/.env" ]]; then
  DATABASE_DIRECT_URL="$(grep -E '^DATABASE_DIRECT_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
  export DATABASE_DIRECT_URL
fi
: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required}"
command -v pg_dump >/dev/null || { echo "pg_dump not found — install PostgreSQL client tools" >&2; exit 1; }

if [[ "${REQUIRE_ENCRYPTION:-0}" == "1" && -z "${AGE_RECIPIENT:-}" ]]; then
  echo "REQUIRE_ENCRYPTION=1 but AGE_RECIPIENT is empty: refusing to write an unencrypted dump" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M)"
OUT="$BACKUP_DIR/jobsentinel-$STAMP.sql.gz"
[[ -n "${AGE_RECIPIENT:-}" ]] && OUT="$OUT.age"
# A failed run leaves no partial file behind.
trap 'rm -f "$OUT"' ERR

dump() {
  # Auth rows first: on restore they must exist before public.users' foreign key is created.
  pg_dump "$DATABASE_DIRECT_URL" --data-only --table=auth.users --table=auth.identities \
    --no-owner --no-privileges --format=plain
  # Extensions are not part of a schema dump; the trigram indexes need this one (migration 0000).
  echo 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;'
  pg_dump "$DATABASE_DIRECT_URL" --schema=public --schema=drizzle \
    --no-owner --no-privileges --format=plain
}

if [[ -n "${AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null || { echo "age not found — install https://age-encryption.org" >&2; exit 1; }
  dump | gzip -9 | age -r "$AGE_RECIPIENT" -o "$OUT"
  # An age file starts with this header line; anything else means encryption did not happen.
  head -c 21 "$OUT" | grep -q '^age-encryption.org/v1' || { echo "output is not an age file" >&2; rm -f "$OUT"; exit 1; }
else
  dump | gzip -9 > "$OUT"
fi
trap - ERR

# Keep the last 8 backups in this directory.
ls -1t "$BACKUP_DIR"/jobsentinel-*.sql.gz* 2>/dev/null | tail -n +9 | xargs -r rm -f
echo "backup written: $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
