# PROMPT — Segurança, integridade e performance da economia Evolutus

## Papel e objetivo

Atue como engenheiro sênior especializado em segurança de aplicações, PostgreSQL, Supabase, pagamentos digitais e prevenção de fraude. Analise **todo o código que participa da economia Evolutus** e implemente, por etapas, as correções necessárias para tornar EvoCoins e EvoCash resistentes a concessões indevidas, pagamentos falsos, duplicidades, concorrência, inconsistências, estornos e falhas operacionais.

**Não quero apenas um relatório:** quero implementação real, testes automatizados e documentação objetiva das mudanças. Execute as etapas na ordem definida, valide cada uma antes de prosseguir e preserve todas as funcionalidades existentes. Não faça deploy em produção nem execute migrações em banco de produção sem autorização expressa.

### Regras inegociáveis

1. **Nunca confiar no cliente:** usuário, valores, pacotes, timestamps, estado do pagamento, quantidade de moedas, níveis, permissões e elegibilidade devem ser validados no servidor.
2. **Não fabricar saldo nem perder dinheiro:** nenhum crédito, débito, estorno, ajuste ou desbloqueio de benefícios pode ocorrer sem origem verificável e registro auditável.
3. **Operações exatamente uma vez do ponto de vista financeiro:** requisições e webhooks podem chegar repetidos ou em paralelo; o efeito financeiro deve ocorrer no máximo uma vez por evento de negócio. Use transações atômicas, restrições únicas e idempotência persistente, não memória local.
4. **Não corromper o histórico:** não apagar, reescrever ou recriar lançamentos antigos para corrigir erros. Fazer ajustes por eventos/lançamentos compensatórios, preservando a trilha de auditoria. Respeitar obrigações de privacidade e retenção.
5. **Regras consistentes em todas as entradas:** API, RPC, Edge Functions, triggers, rotinas administrativas, jobs, reconciliação e frontend devem depender das mesmas validações centrais.
6. **Mudanças mínimas e seguras:** reaproveitar a arquitetura existente; não criar um segundo saldo, um segundo motor de recompensas ou serviços externos desnecessários.
7. **Performance:** manter as operações frequentes de carteira com custo aproximadamente constante e índices adequados; conciliações e análises antifraude pesadas devem ser assíncronas, paginadas e limitadas.
8. **Migrações reversíveis operacionalmente:** nunca apagar dados, recriar tabelas financeiras ou assumir banco vazio. Prever compatibilidade com código em execução, backfill e plano de reversão. Não modificar migrações já aplicadas em produção.
9. **Privilégio mínimo:** somente operações autenticadas e autorizadas; credenciais de serviço e segredos de pagamentos exclusivamente no backend. Não expor funções internas por PostgREST.
10. **Sem correções especulativas:** confirme a existência de cada vulnerabilidade com código, fluxo reproduzível e/ou teste. Se uma proteção já existir, mantenha-a e acrescente testes; não reimplemente.
11. **Sem soluções superficiais:** esconder botões, validar apenas no React, usar debounce, confiar em IP ou adicionar `if` isolado não substitui controles do banco.
12. **Sem interromper desnecessariamente:** avance pelas fases independentes; quando faltar credencial ou ambiente, documente a evidência pendente e continue com o que puder ser verificado localmente.

---

## Contexto do projeto — investigar antes de modificar

Stack identificada no repositório fornecido: React/Vite, Supabase (Auth, PostgreSQL, RLS, RPC, Realtime, Edge Functions) e InfinitePay.

Comece inspecionando, **incluindo suas versões atuais e referências cruzadas**:

