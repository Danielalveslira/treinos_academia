# AUD-07, AUD-08 e AUD-09 — corrigidas e comprovadas em produção

14/10/2026. **GO executado.** Banco publicado primeiro, frontend/dependências/headers depois, com verificação efetiva do domínio Vercel. Não se alterou AUD-06, Edge Functions, EvoCash, compras, regras de recompensa, expiração, moderação ou exclusão de contas. Modificações alheias de prompts/relatórios de imagens ficaram fora dos commits.

Destinos confirmados: GitHub **Danielalveslira / Danielalveslira/treinos_academia / main / origin**; Supabase **ywrjojrjgozdfpddkkuy**, ACTIVE_HEALTHY; Vercel **treinos_academia / prj_WYVlCGYu021KZCrqfp62qRH2cbIE**, conta danielalveslira, Node 24.x. A baseline era `5231cc45995ca4683d848dd13e3be7e1f999618a`. Foram lidos os relatórios de AUD-01/02/03/04/05 e expiração antes da alteração.

## AUD-07 — quota transacional de publicações

**Antes:** todos os criadores encontrados usam INSERT em `public.statuses`: texto, enquete, treino, foto e progresso/foto, com clientes atuais e PWA antigos. Conquista é um tipo SQL válido, também protegido. Não há RPC de criação que substitua esse caminho. Imports/seeds e manutenção usam a credencial de backend. RLS e allowlist já protegiam autoria, comunidade, retenção, promoção e contadores, mas não a taxa. O schema remoto tinha 132 migrations conhecidas, sem quota ou trigger equivalente. Um ensaio do contrato anterior com papel authenticated/RLS real aceitou **20 posts rápidos** em transação local revertida.

Volume remoto consultado apenas por contagens: **3 posts presentes, 2 nas últimas 24 horas, máximo de 3 por autor**. A expiração remove histórico, portanto esses números são um limite inferior do uso, não uma reconstrução completa da atividade. Escolheram-se limites generosos para esse uso observado e para os cinco tipos de publicação, sem modificar recompensas:

| Janela por usuário, compartilhada entre comunidades/tipos | Quota |
|---|---:|
| Minuto UTC | 5 |
| Hora UTC | 30 |
| Dia UTC | 100 |

São janelas **fixas**, definidas pelo servidor; a virada pode permitir uma rajada em cada janela adjacente. Não se afirma janela deslizante. Os limites de hora/dia restringem automação continuada. Nenhum post histórico foi contado retroativamente, apagado ou corrigido.

**Mudança:** `20261101000001_aud07_status_publication_rate.sql` cria `private.status_publication_limits`, PK por usuário, RLS sem policies e sem grants de cliente/serviço. Um trigger AFTER INSERT, SECURITY DEFINER e `search_path=''`, bloqueia apenas a linha do usuário. Obtém o relógio depois do lock, evitando que timestamps antigos de requisições enfileiradas recuem a janela. Armazena três contadores, sem scans de `statuses`, sem cron/worker ou crescimento por publicação. A exclusão de posts não reduz os contadores; a exclusão oficial do usuário faz cascade somente desse controle.

AFTER INSERT conta somente uma linha realmente criada: `ON CONFLICT DO NOTHING` não dispara o trigger; duplicidade, UPDATE/UPSERT proibido, erro e rollback não consomem quota. Um INSERT com várias linhas que excede o limite é revertido integralmente. Uma foto cujo registro foi criado e depois apagado por cancelamento/falha do upload **continua contada**: devolver quota na exclusão permitiria contornar a proteção. Não se trata de uma transação de criação abortada.

