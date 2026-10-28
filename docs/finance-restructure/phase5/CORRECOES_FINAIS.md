# Fase 5.1 — correções finais e múltiplos cadastros

Entrega local de 28/10/2026. Base `finance-profiles-phase5` (`8c802ea`); branch isolada `finance-profiles-phase5-1`, worktree persistente `.finance-local/phase51`. Sem produção, deploy, push, merge, pagamento real ou Fase 6.

## 1. Resumo

Um proprietário administra vários perfis e estabelecimentos, com contratação, edição, snapshot, mídia, expiração e histórico independentes. `/minha-vitrine` passa a ser a central paginada; o formulário anterior é reutilizado por UUID. O motor financeiro permanece único e não foi modificado para resolver a multiplicidade editorial.

## 2. Problemas e causas

- `unique(owner_id)`, criação que retornava o primeiro registro do proprietário e getter sem ID impediam a multiplicidade.
- O estado React único reunia seleção, criação e edição; trocar de recurso poderia herdar estado se o editor não fosse remontado por identidade.
- `admin_accounts_snapshot` fazia join direto de contas com listings: três cadastros geravam três linhas da mesma conta. A regressão foi reproduzida em SQL antes da correção.
- O diretório descartava toda a página no primeiro vencimento, retirando visualmente recursos ainda válidos.
- O seletor de comunidades buscava os primeiros 200 registros globais e só depois filtrava proprietário; um dono poderia não encontrar sua comunidade e recebia campos desnecessários.
- O bootstrap usava o relógio monotônico do documento como idade do novo HTML; navegação Turbo conserva esse relógio entre visitas.
- O teste offline de ACK perdido esperava 40 ms e alterava o transporte global enquanto uma rodada de background podia estar em andamento. Nesse caso, a rodada seguinte podia terminar legitimamente em `idle`, pois a anterior já havia sincronizado.
- Uma fixture de limpeza assumia que o primeiro token de um lote global pertencia à sua mídia, falhando quando o banco local continha órfãos anteriores.

## 3. Arquitetura

Mantidas `professional_listings`, drafts e snapshots aprovados. Removida apenas a unicidade do proprietário; IDs, FKs compostas de proprietário/tipo/oferta e âncoras existentes permanecem.

Criação recebe chave UUID de intenção, única por proprietário. Reenvio retorna o mesmo cadastro; usar a chave para outro tipo falha. Locks no usuário serializam contagem/limite/criação. A assinatura antiga sem chave e o getter sem UUID falham explicitamente, em vez de escolher um registro arbitrário.

`get_my_professional_listing(p_listing_id)` valida propriedade; `list_my_professional_listings` retorna resumos em páginas de 12, com cursor UUID, limite+1 e sem contagem integral/contratos/preços por linha. O editor lazy é remontado com `key=id`, isolando formulário, imagem, cotação e histórico. Atalhos de gerenciamento e renovação apontam para o cadastro específico; a contratação identifica nominalmente a versão aprovada do recurso.

Limites por tipo têm revisão e auditoria no painel existente de moderação. Sem linha configurada: novas criações bloqueadas. Zero: pausa criações. NULL explicitamente escolhido: sem teto de quantidade, preservando elegibilidade/rate limits. A contagem inclui rascunhos e arquivados para não permitir bypass por arquivamento. Reduzir limite não apaga nem suspende cadastros existentes e não impede renovação.

## 4. Migrations

- `20261204000001_multiple_professional_listings.sql`: multiplicidade, intenção idempotente, índice de proprietário/tipo/ID, política de limites, RPCs e grants mínimos.
- `20261204000002_admin_account_listing_summary.sql`: agrega listings por dono no resumo de contas, preservando os guards efetivos anteriores; acrescenta quantidade sem duplicar contas.

Migrations históricas não foram alteradas. Nenhuma tarifa, saldo, limite comercial ilustrativo ou venda é semeado pelas migrations. A tabela de limites nasce vazia.

