# Fase 3 — motor comercial unificado

Entrega local em 27/10/2026, branch `finance-commercial-phase3`, worktree `/tmp/evolutus-finance-phase3`. Base exata: `finance-quantity-phase2`, commit `48ea165c4fef03e39592a89ab8d9cc7a10cb25c3`. O planejamento mestre foi lido integralmente, junto do inventário da Fase 0 e das entregas das Fases 1–2. O workspace original e suas alterações foram preservados. A implementação parcial encontrada foi revisada, corrigida e validada.

O critério funcional da Fase 3 foi atendido na stack isolada: serviços sintéticos podem ser cotados, contratados, debitados na carteira existente, registrados no ledger, expirados e renovados. Débito e direito são uma transação PostgreSQL indivisível. Não houve push, merge, deploy, chamada financeira externa ou alteração no banco de produção. Fases 4–6 e fichas premium não foram implementadas.

## Preview funcional

[Administração comercial](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/admin/parcerias?tab=engine)

A porta 5173 serve este worktree por Vite, com proxy para Auth/PostgREST/Edge/PostgreSQL locais em loopback 55551–55555. O acesso requer a conta superadmin **sintética** já usada nas fases anteriores. Os dados de acesso, sessão e ID do recurso estão no arquivo local ignorado `.finance-local/phase3-access.json`. Não usar a sessão de produção. A página informa explicitamente que é uma simulação.

O catálogo contém as oito ofertas previstas, sem preço ou integração real habilitada. Apenas fixtures identificadas como sintéticas têm preços de teste. O laboratório, montado exclusivamente com `import.meta.env.DEV` e `VITE_FINANCE_LOCAL_PREVIEW=true`, permite informar o recurso sintético e dias, solicitar cotação, confirmar débito e renovar. Ele não integra o build de produção. A aba Direitos mostra o estado calculado pelo servidor; Atualizar dados faz uma nova consulta sem polling.

Reprodução no ambiente local existente: `node scripts/homolog/finance/phase3-preview.mjs`, `node scripts/homolog/finance/phase3-seed.mjs`, `npm run dev -- --config .finance-local/preview.config.mjs`. Esses launchers usam containers locais fixos, imagens existentes e chaves de teste, não provisionam produção. Browser: `node scripts/homolog/finance/phase3-browser.mjs`; o caminho do Chromium pode ser informado em `PHASE3_CHROMIUM`.

## Schema e responsabilidades

Única migration: `supabase/migrations/20261130000001_commercial_engine.sql`.

| Entidade | Responsabilidade |
| --- | --- |
| `commercial_offerings` | Identificador, descrição, unidade, revisão, pausa de vendas e readiness editorial. Oito serviços desabilitados; nenhum preço seed. |
| `commercial_price_versions` | Preço inteiro em EvoCash/dia, limites, início de vigência, autor e justificativa; versões imutáveis. |
| `commercial_orders` | Cotação e pedido na mesma entidade, dono pagante, recurso, versão editorial, snapshot do preço, duração, período e idempotência. |
| `commercial_order_events` | Auditoria append-only de preços, vendas, cotações, contratação, renovação, suspensão e reversão; também fornece cursores. |
| `visibility_entitlements` | Um direito por recurso, pedido de origem, período efetivo, revisão e bloqueio administrativo. |
| `private.commercial_resources` | Âncora editorial privada, com proprietário por FK, oferta por FK, revisão e aprovação explícitas. Sem API de registro ou edição pelo cliente. |

Nenhum UUID genérico de anúncio, produto ou perfil é aceito como autorização. O pedido referencia uma âncora existente por FK composta de recurso/oferta; o direito referencia recurso e pedido compatíveis por FK. Na próxima fase, o módulo editorial precisará ligar sua entidade concreta à âncora por FK e atualizar aprovação, versão e propriedade sob o mesmo lock. A migration desse módulo deverá garantir o vínculo concreto antes de habilitar `integration_ready`; não há RPC administrativa para abrir esse gate. A âncora isoladamente não publica conteúdo real.

