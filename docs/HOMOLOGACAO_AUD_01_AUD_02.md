# AUD-01 / AUD-02 — validação de homologação e rollout

> Histórico local. Não existe homologação remota. O [parecer pré-deploy](PRE_DEPLOY_AUD_01_AUD_02_SEM_HOMOLOGACAO.md) substitui as exigências de homologação remota e o procedimento de journal sintético deste documento. O gerador atual não escreve no journal.

Data: 12/10/2026. Apenas workspace e stack local de homologação, com usuários e pagamentos sintéticos. Sem produção, migrations remotas, commit, push ou deploy. A autorização recebida é para homologação; a publicação continua suspensa pela instrução do usuário.

## Resultado e correções adicionais

Os cinco cenários solicitados passaram no ambiente local real: compatibilidade dos contratos, Auth/PostgREST/triggers/RLS, cadastro interrompido e recuperação, cinco tipos de publicação e promoção com EvoCash. Foram corrigidas duas incompatibilidades e preparada uma estratégia para evitar a janela entre migrations.

1. **Contrato de autoria durante o rollout.** O frontend antigo envia `author_username`/`author_is_superadmin`; a migration 02 os rejeitava. O frontend da primeira correção, por sua vez, omitia o nome no banco antigo, que ainda não o derivava. A nova migration `20261026000003_status_legacy_author_compat.sql` permite apenas INSERT desses dois campos como dicas descartáveis. `statuses_initialize_identity` sempre consulta `public.users` e sobrescreve nome/selo. UPDATE e UPSERT DO UPDATE continuam negados; campos financeiros, contadores, retenção e datas continuam fora da allowlist. O frontend conserva as dicas para o banco antigo. Nenhuma migration anterior foi editada.
2. **Retomada do cadastro.** `Register.jsx` guardava o UID somente depois de concluir o perfil; tentar novamente após uma falha podia chamar signUp de novo. Agora guarda o UID assim que Auth cria a identidade, reaplica as etapas idempotentes de perfil, mantém e-mail/senha vinculados à identidade existente e mostra “Concluir cadastro”. Se a página for abandonada, login, gate legal e Meu Perfil permitem a recuperação. Não há rollback destrutivo nem job financeiro automático durante um erro de cadastro.
3. **Janela entre 02 e 03.** Executar as migrations separadamente expõe, entre os commits, a allowlist estrita que rejeita o cliente antigo. `scripts/build-aud-migration-batch.mjs` gera `/tmp/evolutus-aud-rollout.sql`, envolvendo 01/02/03/04 em uma única transação, sem os BEGIN/COMMIT internos. Inclui hash dos arquivos, recarga do PostgREST e registro das versões quando o journal Supabase existe. O gerador não conecta nem aplica SQL. O pacote foi reaplicado no banco local durante 20 chamadas concorrentes de clientes legados; todas concluíram sem erro de autorização. O journal foi validado em uma tabela local sintética com o formato esperado, registrando as quatro versões.

4. **Promoção de comunidade sem pagamento, confirmada durante a validação.** O dono conseguia dar UPDATE direto com `promoted=true`, prazo em 2099 e vínculo nulo. A policy de linha autorizava o dono e o trigger de campos imutáveis não cobria esses campos. A nova migration `20261026000004_community_promotion_server_only.sql` adiciona um guard INSERT/UPDATE executado como o papel SQL do chamador, com owner postgres/search_path vazio e sem EXECUTE cliente. Usuários autenticados, inclusive administradores de aplicação, não alteram os três campos de promoção; serviço e RPCs DEFINER mantêm operações autorizadas. Não altera registros históricos. A edição de nome/descrição/acesso continua funcionando. As novas verificações SQL e HTTP confirmaram débito de 100 EvoCash, flags pagas preservadas diante de adulteração, cancelamento pela RPC e recusa de alteração direta de saldo/crédito de compra.

Alterações mínimas na aplicação nesta etapa: `src/services/statusesService.js` e `src/pages/Register.jsx`. Migrations adicionais: `supabase/migrations/20261026000003_status_legacy_author_compat.sql` e `supabase/migrations/20261026000004_community_promotion_server_only.sql`. Os testes SQL/JS de contrato foram ajustados para exigir sobrescrita das dicas, mantendo rejeição dos demais metadados. As migrations 01/02 e a trilha financeira oficial permanecem preservadas.

## Compatibilidade medida

“Antigo” corresponde ao código de HEAD (`f036475`) e às migrations anteriores a 01/02. “Novo” é o workspace e o esquema final 01+02+03+04. O snapshot do banco antigo contém as mesmas identidades sintéticas para comparar chamadas autenticadas; não contém jobs cron ativos.

| Frontend | Banco | Evidência |
|---|---|---|
| Antigo | Antigo | Serviço original compilado e chamado com sessão Auth real: INSERT por PostgREST e nome preservado |
| Novo | Antigo | Serviço atual compilado: INSERT por PostgREST e nome preservado pelas dicas de compatibilidade |
| Antigo | Novo final | Texto, enquete, treino, foto e progresso; nome/selo enviados falsos foram substituídos; fotos com upload/download reais |
| Novo | Novo final | Mesmos cinco tipos, autoria e metadados seguros; publicação adicional pelo formulário real da comunidade |
| Antigo | Intermediário somente 02 | Incompatibilidade reproduzida: erro 42501 nas dicas de autoria; não publicar esse estado isoladamente |

