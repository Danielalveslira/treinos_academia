# Arrependimento, cancelamentos e reembolsos — entrega técnica

29/10/2026. Implementação e homologação locais na branch `feat/refunds-withdrawal`, worktree `/tmp/evolutus-refunds`. Base `origin/main`: `6e62d4c070e0443f74510e6812828b762ec55f81`, atualizada por fetch e conferida nesta execução. O workspace original `home-inteligente-v4`, suas exclusões, imagens e documentos não versionados foram preservados. Foi encontrada uma implementação local ainda não commitada neste worktree; ela foi revisada, corrigida e validada, sem descartá-la.

Foram lidos integralmente os dois arquivos de `docs/promps` do workspace original: o pedido específico de reembolsos e o planejamento mestre. Consultados os relatórios das Fases 1–6, correções 4.1/5.1, consolidação, integração e preparação de lançamento. Relatórios de implantação anteriores são históricos: não foi inferido nem alterado o estado atual de produção.

O módulo permite registrar e acompanhar solicitações, preserva protocolo e tempestividade, mantém reclamações após sete dias e oferece decisões administrativas auditadas. Conclusão monetária requer evidência do estorno manual e compensação consistente no ledger existente. Produção permanece sem esta instalação. Não houve push, PR remota, merge, deploy, cobrança, estorno real ou chamada financeira externa.

## Inventário e decisões

| Responsabilidade | Reutilização e resultado da inspeção |
| --- | --- |
| Compras de créditos | `cash_purchases`, `evocash_purchase_quotes`, preços congelados e confirmação InfinitePay. A recarga é distinta da contratação de serviço. |
| Carteira e contabilidade | `wallets`, `economy_transactions`, `_wallet_credit_cash`, `_wallet_debit_cash`, `_ledger_record`. Nenhuma carteira ou ledger paralelo. |
| Reversões existentes | `cash_purchase_reversals`, `admin_record_cash_reversal`, `private.cash_debt`, `private.recover_cash_debt`. Existe reversão parcial auditada; ela não constitui API de estorno do provedor nem aprovação jurídica de proporcionalidade. |
| Reservas | Não havia reserva financeira de EvoCash. Adicionado controle pelas solicitações sob o lock da carteira, com trigger que protege todos os caminhos de redução do saldo. Reservar não gera débito de consumo. |
| Proveniência | O ledger não rastreia lotes de compra nem permite atribuir saldo promocional/consumido a uma recarga. Snapshot explicita `untracked`, ausência de saldo por lote e necessidade de análise manual. Totais da carteira não são apresentados como consumo daquela compra. |
| Serviços e publicidade | `commercial_orders`, `commercial_order_events`, `visibility_entitlements`, recursos e inventário publicitário existentes. Compensação integral reutiliza `admin_reverse_commercial_order`, com cancelamento do período e liberação de inventário pelos mecanismos existentes. |
| Identidade e administração | Guards existentes `require_commercial_user`/`require_evocash_admin`, acesso da conta, sessão ativa e AMR recente. Primer, reautenticação pelo Auth e navegação administrativa reaproveitados. |
| Comunicação | Pipeline existente de notificações. Payload contém somente referência/ação, sem descrição da reclamação, valores, identificadores do provedor ou evidência administrativa. |
| Provedor | Checkout, confirmação e conciliação existentes são preservados. Nenhum endpoint de estorno foi inventado. Capacidade/contrato habilitados na conta InfinitePay não foram homologados; não há verificação automática de estorno nesta entrega. |

São necessárias cinco tabelas públicas de responsabilidade distinta: políticas imutáveis, termos por aquisição, solicitações, eventos append-only e referências de liquidação. `refund_settlements` referencia a reversão financeira ou o pedido comercial; não armazena um segundo saldo/ledger. Duas tabelas privadas guardam os gates/configuração e a política oferecida na cotação.

## Fluxo, cálculo e segurança

`get_refund_source` identifica o titular e retorna pagamento original, créditos, preço congelado, reversões anteriores, marco, prazo, política e relógio do servidor. `create_refund_request` recebe apenas origem, categoria, descrição e UUID de intenção; prazo, valores e titular não vêm do navegador. Protocolo e confirmação são imediatos no commit. Replay da mesma intenção devolve o mesmo protocolo; outra intenção sobre um caso aberto também recupera o caso existente.