- `src/contexts/WalletContext.jsx`, `src/services/economyService.js`, `src/services/cashPurchaseService.js`, `src/utils/evocoins.js` e hooks/telas relacionadas.
- `src/pages/EvoCash.jsx`, `src/pages/AdminCashPurchases.jsx` e componentes que exibem saldo, transações, promoções, recompensas e reputação.
- `supabase/functions/_shared/infinitepay.js`.
- `supabase/functions/infinitepay-create-checkout/`, `infinitepay-webhook/`, `infinitepay-check-payment/` e `infinitepay-admin-reconcile/`.
- `supabase/migrations/20260927000001_economy_wallet_ledger_activity.sql`.
- `supabase/migrations/20260928000001_economy_cash_purchases_promotions.sql`.
- Migrations `20261009000001` a `20261009000007` relativas a EvoCoins.
- Migrations `20261015000001` a `20261015000005` relativas a pagamentos/cancelamentos.
- Migrations posteriores que alteram essas funções ou tabelas, especialmente `20261105000003_infinitepay_pending_reconciliation.sql` **caso estejam presentes/aplicadas**.
- `supabase/tests/evocoins_participation_test.sql`, `supabase/tests/evocoins_concurrency.sh`, `supabase/tests/infinitepay_cash_purchases_test.sql`, `supabase/tests/infinitepay_pending_reconciliation_test.sql` e testes das Edge Functions.
- Demais usos de `wallets`, `economy_transactions`, `economy_daily`, `cash_purchases`, `promotions`, `economy_config`, `financial_cases` e das funções financeiras em todo o repositório.

**Atenção:** o repositório contém arquivos de migrations com datas posteriores à data atual. Nome/arquivo existente **não prova que a migration foi executada**. Verifique histórico real de migrações por ambiente antes de planejar rollout. Novas migrations devem respeitar a ordenação dos arquivos existentes e a história já aplicada, sem renomear ou alterar migrations históricas executadas.

### Evidências técnicas a confirmar

Trate os itens abaixo como hipóteses de auditoria, não como vulnerabilidades automaticamente confirmadas:

- `public.register_qualified_activity()` e os checkpoints podem reconhecer passagem de tempo sem provar atividade genuína.
- `private.award_evocoins()` e os triggers de participação possuem idempotência e limites; confirmar cobertura de todos os caminhos e concorrência.
- `economy_transactions` usa `numeric`, enquanto colunas da carteira podem ter tipos inteiros. Confirmar possibilidade de valores fracionários, casts implícitos e arredondamento indevido.
- `checkoutPayload()` não envia explicitamente parâmetros de cobrança única/expiração. Verificar **na documentação oficial vigente da InfinitePay** quais campos são realmente suportados na API utilizada; nunca adicionar propriedades presumidas.
- O webhook limita `Content-Length`, mas isso não garante limite efetivo dos bytes lidos quando o header está ausente ou incorreto.
- A confirmação via `payment_check` já valida identificadores, valor e método; confirmar resistências a replay, estado cancelado, reconciliação e variações do contrato da InfinitePay.
- Pode faltar tratamento completo de estorno/chargeback de uma compra **já creditada e eventualmente gasta**; não confundir com a opção administrativa de registrar reembolso externo de compra *não creditada*.
- Verificar se já existe reconciliação parcial de compras pendentes; não duplicar cron/jobs.
- Há regras ligadas à exclusão de contas e retenção de casos financeiros; não quebrar esses fluxos.
- O frontend armazena snapshot offline apenas para exibição. Confirmar que snapshots jamais habilitam gastos nem créditos.

Ao final da inspeção, classifique cada achado como **confirmado**, **mitigado**, **não reproduzido** ou **dependente de produção/credenciais**, com severidade, arquivo/função, evidência e teste.

---

# PLANO DE CORREÇÃO POR ETAPAS

## ETAPA 0 — Inventário, ameaças, linha de base e plano de mudanças

