#!/usr/bin/env bash
# Concorrência real de ack_greeting_welcome() e set_greeting_voice(): várias conexões simultâneas na MESMA conta
# (vários aparelhos/abas). pgTAP roda numa transação só, então isto fica num script à parte (fixtures
# COMMITADAS e removidas no final).
#   Uso:  bash supabase/tests/greeting_welcome_concurrency.sh      (container local; PGC=nome PGU=usuário)
# Cenários:
#   A) N confirmações simultâneas da mesma conta: 0 erros, todas devolvem o MESMO instante e ele é gravado uma vez
#   B) N trocas simultâneas de voz: 0 erros e o valor final é um dos valores válidos enviados
#   C) uma nova rodada de confirmações depois da primeira: o instante original nunca muda
set -euo pipefail
PGC=${PGC:-pgex}
PGU=${PGU:-supabase_admin}
N=${N:-12}
PSQL=(docker exec -i "$PGC" psql -U "$PGU" -d postgres -X -q -t -A -v ON_ERROR_STOP=1)
USER_ID='e9000000-0000-0000-0000-000000000001'

cleanup() { "${PSQL[@]}" -c "delete from auth.users where id = '$USER_ID';" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

"${PSQL[@]}" <<SQL >/dev/null
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('$USER_ID', 'authenticated', 'authenticated', 'conc-greeting@example.invalid', 'not-used', now(), '{}', '{}', now(), now());
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id = '$USER_ID';
SQL

out=$(mktemp)
errors=$(mktemp)
START=0
barrier() { START=$(( $(date +%s) + ${BARRIER_SECS:-4} )); }
run_parallel() { # run_parallel <sql>   (barreira comum antes de executar)
  barrier
  for i in $(seq 1 "$N"); do
    "${PSQL[@]}" -c "set role authenticated; select set_config('request.jwt.claim.sub', '$USER_ID', false);
                     select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp())));
                     $1" >>"$out" 2>>"$errors" || echo "falhou $i" >>"$errors" &
  done
  wait
}
fail=0
check() { # check <descrição> <esperado> <obtido>
  if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (esperado=$2 obtido=$3)"; fail=1; fi
}

: >"$out"; : >"$errors"
run_parallel "select public.ack_greeting_welcome();"
stored=$("${PSQL[@]}" -c "select greeting_welcome_seen_at from public.users where id = '$USER_ID';")
check "A: sem erros" "0" "$(wc -l <"$errors" | tr -d ' ')"
check "A: todas as chamadas devolveram o mesmo instante" "1" "$(grep -v '^set_config$\|^$\|^SET$' "$out" | grep -E '^[0-9]{4}-' | sort -u | wc -l | tr -d ' ')"
check "A: instante devolvido == gravado" "$stored" "$(grep -E '^[0-9]{4}-' "$out" | sort -u | head -1)"

: >"$out"; : >"$errors"
run_parallel "select public.ack_greeting_welcome();"
check "C: segunda rodada sem erros" "0" "$(wc -l <"$errors" | tr -d ' ')"
check "C: instante original preservado" "$stored" "$("${PSQL[@]}" -c "select greeting_welcome_seen_at from public.users where id = '$USER_ID';")"

: >"$out"; : >"$errors"
barrier
voices=(masculino feminino neutro auto)
for i in $(seq 1 "$N"); do
  v=${voices[$((i % 4))]}
  "${PSQL[@]}" -c "set role authenticated; select set_config('request.jwt.claim.sub', '$USER_ID', false);
                   select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp())));
                   select public.set_greeting_voice('$v');" >/dev/null 2>>"$errors" || echo "falhou $i" >>"$errors" &
done
wait
final=$("${PSQL[@]}" -c "select greeting_voice from public.users where id = '$USER_ID';")
check "B: sem erros" "0" "$(wc -l <"$errors" | tr -d ' ')"
case "$final" in masculino | feminino | neutro | auto) check "B: valor final válido" ok ok ;; *) check "B: valor final válido" ok "$final" ;; esac

rm -f "$out" "$errors"
exit $fail