A minuta `draft-1` usa contagem civil em Brasília, até o fim do sétimo dia após a data do marco: recebimento/crédito da recarga ou contratação do serviço. Não são simplesmente 168 horas. Regra e versão ficam congeladas na cotação e na aquisição. Histórico sem termos verificáveis é explicitamente manual, sem inventar aceite passado ou extinguir direitos. Esta é uma hipótese técnica de homologação, pendente de validação jurídica por modalidade. Minuta completa e versão são acessíveis antes da confirmação, no formulário e no detalhe.

Um novo arrependimento com prazo verificado encerrado é recusado pelo backend; cobrança indevida, fraude, crédito ausente, falha do serviço, cancelamento voluntário e outros direitos continuam registráveis. Pedido recebido no prazo não perde validade por análise posterior. Motivo é facultativo para arrependimento. Valores originais são informativos; não há desconto automático por consumo, dias ou saldo disponível, nem substituição automática de restituição BRL por EvoCash.

Com gate financeiro habilitado somente na base sintética, pedidos elegíveis reservam até a quantidade contestada realmente disponível no saldo agregado. Não se afirma origem por lote. Todas as reduções da carteira respeitam a soma reservada. Insuficiência/consumo/proveniência incerta permanecem em investigação; a conclusão automática inconsistente é impedida.

Estados: `requested → under_review → approved → awaiting_provider_refund → provider_refund_confirmed → completed`; saídas controladas incluem informação pendente, recusa fundamentada, cancelamento cabível, falha externa e contestação. Revisão/CAS, idempotência e guards são conferidos no servidor. Aprovar não movimenta dinheiro. Cada ação grava evento e notifica. O prazo operacional de resposta é separado da janela de arrependimento; a fila sinaliza atrasos na página consultada.

Estorno monetário é feito pelo operador no canal oficial da InfinitePay do pagamento original. O registro exige identificador único, transação original, lojista configurado, BRL, valor integral ainda devido, data e referência de evidência. A verificação permanece identificada como `administrative_evidence_only`; o cliente vê o resultado, sem acesso à evidência administrativa privada. Estornos parciais/anteriores exigem investigação. Não há integração automática, Pix substitutivo ou segunda devolução.

Concluir exige reserva integral, saldo suficiente sem consumir outras reservas, ausência de dívida anterior e fonte consistente. Liberação da própria reserva, reversão oficial, recuperação auditada, referência de liquidação e estado final são uma transação: falha reverte tudo. Reversão externa/chargeback detectado durante reserva encaminha o caso para investigação e mantém a dívida existente, sem perder o evento financeiro. Evidência de estorno já registrada impede liberar a reserva por recusa/cancelamento, mesmo após passar por investigação e nova análise; essa falha foi encontrada e corrigida nesta revisão.

Compensação de serviço usa EvoCash e cancela seu período pelo motor original; não executa restituição BRL. Pedido monetário relacionado impede conclusão automática de serviço. Contratos encadeados e fundos sem lotes exigem revisão explícita; histórico/publicações não são apagados e prazos não são prorrogados. Aplicam-se também as restrições de ordem de reversão do motor existente.

RLS e revogação de grants impedem acesso direto às tabelas; RPCs têm `search_path=''` e helpers sem execução pública. Mutações sensíveis exigem superadmin ativo e autenticação recente. Locks seguem usuário, origem/recurso, pedido de reembolso e carteira, com espera finita. Snapshots, políticas, eventos e liquidações são imutáveis. Solicitações retêm a referência do titular: exclusão destrutiva da identidade é bloqueada para revisão de retenção, não é uma política definitiva de LGPD.

## Migrations e compatibilidade

Aplicar somente após as 205 migrations da base, nesta ordem:

1. `20261207000001_refund_requests.sql`: políticas, termos, solicitações, estados/RPCs, reservas, auditoria, notificações e retenção de identidade.
2. `20261207000002_refund_quote_disclosure.sql`: política congelada na cotação e projeções compatíveis com campos adicionais.
3. `20261207000003_refund_projections.sql`: saldo disponível/reservado e paginação do histórico de eventos.
4. `20261207000004_refund_reversal_coordination.sql`: recuperação de dívida respeitando reservas, detecção de reversão externa e projeção disponível considerando dívida.

As migrations históricas não foram reescritas. Instalação limpa: 205 da main mais quatro novas, total 209. Upgrade com compra histórica preservou hashes de carteiras, ledger, compras, pedidos e direitos; gates nasceram fechados. DDL dos serviços Auth/Storage vem da stack descartável; a prova não equivale a instalação de serviços hospedados.

