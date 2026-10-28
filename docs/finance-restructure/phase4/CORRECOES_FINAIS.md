# Fase 4.1 — correções finais das vitrines

Trabalho retomado na branch local `finance-storefront-phase4-1`, worktree `/tmp/evolutus-finance-phase4-1`, a partir de `finance-storefront-phase4` (`cd54a79`). O planejamento mestre foi lido integralmente, junto de `ENTREGA.md`, `INVENTARIO.md`, `ARQUIVOS.md` e das evidências anteriores. Este documento atualiza as decisões editoriais, SEO e manutenção descritas na entrega original.

Implementação e homologação exclusivamente locais. Sem push, merge, deploy, alteração de produção, cobrança real, alteração da InfinitePay ou implementação da Fase 5. Preços, créditos e limites do preview são fixtures sintéticas, não condições de lançamento.

## 1. Causas identificadas

| Problema | Causa real |
| --- | --- |
| Edição interrompia período pago | Rascunho e publicação compartilhavam campos e revisão da âncora comercial; cada edição invalidava a aprovação usada pelo motor. |
| Alterações/imagens não podiam coexistir com publicação | A projeção pública consultava diretamente os produtos em edição; não havia referências separadas à mídia aprovada. |
| SEO conservador | Detalhe mantinha `noindex`; catálogo entregava estrutura sem produtos antes do JavaScript; sitemap não incluía vitrines elegíveis. |
| Custo das consultas | Predicado comercial privilegiado executado repetidamente, materialização de produtos também para agrupar, payload duplicado e plano genérico inadequado para filtros pontuais. Os planos internos mostraram ainda 10.000 verificações de direitos/restrições na consulta de categorias. |
| Legado sem publicação | Produtos antigos não têm proprietário verificável nem direito comercial. O inventário histórico da Fase 0 registrou **dois produtos**, em 27/10/2026 às 18:13 UTC (`phase0/baseline.json`); isso não é uma nova contagem de produção. |
| Uploads abandonados | Exclusão dependia da conclusão do pedido HTTP; quedas podiam deixar alocações ou arquivos prontos sem associação, sem coletor operacional. |

## 2. Revisão editorial e integridade

`product_storefronts` mantém o rascunho com `draft_revision` e `draft_state`. `storefront_publications` e `storefront_published_products` conservam exclusivamente a última publicação aprovada. Produtos e imagens possuem FKs compostas para a mesma vitrine. As tabelas de snapshot têm RLS e nenhum acesso direto por anon/authenticated/service role.

Descrição, informações comerciais, preço informativo dos produtos, imagens, inclusão e arquivamento de produtos alteram somente o rascunho. Submissão e decisão usam CAS e o lock da âncora já existente. A aprovação substitui o snapshot inteiro na mesma transação; reprovação conserva o anterior. A auditoria registra a revisão do rascunho efetivamente editado.

A âncora aprovada permanece estável enquanto há edição, permitindo renovar pelo motor existente sem aprovar o rascunho. Uma aprovação nova invalida cotações de revisão antiga, exigindo revalidação. Edição, aprovação, rejeição, associação de legado e manutenção de mídia não escrevem em carteira, ledger, pedidos ou prazos.

Todas as projeções públicas, sitemap e autorização de imagens exigem snapshot aprovado correspondente à âncora, proprietário ativo e sem restrição impeditiva, integração habilitada e direito habilitado dentro de `starts_at/expires_at`, avaliados no PostgreSQL. A suspensão editorial ou comercial bloqueia todas as versões imediatamente. Aprovar depois do vencimento **não** cria nem estende direito. A remoção explícita de suspensão exige administração reautenticada e auditada.

O backfill copia somente conteúdo já aprovado e coerente na instalação. Não tenta reconstruir versões antigas que a Fase 4 já tivesse sobrescrito antes desta correção. Conteúdo nessas condições precisa de nova revisão administrativa; nenhum histórico é inventado.

## 3. Migrations e instalação futura

Aplicar, nesta ordem, depois de `20261201000001_product_storefronts.sql`:

