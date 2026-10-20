# Auditoria da central educativa de moedas — 20/10/2026

## Base examinada

Migrations de `wallets`, `economy_transactions`, `economy_daily`, regras de recompensa, votos, produtos de comunidades, promoções, compras de EvoCash e conciliação InfinitePay; RPCs e políticas RLS; `WalletContext`, `economyService`, serviços de compras/promoções, componentes de carteira, voto, criação de comunidades e páginas de compras/promoções. Esta auditoria descreve o repositório. Não houve acesso autenticado ao banco de produção nem pagamento real neste trabalho; portanto, disponibilidade operacional em produção e valores alteráveis por configuração não foram confirmados ao vivo.

## Funcionamento implementado

| Área | Estado no código | Evidência e condição |
| --- | --- | --- |
| Carteira e extrato | Implementados | `wallets` tem saldos separados e reputação acumulada; `get_my_wallet()` fornece os saldos. `economy_transactions` guarda crédito/débito com chave natural única, data, motivo e referência. RLS permite ao usuário ler apenas suas linhas (superadmin tem exceção). A nova tela oferece as 12 movimentações mais recentes sob demanda. |
| EvoCoins por atividade | Implementado | Regras em `economy_reward_rules`; `private.award_evocoins` aplica limite diário geral e por ação. Atividade qualificada, conclusão de treino, publicação/comentário válidos e apoio recebido são fontes. Publicações e comentários podem aguardar validação. Valores e estados podem mudar no servidor; a página não promete quantidades. |
| EvoCoins em reações | Implementado | `cast_vote` cobra na primeira escolha de curtir ou não curtir uma publicação, verifica saldo e limites. Trocar/remover a reação não reembolsa. Votos em enquete são recurso separado. |
| EvoCoins em comunidades | Implementado com condições | `list_community_creation_products`, `create_community` e upgrade retornam/revalidam produto ativo, elegibilidade, preço e saldo. A configuração inicial oferece opções com EvoCoins; a tela só apresenta as opções disponíveis no momento. |
| Compra de EvoCash | Implementada com dependência externa | Pacotes ativos vêm de `economy_config.cashPackages`; checkout InfinitePay, webhook e verificação via `payment_check` precedem crédito idempotente por RPC. Compras pendentes aparecem em `/evocash` e não alteram saldo. Operação real depende da configuração do provedor e não foi testada com pagamento neste trabalho. |
| EvoCash em promoções | Implementado com condições | `economy_config.promotionPackages` define pacotes; `create_promotion` revalida conteúdo próprio, saldo e preço e debita no servidor. `/minhas-promocoes` acompanha resultados. Cancelamento não reembolsa saldo. A disponibilidade depende de pacote ativo e conteúdo elegível. |
| EvoCash em comunidades | Implementado, indisponível na configuração inicial | RPCs aceitam `evocash`, mas as três linhas iniciais de `community_creation_products` têm `evocash_price = null`; preço nulo bloqueia a ação. Como o valor pode ser alterado no banco, a central não anuncia esse uso como disponível nem afirma um estado atual de produção sem consulta viva. |
| Conversão, transferência e saque | Sem fluxo de usuário encontrado | Busca em migrations, serviços, componentes e rotas não identificou ações para trocar moedas, transferir saldo ou sacar EvoCash. A central descreve a ausência de opção no aplicativo, sem afirmar uma regra contratual fora do código. |
| Planos premium | Sem relação direta encontrada | O EvoCash é crédito interno comprado para ações específicas; não foi encontrada associação automática a assinatura premium. A central não o chama de plano ou moeda premium. |

## Integridade e limites

- Escrita direta de `wallets` e `economy_transactions` não é concedida ao usuário; créditos e débitos passam por funções do servidor. Nenhuma migration, função financeira, RLS, preço, limite ou cálculo foi alterado por esta entrega.
- Saldo online usa `WalletContext` compartilhado. No modo offline, `display` pode representar apenas o último valor salvo; a nova tela informa essa origem e não usa snapshot para operações.
- O extrato lê somente `id, asset, direction, amount, reason, created_at`, filtrado pelo ID do usuário autenticado, em ordem decrescente e com limite de 12. A política RLS é a segunda barreira. Falha, carregamento e lista vazia têm estados próprios.
- A página de compra continha promessa de reajuste futuro e “valores especiais por tempo limitado” sem suporte na configuração consultada. A chamada foi retirada; valores reais continuam vindo de `economy_config` na tela de compra.
- A exclusão de conta tem bloqueios e casos de revisão financeira quando há EvoCash positivo ou compra pendente. Esse fluxo administrativo permanece intacto. Não foi identificada rotina de expiração automática do saldo das moedas; a central evita prometer validade ilimitada.
- Não foi possível confirmar divergência de configuração ou execução financeira em produção sem sessão/banco autorizado. Nenhuma operação de pagamento, débito ou crédito foi disparada nesta auditoria.

## Validação desta entrega

- `npm run build`: passou; a rota da central gerou CSS/JS próprios, carregados sob demanda.
- `npm run lint`: passou com 0 erros e 14 avisos preexistentes em outros arquivos.
- Testes específicos: renderização com saldo zero, saldo existente, snapshot offline e indisponibilidade; rotas protegidas; rótulos do extrato; contrato de consulta somente de leitura e filtragem pelo usuário.
- `npm test` em paralelo não concluiu de modo confiável nesta máquina. A repetição em série, sem `authColdStart.test.js`, aprovou 232/233 arquivos; `businessDate.test.js` oscilou entre falha e 17/17 aprovações em execuções isoladas. `authColdStart.test.js` passou isoladamente. Esses dois arquivos não foram alterados por esta entrega.
- `node scripts/economy-guide-browser-smoke.mjs`: Chromium com dados sintéticos em 375, 768 e 1440 px; links, extrato, ocultação de linhas após troca de conta e ausência de overflow passaram.
- `node scripts/offline-browser-smoke.mjs`: passou no Chromium (cold start, snapshot, escrita offline, reconexão e atualização do service worker).
- `npm run budget`: falhou por `bootFiles = 6` contra baseline de 4. O precache atual inclui `public-home-redirect.js` e assets do app; as alterações públicas já presentes no workspace mudaram esse conjunto. O CSS/JS da central permanece fora do precache inicial.
- `npm run release:offline-check`: não concluiu porque exige `PG_TEST_CONTAINER` com PostgreSQL local migrado. Nenhum teste SQL dessa rotina foi executado. A central não altera rotas offline existentes.