O banco antigo mantém os achados de segurança originais até receber as migrations. Compatibilidade funcional não significa segurança do esquema antigo.

### PWA e abas abertas

- Dois builds reais foram servidos sucessivamente na mesma origem local. O build antigo foi extraído de HEAD, com as dependências atuais do workspace; os dois builds usaram somente URL/chave anon locais.
- A aba antiga permaneceu com seu bundle em memória após o service worker instalar o shell novo. Publicações por seu serviço original continuaram funcionando no banco novo.
- Uma rota lazy antiga ainda não carregada recebeu 404 para o hash removido. O ErrorBoundary existente exibiu “Uma nova versão do app foi publicada” e “Recarregar página”; não houve reload automático. Após a confirmação, a rota da comunidade abriu com o bundle novo e publicou um texto pelo formulário real.
- Foto e progresso atravessaram INSERT real, XMLHttpRequest de upload e download autenticado do Storage. Não foram apenas mocks de SDK.
- O teste offline usou autoria válida e confirmou ausência do registro no banco. Cache Storage não guardou Auth, REST, RPC nem Storage privado.
- Não é necessário limpar indiscriminadamente caches/IndexedDB ou forçar reload de formulários em andamento. Uma rota antiga cujo chunk nunca foi carregado pode exigir o reload explícito já previsto pela aplicação. Isso permanece uma limitação de UX, com recuperação testada.

## Auth, triggers, permissões e RLS por HTTP

Stack real: PostgreSQL Supabase 17.11, GoTrue v2.197.0, PostgREST v16.4 e Storage v1.79.28. As tabelas atuais de Auth e Storage foram criadas pelos próprios serviços, sem a baseline sintética da primeira rodada. As migrations do app foram aplicadas como postgres. Auth local com autoconfirm, conforme o fluxo de cadastro atual. Testes usaram JWTs de usuário emitidos por signup/login do GoTrue; não apenas SET ROLE em SQL.

Containers próprios (`evolutus_homolog_*`), portas somente em 127.0.0.1 e `cron.launch_active_jobs=off` antes de aplicar migrations. O gateway de teste encaminha exclusivamente para portas locais. O Chromium bloqueia destinos externos. Realtime, entrega de e-mail e pagamento no provedor externo não fazem parte desta comprovação.

As 87 verificações HTTP confirmaram:

- signup/login, ensure_user_profile, nome, nascimento e aceite legal reais;
- compatibilidade dos contratos antigo/novo e derivação de nome/selo do cadastro real;
- recusa com 42501 de INSERT/UPDATE/UPSERT de `promoted`, `promoted_until`, `active_promotion_id`, votos, comentários, created_at, expires_at e retention_mode;
- INSERT com nome e selo falsos aceito como contrato legado, com valores persistidos corretos; UPDATE/UPSERT desses campos negado;
- autoria alheia, comunidade proibida, membro comum em `post_access=admins` e escrita de anon negados; dono permitido;
- DELETE de perfil e RPC de rollback negados por HTTP, sem perda de identidade;
- promoção autorizada cobrando 25 EvoCash, repetição sem cobrança dupla, cancelamento e nova promoção com outro débito; outro membro recebe NOT_OWNER;
- saldo sintético 100 → 75 → 75 → 50, com flags de promoção e contadores atualizados somente pelas RPCs autorizadas;
- cast_vote/comment_create atualizando os contadores mesmo sem UPDATE direto de authenticated.

A suíte SQL complementar continua cobrindo conta antiga/recente limpa/com saldo/compra pendente, service_role/worker, retenção financeira e moderação. Não houve saneamento histórico ou zeragem de destaques/contadores existentes.

## Cadastro interrompido e recuperação em Chromium

Foram injetadas respostas HTTP 503 em pontos definidos; as demais operações foram reais:

- Falha depois de reservar o nome, em set_birth_info: identidade e reserva continuaram existindo. “Concluir cadastro” retomou perfil/nascimento/aceite/perfil de uso, com exatamente uma chamada de signUp. E-mail ficou vinculado à conta já criada.
- Falha em set_username e abandono da página: nova sessão entrou com o mesmo e-mail/senha, informou nascimento no gate legal, aceitou os documentos, salvou o nome e escolheu perfil de uso em Meu Perfil. Nenhum signUp adicional e nenhuma identidade duplicada.
- Frontend antigo interrompido: as três tentativas de DELETE e a RPC antiga receberam 403; conta e reserva foram preservadas. A mensagem genérica antiga não promete limpeza. O usuário deve entrar ou atualizar o app para a experiência nova de retomada.

## Evidências finais

