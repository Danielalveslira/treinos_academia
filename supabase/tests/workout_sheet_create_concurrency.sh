#!/usr/bin/env bash
# Concorrência REAL de create_workout_sheet() com o MESMO create_request_id: N conexões
# simultâneas (processos psql separados, não uma transação só) para a MESMA conta, reproduzindo
# o cenário que a retomada de criação depende -- uma tentativa original ainda em execução no
# servidor quando uma retentativa (reload, duplo clique, ou a retomada pós-reload) chega com a
# MESMA identidade. pgTAP roda tudo numa única transação e não prova isto, por isso é um script
# à parte (mesma convenção de evocoins_concurrency.sh/user_activity_concurrency.sh).
#   Uso:  PG_TEST_CONTAINER=supabase_db_treinos_academia PG_TEST_USER=supabase_admin \
#         bash supabase/tests/workout_sheet_create_concurrency.sh
# Esperado: 0 erros, exatamente 1 ficha com este create_request_id (nunca duas), exatamente 1
# recibo de criação para esta identidade, e o nome final é um dos N nomes enviados (nunca um
# valor corrompido/misturado) -- prova por serialização real no Postgres (lock por conta em
# create_workout_sheet, 20261122000001), não por qualquer atraso estimado no cliente.
set -euo pipefail
PSQL=(docker exec -i "${PG_TEST_CONTAINER:-pgtest}" psql -U "${PG_TEST_USER:-postgres}" -d postgres -X -q -t -A -v ON_ERROR_STOP=1)
UID_TEST='83000000-0000-0000-0000-000000000001'
SESSION_ID='83000000-0000-0000-0000-000000000099'
REQUEST_ID='83000000-0000-0000-0000-000000000042'
N=${N:-12}

"${PSQL[@]}" -c "insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('$UID_TEST', 'authenticated', 'authenticated', 'concurrency-sheetcreate@example.invalid', 'not-used', now(), '{}', '{}', now(), now())
  on conflict do nothing"
"${PSQL[@]}" -c "update public.users u set legal_acceptance_version=p.version, legal_acceptance_digest=p.digest
  from public.legal_policy p where p.id and u.id='$UID_TEST'"
trap '"${PSQL[@]}" -c "delete from auth.users where id = '"'"'$UID_TEST'"'"'" >/dev/null' EXIT
"${PSQL[@]}" -c "delete from public.workout_sheets where user_id='$UID_TEST'"

errors=$(mktemp)
for i in $(seq 1 "$N"); do
  (
    "${PSQL[@]}" -c "
      select set_config('request.jwt.claim.sub','$UID_TEST',false);
      select set_config('request.jwt.claims','{\"sub\":\"$UID_TEST\",\"role\":\"authenticated\",\"session_id\":\"$SESSION_ID\"}',false);
      insert into auth.sessions(id,user_id,created_at,updated_at) values('$SESSION_ID','$UID_TEST',now(),now()) on conflict(id) do nothing;
      set role authenticated;
      select public.create_workout_sheet('$REQUEST_ID','Treino Concorrente $i',null,'','{}','[]');
    " >/dev/null 2>>"$errors" || echo "falhou $i" >>"$errors"
  ) &
done
wait

sheets=$("${PSQL[@]}" -c "select count(*) from public.workout_sheets where user_id='$UID_TEST' and create_request_id='$REQUEST_ID'")
receipts=$("${PSQL[@]}" -c "select count(*) from private.workout_sheet_create_receipts where user_id='$UID_TEST' and create_request_id='$REQUEST_ID'")
final_name=$("${PSQL[@]}" -c "select name from public.workout_sheets where user_id='$UID_TEST' and create_request_id='$REQUEST_ID'")

fail=0
if [ -s "$errors" ]; then
  echo "FALHA: erros/exceções em alguma das $N chamadas concorrentes:"
  head -20 "$errors"
  fail=1
fi
[ "$sheets" = "1" ] || { echo "FALHA: esperava exatamente 1 ficha para este create_request_id, veio $sheets"; fail=1; }
[ "$receipts" = "1" ] || { echo "FALHA: esperava exatamente 1 recibo de criação, veio $receipts"; fail=1; }
case "$final_name" in
  "Treino Concorrente "*) ;;
  *) echo "FALHA: nome final '$final_name' não corresponde a nenhuma das $N tentativas enviadas"; fail=1 ;;
esac
rm -f "$errors"
[ "$fail" = 0 ] && echo "OK: $N create_workout_sheet() concorrentes com o mesmo create_request_id => 1 ficha, 1 recibo, 0 erros (nome final: $final_name)"

# Segundo cenário: prova DIRETA e cronometrada de que uma retentativa espera a transação original
# (não um atraso estimado -- o mesmo lock por conta que create_workout_sheet() já usa, seguro
# "manualmente" por 3s por uma conexão separada antes da retentativa real rodar). Isto é
# exatamente "reload enquanto a 1ª transação ainda está aberta": a retentativa precisa esperar e
# SÓ ENTÃO prosseguir -- nunca errar, nunca duplicar, nunca prosseguir antes da hora.
HOLD_REQUEST='83000000-0000-0000-0000-000000000043'
"${PSQL[@]}" -c "delete from public.workout_sheets where user_id='$UID_TEST' and create_request_id='$HOLD_REQUEST'"
(
  docker exec -i "${PG_TEST_CONTAINER:-pgtest}" psql -U "${PG_TEST_USER:-postgres}" -d postgres -X -q -t -A -v ON_ERROR_STOP=1 <<SQL >/dev/null
begin;
select 1 from public.users where id='$UID_TEST' for update;
select pg_sleep(3);
commit;
SQL
) &
HOLDER_PID=$!
sleep 0.5
START=$(date +%s)
"${PSQL[@]}" -c "
  select set_config('request.jwt.claim.sub','$UID_TEST',false);
  select set_config('request.jwt.claims','{\"sub\":\"$UID_TEST\",\"role\":\"authenticated\",\"session_id\":\"$SESSION_ID\"}',false);
  set role authenticated;
  select public.create_workout_sheet('$HOLD_REQUEST','Nome B',null,'','{}','[]');
" >/dev/null
END=$(date +%s)
wait "$HOLDER_PID"
ELAPSED=$((END - START))
hold_sheets=$("${PSQL[@]}" -c "select count(*) from public.workout_sheets where user_id='$UID_TEST' and create_request_id='$HOLD_REQUEST'")
hold_name=$("${PSQL[@]}" -c "select name from public.workout_sheets where user_id='$UID_TEST' and create_request_id='$HOLD_REQUEST'")
[ "$ELAPSED" -ge 2 ] || { echo "FALHA: a retentativa não esperou a transação original (levou ${ELAPSED}s, esperava >=2s de espera pelo lock)"; fail=1; }
[ "$hold_sheets" = "1" ] || { echo "FALHA: esperava exatamente 1 ficha depois da espera, veio $hold_sheets"; fail=1; }
[ "$hold_name" = "Nome B" ] || { echo "FALHA: nome inesperado depois da espera: '$hold_name'"; fail=1; }
[ "$fail" = 0 ] && echo "OK: retentativa esperou ${ELAPSED}s pelo lock da transação original e só então criou a ficha corretamente (sem erro, sem duplicar)"
exit "$fail"