Catálogo, preços e direitos não alteram os módulos atuais de anúncios, promoções, produtos ou perfis. Capacidade, regras de posicionamento e publicação-base/destaque exigirão adapters e validações transacionais das respectivas fases antes de habilitar suas ofertas. Não se criaram módulos fictícios para antecipar essas fases.

## Fluxo financeiro e renovação

1. `quote_commercial_order(resource_id, duration_days, request_id)` autentica a sessão, verifica conta, propriedade e aprovação da revisão atual, disponibilidade e limites. O servidor seleciona a última versão efetiva e calcula o total inteiro. A cotação vale cinco minutos e não movimenta saldo.
2. O cliente apresenta os valores retornados e solicita confirmação explícita. Não envia preço, proprietário, saldo ou expiração autoritativos.
3. `confirm_commercial_order(order_id, true)` trava usuário, oferta, recurso e pedido; revalida acesso, gate, versão editorial, prazo e bloqueios. O helper existente trava a carteira.
4. Na mesma transação: `_wallet_debit_cash` → `_ledger_record` → pedido fulfilled → concessão/renovação do direito → evento de auditoria. Qualquer exceção reverte todas essas escritas.
5. A referência financeira é `commercial:<order UUID>`, no ledger existente, vinculada por `reference_type=commercial_order` e `reference_id`. A unicidade natural do ledger e a transição serializada do pedido impedem dois débitos por replay.
6. Renovação é outro pedido confirmado, pelo preço vigente na nova cotação. Começa em `greatest(expires_at, clock_timestamp())`; acrescenta dias como intervalos de 24 horas, preservando os períodos de todos os pedidos anteriores.

As cotações congelam preço e limites da versão aceita durante sua curta validade; uma publicação posterior não recalcula o snapshot. Pausa de vendas, suspensão, reprovação ou mudança editorial ainda podem impedir a confirmação. Replay de pedido finalizado retorna seu resultado, sem conceder tempo ou reativar conteúdo novamente.

`private.commercial_resource_visible` combina integração pronta, proprietário ativo e sem restrição vigente, conteúdo aprovado na revisão atual, direito habilitado e intervalo vigente pelo relógio do banco. O helper é privado para não criar um oráculo público de UUIDs. Módulos futuros deverão usá-lo em todas as superfícies públicas pertinentes. O vencimento é avaliado na leitura SQL, independentemente de cron, frontend ou alteração materializada de status. A pausa de novas vendas não entra nesse predicado e preserva direitos adquiridos.

Reversão administrativa integral usa os helpers existentes de crédito e ledger, chave `commercial_refund:<order UUID>`, justificativa e autenticação recente. Exige reverter primeiro o pedido mais recente ainda cumprido e conferir o débito original. Remove seu período ou revoga o novo período integralmente; não apaga histórico. Revogação é terminal, retomada de suspensão não prorroga prazo nem aprova conteúdo. Reembolso de EvoCash do serviço não é estorno BRL/InfinitePay.

## Reaproveitamento, interface e limpeza

Reutilizados sem alteração: carteira `wallets`, `economy_transactions`, `_wallet_debit_cash`, recuperação de dívida financeira, `_wallet_credit_cash`, `_ledger_record`, `has_app_access`, sessões e `private.require_evocash_admin`. InfinitePay, conciliação, chargebacks, compras e preços BRL das fases anteriores permanecem nos mesmos contratos.

Administração adicionada como aba na rota existente `/admin/parcerias`, com Primer React: serviços, preços, pedidos, direitos e auditoria. Publicação e ações sensíveis exigem senha pelo Auth, AMR recente no servidor, justificativa, confirmação, idempotência e revisão/CAS. Listagens têm paginação limitada por cursor e não fazem requisições por linha. Temas claro/escuro e largura 320 px foram verificados; corrigida a contenção horizontal da navegação Primer.