1. `20261202000001_storefront_editorial_revisions.sql`: revisões privadas, snapshots, FKs, backfill conservador, projeções públicas e RPC de sitemap.
2. `20261202000002_storefront_media_maintenance_legacy.sql`: referências de mídia, tolerância/leases, limpeza limitada/auditada, transição explícita do legado e agendamento condicionado.

Há timeouts de locks e statements; grants de funções privilegiadas são fechados explicitamente. Nenhum preço, compensação, gratuidade ou venda é habilitado pelas migrations. A limpeza nasce desabilitada e sem tolerância definida.

A sequência completa Fase 4 → 4.1 foi aplicada em transações sobre a base descartável da Fase 3 nos benchmarks, com rollback. A instalação anterior no preview e a atualização final das RPCs também ficaram restritas ao banco descartável. Não foi executado `db push` remoto. Um novo banco limpo com todas as migrations é gate do CI, ainda dependente da autorização de push.

Para uma futura liberação autorizada, coordenar migrations, Edge `storefront-media-cleanup`, handler de catálogo/detalhe/sitemap e frontend. Configurar política oficial de limpeza e Vault somente após decisão operacional. Rollback deve preservar o schema aditivo e os snapshots: **não** restaurar a consulta pública antiga que lia o rascunho. Pausar novas vendas quando necessário; compensações continuam exclusivamente pelas operações financeiras auditadas existentes.

## 4. SEO e respostas HTTP

O handler de detalhe entrega título, descrição, canonical e conteúdo dos produtos aprovados no próprio HTML. Usa `CollectionPage`/`ItemList` e produtos com nome, descrição, marca, imagem e URL válidos; não inventa ofertas, estoque, avaliações ou dados de estabelecimento. O catálogo entrega uma primeira página útil antes do JavaScript e reaproveita esse mesmo payload na ilha React, evitando nova consulta inicial redundante.

Vitrines elegíveis recebem `index,follow`; filtros de catálogo recebem `noindex,follow` e canonical do catálogo. Catálogo vazio permanece não indexável. Conteúdo indisponível responde **404** neutro e não indexável; falha de backend responde **503**, sem dados anteriores. A identidade da URL se mantém na renovação; 404 é apropriado porque a indisponibilidade pode ser temporária.

O sitemap dinâmico usa paginação por UUID, inclui somente vitrines publicáveis com produtos e remove as expiradas/suspensas na consulta corrente. Ajusta os vencimentos pelo tempo de processamento e falha fechado se o backend falhar ou se o limite de 50.000 vitrines exigir particionamento futuro. Respostas HTML, sitemap, RPC e mídia usam `no-store`; não há cache que amplie direitos. Handlers também descartam conteúdo cujo direito termina durante a consulta HTTP.

O catálogo e o detalhe retiram visualmente conteúdo ao vencer, usando o prazo do servidor. Ao carregar mais itens, o catálogo conserva o menor prazo já carregado. APIs e mídia continuam sendo a autoridade mesmo se o JavaScript estiver desligado ou adulterado. Bytes já recebidos e cópias externas não são revogáveis.

**Períodos curtos:** inclusão em sitemap e HTML indexável permitem descoberta, mas não garantem que o buscador visite antes do vencimento. Remover uma URL do sitemap e responder 404 não apaga instantaneamente índices externos. Renovação restaura a mesma canonical quando o direito voltar a ser válido.

`seo-http.json` registra respostas reais do preview com user agent de crawler e navegação com JavaScript desabilitado. Os testes unitários cobrem escaping, dados estruturados, backend indisponível e expiração durante a preparação da resposta. A edição pendente criada pelo teste SEO permanece privada no preview para revisão.

## 5. Performance comparável

`phase41-performance.mjs` instala a Fase 4 em transação descartável, cria a massa, mede a RPC anterior, aplica as duas migrations e mede a nova RPC na **mesma massa e conexão**, com rollback final. Oito execuções por operação/etapa; p50/p95 são descritivos dessa pequena amostra local, não SLA ou p95 de produção. `auto_explain` fica desabilitado durante as medições e é habilitado separadamente para registrar planos internos com ANALYZE/BUFFERS. Sem tráfego de produção ou metas arbitrárias.

