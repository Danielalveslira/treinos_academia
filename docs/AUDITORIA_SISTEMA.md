# Auditoria do sistema

**Data:** 12/10/2026 · **Commit:** `f036475138fa9730edcc51f55e49526107bb4a82`

**Resultado:** 10 achados: 2 de prioridade alta, 6 média e 2 baixa. Corrigir primeiro a exclusão direta de contas e a escrita de metadados controlados pelo servidor.

**Escopo:** revisão de React, serviços, funções Supabase, migrações SQL, autenticação, pagamentos, Storage e configuração de hospedagem; execução de build, lint, testes e auditoria npm. Código da aplicação não alterado.

**Limite:** não houve acesso à produção nem banco Supabase local em execução. Achados SQL são evidências estáticas das migrações disponíveis, consideradas na ordem dos arquivos; exploração e permissões efetivamente implantadas precisam de confirmação em homologação. Não foi feita auditoria do histórico Git nem teste completo de navegação em navegador.

**Registro histórico:** os achados abaixo descrevem o snapshot auditado em 12/10/2026, não o estado atual de produção. As publicações posteriores de AUD-01/AUD-02 estão documentadas em [STATUS_PUBLICACAO_AUD_01_AUD_02.md](releases/STATUS_PUBLICACAO_AUD_01_AUD_02.md), e a correção/publicação da AUD-04 em [STATUS_PUBLICACAO_AUD_04.md](releases/STATUS_PUBLICACAO_AUD_04.md). A AUD-05 continua pendente; este relatório não declara resolvidas as demais auditorias.

## Achados

### AUD-01 — Alta — Exclusão de conta contorna o fluxo oficial

- **Evidência:** `supabase/migrations/20260926000012_account_rollback.sql:4` define `delete_own_account()` como `SECURITY DEFINER`, executando diretamente `delete from auth.users where id = auth.uid()`. Não verifica idade da conta, saldo, compras pendentes ou revisão financeira. `src/services/authService.js:145` chama essa RPC. Nenhuma migração posterior restringe seu corpo ou revoga explicitamente seu acesso de `authenticated`; o hardening de 14/10 remove acesso de `anon`.
- **Impacto:** onde as dependências por chave estrangeira permitirem a exclusão, uma conta autenticada pode apagar a própria identidade fora do worker, sem revisão financeira, tratamento de arquivos ou trilha do fluxo oficial. Dependências podem impedir a operação em algumas contas; isso não constitui uma proteção de negócio.
- **Correção:** restringir a RPC ao rollback de cadastro recente, sem atividade ou movimentação financeira; encaminhar contas existentes ao processo de exclusão. Revisar também `users_delete_fresh`, que ainda permite exclusão direta do perfil nos primeiros dez minutos.
- **Validação:** em homologação, verificar o privilégio EXECUTE e tentar o rollback com conta antiga e conta recente com pendência; ambas devem ser negadas.

### AUD-02 — Alta — Publicações aceitam metadados que deveriam ser exclusivos do servidor

- **Evidência:** `supabase/migrations/20260926000029_statuses_owner_and_post_access.sql:16` valida autor e permissão de publicar, sem limitar colunas do INSERT. As migrações adicionam `promoted`, `promoted_until`, contadores de votos e `comment_count`. Os gatilhos de inserção sobrescrevem o selo de superadmin e a retenção, mas não esses campos nem `author_username`. O cliente insere diretamente em `statuses`.
- **Impacto:** com os grants padrão de INSERT do Supabase, um membro pode criar conteúdo com selo de destaque sem pagar, contadores inventados e nome de outro usuário na exibição. `StatusCard.jsx:487` decide mostrar o destaque pelo booleano e prazo recebidos. Isso não comprova crédito indevido na carteira.
- **Correção:** criar uma RPC de publicação com campos permitidos e revogar INSERT direto, ou conceder INSERT somente nas colunas editáveis. Derivar nome e data no servidor; inicializar promoção e contadores no backend.
- **Validação:** tentar inserir uma publicação com `promoted=true`, prazo futuro, contadores positivos e nome de outro usuário; esses valores devem ser rejeitados ou sobrescritos.

### AUD-03 — Média — Votos de enquete não validam opção e acesso no INSERT

- **Evidência:** `supabase/migrations/20260926000010_rls_policies.sql:66` mantém `status_votes_all`, com `WITH CHECK (user_id = auth.uid())`. No INSERT, a condição de comunidade em `USING` não autoriza a nova linha. `option_id` é texto livre, sem validação contra `poll_options`; não há correção posterior encontrada para essa política.
- **Impacto:** conhecendo um ID válido, o cliente pode tentar inserir voto em publicação de outra comunidade ou de outro tipo, e registrar opção inexistente. O resultado depende também dos privilégios implantados; o acesso de leitura continua sujeito à RLS.
- **Correção:** separar políticas por operação e validar filiação, acesso à conta, tipo `poll`, janela de interação e existência da opção no INSERT e UPDATE.
- **Validação:** negar voto fora da comunidade, em publicação de texto e em opção inexistente; aceitar opção válida de enquete acessível.

