# Fase 5 — perfis profissionais e estabelecimentos com EvoCash

Entrega local para revisão, 28/10/2026. Branch `finance-profiles-phase5`, baseada em `finance-storefront-phase4-1` (`2555661`). Planejamento mestre relido integralmente; auditoria anterior às alterações em [INVENTARIO.md](INVENTARIO.md). Sem push, merge, deploy, alteração de produção ou cobrança real.

## 1. Resumo executivo

Profissionais e estabelecimentos usam as entidades editoriais existentes e o motor comercial único. Preparar um cadastro é gratuito; publicar exige snapshot aprovado, proprietário ativo, direito vigente e ausência de bloqueios. A edição mantém a última versão aprovada, enquanto a revisão fica privada. Aprovar após o vencimento não reativa a publicação. Renovar preserva a identidade e utiliza a confirmação financeira existente.

`/minha-vitrine` continua sendo o único gerenciamento profissional/de estabelecimento. `/profissionais` e `/locais` oferecem diretórios públicos, filtros no servidor, paginação, detalhes em modal e páginas estáveis com HTML para crawlers. Administração em `/admin/vitrines`; precificação independente no motor já existente em `/admin/parcerias?tab=engine`.

## 2. Arquivos

Relação completa de código e testes: [ARQUIVOS.md](ARQUIVOS.md). Evidências textuais/JSON ficam em `evidence/`; capturas PNG são artefatos locais regeneráveis, conforme `.gitignore`. O manifesto registra hashes das migrations e das capturas finais.

Principais responsabilidades:

- `20261203000001_professional_commercial_publication.sql`: vínculo concreto, recuperação do legado, guard/lock editorial compartilhado, snapshots, projeções públicas, referências de mídia e autorização.
- `MyProfessionalListing`, `ProfessionalListingForm`, `AdminProfessionalListings`: preparação, prévia privada, contratação, moderação com revisão explícita e comparação com a versão aprovada.
- `CommercialLeasePurchase`, `CommercialOrderHistory`, `ListingLegalNotice`: componentes compartilhados e ciência jurídica preservada.
- `PublicListingsIsland`/serviço: diretório público sem carregar o contexto financeiro da aplicação.
- `api/listings.js`, sitemap, rewrites e service worker: HTML aprovado e controle de indisponibilidade/cache.
- Scripts `phase5-*`, teste SQL específico e concorrência: verificações reproduzíveis locais.

## 3. Migrations e instalação

Uma migration nova, aditiva: `20261203000001_professional_commercial_publication.sql`. Migrations históricas não foram modificadas. Ordem: fases anteriores, `20261201000001`, `20261202000001`, `20261202000002`, nova migration.

Instalação completa sobre banco-base das fases anteriores, dentro de transação revertida, registrada em [migrations-reinstall.log](evidence/migrations-reinstall.log). O teste inclui um estabelecimento legado publicado sem rascunho: dados, contatos, versão e referência histórica de imagem permanecem; o rascunho é recuperado, sem aprovação ou direito gratuito. Operações antigas interrompidas em `publishing` voltam a rascunho sem apagar o conteúdo.

A migration não cria tarifas, saldos nem vendas ativas. Apenas marca as duas integrações concretas como disponíveis. O catálogo existente mantém preços e disponibilidade sob decisão administrativa.

## 4. Estruturas reutilizadas

`professional_listings.kind` é a entidade real dos dois tipos; `professional_listing_drafts` e `published_professional_listings` já separavam rascunho e publicação. Foram reaproveitadas, sem novas tabelas de perfis ou um terceiro sistema de snapshots.

A âncora em `private.commercial_resources` recebe FKs compostas de identidade, proprietário e oferta gerada a partir de `kind`. Trocar proprietário/tipo não é uma edição permitida. A aprovação valida também a existência do snapshot concreto. O predicado relacional de elegibilidade e os controles de transição/lock são compartilhados com vitrines de produtos.

Reutilizados `commercial_offerings`, versões de preço, pedidos, eventos, entitlements, carteira, ledger, cotação, confirmação, renovação e reversão. Nenhuma RPC nova de débito.

## 5. Fluxo financeiro

Após aprovação, o proprietário escolhe dias, solicita cotação e confirma explicitamente o total. `quote_commercial_order` e `confirm_commercial_order` validam oferta, recurso, proprietário, sessão, estado editorial, preço versionado e saldo. Mantidos locks, atomicidade, idempotência e ledger. O componente bloqueia cliques concorrentes; o banco protege também reenvios e conexões independentes.

Profissional e estabelecimento usam ofertas distintas. Alterações de tarifa não recalculam contratos anteriores. Pagamento não remove suspensão. Saldo insuficiente direciona para a compra existente de EvoCash; a recarga não confirma a contratação automaticamente.

## 6. Fluxo editorial