| Massa | Operação | p50 antes → depois (ms) | p95 antes → depois (ms) |
| --- | --- | --- | --- |
| 100 vitrines / 1.000 produtos | Agrupamento | 13,215 → 4,872 | 28,586 → 16,987 |
| mesma | Busca/categoria/página | 13,233 → 8,444 | 34,246 → 13,129 |
| mesma | Categorias | 4,768 → 2,461 | 5,439 → 11,695 |
| mesma | Detalhe | 1,033 → 2,228 | 1,513 → 2,546 |
| mesma | Produto individual | 4,679 → 2,268 | 22,184 → 3,163 |
| 1.000 vitrines / 10.000 produtos | Agrupamento | 78,483 → 23,681 | 96,960 → 42,645 |
| mesma | Busca/categoria/página | 140,179 → 70,681 | 170,587 → 111,883 |
| mesma | Categorias | 56,350 → 17,861 | 91,092 → 33,766 |
| mesma | Detalhe | 3,796 → 1,933 | 14,500 → 2,286 |
| mesma | Produto individual | 49,702 → 1,408 | 57,718 → 2,007 |

Foram revisados os índices da âncora, direito único por recurso, produtos legados e paginação. Nenhum índice foi acrescentado às tabelas existentes. A tabela nova de produtos publicados recebe `(storefront_id, display_order, product_id)`, usado nos planos de acesso por vitrine. O índice parcial de coleta ordena somente mídias potencialmente abandonadas.

As melhorias vêm de joins relacionais, elegibilidade materializada por vitrine, filtragem por UUID antes de materializar, separação dos modos da RPC e ausência do array global de produtos duplicado no modo agrupado. O produto individual resolve primeiro sua vitrine. A RPC usa plano customizado para não reutilizar um plano genérico de catálogo em uma consulta por ID. Esse planejamento custa aproximadamente 1 ms adicional no detalhe da massa pequena, registrado acima; não se declara melhora universal. Categorias materializam a elegibilidade uma vez, eliminando as verificações repetidas por produto observadas nos planos internos.

Contagens integrais permanecem somente onde são consumidas pelo total e pela paginação da interface; não foram criadas consultas N+1 no cliente. O bootstrap HTTP evita uma consulta duplicada. A paginação administrativa do legado encerra ao acabar e bloqueia clique concorrente.

Mídia continua comprimida no cliente, limitada a 1 MB, com imagens lazy e dimensões definidas. O gateway faz autorização → Storage → reautorização: as duas verificações são necessárias para impedir entrega após expiração/suspensão durante IO. A limpeza limita cada execução a 20 objetos; não realiza varredura/exclusão irrestrita no Storage. Não se introduziu cache nem se retirou validação para reduzir latência. A latência de Edge/Storage em produção ainda requer medição autorizada; o laboratório comprova o fluxo e os limites, não capacidade ou tempo de rede de produção.

Planos e amostras: `evidence41/performance-paired-{100,1000}.log` e `performance-nested-plans-{100,1000}.log`. O arquivo exploratório `performance-paired.log` é anterior e não fundamenta a tabela final.

## 6. Legado: inventário e transição

O inventário da Fase 0 mostra dois registros na tabela antiga, sem coluna de proprietário. Não há evidência suficiente para atribuí-los automaticamente a usuários. Ambos permanecem com decisão de titularidade pendente até apresentação de evidência. Não foram consultados ou modificados registros atuais de produção nesta etapa; a listagem administrativa oferece o inventário corrente paginado, incluindo fingerprint da linha.

Dependências preservadas: PK/constraints de `partner_products`, validações/trigger de imagem, campos de aprovação e janela histórica, índices anteriores, formulário/lista administrativos e URLs de imagem existentes. O histórico de dependências está em `phase0/security-inventory.json`; a nova FK de produto publicado impede apagar uma origem ainda referenciada. A policy pública sem contrato já havia sido retirada na Fase 4 e não foi restaurada.

