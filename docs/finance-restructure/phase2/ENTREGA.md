# Fase 2 — compra de EvoCash por quantidade

## Escopo e base

Implementação na branch local `finance-quantity-phase2`, worktree `/tmp/evolutus-finance-phase2`, a partir da Fase 1 aprovada (`d4f0bff`). Consultados integralmente o planejamento principal e as entregas/inventário anteriores. Não existem clientes financeiros reais, conforme esclarecimento do usuário. Não houve push, merge, deploy, alteração em produção ou início da Fase 3.

## Preview para revisão

https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/evocash

A porta 5173 usa uma única instância Vite com `--host ::`, servindo a branch desta fase nas interfaces IPv4 e IPv6. A homepage mantém seu conteúdo; a mudança de compra está em `/evocash`. O navegador deve usar a conta fictícia da stack local entregue na Fase 1, não a sessão de produção. Se houver conteúdo antigo, recarregar a página sem cache.

O banner identifica o ambiente de simulação. Após confirmar a cotação, a página de pagamento fictício permite simular aprovação ou voltar sem pagar. Nenhum cartão ou dinheiro real é utilizado. A aprovação percorre a Edge Function de webhook, a consulta simulada ao provedor e a confirmação SQL real do banco local. O saldo vem de uma nova leitura do backend. O plugin `scripts/homolog/finance/quantity-preview.mjs` só é importado pela configuração local ignorada; não integra o build de produção.

O preço e os gates habilitados do preview são fixtures. A migration não publica preço e deixa o novo gate de checkout desligado. Os dados de teste persistentes podem aparecer no histórico da conta local.

## Fluxo entregue

1. A página consulta uma vez `get_evocash_purchase_settings`, que fornece preço/limites vigentes e disponibilidade sem expor configuração administrativa completa.
2. A pessoa informa quantidade inteira; a estimativa imediata usa BigInt. A confirmação depende exclusivamente de `create_evocash_purchase_quote`, da Fase 1. A cotação contém ID, versão, quantidade, preço unitário, total e validade do servidor. Alterar a quantidade invalida a confirmação e respostas antigas são descartadas.
3. Após revisão e confirmação explícita, a Edge Function existente recebe somente `quoteId` e `requestId`. O UUID idempotente persiste por usuário/cotação em sessionStorage; duplicação entre abas também é impedida pela unicidade da cotação no banco.
4. `reserve_infinitepay_cash_purchase(uuid,uuid)` usa o JWT autenticado e revalida conta/sessão, propriedade, validade, gates, limites e abuso. A reserva e o snapshot do pedido são atômicos. Os locks compartilham a disciplina de concorrência da precificação/carteira.
5. A integração InfinitePay existente cria o link com quantidade/valor do snapshot, `single_payment` e validade. API key é obrigatória para essas opções. A URL validada é persistida antes do redirecionamento. Replays devolvem o mesmo pedido/link; ambiguidade após timeout não autoriza criar outro link.
6. Retorno visual e webhook fornecem somente pistas. O backend consulta `payment_check` e valida identidade, identificadores, valor, moeda e confirmação antes de usar `confirm_infinitepay_cash_purchase`. O crédito e o ledger existentes continuam atômicos e idempotentes.
7. A página mantém saldo, histórico, cancelamento e retomada de links válidos. Atualização de saldo lê o servidor. Estados pendente, expiração, falha, cancelamento, crédito, análise e estorno são apresentados pelo fluxo existente.

Valores monetários usam centavos inteiros e strings nas fronteiras financeiras. A conversão para Number no payload do provedor ocorre somente após validar o inteiro dentro do intervalo permitido. Preço publicado posteriormente não recalcula pedidos nem cotações válidas. Limites atuais mais restritivos são rechecados na reserva sem repricing. Links ainda pagáveis, inclusive de pedidos cancelados visualmente, continuam consumindo limite; cancelamento não prova cancelamento no provedor.

## Schema, segurança e recuperação

Única migration nova: `supabase/migrations/20261129000001_evocash_quantity_checkout.sql`.

Adiciona `checkout_enabled=false`, snapshot de cotação/versão/preço no pedido, unicidade de cotação, constraints de consistência e trigger de imutabilidade. `quote_id` diferencia pedidos novos dos snapshots históricos, evitando coluna de modo redundante. Campos históricos continuam legíveis; nenhum novo construtor de compra por pacote permanece disponível.

RLS, autorização de sessão, grants mínimos e helpers internos privados são preservados. A reserva pública exige autenticação e não aceita usuário arbitrário; service_role não pode invocá-la em nome de terceiros. Confirmação/finalização continuam restritas ao backend. Não há escrita financeira sensível pelo frontend nem segredo de produção no cliente.

Falhas antes de chamar o provedor podem liberar a tentativa. Falhas com resultado externo incerto ficam bloqueadas para criação duplicada. Webhooks repetidos e confirmações concorrentes geram um único crédito. Pagamento efetivamente verificado após cancelamento ainda pode ser confirmado; conflitos de identidade e pagamentos em pedidos com falha seguem para análise auditável, sem crédito automático.

A recuperação reutiliza reentrega do webhook, sincronização autenticada, conciliação administrativa e worker existentes. O worker só consulta pedidos cujos identificadores do provedor já foram conhecidos; quando faltam identificadores, exige nova notificação ou conciliação administrativa com NSU/slug obtidos no provedor. Não existe descoberta automática de pagamentos apenas pelo retorno visual.