1. Mapear todos os caminhos possíveis de entrada/saída de EvoCoins e EvoCash: atividade, treino, conteúdo, apoio/voto, bônus, criação de comunidades, compras, promoções, cancelamentos, ajustes administrativos, exclusão de conta e processos automáticos.
2. Construir tabela por operação contendo: origem, autorização, RPC, tabela alterada, natural key, regras de idempotência, lock, lançamento contábil, falhas possíveis e testes existentes.
3. Mapear todos os estados de `cash_purchases`, transições permitidas, efeitos financeiros e situações de pagamento tardio.
4. Inspecionar migrations por ordem efetiva, permissões de schemas, grants, defaults, policies RLS, funções `SECURITY DEFINER`, triggers, constraints, índices e jobs.
5. Registrar invariantes financeiros que devem continuar verdadeiros após qualquer operação:
   - saldo disponível de cada ativo nunca fica negativo;
   - débito nunca excede saldo disponível ou valor autorizado;
   - toda movimentação possui referência e idempotência únicas;
   - um pagamento externo comprovado não concede EvoCash duas vezes;
   - uma promoção não ativa benefício sem débito efetivo e autorização;
   - o contador histórico de EvoCoins permanece coerente com sua definição e políticas de reversão;
   - nenhum erro parcial deixa status de sucesso sem efeito financeiro, ou efeito financeiro sem lançamento.
6. Executar a suíte existente e registrar testes, falhas e tempos antes de alterar código.
7. Planejar rollout compatível com versões em execução, dados históricos e possíveis fluxos de pagamento em trânsito.

**Entrega:** inventário técnico breve, lista de riscos confirmados e plano de arquivos/migrations a alterar. Não implementar nova arquitetura redundante.

**Gate:** fluxo financeiro mapeado, comportamento atual documentado e testes-base executados (ou limitação explicada).

## ETAPA 1 — Fechamento de permissões e superfícies de ataque (P0)

1. Auditar RLS e grants de `wallets`, `economy_transactions`, `economy_daily`, `cash_purchases`, `promotions`, configurações e estruturas de casos financeiros. Confirmar que um usuário não consegue inserir, atualizar ou excluir valores por acesso direto REST, RPC, Realtime, Storage ou fluxo administrativo.
2. Auditar **todas** as funções que creditam/debitam, incluindo funções internas com prefixo `_`, overloads antigos, funções legadas de gateways desativados e permissões herdadas de `PUBLIC`.
3. Restringir `EXECUTE` por role; usar RPCs públicas mínimas e autorizadas. Evitar expor funções internas em schema disponibilizado na API quando não for necessário. Para `SECURITY DEFINER`, fixar `search_path` seguro, qualificar objetos e validar identidade/autorização na operação de entrada.
4. Garantir que nenhuma função aceita `user_id`, `amount`, preço, pacote, estado de pagamento ou papel administrativo do cliente como autoridade financeira sem validação do servidor.
5. Revisar autenticação, CORS, limites de taxa e tamanho de corpo das Edge Functions, inclusive requisições sem `Content-Length`, corpo malformado, timeout, headers inconsistentes e métodos HTTP indevidos. Implementar limite real de bytes **antes de parsear JSON**, com leitura limitada e abort quando aplicável.
6. Proteger rotinas administrativas contra escalonamento de privilégio; toda ação sensível requer autorização real no banco/backend, motivo auditável e, quando apropriado, autenticação reforçada.
7. Confirmar isolamento de credenciais `service_role`, tokens e segredos em ambientes, logs, client bundle, actions e testes.
8. Escrever testes negativos: `anon`, `authenticated`, usuário A tentando acessar ou alterar usuário B, RPCs internos, SQL direto, replay e permissões administrativas.

**Gate:** nenhuma operação não autorizada consegue modificar créditos, saldos ou compras. Nenhum segredo presente no bundle ou nos logs.

## ETAPA 2 — Integridade transacional, precisão e idempotência (P0)