Superadmin reautenticado pode escolher **Associar a vitrine**, verificar destino/proprietário/revisão, informar referência da prova de titularidade e confirmar. A RPC verifica CAS da vitrine, fingerprint do produto, limite, titular ativo, permissão e idempotência. A operação preserva a linha original completa na auditoria e a URL antiga em `legacy_image_url`; limpa apenas as antigas flags/janelas que poderiam sugerir autorização comercial.

O resultado é um produto privado em rascunho. Precisa receber imagem pelo upload protegido, passar por moderação e possuir direito vigente para publicar. Nenhum arquivo externo é apagado ou importado automaticamente; não há cobrança, crédito, publicação gratuita ou prazo artificial. A tela administrativa permite consultar detalhes das operações, incluindo evidência e preimagem. Sem prova, conservar o produto na administração.

Após associação de todos os registros e decisão explícita sobre retenção, o CRUD/formulário exclusivamente legado e os índices antigos de publicação poderão ser reavaliados. Hoje ainda têm consumidores e histórico, portanto não foram removidos.

## 7. Arquivos abandonados e recuperação

Referências em rascunhos, produtos (inclusive arquivados), publicação aprovada e produtos publicados impedem coleta. Substituir/excluir uma imagem no rascunho não apaga aquela utilizada pela publicação. Quando a última referência desaparece, um trigger inicia `unreferenced_since`; a tolerância conta desse momento, não da criação do arquivo.

A tolerância é configurável de 1 a 720 horas, sem valor oficial inicial. Upload possui lease de cinco minutos e só pode ser finalizado enquanto vigente. O coletor usa o mesmo lock da âncora das associações, `SKIP LOCKED`, nova checagem de referências, estado `deleting`, token exclusivo e lease de execução. Imagens em exclusão não podem ser associadas.

A Edge Function obtém do banco os caminhos autorizados e ignora caminhos enviados no corpo. Remove bytes, confirma a exclusão por token e registra sucesso/falha em `commercial_order_events`. Falha ou interrupção mantém linha recuperável; retry tem backoff, lease e confirmação idempotente. Clientes não podem atestar a exclusão no Storage. Cada lote seleciona no máximo 20 arquivos (RPC admite até 50 para operadores autorizados).

O job roda a cada 15 minutos, mas só envia requisição se a limpeza estiver habilitada e os secrets Vault `storefront_cleanup_url` e `storefront_cleanup_service_key` estiverem configurados. Sem isso, é inerte. A configuração e execução manual estão na administração, com reautenticação; nenhuma configuração operacional de produção foi feita. Evidências reais de deleção: `media-http.json`; falha/retry, referências e concorrência: SQL e `concurrency.json`.

## 8. Reuso, remoções e qualidade

Reutilizados `private.lock_storefront`, auditoria `commercial_order_events`, autenticação/reautenticação administrativa, limites/CAS, Storage e validação WebP existentes, compressão de imagens, componentes Primer e a ilha pública. Carteira, ledger, cotação/contratação/renovação/reversão e preços continuam exclusivamente nas implementações das Fases 1–3.

Removidos dos caminhos substituídos: invalidação automática da aprovação em cada edição, leitura pública dos produtos em rascunho, noindex incondicional do detalhe, payload global duplicado no agrupamento e consulta inicial redundante do catálogo. A SQL compartilhada da fixture de vitrine foi extraída para `_helpers/storefront_fixture.sql`; preserva as asserções anteriores e permite novos testes. O smoke HTTP anterior foi reaproveitado com `--phase41`, sem duplicá-lo.

Não foram removidos históricos, migrations, dependências de pagamento ou funções de recuperação. Não houve refatoração geral nem novo `!important`. Componentes alterados foram revisados pelos critérios de hooks, estado, acessibilidade, concorrência e requisições das skills React/verification. Os testes administrativos foram atualizados para a RPC de legado, preservando os cenários de edição/cancelamento/imagem.

Inventário exato com SHA-256 em [`source-manifest41.json`](source-manifest41.json). Grupos de arquivos modificados/adicionados:

