#!/bin/sh
# Container entrypoint.
#
# Migrations are opt-in (RUN_MIGRATIONS=true) so several replicas can start without
# racing each other; apply them once per deployment instead.
set -eu

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo '{"level":"info","module":"entrypoint","outcome":"started","msg":"applying database migrations"}'
  node dist/server/db/migrate.js
fi

exec "$@"
