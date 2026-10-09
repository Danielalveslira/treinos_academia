#!/usr/bin/env bash
# Concorrência real de record_ad_events(): várias conexões simultâneas. pgTAP roda numa transação só,
# então estes cenários ficam num script à parte (fixtures COMMITADAS e removidas no final).
#   Uso:  bash supabase/tests/sponsored_ad_metrics_concurrency.sh      (container local; PGC=nome PGU=usuário)
# Cenários:
#   A) N usuários distintos x 3 impressões na MESMA linha agregada (linha quente): contadores exatos, 0 erros
#   B) o MESMO usuário reenviando o MESMO evento em paralelo: conta exatamente uma vez (idempotência)
#   C) o MESMO usuário com 20 eventos distintos em 20 chamadas paralelas: respeita o teto de 10/dia
#   D) lotes com duas chaves em ORDEM OPOSTA enviados em paralelo por usuários distintos: sem deadlock
#   E) o MESMO clique (sem impressão) reenviado em paralelo: conta uma vez, como clique não qualificado
#   F) 20 cliques distintos sem impressão da mesma conta em paralelo: teto de 5, nenhuma impressão criada
set -euo pipefail
PGC=${PGC:-pgphase5}
PGU=${PGU:-supabase_admin}
N=${N:-30}
PSQL=(docker exec -i "$PGC" psql -U "$PGU" -d postgres -X -q -t -A -v ON_ERROR_STOP=1)

COMM='c2000000-0000-0000-0000-000000000001'
AD1='c3000000-0000-0000-0000-000000000001'
AD2='c3000000-0000-0000-0000-000000000002'
AD3='c3000000-0000-0000-0000-000000000003'
OWNER='c1000000-0000-0000-0000-000000000000'
uid() { printf 'c1000000-0000-0000-0000-%012d' "$1"; }
eid() { printf 'c4%06d-0000-4000-8000-%012d' "$1" "$2"; }

cleanup() {
  "${PSQL[@]}" -c "
    delete from public.sponsored_ad_daily_stats where ad_id in ('$AD1', '$AD2', '$AD3');
    delete from public.sponsored_ads where id in ('$AD1', '$AD2', '$AD3');
    delete from public.communities where id = '$COMM';
    delete from auth.users where id::text like 'c1000000-%';
    update public.sponsored_ad_metrics_settings set collection_enabled = false;" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# Fixtures: dono (superadmin), N+2 membros, 1 comunidade, 2 anúncios; coleta ligada só durante o teste.
"${PSQL[@]}" <<SQL >/dev/null
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select case when n = 0 then '$OWNER'::uuid else ('c1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid end,
       'authenticated', 'authenticated', 'conc-ad' || n || '@example.invalid', 'not-used', now(), '{}', '{}', now(), now()
  from generate_series(0, $N + 2) n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'c1000000-%';
update public.users set data_nascimento = date '1990-01-01' where id::text like 'c1000000-%';
update public.users set role = 'superadmin', username = 'concadowner' where id = '$OWNER';
insert into public.communities (id, name, created_by) values ('$COMM', 'Concorrência de anúncios', '$OWNER');
insert into public.community_members (community_id, user_id)
  select '$COMM', ('c1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, $N + 2) n;
insert into public.sponsored_ads (id, partner_name, title, community_ids, display_mode, expires_at, created_by) values
  ('$AD1', 'Conc A1', 'A1', array['$COMM'::uuid], '{banner,feed}', now() + interval '1 day', '$OWNER'),
  ('$AD2', 'Conc A2', 'A2', array['$COMM'::uuid], '{banner,feed}', now() + interval '1 day', '$OWNER'),
  ('$AD3', 'Conc A3', 'A3', array['$COMM'::uuid], '{banner,feed}', now() + interval '1 day', '$OWNER');
update public.sponsored_ad_metrics_settings set collection_enabled = true;
SQL

errors=$(mktemp)
# Barreira: cada conexão abre, prepara a sessão e DORME até o mesmo instante (START, epoch) antes de chamar a RPC;
# sem isso o custo de subir cada docker exec serializa as chamadas e o teste não exerce a corrida de verdade.
START=0
barrier() { START=$(( $(date +%s) + ${BARRIER_SECS:-4} )); }
call() { # call <user-index> <json-array>
  "${PSQL[@]}" -c "set role authenticated; select set_config('request.jwt.claim.sub', '$(uid "$1")', false);
                   select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp())));
                   select public.record_ad_events('$2'::jsonb);" >/dev/null 2>>"$errors" || echo "falhou user=$1" >>"$errors"
}
ev() { # ev <event-id> <type> <ad> <placement>
  printf '{"id":"%s","type":"%s","ad":"%s","placement":"%s","community":"%s"}' "$1" "$2" "$3" "$4" "$COMM"
}
stat() { "${PSQL[@]}" -c "select coalesce((select visible_impressions || ',' || unique_viewers || ',' || clicks || ',' || unqualified_clicks
  from public.sponsored_ad_daily_stats where ad_id = '$1' and placement = '$2' and context_id = '$COMM' order by day desc limit 1), '0,0,0,0')"; }
