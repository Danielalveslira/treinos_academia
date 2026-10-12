# Correção local AUD-01 / AUD-02

**Histórico da primeira correção.** A validação posterior e as alterações de compatibilidade estão em [HOMOLOGACAO_AUD_01_AUD_02.md](HOMOLOGACAO_AUD_01_AUD_02.md). A allowlist efetiva agora aceita dicas legadas de nome/selo somente no INSERT, sempre sobrescritas pelo servidor; o rollout usa pacote transacional.

Data: 12/10/2026. Base: estado atual do workspace sobre `f036475`, incluindo o relatório de auditoria entregue pelo usuário. Sem commit, push, deploy, consulta a produção ou migrations remotas. As alterações preexistentes de documentação foram preservadas.

## Diagnóstico e causa raiz confirmada

**AUD-01.** `delete_own_account()` era SECURITY DEFINER, sem limite de idade, validação de obrigações ou job. O cliente de cadastro também fazia DELETE independente em users/public_profiles/usernames, ignorando resultados. `users_delete_fresh` e `public_profiles_delete_fresh` autorizavam exclusão por idade; `usernames_delete` não exigia idade. As FKs não implementam revisão financeira: auth.users -> users -> perfil público/reservas/carteira e outros dados têm cascatas; outras referências podem barrar uma exclusão, mas não são um controle de negócio.

A varredura de migrations, frontend e Edge Functions encontrou a exclusão de auth.users somente nesta RPC. A rota autorizada usa atendimento/admin, `queue_deletion`/`admin_request_account_deletion`, revisão financeira, separação e preservação de casos/ledger/compras, `run_deletion_job`, estado `auth_cleanup`, Storage e `auth.admin.deleteUser` no worker, seguido de `confirm_auth_deletion`. Atualizações de nome por RPC removem somente a reserva anterior para substituir o nome atomicamente; não são um caminho de exclusão de identidade. As funções do worker continuam restritas ao serviço.

**AUD-02.** `statuses_insert` valida autoria/comunidade, mas não colunas. Os grants padrão de tabela permitem INSERT de promoção, prazo, vínculo de promoção, votos, comentários e nome falso. O selo já era sobrescrito por `statuses_enforce_author_badge`; retenção por `statuses_apply_retention`; `comments_close_at` já é coluna gerada. Não existe policy UPDATE nem fluxo de edição de publicação no cliente atual: o relatório não comprova exploração por UPDATE. Revogar UPDATE continua necessário como defesa contra grants/policies posteriores e UPSERT.

Rotas levantadas: texto, enquete, treino e foto/progresso usam INSERT direto em statusesService; achievement faz parte do esquema, sem criador dedicado no serviço atual. Promoções de post/comunidade usam `create_promotion` (valida dono, acesso, pacote, saldo; debita EvoCash e registra ledger atomicamente) e `cancel_promotion`. Contadores são escritos por `cast_vote`, `comment_create` e triggers de remoção. Moderação/worker removem publicações por operações próprias. Anúncios patrocinados e Vitrine usam tabelas/RPCs separadas; não exigem ampliar privilégios do cliente em statuses.

**Reprodução antes das correções em PostgreSQL local:** authenticated inseriu `promoted=true`, prazo de um ano, votos/comentários 999 e `author_username=falso`; os valores persistiram. Outra conta sintética chamou a RPC de rollback e deixou de existir no Auth. Ambas as reproduções terminaram em ROLLBACK. Isso confirma a causa no esquema local; não comprova os grants implantados remotamente.

## Implementação e arquivos

Migrations novas, posteriores à última existente (`20261025000001`), embora o calendário do repositório já ultrapasse a data desta execução:

