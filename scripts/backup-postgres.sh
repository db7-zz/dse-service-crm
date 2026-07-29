#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIRECTORY:?BACKUP_DIRECTORY is required}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${BACKUP_DIRECTORY}/dse_crm_${timestamp}.dump"

mkdir -p "${BACKUP_DIRECTORY}"
pg_dump --format=custom --no-owner --no-privileges --file="${destination}" "${DATABASE_URL}"
sha256sum "${destination}" > "${destination}.sha256"
echo "Backup created: ${destination}"

