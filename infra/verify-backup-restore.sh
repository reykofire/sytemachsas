#!/bin/sh
set -eu

dump_path="${1:?Usage: verify-backup-restore.sh /backups/file.dump}"

initdb -D "$PGDATA" -U postgres >/dev/null
pg_ctl -D "$PGDATA" -w start >/dev/null
cleanup() {
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

createuser -U postgres hardsystem
createdb -U postgres restore_test
pg_restore -U postgres -d restore_test --exit-on-error "$dump_path"

psql -U postgres -d restore_test -At <<'SQL'
SELECT 'users=' || count(*) FROM users;
SELECT 'tickets=' || count(*) FROM tickets;
SELECT 'products=' || count(*) FROM products;
SQL
