#!/usr/bin/env bash
# Fixed isolated database; each pgTAP suite rolls back its synthetic fixtures.
set -euo pipefail
cd "$(dirname "$0")/.."
logs=${1:-/tmp/aud03/sql}
mkdir -p "$logs"
failed=0
for suite in aud03_poll_vote_security feed_batch_rpcs feed_security comments_system comments_read_access \
  post_support_reactions supporters_failclosed workout_participants_rpc \
  community_member_removal community_join_access_list community_promotion_security \
  aud_01_aud_02_security aud05_status_deletion storage_cleanup_outbox status_expiration \
  infinitepay_cash_purchases financial_case_retention account_deletion_financial_case; do
  file="supabase/tests/${suite}_test.sql"
  log="$logs/$suite.log"
  # These legacy suites count the entire table and require an empty local fixture
  # set. Clear only within the transaction they roll back; preserve prior data.
  input="$file"
  if [[ "$suite" == storage_cleanup_outbox || "$suite" == status_expiration ]]; then
    input="$logs/$suite.isolated.sql"
    printf 'begin; truncate public.statuses cascade; truncate public.storage_cleanup_tasks;\n' > "$input"
    cat "$file" >> "$input"
  fi
  if ! docker exec -i evolutus_homolog_db psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 < "$input" > "$log" 2>&1; then
    echo "FAIL $suite SQL error ($log)"
    failed=1
  elif rg -q 'not ok|Looks like you failed|ERROR:' "$log"; then
    echo "FAIL $suite assertions ($log)"
    failed=1
  else
    echo "PASS $suite $(rg '1\.\.[0-9]+' "$log" | tail -n 1 | xargs)"
  fi
done
exit "$failed"
