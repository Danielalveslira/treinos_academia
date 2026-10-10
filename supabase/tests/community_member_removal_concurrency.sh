#!/usr/bin/env bash
# Concorrência real de entrar/sair/remover/banir/desbanir: sessões paralelas (cada uma com seu JWT) disparam
# no MESMO instante (barreira por relógio) contra o mesmo par (comunidade, usuário). pgTAP roda numa única
# transação, então isto é um script à parte.
#   Uso:  CONTAINER=pgex bash supabase/tests/community_member_removal_concurrency.sh
# Esperado: 0 erros inesperados; jamais "restrição + vínculo" para o mesmo par; member_count == vínculos reais;
# ban/desban repetidos não duplicam nada.
set -uo pipefail
C=${CONTAINER:-pgex}
ROUNDS=${ROUNDS:-12}
PSQL=(docker exec -i "$C" psql -U supabase_admin -d postgres -X -q -t -A)
OWNER='e1000000-0000-0000-0000-000000000001'
COMM='e2000000-0000-0000-0000-00000000000a'

"${PSQL[@]}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('e1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated',
       'u' || n || '-conc@example.invalid', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 400) n on conflict do nothing;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'e1000000-%';
insert into public.communities (id, name, created_by, owner_id) values ('$COMM', 'Concorrência', '$OWNER', '$OWNER') on conflict do nothing;
insert into public.community_members (community_id, user_id) values ('$COMM', '$OWNER') on conflict do nothing;
SQL
cleanup() { "${PSQL[@]}" -c "delete from public.communities where id = '$COMM'; delete from auth.users where id::text like 'e1000000-%'" >/dev/null 2>&1; }
trap cleanup EXIT

uid() { printf 'e1000000-0000-0000-0000-%012d' "$1"; }
errors=$(mktemp)

# run_at <epoch> <uid> <sql> : espera a barreira, entra como <uid> (role authenticated) e executa.
run_at() {
  local at=$1 u=$2 sql=$3
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -c "select set_config('request.jwt.claim.sub', '$u', false);
    select pg_sleep(greatest(0, $at - extract(epoch from clock_timestamp())));
    set role authenticated; $sql" >/dev/null 2>>"$errors"
}
ban()    { echo "select public.set_community_member_ban('$COMM', '$1', true, 'motivo de teste de concorrência')"; }
unban()  { echo "select public.set_community_member_ban('$COMM', '$1', false)"; }
remove() { echo "select public.remove_community_member('$COMM', '$1')"; }
joinrpc() { echo "select public.join_community('$COMM')"; }
join()   { echo "insert into public.community_members (community_id, user_id) values ('$COMM', '$1')"; }
leave()  { echo "delete from public.community_members where community_id = '$COMM' and user_id = '$1'"; }

seed_member() { "${PSQL[@]}" -c "insert into public.community_members (community_id, user_id) values ('$COMM', '$1') on conflict do nothing" >/dev/null; }

# Erros esperados: a entrada concorrente a um ban é recusada (COMMUNITY_BANNED / 42501 / RLS).
for r in $(seq 1 "$ROUNDS"); do
  base=$(( r * 10 ))
  T=$(python3 -c "import time; print(time.time() + 2.5)")
  A=$(uid $((base+1))); B=$(uid $((base+2))); Cc=$(uid $((base+3))); D=$(uid $((base+4))); E=$(uid $((base+5))); F=$(uid $((base+6)))
  seed_member "$B"; seed_member "$Cc"; seed_member "$D"; seed_member "$E"; seed_member "$F"
  # 1) ban x join (A, que não era membro, tenta entrar enquanto o dono bane)
  run_at "$T" "$OWNER" "$(ban "$A")" & run_at "$T" "$A" "$(join "$A")" &
  # 1b) ban x join_community (RPC): o resultado correto da corrida é 'banned', nunca 'joined' com ban ativo
  G=$(uid $((base+7)))
  run_at "$T" "$OWNER" "$(ban "$G")" & run_at "$T" "$G" "$(joinrpc)" &
  # 2) remover x banir simultâneos (B)
  run_at "$T" "$OWNER" "$(remove "$B")" & run_at "$T" "$OWNER" "$(ban "$B")" &
  # 3) banir x banir (Cc) e desbanir x desbanir (D, banido antes)
  run_at "$T" "$OWNER" "$(ban "$Cc")" & run_at "$T" "$OWNER" "$(ban "$Cc")" &
  # 4) remover x remover (E) e sair x remover (F)
  run_at "$T" "$OWNER" "$(remove "$E")" & run_at "$T" "$OWNER" "$(remove "$E")" &
  run_at "$T" "$F" "$(leave "$F")" & run_at "$T" "$OWNER" "$(remove "$F")" &
  wait
done

# Desbanir x desbanir: bane antes (sequencial) e dispara dois desbans juntos.
for r in $(seq 1 "$ROUNDS"); do
  X=$(uid $((300 + r)))
  "${PSQL[@]}" -c "set role authenticated; select set_config('request.jwt.claim.sub', '$OWNER', false); select public.set_community_member_ban('$COMM', '$X', true, 'ban antes dos unbans')" >/dev/null 2>>"$errors"
  T=$(python3 -c "import time; print(time.time() + 2.0)")
  run_at "$T" "$OWNER" "$(unban "$X")" & run_at "$T" "$OWNER" "$(unban "$X")" &
  wait
done

# Só o que NÃO é esperado conta como erro: join recusado por ban é o resultado correto da corrida.
unexpected=$(grep -v -E "COMMUNITY_BANNED|row-level security|ban antes" "$errors" | grep -E "ERROR|deadlock" || true)
bad=$("${PSQL[@]}" -c "select count(*) from public.community_members m join public.community_restrictions r using (community_id, user_id) where m.community_id = '$COMM'")
dup=$("${PSQL[@]}" -c "select count(*) from (select user_id from public.community_restrictions where community_id = '$COMM' group by 1 having count(*) > 1) d")
drift=$("${PSQL[@]}" -c "select (select member_count from public.communities where id = '$COMM') - (select count(*) from public.community_members where community_id = '$COMM')")
deadlocks=$(grep -c -i deadlock "$errors" || true)
echo "erros inesperados: ${unexpected:-nenhum} | ban+vínculo: $bad | restrições duplicadas: $dup | deriva de member_count: $drift | deadlocks: $deadlocks"
if [ -n "$unexpected" ] || [ "$bad" != 0 ] || [ "$dup" != 0 ] || [ "$drift" != 0 ] || [ "$deadlocks" != 0 ]; then echo FALHOU; exit 1; fi
echo OK
