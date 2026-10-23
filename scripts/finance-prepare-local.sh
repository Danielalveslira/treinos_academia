#!/usr/bin/env bash
# No URL or environment credentials accepted. Only a fresh fixed synthetic container.
set -euo pipefail
cd "$(dirname "$0")/.."
container=evolutus_finance_clean
phase=${1:-baseline}
if [ "$phase" = baseline ]; then
 if docker inspect "$container" >/dev/null 2>&1; then echo 'Container already exists: refusing to overwrite'; exit 1; fi
 docker run -d --name "$container" --cpus 0.75 --memory 1g --memory-swap 2g \
   -e POSTGRES_PASSWORD=local-finance-synthetic-password public.ecr.aws/supabase/postgres:17.6.1.166 >/dev/null
 ready=false
 for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U supabase_admin -d postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
 done
 [ "$ready" = true ] || { echo 'Database unavailable'; exit 1; }
 docker exec "$container" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 \
  -c 'alter system set cron.launch_active_jobs=off' -c 'select pg_reload_conf()' >/dev/null
 docker exec -i "$container" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 < scripts/offline-local-supabase-baseline.sql >/dev/null
 docker exec "$container" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 \
   -c 'create extension if not exists pg_cron; create extension if not exists pgtap with schema extensions;' >/dev/null
elif [ "$phase" != candidate ] && [ "$phase" != baseline-resume ]; then echo 'Use baseline or candidate'; exit 1; fi
count=0
for file in supabase/migrations/*.sql; do
 name=${file##*/}
 if [ "$phase" != candidate ] && [[ "$name" > 20261111999999 ]]; then continue; fi
 if [ "$phase" = candidate ] && [[ "$name" != 20261112* ]]; then continue; fi
 docker exec -i "$container" psql -U supabase_admin -d postgres -X -1 -v ON_ERROR_STOP=1 < "$file" >> "/tmp/finance-clean-$phase.log" 2>&1 || { echo "FAIL $name"; exit 1; }
 count=$((count+1))
done
echo "PASS $phase: $count migrations"
