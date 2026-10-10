#!/bin/bash
# Concorrência REAL da alocação/publicação de Exercise Visuals (o pgTAP roda numa sessão só e não prova isso).
# Abre N sessões psql simultâneas (barreira por relógio, senão o custo do `docker exec` serializa tudo e o teste
# passaria mesmo sem o lock) contra um Postgres LOCAL com as migrations aplicadas.
#
#   EV_DB=<container> scripts/verify-exercise-visuals-concurrency.sh
#
# NUNCA aponte para produção: cria e apaga dados de teste e desliga, só durante a limpeza, o trigger que torna a
# auditoria append-only. Sai com código != 0 se qualquer verificação falhar.
set -uo pipefail
C="${EV_DB:-pgex}"
N="${EV_PARALLEL:-10}"
WORK="$(mktemp -d)"
PSQL="docker exec -i $C psql -U supabase_admin -d postgres -X -q -t -A"
FAIL=0
UID_ADMIN="94000000-0000-0000-0000-000000000001"
CAT_A="94aaaaaa-0000-0000-0000-00000000000a"
CAT_B="94aaaaaa-0000-0000-0000-00000000000b"
CAT_C="94aaaaaa-0000-0000-0000-00000000000c"
CAT_D="94aaaaaa-0000-0000-0000-00000000000d"
trap 'cleanup' EXIT

sql() { $PSQL -c "$1"; }
check() { # descrição, esperado, obtido
  if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (esperado: $2 | obtido: $3)"; FAIL=1; fi
}

cleanup() {
  $PSQL >/dev/null 2>&1 <<SQL
alter table public.exercise_visual_audit_log disable trigger exercise_visual_audit_log_immutable;
delete from public.exercise_visual_audit_log where catalog_id in ('$CAT_A','$CAT_B','$CAT_C','$CAT_D');
alter table public.exercise_visual_audit_log enable trigger exercise_visual_audit_log_immutable;
delete from public.exercise_catalog where id in ('$CAT_A','$CAT_B','$CAT_C','$CAT_D');
delete from auth.users where id = '$UID_ADMIN';
SQL
  rm -rf "$WORK"
}

cleanup_pre() { cleanup; WORK="$(mktemp -d)"; }
cleanup_pre

sql "insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('$UID_ADMIN','authenticated','authenticated','conc-exvisuals@example.invalid','x',now(),'{}','{}',now(),now());
     update public.users set role='superadmin', username='concurrencyadmin' where id='$UID_ADMIN';
     insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions) values
       ('$CAT_A','evolutus_dataset','conc-a','Conc A','peito',array['peito'],'força',array['x']),
       ('$CAT_B','evolutus_dataset','conc-b','Conc B','peito',array['peito'],'força',array['x']),
       ('$CAT_C','evolutus_dataset','conc-c','Conc C','peito',array['peito'],'força',array['x']),
       ('$CAT_D','evolutus_dataset','conc-d','Conc D','peito',array['peito'],'força',array['x']);" >/dev/null || { echo "setup falhou"; exit 2; }

AS_ADMIN="select set_config('request.jwt.claim.sub','$UID_ADMIN',false), set_config('request.jwt.claims','{\"sub\":\"$UID_ADMIN\",\"role\":\"authenticated\"}',false);"

# run_parallel <rótulo> <n> <statement-por-sessão com {i}>
run_parallel() {
  local label="$1" n="$2" stmt="$3" at
  at=$(( $(date +%s) + 6 ))
  for i in $(seq 1 "$n"); do
    local s="${stmt//\{i\}/$i}"
    (
      $PSQL -c "select pg_sleep(greatest(0, $at - extract(epoch from clock_timestamp())));" -c "$AS_ADMIN" -c "$s" > "$WORK/$label.$i" 2>&1
    ) &
  done
  wait
}

echo "== A) $N alocações simultâneas no MESMO exercício (chaves diferentes)"
run_parallel A "$N" "select public.allocate_exercise_visual_set('$CAT_A','manual_upload','v2','{}', gen_random_uuid())->>'version';"
errs=$(grep -l -i "error" "$WORK"/A.* 2>/dev/null | wc -l)
check "nenhuma sessão falhou" 0 "$errs"
check "versões distintas" "$N" "$(cat "$WORK"/A.* | grep -E '^[0-9]+$' | sort -u | wc -l)"
check "versões = 1..N sem buracos" "$(seq 1 "$N" | tr '\n' ',')" "$(sql "select string_agg(version::text, ',' order by version) || ',' from public.exercise_visual_sets where catalog_id='$CAT_A'")"
check "uma linha de auditoria 'allocate' por conjunto" "$N" "$(sql "select count(*) from public.exercise_visual_audit_log where catalog_id='$CAT_A' and action='allocate'")"