Criar → salvar rascunho incompleto ou completo → prévia privada → enviar → superadmin aprovar/reprovar → contratar. Salvar, enviar, aprovar e arquivar exigem revisão explícita; uma revisão obsoleta falha, sem sobrescrever dados recentes. Respostas perdidas são recuperadas relendo o estado, sem publicar ou cobrar novamente.

Salvar altera somente o rascunho. Reprovar mantém o snapshot anterior. Aprovar substitui atomicamente o snapshot. Cada decisão administrativa exige justificativa, sessão ativa e autenticação recente. Suspender bloqueia o recurso independentemente da revisão ou do saldo. O arquivamento voluntário preserva dados e contratos.

## 7. Profissionais

Mantidos nome, apresentação, categoria, modalidades, especialidades, cidade/UF, atendimento, contatos HTTPS e comunidade vinculada de propriedade verificável. Imagem comercial protegida separada do avatar pessoal. Cadastro e edição gratuitos. Nenhuma capacidade nova de criar/vender fichas comerciais, marketplace, comissões, saques ou repasses foi adicionada. As fichas comerciais permanecem no módulo administrativo existente do Evolutus.

## 8. Estabelecimentos

`kind=space` usa o mesmo adaptador editorial/comercial. Mantém campos úteis e acrescenta endereço comercial e horários públicos, também sujeitos à aprovação. Gerenciado em `/minha-vitrine`, sem duplicar páginas. Preservada a regra estrutural existente `unique(owner_id)`: um cadastro de um dos tipos por conta. O sistema anterior não oferecia múltiplos locais por proprietário. Não foi inventado um limite comercial novo.

Foi preservado o modelo existente de imagem principal substituível; não havia galeria ou entidade adicional de locais a migrar. Serviços/especialidades continuam nos campos suportados, sem formulário genérico excessivo.

## 9. Expiração e renovação

O PostgreSQL determina visibilidade por `statement_timestamp()` e entitlement. Dia contratado = 24 horas. Não depende de cron, frontend ou refresh. APIs, listagens, detalhes, sitemap e gateway de mídia exigem o mesmo direito.

Renovar um direito ativo acrescenta dias ao vencimento atual; após expiração, começa novo período confirmado, mantendo perfil e histórico. Nenhuma renovação automática. Frontend usa duração informada pelo servidor e tempo decorrido para invalidar estado, detalhes e imagens, sem confiar no relógio do dispositivo. Páginas diretas já abertas também removem conteúdo, título, imagens e JSON-LD ao vencer. Respostas futuras negam o conteúdo mesmo que um buscador mantenha a URL em seu índice.

## 10. Moderação, legado e mídia

Administração mostra proprietário, rascunho, snapshot, estado comercial, vencimento, contratos e eventos. A suspensão registra evidências do período contratado para eventual política futura de compensação; não executa reembolso.

Inventário read-only reproduzível em `supabase/tests/professional_legacy_inventory.sql`; contagens da homologação em [legacy-local-inventory.log](evidence/legacy-local-inventory.log). São registros locais, majoritariamente sintéticos, e não uma nova leitura de produção. Não existem divergências de proprietário/tipo ou rascunhos faltantes nesse inventário após recuperação.

Cadastros legados recebem âncora privada com seu proprietário real, sem aprovação/publicação paga gratuita. Não são apagados. Snapshots e imagens pessoais históricas permanecem preservados; o caminho antigo deixa de conferir acesso comercial público. O proprietário prepara uma nova revisão e envia imagem pelo gateway protegido. Cadastros sem rascunho recuperam dados do snapshot e passam por nova revisão.

Mídia reutiliza `storefront_media`, bucket privado, compressão, verificação real de bytes/tamanho e as Edge Functions existentes. A coluna histórica `storefront_id` passa a apontar para a âncora comercial, com comentário de schema; FKs compostas impedem associar mídia de outro recurso. Referências do rascunho e da publicação entram no mesmo coletor da Fase 4.1. Substituir/remover imagem no rascunho não remove o arquivo aprovado.

Limpeza usa tolerância configurável, leases, verificação de referências sob lock, lote limitado, reprocessamento e eventos por oferta correta. Foram excluídos órfãos reais de Storage na homologação, preservando bytes referenciados. Associação concorrente é ignorada pelo coletor. Endpoints de upload/limpeza e bucket continuam autorizados no servidor.

## 11. SEO

HTML entregue diretamente por HTTP contém nome, apresentação, localização, especialidades, contatos aprovados e canonical estável. Não depende da execução de React para crawlers. URLs: `/profissionais/:uuid` e `/locais/:uuid`; UUID mantém identidade estável, sem mutações de slug em edições. Nome legível aparece em título e conteúdo. URL antiga de estabelecimento em `/profissionais/:id` redireciona 308 para `/locais/:id` apenas quando elegível.