| Área | Arquivos |
| --- | --- |
| SQL | Duas migrations `2026120200000{1,2}_*.sql`; `supabase/tests/{product_storefronts_test,storefront_revisions_test}.sql`; `_helpers/storefront_fixture.sql`. |
| Público/SEO | `api/{_storefront-public,storefront,storefront-catalog,storefront-sitemap}.js`; `public/storefront-detail.{css,js}`; `scripts/public-preview-plugin.js`; `vercel.json`. |
| Interface | `src/components/{CommercialAdmin,PartnerProductList,StorefrontManager,StorefrontMaintenance}.jsx`; `src/features/publicProducts/{PublicProductsIsland.jsx,publicProductCatalogService.js}`. |
| Serviços/erros | `src/services/storefrontService.js`; `src/utils/storefront.js`. |
| Testes JS/CI | `CommercialAdmin.test.js`, `storefrontService.test.js`, `catalogBootstrap.test.js`, `tests/storefront-{public-handler,seo}.test.mjs`; `.github/workflows/supabase-tests.yml`. |
| Edge | `supabase/functions/storefront-media-cleanup/index.ts`; `supabase/config.toml`. |
| Homologação | `scripts/homolog/finance/phase41-{preview,validate,browser,visual,expiration,media,seo,performance}.mjs`, `phase4-http.mjs`, `scripts/storefront-revisions-concurrency.mjs`. |
| Entrega | Este relatório, manifest e evidências textuais/JSON em `evidence41/`. |

## 9. Validação e evidências

Os resultados consolidados e hashes estão em `evidence41/quality.json` e `source-manifest41.json`. Logs completos permanecem em `evidence41/`; capturas são locais e ignoradas pelo Git, conforme `docs/CAPTURES_POLICY.md`.

| Verificação | Evidência |
| --- | --- |
| SQL | Nove suítes, **350 asserções**: revisão 67, vitrine 75, motor 58, preço EvoCash 57, InfinitePay 32, integridade 17, reversões 18, comercial público 20, imagem legada 6. |
| Concorrência real | Edições e aprovações concorrentes têm um vencedor; coletor ignora associação em andamento; saldo insuficiente, replays de confirmação/renovação, renovações independentes e suspensão concorrente preservam débito único e prazo. `concurrency.json`. |
| Navegador completo | Criação, edição, upload/substituição, prévia, submissão/aprovação, contratação, reprovação preservando público, expiração com página aberta, renovação, suspensão e sessão autenticada/anônima. `browser.json`. |
| HTTP e SEO | Sete cenários adversariais com Auth/REST/Storage/Edge reais; leitura privada negada, autoria/validade protegidas e sessão revogada negada. HTML útil sem JS, robots/canonical/schema/sitemap e 404 reais. `http.json`, `seo-http.json`. |
| Mídia | Alocação não finalizada e upload pronto sem associação coletados após tolerância; bytes referenciados preservados; repetição segura. `media-http.json`. |
| Expiração paginada | Carregar página com prazo posterior não amplia o prazo dos itens anteriores. Navegador real, RPC mockada identificada em `pagination-expiration.json`. |
| Visual | Catálogo e gerenciamento em 320/390/1440, claro/escuro; administração de vitrines/motor nas mesmas combinações, incluindo novo modal Primer de limpeza. Sem overflow ou pageerror. `browser.json`, `admin-visual.json`. |
| JavaScript | **2.253 testes** no gate completo do aplicativo; **20 testes diretamente afetados**, incluindo administração/serviços/SEO. `app-tests.log`, `affected-js.log`, `admin-js.log`. |
| Release | **91 testes aprovados**, incluindo scanners, catálogo e release sem publicação. `release-tests.log`. |
| Gates | Lint sem erros (16 warnings preexistentes), build, budget e scanners de fonte/build. O aviso preexistente do chunk Primer permanece. |

Matriz dos 15 cenários obrigatórios: edição durante contrato, aprovação após vencimento, rejeição, suspensão com pendência, renovação com pendência e mídia aprovada são cobertos na suíte de revisões e no browser; edições/aprovações/coleta concorrentes em conexões independentes; acesso expirado, URL privada, terceiros, titular/restrições e sessão revogada em SQL/HTTP; upload abandonado e recuperação no teste de mídia; expiração com página aberta e paginação no browser. Os cenários editoriais verificam também saldo e entitlement inalterados.