1. Centralizar as invariantes de crédito/débito no PostgreSQL, usando as funções já existentes se forem adequadas. Cada operação completa deve ser **atômica**: validação + idempotência + atualização de saldo + ledger + status/benefício.
2. Usar locks específicos (`SELECT ... FOR UPDATE` ou atualização condicional) e constraints únicas. Definir ordem consistente de aquisição de locks para reduzir deadlocks. Não confiar em `SELECT` seguido de `UPDATE` sem proteção contra concorrência.
3. Definir explicitamente unidades de EvoCoins e EvoCash. Para unidades indivisíveis, rejeitar frações, `NaN`, infinitos, valores zero/negativos, overflow e conversões silenciosas. Preferir inteiros no contrato e validar limites de armazenamento/JavaScript. Não converter indiscriminadamente o dinheiro real da InfinitePay: **BRL deve permanecer em centavos inteiros**, separado da quantidade de EvoCash.
4. Se houver dados históricos fracionários ou divergentes, **não fazer cast destrutivo**. Criar diagnóstico e plano de saneamento auditado antes de adicionar constraints `VALIDATE`.
5. Revisar chaves naturais/idempotentes por **evento de negócio**, não por tentativa HTTP. Cobrir webhook repetido, RPC repetido, retries após timeout, duplo clique, confirmação concorrente, jobs e reversões.
6. Garantir que conflitos de idempotência sejam tratados sem crédito parcial e sem mascarar erros não relacionados. O retorno de replay deve refletir o estado verdadeiro da operação original.
7. Revisar condições de saldo insuficiente sob concorrência: duas promoções simultâneas não podem gastar as mesmas moedas; nenhuma operação deixa benefícios ativados sem débito.
8. Preservar `economy_transactions` como histórico auditável; impedir `UPDATE`/`DELETE` por clientes e rotinas indevidas. Ajustes precisam ter ator, motivo, referência à operação original e chave única. Considerar bloqueio a alterações no banco com exceções de retenção legal bem definidas.
9. Se `wallets` continuar sendo saldo materializado, definir como conciliar seu valor com os lançamentos, considerando saldo inicial/backfill e migrações legadas. Não recalcular o ledger completo em cada carregamento da carteira.
10. Revisar exclusão de conta para não perder evidências financeiras necessárias nem reter dados pessoais além do necessário.

**Testes obrigatórios:** 50–100 chamadas concorrentes para crédito/débito/replay; chamadas interrompidas; retry; falta de saldo; frações; overflow; rollback forçado; idempotência entre entradas diferentes. Validar saldo, ledger e efeitos de negócio conjuntamente.

**Gate:** nenhuma execução testada gera dupla concessão, saldo negativo, divergência entre sucesso e lançamento ou valores fracionários não permitidos.

## ETAPA 3 — Compra de EvoCash e InfinitePay (P0)

1. Auditar o ciclo completo: reserva → link → checkout → retorno do navegador → webhook → `payment_check` → confirmação atômica → atualização da carteira → entrega do serviço.
2. Consultar o **contrato oficial atual** da API InfinitePay efetivamente utilizada. Verificar se suporta parâmetros para uso único/validade do checkout (`single_payment`, `valid_until` ou equivalentes) e como consultar/cancelar links. Implementar somente parâmetros/documentação comprovados, com testes do payload.
3. O navegador e o webhook devem fornecer, no máximo, uma indicação para verificação. A autorização do crédito depende de confirmação servidor-servidor verificável, amarrada a pedido, usuário, moeda BRL, valor em centavos, pacote imutável, order NSU, transaction NSU, invoice slug e estado permitido. A ausência de autenticação do webhook deve ser compensada por verificação robusta com o provedor, limitação de abuso e ausência de efeitos diretos por payload não comprovado.
4. Nunca permitir que cliente escolha quantidade de EvoCash ou preço. Congelar `package_id`, preço em centavos, EvoCash contratado e identificadores do pedido no momento da reserva.
5. Validar unicidade de `order_nsu`, `transaction_nsu` e identidade de cobrança conforme o modelo do provedor. Impedir uso do mesmo pagamento para duas compras, contas ou pacotes.
6. Distinguir claramente:
   - checkout criado;
   - checkout incerto após timeout;
   - pagamento pendente;
   - pago e creditado;
   - pago mas retido em caso financeiro;
   - cancelado localmente;
   - cancelado efetivamente no provedor;
   - pagamento tardio após cancelamento;
   - pagamento em revisão;
   - reembolsado/contestado.