Upgrade acumulado Fases 4/4.1/5/5.1 executado sobre baseline local com rollback. Hashes de carteiras, ledger, pedidos e direitos idênticos antes/depois; legado com versão, contato e imagem histórica preservado. Evidências: `migrations-reinstall.log`, `migration-registry.json`, `source-manifest51.json`.

## 5. Arquivos

Inventário completo em [ARQUIVOS51.md](ARQUIVOS51.md). Alterações principais: serviço editorial, central/edição, administração de limites, resumo administrativo/CSV, invalidadores dos diretórios, helper de idade de navegação, consulta de comunidades, teste offline e harnesses/CI. Evidências novas em `evidence51`, preservando os relatórios históricos.

## 6. Reutilização e mídia

Reutilizados cotação/confirmação/renovação, carteira, ledger, entitlements, preços versionados, eventos, CAS editorial, moderação, componentes Primer, formulário, prévia, `CommercialLeasePurchase`, histórico, gateway e coletor existentes.

Decisão de mídia: conservar **uma única** coluna `storefront_media.storefront_id`. Ela já referencia `commercial_resources`; FKs compostas e verificações vinculam a imagem ao recurso, não ao proprietário. Renomeá-la exigiria substituir numerosos corpos SQL/contratos sem alterar a garantia e não demonstrou benefício funcional nesta etapa. Não foram criados bucket, gateway ou coluna equivalente adicionais. A decisão e as dependências estão em `INVENTARIO51.md` e `evidence51/dependencies.json`.

A mesma mídia pode ser referenciada por edição e publicação do mesmo recurso. Não se permite associá-la a outro cadastro, mesmo do mesmo dono. Limpeza preserva referências e leases; Storage real foi exercitado, removendo órfãos e preservando todas as imagens dos três irmãos.

## 7. Remoções e simplificações

Retirados do editor criação/declaração de perfil de uso e ramos que pressupunham um único cadastro. Criação fica na central. Eliminado filtro de comunidades após corte global; a consulta opcional por proprietário reutiliza o serviço e projeta somente `id,name,owner_id`. Consumidores públicos anteriores preservam a projeção completa.

Launcher e teste de mídia anteriores receberam parâmetros locais controlados para reutilização, evitando copiar os mecanismos de runtime/Storage. Assinaturas antigas sem identidade explícita permanecem somente como falha diagnóstica fechada, não como publicação/criação alternativa. Não foi removido histórico jurídico, editorial ou financeiro, nem utilizado `!important`.

## 8. Segurança financeira

Nenhuma primitiva monetária nova ou alteração de cotação/débito/ledger/renovação/reversão. Cada pedido e direito continua vinculado ao UUID concreto e oferta correta. Saldo do mesmo proprietário é serializado pelo motor existente, mesmo em dois recursos.

No fluxo real: cinco pedidos cumpridos, cinco débitos comerciais, três direitos, saldo/ledger líquido de 939 EvoCash **sintéticos**, zero divergência pedido/ledger ou proprietário. `financial-consistency.json`. Criar, editar, aprovar, reprovar, configurar limite e suspender não debitam nem estendem prazo.

## 9. Segurança editorial, expiração e SEO

RLS/grants e propriedade continuam no servidor. Revisões pendentes privadas; versão anterior aprovada preservada; CAS rejeita edição/decisão obsoleta. Suspensão e expiração afetam somente seu recurso, exceto bloqueios legítimos da conta inteira. Contrato de um irmão não publica outro.

A invalidação do diretório agora remove só cards vencidos; detalhes têm prazo próprio. Central revalida estados nos vencimentos, sem polling periódico. O bootstrap compartilhado de vitrines/perfis desconta a idade da requisição HTML correta em navegação Turbo, usando tempo monotônico e sem confiar no relógio de parede do dispositivo.

Handlers/SEO continuam lendo só snapshots elegíveis. URL direta, imagem e sitemap negam vencidos/suspensos; estabelecimento na URL antiga preserva redirecionamento 308. Não há promessa de desindexação instantânea externa nem cache público que estenda direitos.

## 10. Concorrência