| Verificação | Resultado |
|---|---|
| Auth/PostgREST, compatibilidade e EvoCash | 87 verificações aprovadas + 18 verificações de promoção de comunidade/saldo/compras |
| Chromium, cadastro, uploads, formulário e PWA | 21 verificações aprovadas |
| Rollout transacional | 20/20 INSERTs legados durante a fase estrita; autoria/financeiro seguros; journal com quatro versões |
| 13 suítes PostgreSQL/pgTAP | 534/534 (matriz AUD agora 80 verificações) |
| JS relacionados | Contrato de escrita, contadores e erros Auth aprovados |
| Builds antigo e novo, configuração local | Ambos aprovados; aviso conhecido de chunk grande |
| npm run lint | 0 erros; 14 avisos preexistentes |
| npm test completo, fora do sandbox | 1.886/1.888; as duas falhas preexistentes permanecem |
| git diff --check e sintaxe dos scripts | Aprovados |

As falhas do npm test são `adminAccounts/utils/accounts.test.js` (usa data real com fixture de 10/10/2026) e `CatalogOfflineStatus.test.js` (estado ainda “Baixando” na asserção). O catálogo já passou isoladamente em rodadas anteriores; na rechecagem isolada desta rodada também falhou. Não declarar a suíte completa verde; esses arquivos de implementação/teste não foram modificados nesta tarefa.

Logs sem credenciais reais: `/tmp/aud-homolog-api.log`, `/tmp/aud-homolog-browser.log`, `/tmp/aud-homolog-atomic.log`, `/tmp/aud-homolog-community-finance.log`, `/tmp/aud-homolog-sql.log`, `/tmp/aud-homolog-js.log`, `/tmp/aud-homolog-build-old.log`, `/tmp/aud-homolog-build-new.log`, `/tmp/aud-homolog-lint.log`, `/tmp/aud-homolog-npm-test.log` e `/tmp/aud-homolog-catalog.log`. Sessões exclusivamente sintéticas necessárias aos scripts ficam em `/tmp/aud-homolog-sessions.json`, com permissão 0600; não copiar para o repositório nem publicar.

Ferramentas entregues: `scripts/homolog/start-aud-local.sh`, `scripts/homolog/aud-local-gateway.mjs`, `scripts/verify-aud-homolog-api.mjs`, `scripts/verify-aud-homolog-browser.mjs`, `scripts/verify-aud-rollout-atomic.mjs`, `scripts/verify-aud-community-finance.mjs`, `scripts/build-aud-migration-batch.mjs` e o runner SQL da primeira correção. Sem dependências novas.

Para repetir, iniciar os containers próprios com o script local em ambiente novo, aguardar Auth/Storage, preparar o banco com a sequência anterior a 01/02 como postgres, executar o script HTTP e construir os dois frontends com URL/chave locais. O script de navegador requer os builds `/tmp/aud-homolog-dist-old` e `/tmp/aud-homolog-dist-new` e as sessões geradas pelo teste HTTP. O script de concorrência requer o esquema final e reaplica somente o pacote no banco local. Containers/dados sintéticos permanecem disponíveis para inspeção. Não executar os scripts contra produção.

## Condições e bloqueios restantes para publicação

**Nenhum bloqueio funcional de AUD-01/AUD-02 foi observado nos cenários locais finais. A publicação não está autorizada e não foi realizada.**

Antes de publicar em homologação remota:

- [ ] Confirmar conta GitHub, remote corporativo `Danielalveslira/treinos_academia`, projeto Supabase de homologação e projeto Vercel correspondente; não usar o projeto de produção.
- [ ] Conferir se o artefato antigo publicado corresponde ao HEAD usado na matriz; clientes mais antigos que esse commit não foram comprovados.
- [ ] Inspecionar no destino grants de tabela/coluna/herdados, ownership, corpo do trigger, policies e schema do journal Supabase. Esta rodada não consultou o ambiente remoto e não comprova ausência de drift.
- [ ] Revisar o pacote transacional gerado e integrar sua execução/registro à ferramenta de migrations do destino. Não aplicar 02 e 03 em commits separados durante o rollout: essa janela foi reproduzida como incompatível. O pacote permite aplicar o banco primeiro com clientes antigos ativos; o frontend novo também funciona no banco antigo.
- [ ] Repetir HTTP, cadastro, Storage e PWA no projeto de homologação real, com identidades sintéticas e a configuração Auth desse projeto. Se a confirmação de e-mail estiver habilitada, validar também a sessão após confirmação; essa configuração difere do autoconfirm testado aqui.
- [ ] Resolver as duas falhas preexistentes da suíte JS ou registrar uma decisão explícita do responsável pelo release sobre elas. A suíte completa permanece um bloqueio para um gate que exige todos os testes aprovados.
- [ ] Obter autorização específica para a publicação de homologação. Produção continua não autorizada.

Não desfazer a segurança restaurando grants amplos ou a exclusão direta. Não remover a migration 03 isoladamente enquanto clientes antigos estiverem ativos; isso volta a quebrar o contrato. Para rollback do frontend, manter o esquema final com as dicas descartadas pelo servidor. Achados AUD-03 a AUD-10, em especial as limitações do worker/Storage, continuam fora do escopo destas correções.