- `supabase/migrations/20261026000001_close_account_rollback.sql`: substitui a RPC por recusa explícita, SECURITY INVOKER, owner postgres e search_path vazio; revoga EXECUTE de PUBLIC/anon/authenticated/service_role; remove as três policies de exclusão; revoga DELETE/TRUNCATE de perfis/reservas e auth.users para papéis clientes. O worker não usa esta RPC e conserva suas permissões.
- `supabase/migrations/20261026000002_status_write_allowlist.sql`: revoga INSERT/UPDATE tanto de tabela quanto de cada coluna, incluindo grants antigos de coluna; concede somente INSERT da allowlist de conteúdo/identificadores a authenticated; inicializa autoria/nome/selo/data/metadados no servidor. Trigger INVOKER, owner postgres, search_path vazio, sem EXECUTE cliente. Usa o papel SQL efetivo para distinguir cliente de serviço/RPC DEFINER, mesmo que haja sub de usuário no JWT. Inserções internas preservam metadados autorizados; o nome/selo vêm de users. Promoções e contadores existentes não são atualizados.
- `src/services/statusesService.js`: deixa de enviar author_username/author_is_superadmin. As assinaturas e retorno da criação permanecem iguais; author_id é conferido no banco contra auth.uid(), e id continua selecionável para o caminho de upload.
- `src/pages/Register.jsx`: falha após criar a conta preserva dados e informa como entrar/completar o perfil ou usar o atendimento para exclusão oficial.
- `src/services/usersService.js` e `src/services/authService.js`: removem helpers e chamadas do rollback destrutivo.
- `supabase/tests/aud_01_aud_02_security_test.sql`: matriz de autorização com SET LOCAL ROLE e claims sintéticos, 78 verificações.
- `supabase/tests/status_progress_metadata_test.sql`: adapta a criação de fotos ao contrato atual; expires_at passa a ser somente do servidor, como no frontend.
- `src/services/statusWriteContract.test.js`: verifica payloads legítimos e propagação de erro do banco (não certifica RLS).
- `scripts/verify-aud-security-local.sh`: executa as 12 suítes locais com ON_ERROR_STOP e verifica também falhas pgTAP (psql sozinho retorna sucesso mesmo com `not ok`). Não aplica migrations nem recebe URL remota.

**Decisão AUD-01:** rollback imediato desativado, inclusive para conta recente sem atividade. Não se introduziu uma prova incompleta de ausência de obrigações financeiras. Não há rollback permitido nem exclusão parcial/resíduos novos decorrentes dele; contas incompletas são preservadas para recuperação ou exclusão oficial. Não se cria automaticamente um job financeiro durante um erro de cadastro.

## Matriz de permissões antes/depois

| Operação / ator | Antes (banco local) | Depois |
|---|---|---|
| delete_own_account / authenticated | Executável; apaga identidade quando FKs permitem | EXECUTE revogado; corpo também recusa |
| delete_own_account / anon | Já negado pelo hardening anterior | Negado explicitamente |
| delete_own_account / service_role | Sem contrato obrigatório para worker | Negado; worker continua pelas RPCs oficiais |
| DELETE users / authenticated | Própria conta com perfil de menos de 10 minutos | Sem grant DELETE/TRUNCATE e sem policy fresh |
| DELETE public_profiles / authenticated | Perfil próprio recente | Sem grant e sem policy fresh |
| DELETE usernames / authenticated | Próprias reservas, sem idade | Sem grant e sem policy; troca por RPC preservada |
| DELETE auth.users / cliente | Direto negado; possível pelo DEFINER vulnerável | Direto explicitamente negado e RPC desativada |
| INSERT statuses / authenticated | Grant de tabela; RLS só valida a linha | Grant por coluna; RLS preservada; identidade inicial no servidor |
| INSERT metadados / authenticated, inclusive superadmin | Promoção/contadores/nome controláveis | Negado, sem exceção baseada em papel de aplicação |
| UPDATE/UPSERT statuses / authenticated | UPDATE negado pela ausência de policy | UPDATE também sem grant de tabela/coluna |
| INSERT/UPDATE statuses / anon | Sem acesso legítimo pelo RLS | Sem grants de escrita |
| Promoção/moderação/contagem / RPCs autorizadas | DEFINER/serviço | Preservadas; cliente não ganha UPDATE direto |
| Exclusão financeira / admin + worker | Revisão/caso financeiro/worker | Preservada, inclusive bloqueio e retenção |