`Person` para profissionais; `LocalBusiness` somente com endereço/cidade/UF aprovados suficientes; sem endereço completo, não inventa um negócio local. Sem preços fictícios ou horários estruturados inferidos de texto livre. Canonical único. Filtros/paginação e catálogos vazios não são indexáveis. Indisponível: 404 neutro/noindex; falha de backend: 503, sem reutilizar conteúdo antigo. Sitemap inclui exclusivamente recursos elegíveis e falha fechado. Revalida os prazos de produtos e perfis após todas as consultas, impedindo que uma consulta lenta de outro diretório mantenha URL vencida.

Respostas públicas e mídia usam `no-store`; service worker não serve cópia offline desses caminhos. Contratos curtos limitam naturalmente o tempo de descoberta orgânica. Expirar retira a URL do sitemap e bloqueia o conteúdo no servidor, sem promessa de desindexação externa instantânea.

## 12. Performance

`EXPLAIN (ANALYZE, BUFFERS)` e `auto_explain` aninhado, com 200 e 2.000 perfis/estabelecimentos sintéticos. Comparação final usa a mesma massa, conexão, filtros, direitos e oito amostras por operação, revertendo a transação. **Antes** é a implementação comercial segura sem o ajuste de join; **depois** preserva exatamente a elegibilidade. Logs exploratórios `performance-legacy-*` não fundamentam esta comparação, pois o diretório legado não validava contratos.

| Volume total | Operação | p50 antes (ms) | p50 depois (ms) |
|---:|---|---:|---:|
| 200 | Profissionais | 34,368 | 1,800 |
| 200 | Estabelecimentos | 50,752 | 1,755 |
| 200 | Filtros | 23,286 | 1,458 |
| 200 | Paginação | 35,116 | 1,721 |
| 2.000 | Profissionais | 29,979 | 13,339 |
| 2.000 | Estabelecimentos | 20,268 | 10,083 |
| 2.000 | Filtros | 14,739 | 4,354 |
| 2.000 | Paginação | 16,339 | 9,822 |

A estimativa baixa de igualdade entre revisões fazia o planner percorrer âncoras globais antes de ordenar/limitar snapshots. O join lateral com barreira `OFFSET 0` mantém a seleção ordenada e filtrável na frente da autorização por recurso. Reutilizados índices existentes de kind/localização/modalidades, PKs e entitlement único. Nenhum índice ou cache novo.

Medições locais apresentam variância elevada (p95 nos logs), não representam SLA nem produção; não se deve comparar tempos de volumes diferentes como curva controlada. Um ambiente compartilhado não permite excluir todo ruído. Não foram inventadas metas. O payload do diretório é enxuto, há limite+1 sem contagem integral, busca explícita sem polling e detalhe sob demanda. Imagens são comprimidas até 1 MB/1.000 px e carregadas sob demanda; Storage/Edge conserva dupla autorização antes/depois do IO.

## 13. Código removido e qualidade

Removidos do frontend fluxos prepare/finalize/delete/unpublish/reativação sem revisão e ações duplicadas no hook administrativo. Os endpoints históricos perigosos falham fechado e o finalizador não é executável pelos clientes. A suspensão utilizada por denúncias foi mantida e adaptada ao lock/moderação compartilhados: não se removeu um consumidor legítimo.

Removidos helpers de filtros combinatórios e wrapper de aceite antigo sem consumidores; as tabelas de evidência jurídica permanecem. Reutilizados componentes Primer, sem `!important`, sem refatorar módulos financeiros/InfinitePay. Corrigidos modo de atendimento nulo, botões longos em cards, estado de erro sem falso sucesso e acesso Vite limitado ao checkout/dependências. Scanner agora verifica caminhos relativos à raiz revisada: continua rejeitando artefatos privados no build, inclusive binários, mesmo quando o checkout fica dentro de uma pasta ignorada.

## 14. Segurança e evidências

[SEGURANCA.md](SEGURANCA.md) relaciona os 25 cenários solicitados às evidências. SQL testa RLS, propriedade, FK, oferta, revisão, expiração, moderação, mídia e ledger. Conexões independentes testam os dois adaptadores em edição/aprovação simultânea, reenvios de pagamento, renovações independentes, limpeza concorrente e suspensão contra confirmação.

HTTP real testa rascunhos e snapshots por tabela/RPC, edição por terceiro, upload por terceiro (403), detalhe/mídia expirados (404), sitemap e metadados sem a revisão pendente. Navegador testa ambos os ciclos completos, visitantes, sessão autenticada, erros de rede e falha no upload sem perda da imagem aprovada. Uma conta sintética colocada em exclusão por ação administrativa no preview foi preservada nesse estado; o acesso foi corretamente negado e os testes seguintes usaram novas contas.

## 15. Testes e gates