`multiple-concurrency.json`: duas criações distintas simultâneas; seis reenvios da intenção geram um cadastro; disputa pela última vaga tem um vencedor; dois contratos disputam a mesma carteira sem saldo negativo; reenvios debitam uma vez; renovações independentes somam duração; edição simultânea tem um vencedor; aprovação não sobrescreve uma edição mais recente; edição de irmãos preserva identidades; suspensão vence confirmação pendente e não suspende o irmão.

`concurrency.json` e `storefront/concurrency.json`: regressões de mídia/associação concorrentes, aprovação, expiração, suspensão e renovação de profissionais, estabelecimentos e vitrines. `multiple_professional_listings_test.log` cobre FK/ownership, mídia cruzada do mesmo dono, limites, contrato de outro recurso e resumo administrativo sem duplicação.

## 11. Performance

Benchmarks com 1.000 e 4.000 registros distribuídos entre oito donos (125/500 por dono), com snapshots e direitos sintéticos. Doze amostras por operação; mesma massa/conexão/condições, antes sem o índice substituto e depois com ele; transação revertida. `EXPLAIN (ANALYZE, BUFFERS)` para página, contagem, RPC real e diretório público.

| Massa | Operação | p50 antes ms | p50 depois ms |
|---:|---|---:|---:|
| 1.000 | Central por RPC | 4,608 | 1,812 |
| 1.000 | Central filtrada por tipo | 2,968 | 2,066 |
| 1.000 | Contagem de limite | 0,091 | 0,072 |
| 4.000 | Central por RPC | 2,076 | 1,948 |
| 4.000 | Central filtrada por tipo | 1,897 | 1,828 |
| 4.000 | Contagem de limite | 0,636 | 0,200 |

O índice `(owner_id,kind,id desc)` substitui o índice único removido e beneficia a contagem/seleção; a intenção tem índice único próprio para idempotência. Não foi adicionado índice público especulativo: a ordenação candidata não trouxe ganho consistente e o plano alternativo regrediu em parte das amostras. O benchmark permite reproduzir esses candidatos com `order-index`/`flat-join`, sempre com rollback.

No diretório público com 4.000 registros, p50 observado na execução final foi 74,490 ms para profissionais e 141,861 ms para estabelecimentos; não se atribui melhoria pública ao índice privado. Os planos continuam validando publicação, proprietário, restrições e direito. Amostras locais variam, p95 está nos logs, e não definem SLA nem provam gargalo em produção. Não se adotou cache ou meta artificial para esconder o custo. A central não carrega contratos antecipadamente, e o seletor de comunidades reduz payload e corrige o corte antes do filtro.

## 12. Testes e falhas investigadas

- 20 suítes SQL, **868 asserções aprovadas** (`sql-summary.json`), incluindo compras EvoCash, preços, motor, reversões, mídia, contas e RLS.
- Suíte JavaScript completa final: **2.259 aprovados** (`javascript-all.log`).
- Edge Functions: **206 aprovados** (`functions.log`).
- Release/HTTP/SEO/imagens: **123 aprovados** (`release-http-tests.log`).
- Offline: os três cenários investigados passaram em **12 execuções focadas**; a RPC deliberadamente bloqueada prova a barreira sem sleep fixo (`offline-stress.json`, `offline-deterministic.log`). Código de sincronização e proteções não foram desativados.
- Concorrência e fluxo de navegador reais: JSONs citados, Auth/PostgREST/PostgreSQL/Storage/Edge locais.
- Build, lint, budget, scanners source/dist, integridade de migrations e diff sem erro. Lint mantém 16 avisos anteriores; alerta do chunk Primer anterior permanece dentro do budget.

O harness visual também passou a aguardar os proxies de imagem em andamento antes de fechar o contexto, eliminando uma corrida de encerramento sem ocultar falhas de requisição. Falhas encontradas durante o trabalho foram corrigidas: argumento do getter no editor, seletor de URL normalizada no harness, fixture global de mídia e duplicação de contas. Não há falha local remanescente conhecida que bloqueie a etapa. Não se declara resultado de CI remoto ou homologação de pagamento real.