**Allowlist do autor no INSERT:** id, community_id, author_id, type; text; poll_question/poll_options; workout_title/date/location; achievement_day/text/entries/sets; photo_path/caption; progress_kind/period_start/period_end. Identificadores passam por FK, shape e RLS. Achievement/progress são conteúdo declarativo, não uma certificação de treino nem crédito financeiro. Não há edição direta por UPDATE no contrato atual.

**Somente servidor:** author_username, author_is_superadmin, created_at, expires_at, retention_mode, comments_close_at, promoted, promoted_until, active_promotion_id, positive_vote_count, negative_vote_count e comment_count. Colunas futuras ficam negadas por padrão para INSERT/UPDATE do cliente até inclusão explícita na allowlist.

## Evidências e limites dos testes

Ambiente: imagem oficial `public.ecr.aws/supabase/postgres:17.11.0.002`, container `evolutus_aud_postgres`, sem portas publicadas. `cron.launch_active_jobs=off` antes das migrations; nenhum job remoto disparado. Papéis Supabase/auth.uid() reais do PostgreSQL. Auth recebeu as colunas da baseline local já existente; Storage recebeu somente as tabelas sintéticas de `scripts/offline-local-supabase-baseline.sql`, com ownership local ajustado para postgres. Todas as migrations do app foram executadas em sequência no banco descartável. O container local permanece disponível; reexecute os testes com `bash scripts/verify-aud-security-local.sh`. pgTAP e pg_cron foram habilitados localmente. As duas migrations novas foram reaplicadas com sucesso (idempotência).

O Supabase CLI completo falhou na inicialização do Realtime, inclusive com `-x realtime` (DbSetupError/DBConnection.ConnectionError). Esse problema de rede Docker já está documentado em `scripts/homolog/local-stack.sh`. A alternativa valida PostgreSQL, grants, triggers, RLS e as RPCs; não valida GoTrue/PostgREST/Storage ponta a ponta.

| Verificação | Resultado |
|---|---|
| Matriz nova AUD-01/AUD-02 | 78/78; anon/authenticated/service_role, conta antiga/recente limpa/com saldo/compra pendente, DELETE direto, autoria alheia, INSERT/UPDATE/UPSERT de metadados, comunidade proibida/admins, promoção paga e nova cobrança, moderação, contagem e comentários |
| 12 suítes SQL pelo script | 517/517, com ROLLBACK dos dados sintéticos |
| Exclusão financeira, hardening, retenção/rastreabilidade | 85 + 32 + 46 + 35 aprovados; casos/ledger preservados |
| InfinitePay/pagamentos | 57 aprovados; cobrança/crédito/cancelamento e pendência preservados |
| Comentários, apoio e moderação | 41 + 52 + 11 aprovados |
| Texto, fotos/progresso e feed | 9 + 29 + 42 aprovados |
| JS relacionados | 3 arquivos aprovados: contrato de escrita, leitura de contadores e erros Auth |
| npm run lint | 0 erros; 14 avisos preexistentes |
| npm run build | Aprovado; aviso conhecido de chunk maior que 500 kB |
| npm test completo fora do sandbox | 1.886/1.888; falhas preexistentes de relógio e catálogo intermitente |
| CatalogOfflineStatus isolado, rechecagem final | 4/4 aprovados |
| git diff --check | Aprovado |

Logs locais: `/tmp/aud-before.log`, `/tmp/aud-security-test.log`, `/tmp/aud-sql-related.log` (diretório das 12 suítes indicado no final), `/tmp/aud-js-related.log`, `/tmp/aud-lint.log`, `/tmp/aud-build-final.log`, `/tmp/aud-npm-test-final.log`. Nenhum token/credencial real é necessário para esses testes.