echo "== B) $N alocações simultâneas com a MESMA chave de idempotência"
REQ="94bbbbbb-0000-0000-0000-000000000001"
run_parallel B "$N" "select public.allocate_exercise_visual_set('$CAT_B','manual_upload','v2','{}','$REQ')->>'visualSetId';"
errs=$(grep -l -i "error" "$WORK"/B.* 2>/dev/null | wc -l)
check "nenhuma sessão falhou" 0 "$errs"
check "todas receberam o mesmo conjunto" 1 "$(cat "$WORK"/B.* | grep -E '^[0-9a-f]{8}-[0-9a-f-]{27}$' | sort -u | wc -l)"
check "um único conjunto criado" 1 "$(sql "select count(*) from public.exercise_visual_sets where catalog_id='$CAT_B'")"
check "um único evento 'allocate'" 1 "$(sql "select count(*) from public.exercise_visual_audit_log where catalog_id='$CAT_B' and action='allocate'")"
check "3 assets (sem duplicar no replay)" 3 "$(sql "select count(*) from public.exercise_visual_assets a join public.exercise_visual_sets s on s.id=a.visual_set_id where s.catalog_id='$CAT_B'")"

echo "== C) publicações simultâneas de DOIS conjuntos em revisão do mesmo exercício"
PAYLOAD='[{"role":"start","mime_type":"image/webp","width":1024,"height":1024,"byte_size":10},{"role":"end","mime_type":"image/webp","width":1024,"height":1024,"byte_size":10}]'
for k in 1 2; do
  sid=$(sql "$AS_ADMIN select public.allocate_exercise_visual_set('$CAT_C','manual_upload','v2')->>'visualSetId';" | tail -1)
  sql "select public.confirm_exercise_visual_internal('$sid','$UID_ADMIN','$PAYLOAD'::jsonb);" >/dev/null
  eval "SET_C$k=$sid"
done
at=$(( $(date +%s) + 6 ))
for sid in "$SET_C1" "$SET_C2"; do
  ( $PSQL -c "select pg_sleep(greatest(0, $at - extract(epoch from clock_timestamp())));" -c "select public.publish_exercise_visual_internal('$sid','$UID_ADMIN')->>'version';" > "$WORK/C.$sid" 2>&1 ) &
done
wait
check "ambas as publicações terminaram sem erro (serializadas)" 0 "$(grep -l -i error "$WORK"/C.* | wc -l)"
check "exatamente 1 publicado" 1 "$(sql "select count(*) from public.exercise_visual_sets where catalog_id='$CAT_C' and status='published'")"
check "exatamente 1 arquivado" 1 "$(sql "select count(*) from public.exercise_visual_sets where catalog_id='$CAT_C' and status='archived'")"
check "published_media_refs aponta para a versão publicada" \
  "$(sql "select version from public.exercise_visual_sets where catalog_id='$CAT_C' and status='published'")" \
  "$(sql "select published_media_refs->>'version' from public.exercise_catalog where id='$CAT_C'")"
check "auditoria coerente: 2 publish + 1 archive" "2,1" "$(sql "select count(*) filter (where action='publish') || ',' || count(*) filter (where action='archive') from public.exercise_visual_audit_log where catalog_id='$CAT_C'")"

echo "== D) $N publicações simultâneas do MESMO conjunto + confirm x fail concorrentes"
sid=$(sql "$AS_ADMIN select public.allocate_exercise_visual_set('$CAT_D','manual_upload','v2')->>'visualSetId';" | tail -1)
sql "select public.confirm_exercise_visual_internal('$sid','$UID_ADMIN','$PAYLOAD'::jsonb);" >/dev/null
run_parallel D "$N" "select public.publish_exercise_visual_internal('$sid','$UID_ADMIN')->>'version';"
check "uma publicação vence" 1 "$(grep -L -i error "$WORK"/D.* | wc -l)"
check "as demais recebem INVALID_STATE" "$((N - 1))" "$(grep -l "INVALID_STATE" "$WORK"/D.* | wc -l)"
check "um único evento 'publish'" 1 "$(sql "select count(*) from public.exercise_visual_audit_log where visual_set_id='$sid' and action='publish'")"
sid2=$(sql "$AS_ADMIN select public.allocate_exercise_visual_set('$CAT_D','manual_upload','v2')->>'visualSetId';" | tail -1)
at=$(( $(date +%s) + 6 ))
( $PSQL -c "select pg_sleep(greatest(0, $at - extract(epoch from clock_timestamp())));" -c "select public.confirm_exercise_visual_internal('$sid2','$UID_ADMIN','$PAYLOAD'::jsonb)->>'status';" > "$WORK/E.confirm" 2>&1 ) &
( $PSQL -c "select pg_sleep(greatest(0, $at - extract(epoch from clock_timestamp())));" -c "select public.fail_exercise_visual_set_internal('$sid2','$UID_ADMIN','EXPIRED')->>'status';" > "$WORK/E.fail" 2>&1 ) &
wait
final=$(sql "select status from public.exercise_visual_sets where id='$sid2'")
check "estado final é review ou failed (nunca inconsistente)" 1 "$([ "$final" = review ] || [ "$final" = failed ] && echo 1 || echo 0)"
check "auditoria bate com o estado final" "$final" "$(sql "select new_status from public.exercise_visual_audit_log where visual_set_id='$sid2' order by id desc limit 1")"

echo
if [ "$FAIL" -eq 0 ]; then echo "CONCORRÊNCIA OK"; else echo "CONCORRÊNCIA COM FALHAS"; fi
exit "$FAIL"
