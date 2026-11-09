-- Remove a exigência de 30 dias de conta / 20 dias ativos da elegibilidade de criação de
-- comunidade -- tanto paga quanto (futura) gratuita, já que as duas vão compartilhar o mesmo
-- gate. A seção de requisitos a preservar (autenticação, sessão, e-mail, conta regular,
-- restrições, limite de comunidades, saldo quando aplicável, antifraude) não lista esses dois
-- requisitos de tempo -- então eles saem do bloqueio, não só da futura via gratuita.
--
-- community_creation_activity_days / record_activity_checkpoint continuam rodando exatamente
-- como hoje (zero mudança nelas): accountDays/qualifiedDays continuam calculados e devolvidos
-- pela RPC de elegibilidade, só deixam de decidir `eligible`/bloquear a criação. Isso preserva
-- toda a infraestrutura de rastreio de atividade para uso futuro (ex.: exibição informativa),
-- sem precisar remover nada dela.
--
-- Efeito esperado nos testes pgTAP existentes: os cenários que hoje esperam ACCOUNT_TOO_NEW
-- (conta de 29 dias) e NOT_ACTIVE_ENOUGH (19 dias ativos) no fluxo PAGO deixam de ser válidos
-- como estão -- são atualizados na Fase 4 para confirmar que esses dois erros não existem mais
-- em nenhum caminho de criação.

create or replace function private.community_creation_state(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rules public.community_creation_rules;
  v_user public.users;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_account_days integer;
  v_qualified_days integer;
  v_qualified_today boolean;
  v_email_verified boolean;
  v_standing_ok boolean;
  v_owned integer;
begin
  select * into v_rules from public.community_creation_rules where id;
  if v_rules is null then raise exception 'CREATION_RULES_UNAVAILABLE'; end if;

  select * into v_user from public.users where id = p_uid;
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  v_account_days := greatest(floor(extract(epoch from (now() - v_user.created_at)) / 86400), 0)::integer;

  select count(*) filter (where qualified), coalesce(bool_or(qualified) filter (where activity_date = v_today), false)
    into v_qualified_days, v_qualified_today
  from public.community_creation_activity_days
  where user_id = p_uid
    and activity_date > v_today - v_rules.active_window_days
    and activity_date <= v_today;

  select coalesce((select au.email_confirmed_at is not null from auth.users au where au.id = p_uid), false)
    into v_email_verified;

  v_standing_ok := v_user.account_status = 'active'
    and not exists (
      select 1 from public.account_restrictions r
      where r.user_id = p_uid and not (r.action = 'temporary_suspension' and r.until <= now())
    );

  select count(*) into v_owned from public.communities c
    where c.owner_id = p_uid and c.is_active and c.deletion_status is null;

  return jsonb_build_object(
    'accountDays', v_account_days,
    'requiredAccountDays', v_rules.required_account_days,
    'qualifiedDays', v_qualified_days,
    'requiredQualifiedDays', v_rules.required_active_days,
    'activeWindowDays', v_rules.active_window_days,
    'qualifiedToday', v_qualified_today,
    'emailVerified', v_email_verified,
    'standingOk', v_standing_ok,
    'activeOwnedCommunities', v_owned,
    'communityLimit', v_rules.max_owned_communities,
    -- Antes: também exigia v_account_days >= required_account_days e
    -- v_qualified_days >= required_active_days. Removido por decisão de produto (ver cabeçalho).
    'eligible', v_standing_ok and v_email_verified and v_owned < v_rules.max_owned_communities
  );
end;
$$;
revoke all on function private.community_creation_state(uuid) from public, anon, authenticated;

-- Primeiro requisito que falha, como código curto (usado pela criação paga e, a partir da
-- próxima migration, também pela criação gratuita).
create or replace function private.community_creation_blocker(p_state jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when not (p_state->>'standingOk')::boolean then 'ACCOUNT_NOT_ELIGIBLE'
    when not (p_state->>'emailVerified')::boolean then 'EMAIL_NOT_VERIFIED'
    when (p_state->>'activeOwnedCommunities')::int >= (p_state->>'communityLimit')::int then 'COMMUNITY_LIMIT_REACHED'
    else null
  end
$$;
revoke all on function private.community_creation_blocker(jsonb) from public, anon, authenticated;
