#!/usr/bin/env bash
# Weekly logical backup of the JobSentinel database (docs 11 §2, 14 §5).
# Requires: pg_dump (PostgreSQL client tools) and DATABASE_DIRECT_URL in the environment or root .env.
# Optional: AGE_RECIPIENT (age public key) to encrypt the dump; BACKUP_DIR (default ./backups).
#
# Usage:  scripts/backup.sh            # creates backups/jobsentinel-YYYYmmdd-HHMM.sql.gz[.age]
# Restore: gunzip -c backups/<file>.sql.gz | psql "$DATABASE_DIRECT_URL"
#          (for .age files: age -d -i key.txt <file> | gunzip -c | psql "$DATABASE_DIRECT_URL")
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DATABASE_DIRECT_URL:-}" && -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^DATABASE_DIRECT_URL=' "$ROOT/.env" | xargs)
fi
: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required}"
command -v pg_dump >/dev/null || { echo "pg_dump not found — install PostgreSQL client tools"; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BACKUP_DIR/jobsentinel-$STAMP.sql.gz"

# Only our schema; Supabase-managed schemas (auth, storage) are excluded — users are re-linked by id on restore.
pg_dump "$DATABASE_DIRECT_URL" --schema=public --no-owner --no-privileges --format=plain | gzip -9 > "$OUT"

if [[ -n "${AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null || { echo "age not found — install https://age-encryption.org"; exit 1; }
  age -r "$AGE_RECIPIENT" -o "$OUT.age" "$OUT" && rm -f "$OUT"
  OUT="$OUT.age"
fi

# Keep the last 8 backups.
ls -1t "$BACKUP_DIR"/jobsentinel-*.sql.gz* 2>/dev/null | tail -n +9 | xargs -r rm -f
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
