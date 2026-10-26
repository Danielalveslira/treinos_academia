#!/usr/bin/env bash
# Concorrência real de touch_user_activity(): N conexões simultâneas (cada uma com seu session_id)
# para o MESMO usuário. pgTAP roda numa única transação, então isto é um script à parte.
#   Uso:  PG_TEST_CONTAINER=supabase_db_treinos_academia PG_TEST_USER=supabase_admin \
#         bash supabase/tests/user_activity_concurrency.sh
# (mesma convenção de container/usuário de npm run test:functions, ver .github/workflows;
# sem as duas variáveis, cai no container manual "pgtest"/"postgres" de antes.)
# Esperado: 0 erros, 1 única linha em user_activity, last_session_id = uma das sessões usadas,
# e (como o teto de 1 min já vale) uma única gravação efetiva.
set -euo pipefail
# Trocar PG_TEST_USER sem "-d postgres" explícito faria o psql cair no banco default
# (mesmo nome do usuário, ex. "supabase_admin"), que não existe -- sempre nomear o banco.
PSQL=(docker exec -i "${PG_TEST_CONTAINER:-pgtest}" psql -U "${PG_TEST_USER:-postgres}" -d postgres -X -q -t -A -v ON_ERROR_STOP=1)
UID_TEST='82000000-0000-0000-0000-000000000001'
N=${N:-40}

"${PSQL[@]}" -c "insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('$UID_TEST', 'authenticated', 'authenticated', 'concurrency-useractivity@example.invalid', 'not-used', now(), '{}', '{}', now(), now())
  on conflict do nothing"
trap '"${PSQL[@]}" -c "delete from auth.users where id = '"'"'$UID_TEST'"'"'" >/dev/null' EXIT
"${PSQL[@]}" -c "delete from public.user_activity where user_id = '$UID_TEST'"

errors=$(mktemp)
for i in $(seq 1 "$N"); do
  sid=$(printf 'c%07d-0000-4000-8000-000000000000' "$i")
  (
    "${PSQL[@]}" -c "select set_config('request.jwt.claim.sub', '$UID_TEST', false),
                            set_config('request.jwt.claims', '{\"sub\":\"$UID_TEST\",\"session_id\":\"$sid\"}', false);
                     select public.touch_user_activity();" >/dev/null 2>>"$errors" || echo "falhou $i" >>"$errors"
  ) &
done
wait

rows=$("${PSQL[@]}" -c "select count(*) from public.user_activity where user_id = '$UID_TEST'")
session_ok=$("${PSQL[@]}" -c "select count(*) from public.user_activity where user_id = '$UID_TEST' and last_session_id::text like 'c0%-0000-4000-8000-000000000000'")
recent=$("${PSQL[@]}" -c "select count(*) from public.user_activity where user_id = '$UID_TEST' and last_active_at > now() - interval '1 minute'")

fail=0
[ -s "$errors" ] && { echo "FALHA: erros nas chamadas:"; head -5 "$errors"; fail=1; }
[ "$rows" = "1" ] || { echo "FALHA: esperava 1 linha, veio $rows"; fail=1; }
[ "$session_ok" = "1" ] || { echo "FALHA: last_session_id não é de uma das sessões usadas"; fail=1; }
[ "$recent" = "1" ] || { echo "FALHA: last_active_at não é recente"; fail=1; }
rm -f "$errors"
[ "$fail" = 0 ] && echo "OK: $N chamadas simultâneas => 1 linha, 0 erros"
exit "$fail"
