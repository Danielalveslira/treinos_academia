#!/usr/bin/env bash
# Só PostgreSQL local já preparado; não aplica migrations nem acessa ambiente remoto.
set -euo pipefail
cd "$(dirname "$0")/.."
container=evolutus_aud_postgres
logs=$(mktemp -d /tmp/evolutus-aud-tests.XXXXXX)
files=(
  aud_01_aud_02_security_test
  community_promotion_security_test
  account_deletion_financial_case_test
  account_deletion_hardening_test
  financial_case_retention_test
  financial_case_cancel_traceability_test
  infinitepay_cash_purchases_test
  comments_system_test
  post_support_reactions_test
  support_moderation_functions_test
  status_text_limit_test
  status_progress_metadata_test
  feed_security_test
)
for name in "${files[@]}"; do
  log="$logs/$name.log"
  if ! docker exec -i "$container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
      < "supabase/tests/$name.sql" > "$log" 2>&1; then
    echo "FAIL $name (log: $log)"
    tail -n 12 "$log"
    exit 1
  fi
  if rg -q 'not ok|Looks like you failed|ERROR:' "$log"; then
    echo "FAIL $name (log: $log)"
    rg -n -A 5 'not ok|Looks like you failed|ERROR:' "$log"
    exit 1
  fi
  printf 'PASS %s: ' "$name"
  rg '1\.\.[0-9]+' "$log" | tail -n 1
 done
printf 'Logs locais: %s\n' "$logs"