## 13. Evidências visuais e preview

102 verificações em 320/390/1440 px, claro/escuro, central com três cadastros, três editores/prévias, diretórios/modais e administração/motor/limites. Sem overflow ou erros de aplicação detectados; capturas aguardam conteúdo carregado e registram modais no viewport sem animações. JSON/manifest verificáveis em `evidence51`; PNGs locais regeneráveis conforme política do repositório.

Rotas principais retornaram HTTP 200; tentativa de ler o arquivo privado de sessões retornou 403 (`preview-routes.json`).

Preview local: `https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev`.

- `/minha-vitrine`: central; `?cadastro=<uuid>` seleciona; `#publicacao` leva à contratação/renovação do cadastro.
- `/profissionais`, `/locais`: visitantes e páginas elegíveis.
- `/admin/vitrines`: moderação e limites por tipo.
- `/admin/parcerias?tab=engine`: preços/direitos/pedidos existentes.

Credenciais sintéticas são apresentadas na entrega; sessões ficam somente em `.finance-local/phase51-access.json`, ignorada pelo Git e negada pelo HTTP. Preview depende do Codespace/containers, não é deploy persistente. A stack HTTP local não oferece Realtime: o console registra handshake WebSocket 404 nas assinaturas globais de carteira/notificações. O harness identifica estritamente esse endpoint/status em `environmentWarnings`, sem ignorar outros erros. Realtime não foi homologado nesta stack; contratação, saldo, autorização e expiração foram exercitados pelas APIs reais, sem depender dessas assinaturas.

## 14. Pendências externas e limites

Pagamento real/InfinitePay, CI remoto, deployment/CDN/rewrites, infraestrutura/segredos/jobs, schema/dados reais, backup/restore e aprovações comerciais/jurídicas permanecem externos ao desenvolvimento local. Não foram resolvidos com simulações, mudança de produção ou concessão de políticas fictícias.

Não há rename físico da coluna de mídia nem política automática de compensação. Legado e arquivos referenciados permanecem. Nenhuma conversão monetária, carteira corporativa, venda de fichas por terceiros, comissão, saque ou repasse foi criado.

## 15. Checklist de lançamento e reprodução

Checklist único vigente: [CHECKLIST_LANCAMENTO.md](../CHECKLIST_LANCAMENTO.md), com A técnico concluído, B decisões comerciais e C ambiente/autorização. B/C bloqueiam lançamento, não autorizam iniciar Fase 6.

```sh
node scripts/homolog/finance/phase51-preview.mjs
npm run dev -- --config .finance-local/preview.config.mjs
node scripts/homolog/finance/phase51-validate.mjs
PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/multiple-listings-concurrency.mjs
# Novo dono sintético antes de repetir o fluxo completo:
node scripts/homolog/finance/phase4-seed.mjs
node scripts/homolog/finance/phase51-seed.mjs
node scripts/homolog/finance/phase51-browser.mjs
node scripts/homolog/finance/phase51-media.mjs
node scripts/homolog/finance/phase51-visual.mjs
node scripts/homolog/finance/phase51-performance.mjs 1000
node scripts/homolog/finance/phase51-performance.mjs 4000
node scripts/homolog/finance/phase51-reinstall.mjs
```

Seeds/concorrência só aceitam a stack descartável e usam políticas/saldos sintéticos, nunca defaults de produção. Performance/reinstalação revertem suas transações. Para rollback, pausar novas criações/vendas e manter APIs por ID; não recompor unicidade apagando cadastros ou históricos financeiros.

## 16. Estado final das Fases 1 a 5

Fases anteriores permanecem funcionais nas regressões afetadas. Mantidos carteira, ledger, compra EvoCash, preços imutáveis, cotações, contratos, direitos, reversões, auditoria, moderação, snapshots, mídia e expiração autoritativa. Cada novo cadastro usa o motor comercial existente, com recursos independentes e limites auditáveis.

Código e evidências permanecem locais para revisão. Nenhum push, merge, deploy, alteração de produção, cobrança real ou Fase 6 foi executado.