7. Tratar respostas inconsistentes, atrasadas, duplicadas ou fora de ordem sem perder pagamento nem creditar indevidamente. `checkout_uncertain` e compras com status divergentes devem usar reconciliação segura, jamais criação cega de nova cobrança.
8. A confirmação deve bloquear a linha da compra e efetuar ledger + carteira + status em uma única transação. Replays retornam resultado idempotente.
9. Caso a conta esteja em exclusão ou tenha caso financeiro, preservar o fluxo de retenção existente; impedir créditos a contas indevidas e pagamentos “órfãos” silenciosos.
10. Implementar timeout, retries com backoff e jitter onde forem seguros, limites de tentativas e mensagens estáveis ao usuário; **não repetir criação de checkout após timeout incerto** sem confirmação do provedor.
11. Evitar logar payloads sensíveis, dados pessoais, tokens e recibos completos. Logs devem conter apenas IDs de correlação e códigos úteis.
12. Criar testes com respostas simuladas do provedor para: pago/não pago, valor incorreto, moeda incorreta, método inválido, NSUs divergentes, status cancelado, webhook duplicado, requisições concorrentes, corpo excessivo, timeout, resposta 500 e confirmação tardia.

**Gate:** sem qualquer caminho de crédito por redirect, request arbitrário ou replay; nenhum pagamento comprovado fica invisível ou provoca crédito repetido.

## ETAPA 4 — Reembolso, estorno, chargeback e dívida de crédito (P0)

**Não confundir** registrar “reembolsado externamente sem crédito” com desfazer uma compra **já creditada**.

1. Confirmar, na documentação oficial InfinitePay e no contrato comercial utilizado, quais eventos e consultas oferecem reembolso total/parcial, chargeback/disputa e reversão, bem como sua autenticidade. Se a API não fornecer determinado evento, documentar limite e criar conciliação operacional segura, sem inventar endpoints.
2. Projetar uma máquina de estados e um modelo de eventos auditáveis para compra já creditada. Uma compra pode ter reembolsos parciais e eventos sucessivos. Evitar estados ambíguos ou transições retroativas não autorizadas.
3. Para cada estorno comprovado, registrar evento único com ID do provedor, compra original, valor e unidade, data, origem, confirmação e status. Bloquear replay e reversão acima do montante elegível, considerando eventos anteriores.
4. Se o usuário ainda possuir EvoCash suficiente, aplicar débito compensatório transacional. Se tiver consumido os créditos, **não gerar saldo negativo no campo de saldo disponível**: definir saldo recuperável/obrigação pendente em estrutura separada, marcar a conta conforme política de risco e impedir novos gastos indevidos.
5. Definir uma política explícita para EvoCash comprado, devolvido, utilizado, indisponível, congelado e passivo pendente; não bloquear moedas legitimamente adquiridas por outros pagamentos além do necessário.
6. Considerar promoções/benefícios já ativados: não apagar o histórico; definir regra de cancelamento de serviços futuros, suspensão, revisão humana e efeitos proporcionais para serviços já prestados.
7. Qualquer compensação deve ser idempotente, rastreável e compatível com o mecanismo de `financial_cases`/exclusão de conta.
8. Implementar controles administrativos mínimos: ver comprovante/identificador, motivo, estado, valor, trilha de auditoria, resolução e autorização. Nenhum botão administrativo deve “fabricar” um pagamento ou estorno.
9. Testar: estorno integral sem gasto, integral após gasto, parcial, dois parciais, contestação duplicada, estorno sem compra, montante excedente, compra excluída/com caso financeiro, reembolso pendente de confirmação e corrida com gasto simultâneo.

**Gate:** qualquer reversão comprovada permanece consistente mesmo com saldo já gasto, sem falsificar saldo e sem perder o histórico.

## ETAPA 5 — Blindagem de EvoCoins contra farm e abuso (P1)