Não se revogou o INSERT legado nem se criou RPC nova. O papel SQL da sessão, preservado em chamadas SECURITY DEFINER, determina o controle. Administradores usando sessão authenticated têm a mesma quota. Somente os papéis internos/backend já privilegiados ficam fora dela, para imports e manutenção; não existe flag de cliente ou bypass por superadmin no aplicativo. A credencial de serviço não é exposta ao frontend. Rejeição retorna **PT429 / HTTP 429** e tempo de recuperação em `details`; `publicationError.js`, `StatusForm.jsx` e `CommunityDetail.jsx` mostram mensagem simples e preservam o formulário. Clientes antigos recebem a mesma recusa do banco, mesmo sem a nova mensagem.

**Testes:** 21 checks Auth/PostgREST reais locais e 14 pgTAP. Incluem os cinco tipos, membro/não membro/anon, superadmin, recuperação de minuto/hora/dia, deletion sem reset, retry idempotente com ID, duplicidade, rollback, INSERT multirow, isolamento de usuários e papel interno. **24 requisições concorrentes: 5 aceitas e 19 recusadas; p95 HTTP 216,36 ms** nesse ensaio. Uma segunda sessão manteve o contador de um usuário bloqueado enquanto outro publicou sem esperar: não há lock global. O cliente antigo que cria outro ID numa repetição cria outra publicação e consome quota; não se inventou deduplicação por conteúdo.

Benchmark SQL em 10 usuários × 5 posts, com RLS real e rollback, sem a suíte JS concorrendo:

| Caminho | Antes | Depois |
|---|---:|---:|
| Média por INSERT | 2,007 ms | 2,165 ms |
| p95 por INSERT | 2,587 ms | 2,947 ms |

**Produção:** dry-run selecionou exclusivamente AUD-07; publicação pela CLI oficial com `--linked --project-ref ywrjojrjgozdfpddkkuy --skip-vault --yes`, sem seeds/roles/Vault/repair. Journal **132 → 133**, última entrada `20261101000001 / aud07_status_publication_rate`. Smoke remoto com papéis reais fez **7 verificações**, criou 5 posts próprios sintéticos e recusou o sexto, comprovou proteção do contador e recusou não membro. Toda a fixture foi revertida na mesma transação. **Zero recompensas ou pendências financeiras geradas.** É smoke SQL/RLS de produção; Auth/PostgREST de escrita foi exercitado localmente, sem criar contas persistentes remotas.

Posts existentes, voto histórico, ledger (105 linhas), compras (19), carteiras (3), promoções (6), policies/grants de posts/votos, crons e todas as funções anteriores tiveram snapshots iguais antes/depois. Expiração permanece ativa, sem erros de fila, e outbox Storage sem pending/failed. AUD-01 a AUD-05 e histórico financeiro foram preservados.

Commit AUD-07: **d3940477c9cfc14979c0dbfb5ce8ca088ae95213**. Resultado: **GO / corrigida em produção**.

## AUD-08 — dependências de desenvolvimento/build

**Antes:** o audit atual confirmou os mesmos quatro pacotes afetados, agregando **3 high e 1 moderate**, todos na cadeia de desenvolvimento/build. Vite era direto; esbuild vinha do Vite, source-map-js do PostCSS e brace-expansion de ESLint/minimatch. Não foi atribuída exploração de runtime ao site estático.

| Pacote | Antes instalado | Depois instalado |
|---|---:|---:|
| Vite | 5.4.21 | 7.3.7 |
| esbuild | 0.21.5 | 0.28.2 |
| brace-expansion | 1.1.18 | 1.1.21 |
| source-map-js | 1.2.1 | 1.2.2 |

