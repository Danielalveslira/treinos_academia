# Criação de comunidades (tiers, elegibilidade, retenção)

Migrations: `20261008000001` (dias ativos), `20261008000002` (tiers/retenção), `20261008000003` (RPCs).
Testes: `supabase/tests/community_creation_test.sql`, `src/utils/communityCreation.test.js`,
`src/utils/postRetention.test.js`, `src/components/CommunityCreationSteps.test.js`.

## Regra pública (tabela `community_creation_rules`, linha única)
30 dias de conta · 20 dias ativos nos últimos 30 · >= 10 min de atividade válida por dia ativo ·
e-mail confirmado · conta ativa e sem restrição · no máximo 3 comunidades próprias ativas
(`owner_id = uid`, `is_active`, `deletion_status is null`).

## Ordem fixa: elegibilidade, depois pagamento
`create_community()` recalcula tudo no banco (nada vem do cliente): lock advisory por usuário →
idempotência → elegibilidade → preço (`community_creation_products`) → saldo → comunidade + dono
como membro + débito + ledger (`reason = community_creation`) + registro em
`community_creation_requests`. Uma transação; erro = rollback. A UI só mostra
(`get_my_community_creation_eligibility`, `list_community_creation_products`).

## Dia ativo
`register_qualified_activity()` (chamada pelo app em navegação autenticada) alimenta
`community_creation_activity_days` via `private.record_activity_checkpoint`: o 1º ping do dia não
soma, ping < 60s é ignorado, cada intervalo soma no máximo 20 min, no máximo 6 pings/dia, dia em
America/Sao_Paulo. Só o resumo diário é guardado (sem rota/evento). A tabela é fechada ao cliente.
A UI mostra apenas o progresso público; nenhuma heurística interna é exposta.

## Produtos
`essential` (posts 24h, 300 EvoCoins ou EvoCash), `plus` (30d, 600 EvoCoins ou EvoCash), `archive`
(`no_auto_expiration`, só EvoCash). Preço `NULL` = forma de pagamento indisponível: **os valores em
EvoCash ainda não foram definidos**, então hoje só Essencial/Plus em EvoCoins são vendáveis. Para
definir: `update community_creation_products set evocash_price = ... where tier = ...`.

## Retenção dos posts
`communities.post_retention_mode` (`24h` | `30d` | `no_auto_expiration`). O trigger
`statuses_apply_retention` calcula `statuses.expires_at` no INSERT e grava `statuses.retention_mode`
no próprio post, ignorando o que o cliente enviar. `expires_at` nulo = sem expiração automática
(autor/moderação ainda podem excluir). Upgrade (`upgrade_community_tier`) só afeta posts novos.
Comunidades existentes ficam `tier = legacy` / `24h`, sem cobrança retroativa.

## Pendências conhecidas
- Não existe job que apague posts/fotos vencidos: a expiração é só filtro de leitura (feed, Storage,
  comentários). Um purge (com remoção no Storage via Edge Function) precisa de decisão própria.
- A UI de upgrade ainda não existe; a RPC `upgrade_community_tier` está pronta e testada.
- Comunidades `legacy` do dono contam no limite de 3 (dono com 3+ não cria novas até encerrar alguma).
