# Recuperação de anúncios suspensos pelo fluxo antigo de pausa

Antes de `20261219000002_advertising_voluntary_pause.sql` (PR #151), `interrupt_advertising_campaign`
não distinguia pausa voluntária de suspensão administrativa: toda interrupção virava
`moderation_state='suspended'`, inclusive quando o próprio proprietário ou um gerente autorizado
da conta só queria pausar o próprio anúncio. O ator sempre foi registrado em
`advertising_operations` (`action='suspend'`), então a intenção real pode ser reconstruída com
segurança a partir dessa evidência.

Execute em modo somente leitura, com acesso administrativo, para listar candidatos:

```sql
select r.id, d.account_id, a.name as conta, s.title,
  o.actor_user_id, o.reason, o.occurred_at,
  private.advertising_suspension_origin(r.id, d.account_id) as origem
from private.commercial_resources r
join private.advertising_drafts d on d.ad_id = r.id
join public.advertiser_accounts a on a.id = d.account_id
join public.sponsored_ads s on s.id = r.id
join lateral (
  select action, actor_user_id, reason, occurred_at from public.advertising_operations
  where resource_id = r.id and action in ('suspend', 'admin_suspend', 'suspend_pause_limit')
  order by id desc limit 1
) o on true
left join public.visibility_entitlements e on e.resource_id = r.id
where r.moderation_state = 'suspended'
  and private.advertising_suspension_origin(r.id, d.account_id) = 'legacy_voluntary'
  and e.administrative_state = 'enabled' and e.expires_at > now()
order by o.occurred_at desc;
```

Um registro é candidato quando `origem = 'legacy_voluntary'` (o ator do último `suspend` é dono
ou gerente, atual ou histórico, da própria conta do anúncio — nunca alguém de fora) **e** o
contrato ainda está vigente (`e.expires_at > now()`). Contratos já vencidos não devem ser
recuperados: oriente renovação, condicionada à elegibilidade real.

Para cada candidato, confira o histórico completo de `advertising_operations` daquele recurso e
confirme que não existe nenhuma suspensão administrativa genuína mais recente (`admin_suspend`)
nem evidência de moderação real antes de prosseguir. Registre o ID, a `content_revision` e a
evidência da decisão.

Só então chame `admin_recover_advertising_voluntary_suspension(p_id, p_expected_revision)` em
sessão de superadmin autenticada (exige reautenticação recente, como as demais operações
administrativas sensíveis). A RPC:

- Usa bloqueio de linha e revisão esperada (`AD_REVISION_CONFLICT` se desalinhada).
- Rejeita quando a origem não é `legacy_voluntary` (`AD_RECOVERY_NOT_ELIGIBLE`) — nunca libera
  suspensão administrativa real ou registro sem evidência suficiente.
- Rejeita contrato não vigente (`AD_RECOVERY_NOT_ELIGIBLE`).
- Restaura `moderation_state='approved'`, devolvendo a entrega normalmente.
- **Credita a pausa recuperada no contador de 3 ciclos** (`advertiser_pause_count`) em vez de
  conceder um reset gratuito — o anunciante pausou de fato uma vez, mesmo que o código antigo
  tenha registrado isso errado.
- Nunca toca em conteúdo, pedidos, reservas, saldo ou histórico financeiro.
- Registra `advertising_suspension_recovered` na auditoria.

**Não execute recuperação em massa.** Cada candidato exige confirmação individual da evidência
antes da chamada. Não execute esta recuperação em produção sem autorização explícita.