Frontend antigo continua com os mesmos contratos e recebe campos JSON adicionais; seus débitos também respeitam reservas pelo trigger. Pode apresentar saldo total em vez de disponível, mas não consegue gastar saldo reservado. Frontend novo requer banco já migrado. Falha de RPC não produz confirmação falsa. Rollback visual preserva schema, reservas, protocolos e compensações; não executar down migration destrutiva ou apagar lançamentos para desfazer estorno. Pausar novas operações exige decisão operacional sem interromper reconciliação de casos existentes.

## Interface e arquivos

- `/evocash`: histórico com “Ver compra / Solicitar reembolso”, saldo disponível/reservado e “Minhas solicitações” paginada; detalhe acessível por `?request=<uuid>`.
- Histórico de contratos: “Ver contratação / Cancelar ou reportar problema” no componente compartilhado utilizado pelos serviços existentes.
- `/admin/compras-evocash?tab=refunds`: fila, prazo operacional, classificação revisável, fundamentos, revisão de contratos, comunicação, registro de evidência e liquidação.
- `Refunds.jsx`/`Refunds.css`: componentes Primer de política, formulário, fila e detalhe; foco/teclado e temas existentes.
- `refundService.js`, `refunds.js` e testes: RPCs, textos de estados/erros e orientação temporal pelo servidor.
- Alterações pontuais em `CommercialLeasePurchase`, `CommercialOrderHistory`, `EvoCashQuantityPurchase`, `EvoCash`, `AdminCashPurchases` e notificações.
- Quatro suítes SQL `refund_{requests,exceptions,services,chargeback}_test.sql`, script de concorrência e harnesses `scripts/homolog/finance/refunds-*.mjs`.
- CI existente passa a executar concorrência de reembolsos; suítes SQL novas seguem a descoberta padrão. Sem novos serviços de produção ou dependências.

## Validação

| Verificação | Resultado/evidência |
| --- | --- |
| PostgreSQL real local | Dez suítes, **323 asserções aprovadas**, incluindo 94 de reembolsos e regressões de reversão, integridade, preço, InfinitePay, contratos e campanhas. `evidence/sql-summary.json` e logs por suíte. Fixtures SQL revertidas. |
| Concorrência | Seis submissões → um protocolo/reserva; seis recusas → uma liberação; gasto contra reserva → saldo/ledger consistentes; seis conclusões → uma reversão, um débito e uma liquidação. `evidence/concurrency.json`. Transações independentes com commits. |
| Browser real | Recebimento/protocolo, perda da resposta após commit e recuperação idempotente, reautenticação, análise/aprovação, prova sintética e conclusão. Seis combinações de viewport/tema no detalhe. `evidence/browser.json`: dez verificações sem erros de aplicação. |
| Mobile/teclado | 320/390/1440, claro/escuro, cliente/admin, foco contido no modal, Escape e retorno de foco, sem overflow. `evidence/visual-keyboard.json`. |
| JavaScript afetado | Oito arquivos aprovados: reembolsos, notificações, comercial, fluxo de compra, preço e serviços compartilhados. `evidence/affected-js.log`. |
| Instalação | 209 migrations aplicadas em PostgreSQL novo com imagem oficial fixada/verificada por digest; históricos financeiros preservados e flags fechadas. `evidence/install.json`. |
| Gates | Build, budget, lint sem erros (14 avisos herdados), integridade das migrations e scanners fonte/dist; logs em `evidence`. Aviso anterior de chunk Primer grande permanece. |

O browser bloqueia rede externa; telemetria Vercel não é liberada. Auth, REST e PostgreSQL são reais e locais; compras, dinheiro, provas e contas são sintéticos. As capturas ficam ignoradas em `.finance-local/refunds/captures`, conforme política do repositório. Não se reexecutaram indiscriminadamente milhares de testes inalterados; CI remoto completo depende de publicação autorizada. Realtime não está provisionado neste preview: atualizações são recuperadas pelas consultas/botão e notificações persistidas, sem alegar entrega realtime homologada. Não foram feitos benchmark hospedado, auditoria formal de acessibilidade ou teste em aparelho físico.

Os testes do scanner exigiram repetição fora do sandbox por utilizarem subprocessos Git; os dez testes de integridade/scanner passaram nessa execução. O harness de teclado passou a focar explicitamente o botão antes de testar Escape, porque um seletor nativo pode consumir a primeira tecla para fechar seu próprio popup. As asserções de contenção de foco, fechamento e retorno de foco foram mantidas. Não foi alterado o componente para mascarar a diferença do harness.

## Reprodução e preview

