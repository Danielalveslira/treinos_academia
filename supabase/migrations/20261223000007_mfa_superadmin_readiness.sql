-- MFA TOTP para superadmins (seção 9 do prompt). O projeto hospedado já tem matrícula/desafio
-- TOTP habilitados nativamente (confirmado em docs/releases/AUTH_RESTRUCTURING_P5_HARDENING_CHECKLIST.md),
-- mas nenhum dos superadmins reais tem fator cadastrado ainda. Esta migration só prepara o
-- servidor para exigir aal2 -- nunca liga a exigência sozinha. Rollout em fases (não automatizável
-- aqui): 1) inventário dos superadmins reais (feito); 2) cada um matricula um fator TOTP de
-- verdade (exige ação humana com um app autenticador, fora do alcance deste repositório);
-- 3) validar um método de contingência operacional; 4) testar o enforcement com um segundo
-- admin já matriculado; 5) só então setar mfa_enforcement_ready=true, com aprovação explícita.
set local lock_timeout = '5s';

alter table private.auth_flow_control add column mfa_enforcement_ready boolean not null default false;

create function public.auth_mfa_enforcement_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select mfa_enforcement_ready from private.auth_flow_control where id), false)
$$;
-- "from public" só revoga o pseudo-papel PUBLIC -- o Supabase já concede execute a
-- anon/authenticated/service_role por padrão em toda função nova do schema public
-- (default privileges do projeto), então sem listar "anon" aqui explicitamente a função
-- continuaria executável por uma visita anônima, sem sessão nenhuma.
revoke all on function public.auth_mfa_enforcement_ready() from public, anon;
grant execute on function public.auth_mfa_enforcement_ready() to authenticated;

-- aal2 comprovado pelo próprio GoTrue (claim assinada), nunca por uma flag local ou por
-- confiança numa chamada do cliente dizendo "MFA concluído".
create function public.is_aal2_session() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.jwt()->>'aal' = 'aal2'
$$;
revoke all on function public.is_aal2_session() from public, anon;
grant execute on function public.is_aal2_session() to authenticated;

-- Sem a flag, comportamento idêntico ao de hoje -- nenhum superadmin fica bloqueado antes de
-- matricular um fator. Com a flag ligada, is_superadmin() também exige aal2. A matrícula em si
-- (supabase.auth.mfa.enroll/challenge/verify) é uma chamada de sessão já autenticada (aal1 basta
-- para começar; o próprio verify() promove a sessão a aal2) -- nunca passa por is_superadmin(),
-- então ninguém fica preso sem conseguir matricular.
create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_full_login_session()
    and exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'superadmin')
    and (not public.auth_mfa_enforcement_ready() or public.is_aal2_session())
$$;