Falhas do sandbox ao iniciar subprocessos foram reexecutadas com a permissão necessária, sem alterar controles da aplicação. O primeiro gate completo detectou cinco fixtures antigas de `CommercialAdmin` que ainda esperavam leitura direta da tabela; foram corrigidas para a RPC paginada e revalidadas. Não se suprimiu teste ou erro para obter aprovação.

## 10. Preview atualizado

- [Catálogo](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/vitrine).
- [Gerenciamento](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/vitrine/gerenciar).
- [Administração de vitrines e mídia](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/admin/parcerias?tab=commercial).
- [Motor comercial](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/admin/parcerias?tab=engine).

Preview local da branch corretiva, com PostgreSQL, Auth, REST, Edge e Storage descartáveis. Acesso às contas sintéticas permanece no arquivo **local ignorado** `.finance-local/phase4-access.json`; não versionar senhas/sessões. A disponibilidade do endereço depende deste workspace e do encaminhamento da porta 5173, sem deploy remoto.

Reprodução no ambiente descartável já preparado:

```sh
node scripts/homolog/finance/phase41-preview.mjs
node scripts/homolog/finance/phase4-seed.mjs
npm run dev -- --config .finance-local/preview.config.mjs
# Em outro terminal:
node scripts/homolog/finance/phase41-validate.mjs
node scripts/homolog/finance/phase41-browser.mjs
node scripts/homolog/finance/phase4-http.mjs --phase41
node scripts/homolog/finance/phase41-media.mjs
node scripts/homolog/finance/phase41-seo.mjs
node scripts/homolog/finance/phase41-visual.mjs
node scripts/homolog/finance/phase41-expiration.mjs
PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/storefront-revisions-concurrency.mjs
node scripts/homolog/finance/phase41-performance.mjs 100
node scripts/homolog/finance/phase41-performance.mjs 1000
```

O launcher pressupõe a stack descartável anterior com migrations instaladas; não instala migrations em ambiente remoto. O benchmark requer o container descartável da Fase 3 (`evolutus_commercial_phase0_20261027`), sem Fase 4 instalada, e termina com rollback. Suítes SQL também revertem as fixtures. Os scripts de browser/concorrência criam registros sintéticos persistentes **apenas** na stack local. Execute o seed novamente antes de repetir o browser completo; ele pressupõe uma carteira sintética nova.

## 11. Pendências e limites

Dependem de decisão comercial: preços oficiais, limites de cadastro/contratação, tolerância/retenção de mídia, provas de titularidade dos dois registros históricos, condições jurídicas e compensações por indisponibilidade. Nenhuma política foi inventada ou ativada em produção.

Dependem de liberação operacional: CI remoto (sem push autorizado), instalação real e teste de Vault/cron no ambiente de destino, homologação de cold start/latência de Edge em rede real e verificação do roteamento/includeFiles no deployment. O preview utiliza o mesmo handler público, mas não substitui essa prova de hospedagem. O sitemap exige particionamento se ultrapassar 50.000 vitrines; nessa condição retorna indisponibilidade em vez de entregar índice incompleto silenciosamente.

Capturas e conteúdo já recebidos por terceiros não podem ser revogados, e o Evolutus não controla a retenção nos buscadores. Mídias ainda referenciadas por conteúdo arquivado permanecem conservadas; sua retenção depende de política explícita, não de um coletor agressivo.

## 12. Integridade das Fases 1–4 e preparação da Fase 5

Não foi criado motor financeiro paralelo, publicação sem direito, cobrança por edição, renovação automática ou extensão silenciosa. A aprovação do snapshot e a autorização comercial permanecem requisitos independentes. As regressões SQL/concorrência cobrem débito/ledger/pedido/direito atômicos, idempotência, suspensão, reversões e compras EvoCash existentes. FKs impedem referências quebradas; RLS/grants mantêm versões privadas inacessíveis.

Fases 1–4 permanecem coerentes no ambiente homologado. A Fase 5 não foi iniciada e continua sujeita ao seu escopo próprio: conectar profissionais/estabelecimentos sem duplicar contratação, carteira ou expiração. Prontidão técnica local não significa autorização de cobrança ou produção.
