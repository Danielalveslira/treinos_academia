#!/bin/bash
# GoTrue extra, com o Custom Access Token Hook ligado (private.auth_scope_access_token), só para
# testar a derivação de role do P1. Requer `local-stack.sh up` já no ar: usa o mesmo banco e a
# mesma rede isolada de hdb (`--network container:hdb`, sem rota de saída), e fica alcançável do
# host pela porta 9991 que o próprio hdb já publica (containers em modo `--network container:X`
# compartilham a pilha de rede de X por completo, incluindo as portas publicadas por X).
#
# NUNCA habilite este hook fora de uma rede `--internal` como `homolog-isolated`: ele roda a cada
# emissão/refresh de token. Homologação real ou produção só devem recebê-lo depois destes testes e
# de aprovação explícita (ver docs/releases/AUTH_RESTRUCTURING_P1_P2_P4_STATUS.md).
#
#   scripts/homolog/auth-hook-stack.sh up      # sobe hauth_hook em http://127.0.0.1:9991
#   scripts/homolog/auth-hook-stack.sh down
set -euo pipefail
SECRET='super-secret-jwt-token-with-at-least-32-characters-long'
IMG=public.ecr.aws/supabase
N="--network container:hdb"

case "${1:-}" in
  down) docker rm -f hauth_hook >/dev/null 2>&1 || true; echo "hauth_hook removido" ;;
  up)
    docker rm -f hauth_hook >/dev/null 2>&1 || true
    docker run -d --name hauth_hook $N \
      -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9991 -e API_EXTERNAL_URL=http://127.0.0.1:9991 \
      -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres \
      -e GOTRUE_SITE_URL=http://127.0.0.1:3000 -e GOTRUE_JWT_SECRET=$SECRET -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
      -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false \
      -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=a@b.c \
      -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true \
      -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/private/auth_scope_access_token \
      $IMG/gotrue:v2.197.0 >/dev/null
    for _ in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:9991/health && break; sleep 1; done
    echo "hauth_hook no ar: http://127.0.0.1:9991 (hook de role ligado, mesma rede isolada de hdb)" ;;
  *) echo "uso: $0 up|down"; exit 1 ;;
esac