Estornos reutilizam `admin_record_cash_reversal`, controle de concorrência, ledger e casos financeiros existentes. Eventos de estorno não confiáveis não debitam carteira diretamente. Não se implementou um segundo motor de pagamento/reembolso nem uma integração automática nova de estornos com o provedor.

## Reaproveitamento e remoções

Reutilizados: cotações e versões da Fase 1; checkout, webhook, payment_check, sync, reconciliador e leases InfinitePay; confirmação SQL; carteira/ledger e atualização via WalletContext; cancelamento, reversões, casos financeiros e notificações; componentes Primer e identidade visual.

Removidos efetivamente: `CashPackageCards.jsx` e seu teste; `cashPackagePresentation.js` e seu teste; formulário/lógica de seleção de pacotes em EvoCash; configuração ativa `cashPackages`; assinatura antiga `reserve_infinitepay_cash_purchase(uuid,text)`; dependência de package_id na confirmação do provedor; textos de pacotes em compra, guia e lembretes. Dependências de aplicação e SQL foram verificadas antes da remoção. A remoção SQL usa DROP com RESTRICT.

Preservados: migrations históricas, snapshots e rótulos de histórico, pacotes de promoções de outras funcionalidades, mecanismos financeiros compartilhados. O helper SQL em `supabase/tests/_helpers/cash_purchase.sql` só constrói snapshots sintéticos de testes antigos; não é API ou camada de compatibilidade operacional. O teste de instalação ainda usa a assinatura antiga exclusivamente para preparar o baseline anterior à migration. O diagnóstico de produção somente leitura mantém referências históricas para comparar schemas.

O manifesto `ARQUIVOS.md` lista todas as alterações. O componente novo separa a compra da página de carteira. Não foram adicionadas dependências, polling contínuo, cache de saldo financeiro ou consultas por linha de histórico.

## Validação executada

Evidências textuais/JSON em `evidence/`; capturas locais não versionadas conforme `docs/CAPTURES_POLICY.md`.

- 432 asserções em 12 suítes pgTAP afetadas: quantidades/overflow, cotação expirada, preço congelado, limites, RLS/grants/sessão, replay, falhas, crédito/ledger, cancelamento, reversões parciais/totais e regressões de casos/exclusão/lembretes/conciliação. Fixtures SQL transacionais são revertidas.
- Concorrência com commits reais: publicação disputada, replay de preços/cotações, seis reservas do mesmo pedido (um criador de link), seis confirmações (um crédito no ledger).
- Oito cenários HTTP com Auth, Edge, PostgREST e PostgreSQL locais reais: autenticação, escrita direta negada, criação/replay, isolamento entre usuários, callback fabricado, 12 webhooks repetidos, sessão revogada, divergência de valor/moeda, erro 503, timeout e pagamento tardio após cancelamento. Provedor sempre simulado.
- Testes JS afetados de checkout, webhook, reconciliação, lembretes, carteira e componentes/utilitários compartilhados passaram. Logs identificam arquivos e resultados; não se declara execução da suíte completa do repositório.
- Browser real: entrada inválida, alteração invalida confirmação, cotação, um checkout, aprovação simulada pelo backend e saldo atualizado do servidor. Larguras 320/390/1440 em claro/escuro, sem overflow e sem pageerror. Zero requisições financeiras externas. O aumento de 62 no fixture inclui a compra de 25 da preparação e a compra de 37 do percurso automatizado.
- Migration completa reinstalada em transação revertida a partir da fronteira da Fase 1. Migration local registrada apenas nas bases isoladas.
- Build passou; ESLint passou com zero erros e 16 warnings existentes. Permanece aviso de chunk grande. `git diff --check`, sintaxe do harness e scanner de segredos passaram. Tempos HTTP locais são amostra funcional, não benchmark ou SLA.

## Pendências para liberação futura

A documentação oficial consultada foi https://www.infinitepay.io/checkout-documentacao e https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay. Mantidos os endpoints/contrato clássico existentes, com opções documentadas de pagamento único e validade. A documentação mais recente também descreve configuração de webhook/eventos; validar contrato habilitado na conta, payloads, API key, política de expiração e comportamento real de replay antes de qualquer ativação. Nenhuma chamada real ao provedor foi feita nesta entrega.

Ainda exigem ambiente de homologação autorizado do provedor: autenticação/API key reais, criação de link, captura/expiração, reentregas e ordem de eventos, notificações de estorno e recuperação operacional com NSU/slug. Estorno automático por evento não faz parte do contrato implementado; permanece o processo administrativo auditável existente. CI remoto completo depende de futuro push/PR, que não foi realizado. Revisão comercial/jurídica e aprovação de preço/limites permanecem necessárias para lançamento.

## Aplicação e rollback

Nenhuma autorização de produção foi usada. Para homologação futura, sincronizar a base, aplicar migrations ordenadas, verificar constraints/grants e manter quoting/checkout desativados até aprovação explícita. Habilitar Edge e banco exige configuração controlada; não existe botão público para ativar vendas.

A mudança de assinatura da reserva exige coordenar backend e frontend. Não voltar cegamente ao checkout por pacotes. Em incidente, desabilitar novas compras, manter verificação/conciliação de pedidos já emitidos e preservar schema, snapshots, ledger e auditoria. Rollback visual não deve apagar dados nem desfazer créditos com SQL manual. A retomada de produção exige autorização separada.
