#!/usr/bin/env bash
set -euo pipefail
img=public.ecr.aws/supabase
secret=super-secret-jwt-token-with-at-least-32-characters-long
anon=$(node scripts/homolog/keys.mjs print | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).anon")
service=$(node scripts/homolog/keys.mjs print | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).service")
docker run -d --name evolutus_homolog_db -p 127.0.0.1:55431:3000 -p 127.0.0.1:55432:9999 -p 127.0.0.1:55433:5000 -p 127.0.0.1:55434:3001 -e POSTGRES_PASSWORD=local-aud-synthetic-password "$img/postgres:17.11.0.002" >/dev/null
for ((n=0;n<40;n++)); do
  if docker exec evolutus_homolog_db pg_isready -U supabase_admin -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec evolutus_homolog_db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c 'alter system set cron.launch_active_jobs = off' -c 'select pg_reload_conf()' -c 'create extension if not exists pg_cron; create extension if not exists pgtap with schema extensions;' >/dev/null
docker run -d --name evolutus_homolog_auth --network container:evolutus_homolog_db \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:55432 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:local-aud-synthetic-password@127.0.0.1:5432/postgres \
  -e GOTRUE_SITE_URL=http://127.0.0.1:55440 -e GOTRUE_JWT_SECRET="$secret" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=test@example.invalid \
  "$img/gotrue:v2.197.0" >/dev/null
docker run -d --name evolutus_homolog_storage --network container:evolutus_homolog_db \
  -e ANON_KEY="$anon" -e SERVICE_KEY="$service" -e AUTH_JWT_SECRET="$secret" -e PGRST_JWT_SECRET="$secret" \
  -e DATABASE_URL=postgres://supabase_storage_admin:local-aud-synthetic-password@127.0.0.1:5432/postgres \
  -e DB_INSTALL_ROLES=false -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file \
  -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=local -e REGION=local -e GLOBAL_S3_BUCKET=local \
  -e SERVER_PORT=5000 -e ENABLE_IMAGE_TRANSFORMATION=false "$img/storage-api:v1.79.28" >/dev/null
printf 'Banco/Auth/Storage locais iniciados; cron desativado.\n'