**Atualização em 14/10/2026 — corrigida em produção:** migration exclusiva `20261031000001_aud03_poll_vote_security.sql` aplicada e confirmada no journal remoto. A versão conflitante da candidata foi renomeada sem alterar migrations publicadas. Validação: 96 cenários API, 730 assertivas SQL, 1.912 testes JavaScript e 152 testes Edge, todos aprovados. Smoke de produção: 16 verificações com fixtures transacionais revertidas, zero recompensas; três leituras anônimas PostgREST recusadas. Um voto histórico auditado e preservado integralmente. Evidências em `docs/releases/AUD_03_VOTACOES.md` e `AUD_03_VOTACOES_EVIDENCIAS.json`.

### AUD-04 — Média — Worker não remove corretamente as fotos do Storage

- **Evidência:** `supabase/migrations/20261005000003_case_items_traceability.sql:192` coleta caminhos como `statusPhotos/<comunidade>/<status>.webp`. `supabase/functions/process-deletion-jobs/processor.js:50` passa esses caminhos integralmente ao bucket `status-photos`, cujo caminho real não contém `statusPhotos/`. Além disso, `.remove()` retorna `{ error }`, mas o worker só trata rejeição da promessa.
- **Impacto:** registros desaparecem, porém fotos permanecem armazenadas. O job pode ser contabilizado como processado mesmo com erro de remoção, sem tentativa posterior para esses arquivos.
- **Reprodução executada:** chamada ao worker com cliente simulado retornando erro de Storage. Resultado: caminho enviado com prefixo incorreto e resumo `{ ok: true, processed: 1, errored: 0 }`.
- **Correção:** normalizar caminhos relativos ao bucket, conferir `error` de cada operação e guardar uma tarefa persistente de limpeza com retentativa.

### AUD-05 — Média — Exclusão de publicação com foto atribui texto a array SQL

- **Evidência:** `supabase/migrations/20261005000003_case_items_traceability.sql:222`: `select photo_path into v_photo_paths`, sendo `photo_path` um `text` e `v_photo_paths` um `text[]`.
- **Impacto provável:** caminho comum como `statusPhotos/...webp` não é um literal válido de array PostgreSQL. A atribuição tende a gerar `malformed array literal`; o bloco de exceção mantém o job pendente e a publicação não é excluída por esse caminho. Evidência estática, sem reprodução em PostgreSQL nesta rodada.
- **Correção:** usar `array[photo_path]` com tratamento de nulo, ou variável escalar antes de montar o array.
- **Validação:** executar `run_deletion_job` para publicação com foto e para publicação sem foto.

### AUD-06 — Média — Recuperação de senha não permite definir a nova senha

- **Evidência:** `src/services/authService.js:135` apenas chama `resetPasswordForEmail`. `src/App.jsx` tem `/esqueci-senha`, mas não há formulário de nova senha, tratamento de `PASSWORD_RECOVERY` ou chamada `updateUser({ password })` no código pesquisado.
- **Impacto:** o usuário recebe o link, porém o aplicativo não conclui a troca da senha. O destino padrão depende da configuração `site_url` do Supabase.
- **Correção:** implementar rota de recuperação, configurar `redirectTo`, validar a sessão de recuperação e enviar a nova senha ao Auth.
- **Validação:** completar o fluxo por e-mail e confirmar login com a senha nova.

### AUD-07 — Média — Publicações sem limite preventivo no servidor

- **Evidência:** criação direta em `statuses` por `src/services/statusesService.js`; política de INSERT valida autor e comunidade. Não foi localizado contador, intervalo mínimo ou quota para criação de publicações nas migrações e funções atuais. Os limites de comentários e catálogo protegem outras operações.
- **Impacto:** membro autorizado pode automatizar grande volume de publicações, consumindo banco, notificações e armazenamento. Retenção posterior não limita a taxa de entrada.
- **Correção:** impor limite transacional por usuário antes da gravação, preferencialmente na RPC de publicação.
- **Validação:** enviar requisições concorrentes acima da quota e confirmar que somente o volume permitido é gravado.

**14/10/2026 — corrigida em produção:** migration `20261101000001_aud07_status_publication_rate.sql`, quotas 5/minuto, 30/hora e 100/dia UTC por usuário, com concorrência, rollback e clientes legados validados. Journal remoto 133 versões; smoke sintético transacional sem recompensa aprovado. Ver `releases/AUD_07_08_09_CORRECOES.md`.

### AUD-08 — Média — Dependências de desenvolvimento com vulnerabilidades conhecidas

`npm audit --json` retornou **4 pacotes afetados: 3 classificados como high e 1 moderate**. Prioridade contextual desta auditoria: média, pois as cadeias identificadas são de ferramentas de desenvolvimento/build; não foi demonstrada exploração no site estático publicado.

