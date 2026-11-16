# Recuperação de exercícios afetados pela edição pendente

A migration `20261220000003_exercise_catalog_safe_pending_edits.sql` não altera a disponibilidade de nenhum exercício existente. Execute a consulta abaixo em modo somente leitura depois da migration, usando acesso administrativo, para identificar candidatos. Uma linha é candidata quando já teve publicação, está em revisão, guarda conteúdo pendente e não registra retirada posterior à publicação.

```sql
select ec.id, ec.provider, ec.provider_exercise_id, ec.name as nome_publicado,
  ec.pending_content->>'name' as nome_pendente, ec.revision, ec.published_at,
  ec.updated_at, ec.published_media_refs
from public.exercise_catalog ec
where ec.status = 'in_review'
  and ec.is_active = false
  and ec.published_at is not null
  and ec.pending_content is not null
  and ec.withdrawn_at is null
  and not exists (
    select 1 from public.admin_audit_log a
    where a.action = 'catalog_exercise_withdrawn'
      and a.metadata->>'catalogId' = ec.id::text
      and a.created_at >= ec.published_at
  )
order by ec.updated_at desc;
```

Para cada candidato, confira o histórico de auditoria, a versão pública e a edição pendente. Registre o ID, a revisão e a evidência da decisão. Só então chame `admin_recover_catalog_pending_publication(p_id, p_expected_revision)` em sessão de superadmin. A RPC usa bloqueio de linha e revisão esperada, valida o conteúdo público, rejeita retiradas intencionais, mantém a proposta pendente e registra `catalog_exercise_availability_recovered` na auditoria. Ela não publica a proposta: a publicação é uma ação separada no painel.

Para o caso de referência, filtre a consulta por `ec.name = 'Cadeira Flexora Sentada'` e confirme que `nome_pendente = 'Mesa Flexora Deitada'`. Não execute uma atualização direta nesse registro em produção. Depois da recuperação autorizada, publique a edição pelo painel e confirme que o ID e as referências das fichas permanecem os mesmos.
