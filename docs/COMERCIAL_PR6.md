# Homologação integrada — PR6

## O que este PR6 validou

Não há mudanças de código neste PR -- é verificação, não implementação. Repetiu a navegação
completa da Central comercial numa **única sessão contínua de navegador**, ao invés de
sessões isoladas por PR (como feito em PR1-5):

1. As 6 seções (Visão geral → Aprovações → Publicidade → Vitrines e parceiros → Financeiro →
   Configurações), na ida e na volta, 12 trocas seguidas, sem recarregar a página.
2. O link "Revisar anúncios" da Visão geral (PR1) abre a fila de Aprovações (PR2) já com o
   anúncio pendente visível.
3. Aprovar esse anúncio pela fila (PR2) faz o contador da Visão geral (PR1) refletir a
   mudança no próximo carregamento -- as duas telas usam a mesma fonte de verdade
   (`getAdvertisingCampaigns`), sem cache divergente.
4. Configurações ainda mostra "Espaços de anúncio" (PR3) e Financeiro ainda abre "Preços e
   contratações", não "Motor comercial" (PR4), depois de toda essa navegação.
5. "Vitrines e parceiros" ainda resolve para a aba "Vitrines de produtos" isolada das
   propostas e dos produtos legados (PR5).
6. Repeti os seis passos acima em dark mode (mesma sessão, outra rodada) e sem rolagem
   horizontal em 390px nas duas telas mais densas (Aprovações, Vitrines de produtos).

Resultado: **zero crashes, zero React error boundaries acionadas, um único aviso de console
em toda a sessão** (favicon 404 do harness local, irrelevante). Nenhum problema de integração
entre fases foi encontrado.

## Mock vs. integração real -- leitura obrigatória antes de homologar como pronto para produção

Isto é importante o bastante para repetir de forma explícita, como pedido:

### O que foi testado com Supabase simulado (mock)

Todas as capturas de tela e asserções de PR1 a PR6 vieram de um harness local: a página real
é compilada com esbuild, só o módulo `supabase/config` é substituído por um objeto em memória
com dados sintéticos, e o resultado é servido num Chromium headless via Playwright. Isso prova
**composição de UI e comportamento de componente**: navegação, diálogos abrindo com os campos
certos, filtros, estados visuais, responsividade, dark mode, e que o fluxo de uma tela afeta
corretamente o estado de outra tela quando os dois leem a mesma função de serviço.

Isso **não prova** que as RPCs reais (`admin_review_advertising_campaign`,
`set_storefront_editorial`, `admin_review_commercial_promotion`,
`admin_configure_advertising_placement`, `admin_set_advertising_network`, etc.) continuam
se comportando como antes no Postgres real, com RLS, triggers e `require_evocash_admin`
ativos.

### O que foi verificado por leitura direta do SQL real

Nenhuma RPC, migration, trigger ou política de RLS foi alterada nesta sessão -- confirmado por
`node scripts/check-migration-integrity.mjs` (211 migrations, 203 históricas, íntegras) e por
leitura direta de cada função antes de qualquer componente ser escrito ou alterado (ver as
seções de investigação dos docs de PR2-PR5). As chamadas que o frontend faz (nomes de RPC,
argumentos, formato de retorno) foram conferidas uma a uma contra o `create function` real na
migration correspondente, não assumidas.

### O que eu NÃO consegui rodar nesta sessão: integração real contra Postgres

O projeto já tem a suíte de integração real (`.github/workflows/supabase-tests.yml`, job
`sql`): `supabase start` sobe um Postgres real com todas as migrations aplicadas em ordem, e
roda pgTAP (`supabase test db`) mais scripts de concorrência real para exatamente os domínios
tocados aqui -- `storefront-revisions-concurrency.mjs`, `professional-listings-concurrency.mjs`,
`advertising-concurrency.mjs`, `commercial-engine-concurrency.mjs`, `refund` etc.

Tentei rodar `supabase start` neste ambiente (imagens Docker já em cache local, sem precisar
baixar nada). **Falhou de forma consistente** em 4 tentativas (com e sem o serviço Realtime
desligado): o container do Postgres nunca fica alcançável a tempo para os outros serviços
(`DBConnection.ConnectionError`/timeout de conexão do cliente `pg`), um sintoma típico de
sandbox sem suporte a rede Docker customizada entre containers. Não é um problema do código
--é uma limitação deste ambiente de execução, não do projeto.

**Consequência prática:** esta sessão não homologa as RPCs reais contra Postgres. Essa prova
só existe quando o `workflow_dispatch` ou o próprio `pull_request` do GitHub Actions rodar o
job `sql` deste branch -- o que só acontece ao abrir a PR real, não antes. Não declaro nenhuma
operação financeira ou de moderação como "homologada em produção" nesta sessão; declaro que o
código não mudou nenhum contrato de RPC e que a suíte de integração real já existe e cobre
exatamente esses contratos, mas que sua execução fica pendente do CI real.

## Verificação consolidada

- `node_modules/.bin/eslint` em todos os 11 arquivos tocados em PR1-5: 0 erros, 0 avisos.
- `npm run lint` (projeto inteiro): 0 erros, 15 avisos pré-existentes, nenhum nos arquivos
  tocados.
- `npm test` (suíte completa, mock/unitário): 2339 testes, 0 falhas.
- `node scripts/check-migration-integrity.mjs`: 211 migrations íntegras, nenhuma histórica
  alterada.
- `npm run build` + `npm run budget`: build limpo, orçamento de bundle de boot dentro da
  tolerância.
- Homologação integrada em navegador (mock, documentada acima): 12 trocas de seção numa
  sessão, cross-PR, dark mode, mobile 390px -- sem crash, sem React error boundary, 1 aviso
  de console irrelevante em toda a sessão.
- Pendente: `supabase-tests.yml` (job `sql`, Postgres real) só roda no CI real.
