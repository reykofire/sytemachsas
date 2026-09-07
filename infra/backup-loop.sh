#!/bin/sh
set -eu

mkdir -p /backups
interval="${BACKUP_INTERVAL_SECONDS:-86400}"

while true; do
  timestamp="$(date +%Y%m%d-%H%M%S)"
  temporary="/backups/.hardsystem-${timestamp}.dump.tmp"
  destination="/backups/hardsystem-${timestamp}.dump"

  rm -f "$temporary"
  if pg_dump --format=custom --file="$temporary" && test -s "$temporary" && pg_restore --list "$temporary" >/dev/null; then
    mv "$temporary" "$destination"
    date +%s > /backups/.last-success
    find /backups -type f -name "*.dump" -mtime +14 -delete
    echo "Verified backup created: $destination"
  else
    rm -f "$temporary"
    echo "Backup creation or validation failed" >&2
  fi

  sleep "$interval"
done