- 17 suítes SQL, **683 asserções aprovadas**: [sql-summary.json](evidence/sql-summary.json).
- Concorrência real dos dois perfis: [concurrency.json](evidence/concurrency.json); regressão de vitrines: [storefront/concurrency.json](evidence/storefront/concurrency.json).
- Suíte JavaScript completa: **2.246 aprovados**; após limpeza pontual, **32 testes afetados aprovados**. Logs [javascript-all.log](evidence/javascript-all.log) e [affected-js.log](evidence/affected-js.log).
- Edge Functions: **206 aprovados**: [functions.log](evidence/functions.log).
- Release/HTTP/SEO/scanners: **110 aprovados**: [release-http-tests.log](evidence/release-http-tests.log).
- Fluxos reais: [browser.json](evidence/browser.json), [http-seo-security.json](evidence/http-seo-security.json), [detail-browser.json](evidence/detail-browser.json), [media-http.json](evidence/media-http.json), [upload-failure.json](evidence/upload-failure.json).
- 66 capturas finais e verificação de conteúdo carregado, overflow, temas e modais: [visual.json](evidence/visual.json). As capturas iniciais de carregamento foram substituídas pela execução estável.
- Build, lint (0 erros/16 avisos preexistentes), budget, scanner source e dist. Logs homônimos em `evidence/`. Boot dentro do orçamento existente. Sem exceção para ignorar conteúdo privado no scanner.

Uma primeira execução completa de JS apresentou uma falha de temporização preexistente do teste offline (`idle`/`synced`) sob carga simultânea. A repetição completa passou sem alterar o módulo/teste offline. Limitação registrada, sem desativar o teste.

Reprodução local, no worktree e com a stack descartável disponível:

```sh
node scripts/homolog/finance/phase5-preview.mjs
npm run dev -- --config .finance-local/preview.config.mjs
node scripts/homolog/finance/phase4-seed.mjs
node scripts/homolog/finance/phase5-seed.mjs
node scripts/homolog/finance/phase5-validate.mjs
PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/professional-listings-concurrency.mjs
node scripts/homolog/finance/phase5-browser.mjs
node scripts/homolog/finance/phase5-http.mjs
node scripts/homolog/finance/phase5-detail-browser.mjs
node scripts/homolog/finance/phase5-media.mjs
node scripts/homolog/finance/phase5-upload-failure.mjs
node scripts/homolog/finance/phase5-visual.mjs
node scripts/homolog/finance/phase5-performance.mjs 100
node scripts/homolog/finance/phase5-performance.mjs 1000
```

Os scripts de seed/concorrência alteram **somente** o banco descartável com tarifas/saldos sintéticos. Não devem ser usados em produção. O browser de história cria perfis; para repeti-lo, semear novas contas antes. Tokens ficam exclusivamente em `.finance-local`, negada pelo HTTP e ignorada pelo Git. Os scripts de performance/reinstalação sempre revertem a transação. CI remoto preparado com os testes novos, sem execução remota ou push nesta etapa.

## 16. Preview, riscos e decisões comerciais

Base: `https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev`.

- Visitantes: `/profissionais`, `/locais` e URLs de detalhes nos cards.
- Proprietários dos dois tipos: `/minha-vitrine`.
- Moderação: `/admin/vitrines`.
- Motor: `/admin/parcerias?tab=engine`.

Credenciais sintéticas vigentes são apresentadas na entrega e armazenadas apenas no arquivo local de acesso, sem tokens neste relatório. O preview depende do Codespace, Vite e containers locais; não é deployment remoto persistente.

Pendências comerciais: preços oficiais, mínimos/máximos de dias, disponibilidade de lançamento e política de compensação/reembolso por indisponibilidade administrativa. Não foram presumidas. A tolerância/job de limpeza exige configuração operacional aprovada. Antes de liberar produção: revisar dados reais/legado, aprovar tarifas, executar CI remoto e smoke no ambiente autorizado, configurar job auxiliar caso desejado. Nenhuma dessas decisões foi ativada em produção.

Limites do ambiente: não foram medidos tráfego real, latência regional, CDN ou Storage de produção. A configuração de empacotamento/rewrites foi preparada e testada localmente; deployment Vercel remoto não foi realizado. Não se afirma aprovação do CI remoto.

## 17. Integridade das Fases 1 a 4.1

Regressões afetadas confirmam preservação de carteira, ledger, cotações, compras de EvoCash, preços versionados, motor comercial, reversões, vitrines, moderação e mídia. Não existe nova carteira, débito paralelo, contrato editorial gratuito, cobrança automática ou pagamento que remova suspensão. Cadastros não apagam históricos financeiros. Aprovação e direito comercial permanecem condições independentes, verificadas no servidor.

Nenhuma alteração de produção, push, merge, publicidade, Fase 6 ou modificação da InfinitePay foi executada. A entrega fica isolada para revisão.
