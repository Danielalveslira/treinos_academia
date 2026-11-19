set local lock_timeout='5s';
set local statement_timeout='30s';
-- Reestruturação do portal do anunciante (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md),
-- seção 10: linha do tempo editorial/operacional amigável. Reaproveita a trilha de
-- auditoria já existente (public.advertising_operations) em vez de criar uma nova tabela,
-- mas nunca a RPC de auditoria administrativa (admin_advertising_operations): esta é uma
-- leitura própria do anunciante, com autorização por recurso/conta (mesmo padrão de
-- get_advertising_revisions), projeção mínima e paginação.
--
-- `actorKind` é derivado só pelo nome da ação (nunca por uma leitura de public.users/PII):
-- approve/reject/admin_suspend/advertising_suspension_recovered/resume só podem ter sido
-- executados por um admin (todas exigem require_evocash_admin() na própria RPC que as
-- gera); as demais exigem require_advertising_editor da conta (o próprio dono ou um
-- gerente autorizado), e o frontend já sabe comparar actor_user_id com o próprio auth.uid()
-- para decidir "Você" vs "Gerente autorizado" sem o servidor expor nome/e-mail de ninguém.
-- `edit` fica de fora de propósito: dispara a cada edição de rascunho antes do envio (nunca
-- é um evento "material" por si só) e geraria ruído -- `submit` já é o evento que importa.
create function public.get_advertising_operations_for_advertiser(p_id uuid, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account uuid;
begin
 select account_id into account from private.advertising_drafts where ad_id=p_id;
 if account is null then raise exception 'AD_NOT_FOUND'; end if;
 perform private.require_advertising_editor(account);
 return coalesce((
 select jsonb_agg(jsonb_build_object(
 'id',o.id,
 'action',o.action,
 'reason',o.reason,
 'occurredAt',o.occurred_at,
 'actorKind',case
 when o.action in('approve','reject','admin_suspend','advertising_suspension_recovered','resume') then 'admin'
 when o.actor_user_id=auth.uid() then 'self'
 else 'other' end
 ) order by o.id desc)
 from public.advertising_operations o
 where o.resource_id=p_id
 and o.action in('create','submit','approve','reject','admin_suspend','suspend_pause_limit','advertiser_pause','advertiser_resume','resume','advertising_suspension_recovered','archive')
 and (p_before is null or o.id<p_before)
 order by o.id desc limit 20
 ),'[]'::jsonb);
end $$;
revoke all on function public.get_advertising_operations_for_advertiser(uuid,bigint) from public,anon,service_role;
grant execute on function public.get_advertising_operations_for_advertiser(uuid,bigint) to authenticated;