fail=0
expect() { [ "$2" = "$3" ] || { echo "FALHA ($1): esperava '$3', veio '$2'"; fail=1; }; }

# A) N usuários x 3 impressões na mesma linha agregada
barrier
for i in $(seq 1 "$N"); do
  call "$i" "[$(ev "$(eid 1 $((i * 10 + 1)))" impression "$AD1" community_banner),$(ev "$(eid 1 $((i * 10 + 2)))" impression "$AD1" community_banner),$(ev "$(eid 1 $((i * 10 + 3)))" impression "$AD1" community_banner)]" &
done
wait
expect "A: impressões/únicos/cliques" "$(stat "$AD1" community_banner)" "$((N * 3)),$N,0,0"

# B) mesmo usuário, mesmo evento, 20 chamadas paralelas
U=$((N + 1))
barrier
for _ in $(seq 1 20); do call "$U" "[$(ev "$(eid 2 1)" impression "$AD2" community_feed)]" & done
wait
expect "B: idempotência sob paralelismo" "$(stat "$AD2" community_feed)" "1,1,0,0"

# C) mesmo usuário, 20 eventos distintos em 20 chamadas paralelas: teto de 10
U=$((N + 2))
barrier
for k in $(seq 1 20); do call "$U" "[$(ev "$(eid 3 "$k")" impression "$AD2" community_banner)]" & done
wait
expect "C: teto de 10 impressões/dia" "$(stat "$AD2" community_banner)" "10,1,0,0"

# D) lotes com chaves em ordem oposta (AD1 feed -> AD2 feed e AD2 feed -> AD1 feed)
barrier
for i in $(seq 1 "$N"); do
  if [ $((i % 2)) -eq 0 ]; then
    call "$i" "[$(ev "$(eid 4 "$i")" impression "$AD1" community_feed),$(ev "$(eid 4 $((i + 100)))" impression "$AD2" community_feed)]" &
  else
    call "$i" "[$(ev "$(eid 4 "$i")" impression "$AD2" community_feed),$(ev "$(eid 4 $((i + 100)))" impression "$AD1" community_feed)]" &
  fi
done
wait
expect "D: AD1 feed (deltas)" "$(stat "$AD1" community_feed)" "$N,$N,0,0"
# AD2 feed já tinha 1 impressão do usuário do cenário B
expect "D: AD2 feed (deltas)" "$(stat "$AD2" community_feed)" "$((N + 1)),$((N + 1)),0,0"

# E) mesmo clique (sem impressão) 20x em paralelo
barrier
for _ in $(seq 1 20); do call 3 "[$(ev "$(eid 5 1)" click "$AD3" community_banner)]" & done
wait
expect "E: clique rápido idempotente sob paralelismo" "$(stat "$AD3" community_banner)" "0,0,1,1"

# F) 20 cliques distintos da mesma conta, sem impressão, em paralelo: teto de 5 e nenhuma impressão criada
barrier
for k in $(seq 1 20); do call 4 "[$(ev "$(eid 6 "$k")" click "$AD3" community_feed)]" & done
wait
expect "F: teto de 5 cliques sem impressão" "$(stat "$AD3" community_feed)" "0,0,5,5"

if [ -s "$errors" ]; then echo "FALHA: erros nas chamadas (deadlock/serialização?):"; head -5 "$errors"; fail=1; fi
rm -f "$errors"
[ "$fail" = 0 ] && echo "OK: A) $N usuários na linha quente, B) retry paralelo, C) teto sob paralelismo, D) ordem oposta sem deadlock, E) clique rápido idempotente, F) teto de cliques sem impressão"
exit "$fail"