Os hooks de anúncios e comunidades recebem um gate opcional para evitar consultas dessas listas ao abrir somente o motor. O conteúdo de campanhas deixa de montar oculto nas demais abas. Mantidos os consumidores ativos de promoções, carteira, relatórios e conciliação; nenhuma função financeira histórica foi removida sem substituição. Removido o probe temporário duplicado de browser. Não há dependência nova. O ESLint passou a ignorar `.finance-local/**`, que contém cache Vite e runtime sintético gerados, já ignorados pelo Git.

O inventário completo está em `ARQUIVOS.md`; hashes dos arquivos entregues em `evidence/source-manifest.json`.

## Segurança

- RLS nas seis tabelas; catálogo administrativo, preços, eventos, recursos e direitos sem acesso direto do cliente. Pedidos só têm SELECT do próprio pagante com acesso válido.
- Nenhuma escrita financeira ou editorial direta concedida a anon/authenticated/service_role. RPCs de contratação não aceitam pagante arbitrário; service_role não pode executá-las.
- Funções privilegiadas com `search_path=''`, objetos qualificados e grants/revokes explícitos. Helpers privados sem execução pública.
- Superadmin ativo, sessão válida e autenticação recente assinada exigidos nas mutações administrativas; a senha não chega à RPC nem à auditoria.
- Preço/total passam como strings na API e são calculados no PostgreSQL. Limite técnico de 2.147.483.647 EvoCash por pedido, até 3.650 dias, compatível com as primitivas atuais; limites comerciais são configuráveis dentro desses tetos. Entradas nulas, negativas, fracionárias, excessivas e overflow falham fechadas.
- Locks de espera finita; usuário → oferta → recurso → pedido → carteira nas contratações. CAS impede atualização administrativa perdida. Idempotência administrativa serializada também entre ofertas.
- Histórico de preços, eventos e snapshots de pedidos protegido por triggers; cotação, confirmação, suspensão e reversão não sobrescrevem contratos anteriores.
- Conta bloqueada/sessão revogada não pode gastar. Conteúdo submetido, alheio, inexistente, com revisão alterada ou suspenso não pode ser contratado. Pagamento não remove suspensão/revogação.
- Sem carteira empresarial, comissões, saques, repasses, venda de fichas por terceiros ou cobranças automáticas.

## Evidências e resultados

| Verificação | Resultado verificável |
| --- | --- |
| Instalação | Migration final reconstruída na fronteira da Fase 2, em transação revertida, com checagem de oito ofertas pausadas e zero preços. `evidence/migration-install.log`. Nenhum histórico financeiro persistente foi apagado. |
| SQL novo | **58 asserções** pgTAP: preço, gates, permissão/RLS, snapshot, duração, renovação, expiração, restrição de conta, sessão, suspensão, imutabilidade e reversão. `commercial_engine_test.log`. |
| Regressão SQL | **124 asserções**: Fase 1 (57), checkout Fase 2 (32), integridade financeira (17), reversões (18). `sql-summary.json` e logs por suíte. Total: **182 asserções**. |
| Atomicidade | Trigger sintético falha na concessão após débito, ledger e atualização de pedido. Saldo, ledger, estado do pedido, datas/revisão do direito e ausência de evento fulfilled/renewed são conferidos após rollback. |
| Concorrência real | Dois publicadores na mesma revisão: um vencedor. Dois pedidos de 70 com saldo 100: um débito e saldo 30. Seis replays de confirmação e seis de renovação: um débito por pedido. Duas renovações independentes simultâneas: um direito, período exato de 432.000 segundos, saldo final 22. `concurrency.json`. Transações com commits reais e processos separados. |
| Integração browser | Auth real → React → PostgREST → SQL → carteira/ledger/direito → leitura vencida → renovação. Duplo clique gerou uma confirmação cliente. Compra e renovação de 21 cada: débito total 42 e um lançamento correspondente por pedido. `browser.json`. |
| Responsividade | 320/390/1440 px, claro/escuro, sem overflow e sem pageerror. Capturas locais ignoradas pelo Git, conforme política do repositório. |
| Rede | Zero requisições financeiras externas; telemetria bloqueada no browser. Apenas stack sintética local. |
| JS | Suite `npm test`: 262 dos 263 arquivos passaram no sandbox; o único bloqueio foi `spawnSync Node EPERM` no teste de fusos. Esse arquivo foi reexecutado fora do sandbox: **18/18 passaram**. Testes novos de serviço/utilitários incluídos. Logs separados preservam esse limite em vez de declarar um único run integral verde. |
| Release | **95 testes passaram**, incluindo scanner, comparador e snapshot público. Primeira tentativa bloqueada por `spawnSync Git EPERM`; retry fora do sandbox passou. |
| Gates | Lint: zero erros, 16 warnings existentes. Build, budget e scanners de segredos de fonte/build passaram; `git diff --check` passou. Aviso existente de chunk Primer acima de 500 kB permanece. |
| Performance | 10.000 recursos/pedidos/direitos sintéticos, rollback ao final. EXPLAIN ANALYZE: predicado pontual 0,075 ms; página de 20 registros 0,250 ms nesta amostra local. Índices de recurso/direito e origem usados. `performance.log`. Não é p95, teste de carga ou SLA. |