A primeira execução de npm test no sandbox reportou 210/213 arquivos aprovados: CatalogOfflineStatus e businessDate passaram na reexecução autorizada fora do sandbox (21 testes); accounts.test mantém a falha de relógio já reportada em AUD-10. A execução final completa fora do sandbox reportou **1.888 testes: 1.886 aprovados e 2 falhas**: accounts.test (AUD-10, relógio não controlado) e CatalogOfflineStatus.test (estado ainda “Baixando” na asserção de conclusão; comportamento intermitente, já observado na auditoria). O catálogo passou novamente isolado (4/4). A suíte não está inteiramente verde; nenhum desses arquivos de implementação foi alterado nesta tarefa.

## Riscos residuais e rollback

- Grants, ownership, funções, policies, triggers e extensões de produção não foram consultados. Confirmar drift e grants herdados de outros papéis em homologação antes de promover; papéis adicionais não fazem parte da matriz padrão testada.
- Clientes antigos ainda enviam author_username/author_is_superadmin; passam a receber erro de permissão depois da migration AUD-02. Publicação futura deve coordenar o frontend atualizado e o banco (primeiro frontend compatível, depois migrations) e conferir versões antigas/cache PWA. Nenhuma publicação foi feita nesta tarefa.
- Contas cujo cadastro falha ficam existentes; o e-mail e eventuais reservas permanecem, e a orientação é entrar/completar o perfil ou solicitar atendimento. Validar esse caminho em navegador. Não implementar cadastro novamente como se a identidade não existisse.
- AUD-03 a AUD-10 continuam fora do escopo. Em especial, as limitações conhecidas da limpeza de Storage e do job de publicação com foto não foram corrigidas por estas migrations.
- Não houve saneamento de destaques/contadores históricos; qualquer levantamento e reparação deve ser outra tarefa aprovada.
- Rollback do frontend isolado pode voltar a enviar colunas proibidas. Para recuperação, preferir corrigir o cliente ou desativar temporariamente a criação de publicações; não restaurar grants amplos nem a RPC destrutiva. Não há down migration automática: desfazer estes controles reabre os achados. Qualquer rollback SQL precisa de nova migration revisada e autorização específica. Nenhuma linha existente é apagada pelas migrations, portanto não há recuperação de dados a executar.

## Checklist de homologação / produção futura

- [ ] Confirmar conta GitHub, remote corporativo `Danielalveslira/treinos_academia`, projeto Supabase de destino e projeto Vercel correspondente; obter autorização específica antes de qualquer publicação/migration remota.
- [ ] Inspecionar grants de tabela/coluna e herdados, ownership, RLS/policies, corpos das RPCs, search_path e triggers efetivamente implantados. Comparar com as migrations locais.
- [ ] Aplicar migrations somente em homologação autorizada, sem editar migrations antigas; executar as mesmas suítes SQL.
- [ ] Fazer chamadas HTTP diretas a PostgREST com JWTs de anon/usuário/admin/serviço, testando INSERT/UPDATE/UPSERT e garantindo mensagens/erros previstos.
- [ ] Validar no navegador cadastro com falha intermediária, login/recuperação do perfil, aceite legal, postagem comum/enquete/treino/foto/progresso e cache de clientes antigos.
- [ ] Validar pagamento e nova promoção, moderação, votos e comentários; conferir débito único e ledger.
- [ ] Validar pedido oficial, bloqueio financeiro, revisão/separação, retenção, Storage e retry/confirmação do Auth com dados sintéticos. Não considerar os achados conhecidos de Storage resolvidos.
- [ ] Comparar publicações existentes antes/depois, sem saneamento em massa; conservar destaques/contadores pagos e válidos.
- [ ] Planejar rollout coordenado frontend/banco e correção posterior do AUD-10; registrar evidências e obter autorização de produção.
