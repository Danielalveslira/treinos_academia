#!/bin/bash
# Stack Supabase LOCAL (só para homologação; nunca produção) montada à mão com as imagens oficiais, porque
# `supabase start` não funciona neste Codespace (o container do Realtime não alcança o banco em redes docker
# customizadas). Todos os serviços compartilham a rede do container do banco (`--network container:hdb`).
#
#   scripts/homolog/local-stack.sh up      # sobe (gateway em http://127.0.0.1:54321) e aplica as migrations
#   scripts/homolog/local-stack.sh down    # remove containers (as imagens ficam; `docker rmi` para liberar disco)
#   scripts/homolog/local-stack.sh keys    # imprime {"anon","service"} (JWTs locais, nunca reutilizáveis fora daqui)
#
# Depois de `up`: crie usuários em POST /auth/v1/signup, promova o superadmin com
#   update public.users set role='superadmin' where id=...   (docker exec -i hdb psql -U supabase_admin -d postgres)
# importe o catálogo (SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service> node scripts/import-exercise-catalog.mjs --apply)
# e rode scripts/verify-exercise-visuals-homolog.mjs. Para o app no navegador veja docs/EXERCISE_VISUALS.md
# (o Service Worker só liga o cache de imagens para origem https: use um proxy TLS autoassinado).
set -euo pipefail
cd "$(dirname "$0")/../.."
HERE=scripts/homolog
SECRET='super-secret-jwt-token-with-at-least-32-characters-long'
IMG=public.ecr.aws/supabase
N="--network container:hdb"
keys() { node $HERE/keys.mjs print; }

case "${1:-}" in
  keys) keys ;;
  down) docker rm -f hfn hkong hrest hstorage hauth hdb >/dev/null 2>&1 || true; echo "stack removida" ;;
  up)
    ANON=$(keys | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).anon")
    SERVICE=$(keys | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).service")
    docker rm -f hfn hkong hrest hstorage hauth hdb >/dev/null 2>&1 || true
    docker run -d --name hdb -p 54321:8000 -e POSTGRES_PASSWORD=postgres $IMG/postgres:17.6.1.166 >/dev/null
    for _ in $(seq 1 40); do docker exec hdb pg_isready -U supabase_admin -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 2; done; sleep 5
    docker run -d --name hauth $N -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
      -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres \
      -e GOTRUE_SITE_URL=http://127.0.0.1:3000 -e GOTRUE_JWT_SECRET=$SECRET -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
      -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
      -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=a@b.c $IMG/gotrue:v2.197.0 >/dev/null
    docker run -d --name hstorage $N -e ANON_KEY=$ANON -e SERVICE_KEY=$SERVICE -e AUTH_JWT_SECRET=$SECRET -e PGRST_JWT_SECRET=$SECRET \
      -e DATABASE_URL=postgres://supabase_storage_admin:postgres@127.0.0.1:5432/postgres -e DB_INSTALL_ROLES=false -e FILE_SIZE_LIMIT=52428800 \
      -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=local -e REGION=local -e GLOBAL_S3_BUCKET=local \
      -e SERVER_PORT=5000 -e ENABLE_IMAGE_TRANSFORMATION=false $IMG/storage-api:v1.77.5 >/dev/null
    sleep 12   # GoTrue e Storage criam seus schemas (auth/storage) antes das migrations do app
    P="docker exec -i hdb psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"
    $P -c "create extension if not exists pgtap with schema extensions; create extension if not exists pg_cron;"
    for f in supabase/migrations/*.sql; do $P < "$f" >/dev/null || { echo "FALHOU: $f"; exit 1; }; done
    docker run -d --name hrest $N -e PGRST_DB_URI=postgres://authenticator:postgres@127.0.0.1:5432/postgres -e PGRST_DB_SCHEMAS=public \
      -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SECRET -e PGRST_SERVER_PORT=3000 $IMG/postgrest:v14.5 >/dev/null
    docker run -d --name hkong $N -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/kong.yml -e KONG_DNS_ORDER=LAST,A,CNAME -e KONG_PLUGINS=cors \
      -e KONG_PROXY_LISTEN=0.0.0.0:8000 -e KONG_ADMIN_LISTEN=off -v "$PWD/$HERE/kong.yml":/kong.yml:ro $IMG/kong:2.8.1 >/dev/null
    mkdir -p /tmp/homolog-main && cp $HERE/edge-main.ts /tmp/homolog-main/index.ts
    docker run -d --name hfn $N -e JWT_SECRET=$SECRET -e SUPABASE_URL=http://127.0.0.1:8000 -e SUPABASE_ANON_KEY=$ANON -e SUPABASE_SERVICE_ROLE_KEY=$SERVICE \
      -v "$PWD/supabase/functions":/home/deno/functions:ro -v /tmp/homolog-main:/home/deno/main:ro \
      $IMG/edge-runtime:v1.77.1 start --main-service /home/deno/main -p 9000 >/dev/null
    echo "stack no ar: http://127.0.0.1:54321 (auth, rest, storage, functions)" ;;
  *) echo "uso: $0 up|down|keys"; exit 1 ;;
esac