1. Auditar todas as fontes de EvoCoins e comparar ações originadoras com permissões, limites e deduplicação no banco. Manter o teto diário global (atualmente indicado como 10 moedas), exceto se a configuração validada em produção determinar outra regra; não aumentá-lo.
2. Revisar `register_qualified_activity()`: checkpoints baseados apenas em tempo entre RPCs não comprovam atividade real. Não utilizar somente intervalos, abas abertas, scroll sintético ou heartbeat como evidência suficiente.
3. Criar critérios de **eventos de negócio verificáveis pelo servidor** quando possível (ex.: treino válido persistido, participação permitida, conteúdo existente, ação única e elegível), associados a usuário, recurso e janela de tempo.
4. Para sinais impossíveis de comprovar com segurança em frontend puro, admitir risco residual e usar limites estritos, análise de anomalias e recompensas pequenas. Não alegar “prova de humano” sem ela existir.
5. Checar criação/edição/exclusão de publicações, comentários, votos, apoio e treinos; impedir concessão por objetos inexistentes, duplicados, excluídos, proibidos ou inconsistentes. Confirmar arquivos no Storage antes de creditar recompensas por mídia, respeitando políticas de acesso.
6. Introduzir controles proporcionais contra spam: repetição de conteúdo, criação coordenada de contas, ações recíprocas artificiais, padrões anormais e abuso de eventos. Não punir definitivamente por um único sinal como IP compartilhado.
7. Garantir que revogação por fraude seja explícita e auditável. **Não subtrair silenciosamente** de `lifetime_coins_earned` nem quebrar o significado atual de Reputação. Separar pontos brutos de pontos elegíveis/revogados se a regra de produto exigir.
8. Projetar decisões de risco como estados claros (`allowed`, `limited`, `pending_review`, `rejected`) com motivo interno e revisão administrativa proporcional. Não expor regras detalhadas antifraude que facilitem exploração.
9. Preservar UX: não punir automaticamente usuários legítimos por falhas de rede, pausas, treino offline ou ausência de atividade diária. Recompensas offline nunca são confiáveis até validação servidor-side.
10. Medir quantidade de recompensas por usuário, origem, rejeições, duplicatas e padrões suspeitos sem armazenar dados pessoais além do necessário.

**Gate:** múltiplos requests, conteúdo falso/repetido ou replays não contornam limites e idempotência; o sistema conserva recompensas legítimas.

## ETAPA 6 — Conciliação financeira e detecção de divergências (P1)

1. Antes de criar algo novo, identificar o que já existe de reconciliação de compras pendentes e reaproveitar.
2. Implantar dois processos distintos:
   - **Conciliação interna:** saldo materializado versus lançamentos e saldos iniciais/migrações históricas.
   - **Conciliação externa:** pedidos InfinitePay versus pagamentos confirmados, situações pendentes, estornos e casos financeiros.
3. Processar em **lotes pequenos, com cursor e checkpoints persistentes**, índices nos filtros utilizados, rate limit do provedor e estratégia segura para concorrência (`FOR UPDATE SKIP LOCKED` quando aplicável).
4. Priorizar diferenças relevantes: crédito sem confirmação, pagamento confirmado sem crédito, duplicidade, estado impossível, estorno sem compensação, saldo divergente e pedido antigo incerto.
5. Separar **detecção** de **reparação**. Nunca corrigir automaticamente uma divergência desconhecida nem fabricar histórico. Reparos conhecidos e comprováveis podem usar operações compensatórias idempotentes e auditadas.
6. Rodar inicialmente em modo **somente leitura/alerta (shadow mode)**, sem afetar saldos; liberar reparações automáticas apenas após testes e validação das regras.
7. Criar métricas e alertas para divergências, backlog, idade de pendências, falhas do provedor, retries, latência, quantidade de estornos e tentativas bloqueadas.
8. Definir trilha de auditoria operacional, retenção de registros e processo de reprocessamento/replay seguro.
9. Não criar polling por usuário no frontend; usar jobs agendados no backend e consultas administrativas paginadas.

**Gate:** rodar mais de uma vez não altera saldos indevidamente; diferenças são reportadas e cada reparo tem justificativa verificável.

## ETAPA 7 — Ajustes mínimos nas telas e ferramentas administrativas (P2)