Preview local: <http://127.0.0.1:5174/evocash>; encaminhamento do Codespace: <https://organic-goldfish-r7w5rp9g754vhxp4v-5174.app.github.dev/evocash>. O endereço encaminhado depende das permissões e disponibilidade da sessão; não é deploy persistente. Banner identifica homologação inteiramente sintética. Contas/sessões ficam nos arquivos ignorados `.finance-local/refunds/access.json` e `browser-access.json`; nunca usar credenciais de produção.

Acesso exclusivamente sintético desta execução (não válido em produção):

| Papel | E-mail | Senha local |
| --- | --- | --- |
| Cliente | `refunds-buyer-20acbbd8-6cac-46b7-af4b-eb6ad75e2e62@example.invalid` | `Evolutus-Local-Refunds!2026` |
| Superadmin | `refunds-admin-01fe4715-fb08-402f-af00-ea191f440121@example.invalid` | `Evolutus-Local-Refunds!2026` |

Somente no worktree e nos containers descartáveis allowlisted:

```sh
# Para uma stack nova (não substituir containers existentes):
node scripts/homolog/finance/refunds-stack.mjs start
node scripts/homolog/finance/migrate.mjs all evolutus_refunds_db
node scripts/homolog/finance/refunds-seed.mjs
node_modules/.bin/vite --config .finance-local/refunds.config.mjs
# Em outro terminal:
node scripts/homolog/finance/refunds-validate.mjs
node scripts/refunds-concurrency.mjs
node scripts/homolog/finance/refunds-install.mjs
node scripts/homolog/finance/refunds-seed.mjs browser
node scripts/homolog/finance/refunds-browser.mjs
node scripts/homolog/finance/refunds-visual.mjs
```

`start` recusa containers existentes; `resume` retoma a stack preparada. Seed e concorrência persistem somente fixtures locais; instalação limpa cria outro container sem dados reais. O teste de migração não é runbook para produção. Secrets/sessões não integram os artefatos versionados.

## Pendências e ativação bloqueada

- [ ] Aprovação jurídica/comercial da política completa, marco e contagem civil por modalidade, extensões mais favoráveis, consumo parcial, integralidade e atualização monetária legalmente devida, contratos acessórios, B2B, cancelamento voluntário e retenção/LGPD. Não há regra automática aprovada para esses casos.
- [ ] Validar contrato efetivo e recursos habilitados na conta InfinitePay, procedimento de estorno original, identificação do lojista, evidências, divergências e eventual consulta autorizada. Nenhum estorno real ou API de devolução foi homologado. Valores adicionais/atualização monetária exigem procedimento aprovado; a liquidação técnica atual limita-se ao pagamento original integral.
- [ ] Resolver remediações com créditos consumidos ou histórico sem lotes sem inventar precisão ou impedir restituição legal. O módulo registra e mantém esses casos em análise; não implementa uma política automática de compensação.
- [ ] Definir atendimento de indisponibilidade, contas bloqueadas/excluídas e responsável operacional. O canal do módulo exige acesso ativo; isso não pode ser a única via de exercício de direitos para consumidores sem acesso à conta.
- [ ] Validar infraestrutura, entrega de notificações, monitoramento durável dos prazos, backup/restore e drift atual do destino, sob autorização própria.
- [ ] Autorizar push e abertura da PR remota com o texto de `PR.md`, executar CI obrigatório e revisar o diff. Branch e commit locais são a entrega disponível; a proibição explícita de push exige autorização separada para publicar.
- [ ] Somente depois, autorizar implantação coordenada de banco/frontend e ativação. `financial_requests_enabled=false`, `settlement_enabled=false`, política não aprovada e lojista não configurado são os defaults. Não usar fixtures para ativar produção.

## Referências verificadas em 29/10/2026

O Planalto retornou bloqueio de acesso nesta consulta. O texto legal foi conferido em fonte oficial alternativa da Câmara: [CDC atualizado, art. 49](https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html) e [Decreto 7.962/2013, arts. 4º e 5º](https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html). Essas fontes fundamentam janela legal, informação, atendimento e confirmação; não aprovam a interpretação técnica de contagem/modalidade aqui mantida como minuta.

Consultadas [documentação do Checkout InfinitePay](https://www.infinitepay.io/checkout-documentacao) e [ajuda oficial do Checkout Integrado](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay). A documentação pública de checkout não comprova capacidades contratuais de estorno habilitadas no lojista. Revisão qualificada e homologação operacional continuam obrigatórias antes da ativação.
