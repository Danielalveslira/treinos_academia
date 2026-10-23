#!/usr/bin/env bash
# Concorrência REAL do motor de EvoCoins: várias sessões simultâneas (commits de verdade) disputando
# o mesmo usuário/dia. O pgTAP roda numa transação só e não consegue provar isto.
#
# Uso (banco local com as migrations aplicadas):
#   PSQL="docker exec -i pgtest psql -U postgres -d postgres" supabase/tests/evocoins_concurrency.sh
# Cria um usuário de teste, dispara as sessões em paralelo e preserva fixtures no banco descartável (ledger imutável).
set -euo pipefail

PSQL=${PSQL:-"psql"}
UID_T=$(python3 -c 'import uuid; print(uuid.uuid4())')
FAIL=0
q() { $PSQL -X -tA -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (esperado $3, obtido $2)"; FAIL=1; fi; }

q "insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
   values ('$UID_T', 'authenticated', 'authenticated', 'evc-conc-$UID_T@example.invalid', 'x', now(), '{}', '{}', now(), now())" >/dev/null

# 1) 30 sessões simultâneas, ações e chaves distintas (potencial de 3+2+2+3+3 = 13 > 10)
run_award() { q "select private.award_evocoins('$UID_T', '$1', '$2', 'conc', '$2')" >/dev/null; }
pids=()
for i in 1 2 3 4; do run_award daily_activity "act:$i" & pids+=($!); done
for i in 1 2 3 4; do run_award workout_completed "wk:$i" & pids+=($!); done
for i in 1 2 3 4 5 6; do run_award post_published "post:$i" & pids+=($!); done
for i in 1 2 3 4 5 6 7 8; do run_award comment_posted "cm:$i" & pids+=($!); done
for i in 1 2 3 4 5 6 7 8; do run_award support_received "sp:$i" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done

total=$(q "select coalesce(earned_total, 0) from public.economy_daily where user_id = '$UID_T' and day = (now() at time zone 'America/Sao_Paulo')::date")
check "teto global: 30 sessões concorrentes somam exatamente 10" "$total" "10"
ledger=$(q "select coalesce(sum(amount), 0)::int from public.economy_transactions where user_id = '$UID_T'")
check "ledger == agregado do dia" "$ledger" "10"
wallet=$(q "select coin_balance from public.wallets where user_id = '$UID_T'")
check "carteira == ledger" "$wallet" "10"
lifetime=$(q "select lifetime_coins_earned from public.wallets where user_id = '$UID_T'")
check "reputação == ledger" "$lifetime" "10"
over=$(q "select count(*) from (select key::text k, value::int v from public.economy_daily d, jsonb_each_text(d.earned_by_action) e(key, value) where d.user_id = '$UID_T') x
          join public.economy_reward_rules r on r.action = x.k where x.v > r.daily_max")
check "nenhum teto por ação estourado" "$over" "0"

# 2) Nova fixture: não apagar histórico para reutilizar usuário.
# Mesma natural_key em 12 sessões simultâneas: uma única linha no ledger.
UID_T=$(python3 -c 'import uuid; print(uuid.uuid4())')
q "insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
   values ('$UID_T', 'authenticated', 'authenticated', 'evc-conc-$UID_T@example.invalid', 'x', now(), '{}', '{}', now(), now())" >/dev/null
pids=()
for i in $(seq 1 12); do run_award post_published "same-key" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
check "mesma natural_key concorrente: 1 linha no ledger" "$(q "select count(*) from public.economy_transactions where user_id = '$UID_T' and natural_key = 'same-key'")" "1"
check "mesma natural_key concorrente: paga 1 vez" "$(q "select coin_balance from public.wallets where user_id = '$UID_T'")" "1"

exit $FAIL