1. Preservar layout/identidade visual do Evolutus; alterar UI somente onde os novos estados financeiros exigirem informação ou ação.
2. Em EvoCash, diferenciar claramente `pendente`, `em verificação`, `creditado`, `cancelamento solicitado`, `reembolso` e `análise financeira`, conforme estados realmente existentes.
3. Exibir saldo online confirmado pelo servidor. Snapshots offline são exclusivamente visuais e devem indicar desatualização; **nunca autorizam gasto**.
4. Impedir duplos envios na UI sem depender disso como mecanismo de idempotência.
5. Na administração, mostrar compra, pedido/provedor, status, eventos, valores e logs auditáveis **sem expor dados sigilosos ou permitir edições diretas no banco**.
6. Mensagens de falha devem evitar revelar regras antifraude, privilégios ou detalhes internos; registrar os detalhes técnicos apenas no backend.
7. Garantir acessibilidade, estados de carregamento, feedback correto de retry e tratamento de troca de conta e sessões expiradas.

**Gate:** usuário não vê créditos fictícios; operações em análise não aparecem como pagas/gastas; nenhuma regressão no fluxo atual.

## ETAPA 8 — Testes adversariais, performance e homologação (obrigatória)

Criar testes de integração e regressão reproduzíveis, preferencialmente ampliando a suíte existente.

### Matriz mínima de testes

| Área | Cenários que devem passar |
|---|---|
| Autorização | Anônimo, usuário A/B, superadmin, service role, RLS, funções internas e RPCs legadas |
| Idempotência | Mesmo evento 100 vezes, dois requests simultâneos, retries após timeout, webhook reentregue |
| Concorrência | Crédito + débito; duas promoções; estorno + gasto; duas confirmações do mesmo pagamento |
| Pagamento | Redirect falso, valor alterado, IDs divergentes, moeda errada, link reutilizado, retorno atrasado |
| Estorno | Integral, parcial, repetido, sem saldo, acima do elegível, disputa e eventos fora de ordem |
| EvoCoins | Limite diário, replay, evento inexistente, treino offline não validado, spam, remoção de recurso |
| Integridade | Frações, overflow, rollback, histórico append-only, saldo inicial legado, exclusão de conta |
| Operação | Job executado duas vezes, job interrompido, rate limit, falha do provedor, reconciliação paginada |
| UI | Saldo desatualizado/offline, mudança de conta, clique repetido, estado pendente e erro recuperável |

### Executar e registrar

- `npm run lint`
- `npm test`
- `npm run test:functions`
- `npm run build`
- Testes SQL e de concorrência existentes em `supabase/tests/`, usando instância local/descartável e credenciais de teste.
- Verificações de migrations (`db reset`, diff e testes de aplicação incremental), **somente em banco descartável**.
- Testes de carga concentrados em RPCs financeiras e endpoints de webhook, com massa sintética, medindo p50/p95/p99, throughput, contenção/deadlocks, erros e crescimento de filas.

Requisitos de performance:

- Evitar N+1 queries e consultas de histórico completo para exibir saldo.
- Criar apenas índices fundamentados em consultas reais; evitar índices redundantes e escrita excessiva.
- Limitar cardinalidade de logs, tamanho de payload, concorrência dos jobs e duração de transações.
- Preferir operações SQL atômicas e locks por compra/carteira, nunca lock global da economia.
- Manter APIs, componentes e Realtime compatíveis; medir antes/depois em cenário idêntico.
- Nenhuma otimização pode enfraquecer a consistência ou a autorização.

**Gate:** todas as validações executáveis passam, resultados ficam documentados e não há regressão funcional ou degradação significativa não justificada.

## ETAPA 9 — Rollout seguro, monitoramento e documentação final

