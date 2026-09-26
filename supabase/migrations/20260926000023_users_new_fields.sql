-- Campos novos em public.users que apareceram no main durante as ~164 commits que
-- rodaram em paralelo à primeira tentativa de migração (ver AUD-010, verificação de
-- e-mail, altura, perfil de uso).
alter table public.users
  add column if not exists height_cm smallint check (height_cm between 50 and 250),
  add column if not exists usage_profile text not null default 'common'
    check (usage_profile in ('common', 'professional', 'establishment_owner'));

-- Verificação de e-mail: o Supabase Auth já rastreia isso nativamente em
-- auth.users.email_confirmed_at — não precisa de nenhum campo espelhado em
-- public.users, só ler auth.users na função abaixo. Contas criadas antes do corte
-- (equivalente ao EMAIL_VERIFICATION_CUTOFF do firestore.rules/client) nunca precisam
-- verificar; depois do corte, precisam.
create or replace function public.email_verified_ok(p_user_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select u.created_at < '2026-09-11 14:15:00+00'::timestamptz
      or exists (select 1 from auth.users au where au.id = p_user_id and au.email_confirmed_at is not null)
    from public.users u where u.id = p_user_id
$$;

-- A policy antiga de update (`users_update`, using/with check id = auth.uid()) não
-- restringia QUAIS colunas podiam ser gravadas — diferente do allowlist explícito do
-- firestore.rules (affectedKeys().hasOnly([...])). Como toda escrita de perfil já
-- passa por RPC security definer (ensure_user_profile, set_username,
-- update_user_profile, set_birth_info), a policy genérica só era uma porta aberta
-- (ex.: um update direto gravando role='superadmin' no próprio uid) sem uso legítimo
-- correspondente. Removida — updates em public.users passam a exigir uma RPC.
drop policy if exists users_update on public.users;

-- hasAppAccess consolidada (mesmo motivo do firestore.rules: menos leituras repetidas).
-- Substitui a versão anterior: agora também exige e-mail verificado (a menos que
-- superadmin), igual ao main.
create or replace function public.has_app_access() returns boolean
  language sql stable security definer set search_path = public as $$
    select
      u.account_status <> 'deleting'
      and (u.role = 'superadmin' or u.account_status <> 'disabled')
      and (u.role = 'superadmin' or public.email_verified_ok(u.id))
      and (
        not exists (select 1 from public.legal_policy where id and published)
        or (u.legal_acceptance_version = (select version from public.legal_policy where id)
            and u.legal_acceptance_digest = (select digest from public.legal_policy where id))
      )
      and not exists (
        select 1 from public.account_restrictions r
        where r.user_id = auth.uid()
          and not (r.action = 'temporary_suspension' and r.until <= now())
      )
    from public.users u where u.id = auth.uid()
$$;

-- Equivalente a setUsageProfile (Cloud Function): usage_profile fica fora do
-- allowlist de update direto (ver policy dropada acima), só esta RPC grava.
-- TODO(vitrine): o main bloqueia virar 'common' com uma vitrine ativa em certos
-- estados (LISTING_STATES_BLOCKING_COMMON, usage-profile-service.js) — adiar essa
-- checagem pra quando a Vitrine for portada (ainda não existe no Supabase).
create or replace function public.set_usage_profile(p_usage_profile text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_usage_profile not in ('common', 'professional', 'establishment_owner') then
    raise exception 'INVALID_USAGE_PROFILE';
  end if;
  update public.users set usage_profile = p_usage_profile where id = auth.uid();
end;
$$;