Somente Vite mudou como dependência direta; `package-lock.json` foi atualizado com as transitivas corrigidas. Não houve `npm audit fix --force`, remoção de funcionalidades ou atualização geral de runtime. O plugin React já instalado, 4.7.0, é compatível e foi mantido. Escolheu-se Vite 7 para manter Rollup/esbuild e não introduzir o pipeline Rolldown/Oxc do Vite 8. Conforme a [migração oficial do Vite 7](https://v7.vite.dev/guide/migration.html), o novo padrão de navegadores muda; `vite.config.js` agora fixa o alvo anterior ES2020/Edge 88/Firefox 78/Chrome 87/Safari 14. Local e Vercel usam Node 24, compatível com o novo requisito.

**Depois:** `npm ci` passou; **npm audit completo = 0 vulnerabilidades e npm audit --omit=dev = 0**. Evidência real em `AUD_07_08_09_EVIDENCIAS.json`, sem inferir zero apenas pela versão. Build, splitting charts/markdown/Primer, lazy loading, SW e precache permanecem funcionais.

| Boot, gzip nível 9, mesma configuração | Antes | Depois |
|---|---:|---:|
| JS | 307.092 B | 308.096 B |
| CSS | 74.055 B | 74.043 B |
| Arquivos no BOOT_ASSETS | 4 | 4 |

JS aumentou **1.004 B / 0,327%**, CSS diminuiu 12 B. O budget antigo correspondia a um build mais antigo: o CSS **já falhava antes desta tarefa**. A baseline foi alinhada ao build inicial capturado acima, sem aumentar a tolerância de **3%** e sem usar o tamanho novo como baseline. O budget final passou. Os dois scripts públicos do boot também integram o shell versionado, além do BOOT_ASSETS medido.

O smoke offline inicial procurava “Finalizar exercício”, botão inexistente no `WorkoutForm` já publicado, que salva cada série imediatamente. Corrigiu-se apenas o verificador para esperar a outbox persistida depois de “Concluir série”; não se removeu a assertiva de gravação. Smoke final passou: **41 assets essenciais**, cold start sem aquecimento manual, snapshot/saldos restaurados, nenhum flash bloqueante, nenhum RPC/Realtime no boot offline, gravação IndexedDB/outbox, reconexão e atualização do SW. Nenhum código de treino foi alterado.

Commit AUD-08: **4c12dc2fa8748f189a711430aa5b0aebfea6aeaf**. Resultado: **GO / toolchain corrigida, build publicado READY**.

## AUD-09 — headers HTTP e CSP efetivos

**Antes:** GETs de homepage, login, deep link, manifest e service worker confirmaram ausência de CSP, nosniff e Referrer-Policy. A Vercel já fornecia HSTS `max-age=63072000; includeSubDomains; preload`; não se adicionou outra política HSTS conflitante. `vercel.json` só declarava caches.

**Inventário real:** Auth/PostgREST/Storage/Edge/Realtime usam o Supabase do projeto, HTTPS e WSS. A origem pública configurada das imagens legadas do catálogo é **firebasestorage.googleapis.com**, resolvida pela variável pública autorizada; não foram impressos valores sensíveis. As chamadas InfinitePay/exerciseapi são feitas no backend; pagamento no cliente usa navegação de página, sem script ou iframe externo. Links WhatsApp/Instagram também navegam externamente. Fontes são de sistema/local. Avatar, fotos e compartilhamento usam blob/data; comunidades/anúncios permitem imagens HTTPS externas. Não foi encontrado contrato de incorporação do app por terceiros.

Dois scripts inline do HTML foram movidos para `public/boot-theme.js` (síncrono antes do paint) e `public/boot-fallback.js` (tela de segurança). O handler inline do botão foi substituído por listener. Ambos entram no shell e no hash de versão do SW, com `no-cache` no servidor. A CSP não precisa de script `unsafe-inline`, `unsafe-eval`, nonce estático ou `*`.

Headers declarados e **confirmados na Vercel**:

| Header | Valor/contrato |
|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://ywrjojrjgozdfpddkkuy.supabase.co wss://ywrjojrjgozdfpddkkuy.supabase.co https://firebasestorage.googleapis.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| X-Frame-Options | `DENY`, coerente com frame-ancestors |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |
| Strict-Transport-Security | Preservado pela infraestrutura Vercel |

`style-src 'unsafe-inline'` é necessário pelos estilos React/Primer/styled-components e atributos inline existentes; removê-lo sem nonce/refatoração quebraria a interface. Isso **não libera execução de scripts**. `img-src https:` mantém o contrato de imagens externas de comunidades/anúncios; connect-src permanece limitado às origens realmente usadas. Nenhuma CSP por meta tag foi usada para frame-ancestors.

**Ensaios:** primeiro Report-Only e depois CSP bloqueante no mesmo build servido localmente: 10 casos de comunidades/mobile/desktop/temas por etapa, zero violações no uso normal. Três telas de autenticação, registro do SW/precache e bloqueio real de script inline injetado também passaram. A violação deliberada da injeção é esperada e contabilizada separadamente.

**Produção:** `verify-aud789-production-http.mjs` conferiu **14 rotas/recursos reais**: homepage, login, cadastro, recuperação existente, SPA deep link, manifest, SW, boot-theme, boot-fallback, ícone e JS/CSS atuais. Todos HTTP 200; todos com headers esperados; JS/CSS e SW com MIME correto. Assets mantêm cache imutável de um ano; SW/boot com no-cache; HTML sem immutable. No navegador do site publicado, **10 casos mobile/desktop/temas**, três telas Auth, SW e injeção bloqueada passaram, sem exceções de página ou violações normais CSP. Todas as chamadas Supabase desse smoke de navegador foram interceptadas com fixtures, sem ler/escrever contas reais. Não houve teste financeiro real nem alegação de conserto da recuperação AUD-06.

Commit AUD-09 e SHA funcional publicado: **3a3731267c83cd05d36adddc2463a7b74ed8a27c**, push normal confirmado em origin/main. Vercel production **READY**, deployment **dpl_44MrX3SQVPqdqM2887HDaqNDbh1W**, https://treinosacademia-46yjw07xb-danielalvesliras-projects.vercel.app; alias público https://treinosacademia-ten.vercel.app. Resultado: **GO / proteção HTTP efetiva comprovada em produção**.

## Testes integrados, recuperação e limites

- **1.913 JavaScript, 152 Edge, 23 testes de scripts**, zero falhas/skip; **744 assertivas pgTAP** (14 novas + 730 regressões), 21 checks de quota API e 96 checks de votação AUD-03. Comentários, feed, promoção, exclusões, Storage, compras/financeiro e expiração preservados.
- Lint: zero erros, 14 warnings anteriores. Build e npm ci aprovados; aviso anterior de chunk grande preservado. Budget final aprovado conforme baseline pré-mudança documentada. `git diff --check` aprovado.
- Snapshots privados de recuperação/metadados em `/tmp/aud789/predeploy-snapshot.json` e `postdeploy-snapshot.json`, sem exportação de dados pessoais ou credenciais. Logs iniciais e finais são preservados, incluindo erro do verificador offline e nome de tabela incorreto no primeiro ensaio do smoke, corrigido antes de executá-lo em produção.
- Banco: falha da migration reverte a transação; após publicação, conservar contadores e preparar migration corretiva, sem apagar quotas ou reabrir grants/RLS. Não desativar finanças/expiração nem restaurar policies vulneráveis. Frontend: em incidente crítico, o deployment anterior READY de `5231cc4` é compatível com a quota do banco; retorno seria contenção temporária, **reabrindo AUD-08/09**, seguida de release corretiva. Em problema específico de CSP, testar correção ou Report-Only mantendo demais headers antes de novo push.
- Não há homologação remota, worker/cron novo ou Edge republicada. Nenhum voto/post histórico foi saneado. Métricas de latência são locais, sem garantia de SLA; volume presente não recompõe posts expirados. O smoke de criação remoto foi transacional/SQL, com rollback; o navegador publicado usou dados simulados.

As três AUD estão encerradas pelas evidências de produção acima. O commit documental deste relatório pode gerar outro deploy automático sem mudança funcional; o SHA remoto final e seu READY são confirmados na resposta de encerramento.