1. Preparar migrations incrementais e compatíveis com as versões atuais, com pré-check de dados, estimativa de locks, correções em lotes e roteiro para lidar com dados legados anômalos.
2. Usar expansão → backfill controlado → validação → ativação por feature flag (quando necessário) → limpeza futura. Não realizar `DROP COLUMN`, alteração destrutiva ou `UPDATE` em massa sem demonstração de necessidade e plano aprovado.
3. Definir a ordem de deploy entre banco, Edge Functions e frontend e possíveis janelas de versão mista.
4. Habilitar primeiro observabilidade/conciliação shadow, depois as regras que modificam comportamento, minimizando risco financeiro.
5. Criar runbook de incidentes: crédito indevido, pagamento aprovado sem saldo, cobrança duplicada, contestação, divergência de ledger, falha de provedor, vazamento de credencial e rollback.
6. Incluir monitoramento sobre falhas de funções financeiras, tentativas suspeitas, pagamentos presos, backlog da conciliação e estados financeiros impossíveis.
7. Não prometer rollback de migrations financeiras como simples `down`: detalhar **rollback operacional por deploy/feature flag e roll-forward corretivo** com preservação de dados.
8. Não executar deploy de produção, alterar segredos reais ou disparar pagamentos reais sem autorização explícita.

**Gate final:** arquitetura auditável, invariantes financeiras demonstradas, testes automatizados, documentação de riscos residuais e checklist pronto para homologação.

---

## Requisitos de arquitetura e organização de código

- Reutilizar naming conventions, padrões e módulos existentes; manter funções pequenas, responsabilidades claras e código legível.
- Não adicionar novas dependências, filas, microserviços ou tabelas sem justificar por que a estrutura existente é insuficiente.
- Consolidar lógica financeira no backend; o frontend consome contratos estáveis, sem recalcular saldos ou decidir autorização.
- Criar migrações **novas**, não editar versões históricas já executadas; escolher timestamp posterior ao último arquivo existente e reconciliar com a tabela real de migrações.
- Toda tabela nova deve ter: ownership claro, constraints, índices necessários, RLS/policies adequadas, privilégios explícitos, retenção e regra de exclusão.
- Toda função financeira nova deve ter: autenticação/autorização, validação de argumentos, idempotência, controle de concorrência, mensagens seguras, limites e testes.
- Toda integração externa deve ter: validação de origem/resultado, resposta limitada, timeout, retry seguro, rastreabilidade e ausência de segredo em logs.
- Se for necessário alterar uma regra de negócio (ex.: expiração, tratamento de débito não recuperado, limites de moedas), documentar a decisão e o impacto financeiro; não inventar valores comerciais nem políticas de reembolso sem fundamentação.
- Não implementar níveis de Reputação neste trabalho; somente garantir que futuras regras de reputação não sejam alimentadas por pontos inválidos sem rastreabilidade.

## Formato de execução e retorno exigido

Trabalhe **por etapa**, aplicando correções reais. Ao concluir cada etapa:

1. Apresente o que foi auditado e quais riscos foram **confirmados**.
2. Liste os arquivos/migrations alterados e resuma as decisões de arquitetura.
3. Mostre testes executados, resultados e evidências objetivas; não declare “testado” sem execução.
4. Identifique migrações/ações que dependem do ambiente de produção e mantenha-as pendentes de aprovação.
5. Prossiga para a próxima etapa independente, sem refazer componentes existentes.

Ao terminar, entregue:

- **Resumo executivo:** vulnerabilidades corrigidas, proteções existentes preservadas, riscos residuais.
- **Tabela por etapa:** problema, solução aplicada, arquivos, testes, resultado e status.
- **Arquitetura resultante:** fluxo EvoCoins, EvoCash, gateway, estorno, ledger e conciliação.
- **Migrações:** ordem, pré-requisitos, compatibilidade, backfill, smoke tests e rollback operacional.
- **Performance:** medições antes/depois e custo adicional dos mecanismos antifraude/conciliação.
- **Checklist de homologação em staging:** pagamentos simulados/ambiente autorizado, concorrência, contas, reembolso, suspeitas e observabilidade.
- **Pendências de produção:** somente aquilo que exige credenciais reais, configuração do provedor, migrações remotas ou aprovação humana.

**Critério de sucesso:** nenhum usuário consegue gerar EvoCoins/EvoCash sem elegibilidade ou pagamento comprovado; nenhuma repetição ou corrida duplica crédito; nenhum gasto ou estorno corrompe saldos; todas as movimentações são rastreáveis; o fluxo permanece seguro, utilizável e performático. Não afirmar segurança absoluta: demonstrar os controles e explicitar limitações.