O script de concorrência integra o job SQL obrigatório existente; o pgTAP novo segue a descoberta `*_test.sql`. O CI remoto completo depende de futuro push autorizado e não foi executado. Os gates de browser globais não afetados não foram repetidos; a evidência nova cobre as telas e os fluxos desta fase.

Fases 1 e 2 permanecem funcionais nas regressões SQL executadas e suas páginas montaram na mesma stack real de Auth/REST. Nenhum arquivo de implementação dessas fases ou InfinitePay foi modificado nesta entrega. As evidências anteriores continuam disponíveis, sem alegação de nova homologação real do provedor.

## Limites, operação e próximas integrações

Não existem preços comerciais oficiais publicados pela migration. As oito integrações reais permanecem indisponíveis; só o superadmin configurar um preço não habilita o módulo. Preços, limites comerciais e regras de lançamento ainda precisam de decisão comercial antes de vendas. As fixtures ficam exclusivamente na stack descartável.

A situação de produção citada no inventário é o snapshot somente leitura da Fase 0; não foi feita nova auditoria remota nesta fase. O estado efetivamente inspecionado e alterado nesta entrega é o local isolado, com migrations até `20261130000001`. Não se afirma instalação remota das Fases 1–3.

Antes de habilitar qualquer integração futura: estabelecer FK com o conteúdo concreto, sincronizar aprovação/revisão/propriedade em transação, validar elegibilidade e capacidade sob locks, ligar o predicado a todas as leituras/RLS/Storage/cache e testar moderação/expiração em URL direta. Essas condições são responsabilidade das fases correspondentes; nenhuma superfície editorial atual foi convertida para cobrança nesta fase.

Reversão integral exige conta ainda ativa e ordem reversa dos contratos; contas excluídas/bloqueadas exigem o fluxo financeiro de remediação apropriado, sem crédito manual. Política comercial de consumo/cancelamento/compensação precisa ser definida antes de liberar essa ferramenta em operação real. Não há estorno automático novo com InfinitePay.

Rollback operacional: pausar vendas por RPC auditada, manter consultas e histórico. Rollback visual não desfaz débitos. Preservar schema aditivo, pedidos, eventos e ledger; compensações somente pela reversão auditada, nunca por DELETE ou edição de saldo. A reinstalação transacional do harness é exclusiva da stack descartável e sempre termina em rollback; não é runbook de produção.

Para reproduzir SQL e concorrência na stack existente: `node scripts/homolog/finance/phase3-validate.mjs` e `PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/commercial-engine-concurrency.mjs`. Não executar esses fixtures em ambiente compartilhado ou produção. Não há pendência funcional conhecida que impeça o critério de conclusão sintético desta fase; permanecem os limites de CI remoto, lançamento e integrações futuras explicitados acima.