| Pacote instalado | Cadeia | Risco identificado |
|---|---|---|
| `vite@5.4.21` | Direta, devDependency | Falhas no servidor de desenvolvimento, incluindo acesso indevido a arquivos em condições específicas. |
| `esbuild@0.21.5` | Vite | Leitura de respostas do servidor de desenvolvimento por outros sites. |
| `brace-expansion@1.1.18` | ESLint → minimatch | Consumo excessivo de CPU/recursão com padrões maliciosos. |
| `source-map-js@1.2.1` | Vite → PostCSS | Negação de serviço ao processar source maps maliciosos. |

**Correção:** atualizar dependências e lockfile para versões corrigidas, validar compatibilidade de Vite/plugin React e repetir build/testes/audit. A solução sugerida pelo npm para Vite envolve mudança de versão major; revisar a migração antes de aplicar.

As condições e versões afetadas estão nos avisos de [Vite](https://github.com/vitejs/vite/security/advisories/GHSA-4w7w-66w2-5vf9), [esbuild](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99), [brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) e [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

**14/10/2026 — AUD-08 corrigida:** Vite 7.3.7 e transitivas corrigidas; audit completo e de produção com zero vulnerabilidades, npm ci/build/testes/PWA aprovados e build Vercel READY. Ver `releases/AUD_07_08_09_CORRECOES.md`.

### AUD-09 — Baixa — Configuração de hospedagem não declara headers de proteção

- **Evidência:** `vercel.json:8` configura apenas cache; não declara CSP, `frame-ancestors`/`X-Frame-Options`, `X-Content-Type-Options` ou `Referrer-Policy`.
- **Impacto:** proteção contra enquadramento em sites externos e defesa adicional contra injeções não estão garantidas pelo repositório. Headers efetivos podem ser adicionados pela infraestrutura, que não foi consultada.
- **Correção:** configurar headers globais e CSP compatível com os recursos utilizados; conferir respostas reais do ambiente publicado.

**14/10/2026 — AUD-09 corrigida em produção:** CSP bloqueante e headers HTTP confirmados em 14 rotas/recursos Vercel; navegador mobile/desktop, Auth, SW e bloqueio de script injetado aprovados. Scripts inline do boot externalizados; caches preservados. Ver `releases/AUD_07_08_09_CORRECOES.md`.

### AUD-10 — Baixa — Teste do painel depende da data real e falha

- **Evidência:** `src/features/adminAccounts/utils/accounts.test.js:230` usa registros relativos a `NOW = 2026-10-10`, mas o helper desse teste chama `filterAccounts` sem passar `NOW`. A função usa `Date.now()` por padrão.
- **Reprodução executada:** esperado `['uso-recente']`; recebido `[]` em 12/10/2026. A falha persiste na execução isolada e não demonstra defeito do filtro em produção.
- **Correção:** passar `NOW` ao filtro ou controlar o relógio no teste.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm run build` | Aprovado; aviso de chunk acima de 500 kB. |
| `npm run lint` | 0 erros; 14 avisos. |
| `npm test` | 213 arquivos reportados: 210 aprovados e 3 com falha inicial. |
| Rechecagem de `businessDate` e `CatalogOfflineStatus` fora do sandbox | Aprovada: 21 testes reportados. `businessDate` apresentou `spawnSync EPERM` no sandbox; a falha de catálogo não persistiu na rechecagem. |
| Teste isolado de `adminAccounts/utils/accounts` | 13 aprovados; 1 falha por relógio não controlado (AUD-10). |
| `npm run test:functions` | 14 arquivos aprovados. |
| `npm run test:backfill` | 3 arquivos aprovados. |
| `npm audit --json` | 4 pacotes vulneráveis: 3 high e 1 moderate. |
| Simulação do worker com erro de Storage | Confirmou caminho incorreto e sucesso indevido (AUD-04). |
| Testes SQL/RLS em banco e navegação completa | Não executados nesta rodada. |

## Configurações e documentação a conferir

- `supabase/config.toml:225` desativa confirmação de e-mail; senha mínima é 6 e `secure_password_change=false`. `authService.js` reconhece que o gate de verificação não bloqueia com autoconfirm. Conferir a configuração hospedada e adaptar o cadastro antes de habilitar confirmação, pois ele depende de sessão imediata.
- `KNOWN_LIMITATIONS.md` descreve Firebase, Firestore Rules e arquivos removidos. Atualizar para Supabase: esse documento não comprova os controles existentes hoje.

## Ordem de correção

1. Fechar exclusão direta e metadados de publicação: AUD-01/AUD-02.
2. Corrigir votos, limpeza de arquivos e job de exclusão: AUD-03/AUD-04/AUD-05.
3. Concluir recuperação de senha, limitar publicações e atualizar dependências: AUD-06/AUD-07/AUD-08.
4. Ajustar headers e teste de relógio: AUD-09/AUD-10.

Após as correções, validar SQL/RLS em homologação com chamadas diretas à API, incluindo tentativas negativas; os testes JavaScript atuais não certificam essas permissões.
