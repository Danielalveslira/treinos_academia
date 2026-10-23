-- PROMPT_CORRECAO_LOGOUT_GLOBAL_EVOLUTUS (2ª auditoria), Etapa 3: `AuthContext.revalidate()` só
-- roda em modo `offline-local`. Uma sessão puramente ONLINE (nunca ficou offline) não tinha
-- NENHUMA revalidação própria enquanto o app continuava aberto -- só o refresh automático do SDK,
-- perto do vencimento do access token (até jwt_expiry = 3600s depois da revogação em outro
-- aparelho). getUser() por si só também não é garantia: depende do GoTrue aceitar/rejeitar o
-- token por revogação, não só por assinatura/exp. Esta RPC expõe diretamente a verificação
-- server-side já existente (private.current_session_active(), 20261113000001) para o cliente
-- poder confirmar a própria sessão sem depender exclusivamente do comportamento do GoTrue.
--
-- Raio de impacto: só esta função nova. Não altera has_app_access() nem nenhuma RPC financeira.
set local lock_timeout = '5s';

create or replace function public.is_session_active() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth.uid() is null then null else coalesce(private.current_session_active(), false) end
$$;
revoke all on function public.is_session_active() from public, anon;
grant execute on function public.is_session_active() to authenticated;
