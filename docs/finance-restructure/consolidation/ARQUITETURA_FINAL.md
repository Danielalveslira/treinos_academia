# Arquitetura consolidada — Fase 6.1

Base: `finance-advertising-phase6`, `5571e5c15e6489ec3c06fd6cda2d207e69d3e75e`. Conferida por Git e catálogo PostgreSQL local, não somente pelos relatórios. O planejamento mestre informado fica no workspace principal em `docs/promps/PLANEJAMENTO_REESTRUTURACAO_COMERCIAL_FINANCEIRA_EVOLUTUS.md`. Inventários e entregas anteriores continuam sendo histórico, inclusive as correções 4.1 e 5.1.

## Matriz de responsabilidades

| Responsabilidade | Autoridade e consumidores | Limite/risco controlado |
| --- | --- | --- |
| Identidade/sessão | Supabase Auth, `private.current_session_active`, `has_app_access`, `require_commercial_user` | JWT isolado não comprova sessão ativa; API valida sessão/conta/política. |
| Consulta de saldo | `get_my_wallet`, `wallets`; `WalletContext` | Saldo não é calculado pelo React nem por métricas. |
| Crédito/débito | `_wallet_credit_cash`, `_wallet_debit_cash`, helpers de moedas | Locks na mesma carteira; sem UPDATE de cliente ou service_role. |
| Dívida de reversão | `private.recover_cash_debt`, chamado pelas primitivas e reversões | Escrita interna especializada, sob lock e com ledger; não substituir por débito genérico: este chama a recuperação e causaria recursão. |
| Ledger/histórico | `_ledger_record`, `economy_transactions` e RPCs existentes | Chave natural única por usuário, append-only; histórico de casos de exclusão preservado. |
| EvoCoins | `private.award_evocoins`, regras/dia, helpers coin | Mesma infraestrutura, asset separado; nenhuma conversão ou saldo empresarial novo. |
| Preço BRL | `evocash_price_versions`, estado e auditoria; `EvoCashPricing` | Inteiros/centavos, versões imutáveis, CAS e autenticação recente. |
| Cotação/compra EvoCash | RPCs de cotação/reserva, `cash_purchases`, `EvoCashQuantityPurchase` | Snapshot de quantidade/preço; expiração/idempotência e limites no PostgreSQL. |
| Pagamento/crédito | Edge InfinitePay existente → verificação do provedor → `confirm_infinitepay_cash_purchase` | Webhook é indício; divergência/timeout não autoriza crédito. Retardatários e revisão usam caminhos auditados. |
| Cancelamento/reversão | Casos/reversões financeiras existentes e `admin_reverse_commercial_order` | Compensações registradas; nunca apagar ledger ou editar saldo manualmente. |
| Catálogo comercial | `commercial_offerings`, `commercial_price_versions` | Uma tarifa versionada por serviço; nenhuma regra financeira autoritativa no frontend. |
| Cotação/contratação | `commercial_orders`, `confirm_commercial_order`, `commercial_order_events` | Pedido identifica pagante, recurso, oferta, revisão, dias e preço; débito/ledger/direito atômicos. |
| Vigência/renovação | `visibility_entitlements`, `private.commercial_resource_visible` | Relógio PostgreSQL, renovação explícita, suspensão independente do pagamento. |
| Âncora/propriedade | `private.commercial_resources`, FKs compostas e adapters editoriais | Contrato não pode publicar outro proprietário ou tipo. |
| Vitrines/produtos | `product_storefronts`, produtos e snapshots/revisões; `StorefrontManager` | Rascunho privado e snapshot aprovado preservado; mesmos contratos. |
| Profissionais/locais | `professional_listings`, drafts e publicados; central por UUID | Proprietário pode ter múltiplos recursos; suspensão e contratação independentes. |
| Campanhas | `sponsored_ads`, drafts e histórico privados, contas/membros | Proprietário pagante autoriza sua carteira; gestores não gastam saldo alheio. |
| Inventário/global | `advertising_placements`, inventários congelados e `private.advertising_reservations` | Pico simultâneo `[início,fim)`, locks ordenados, pacote indivisível; reduzir abaixo de compromissos falha. |
| Seleção publicitária | `select_advertising`, batch de autorização de impulsos | PostgreSQL filtra aprovação, vigência, contexto, conta e origem antes da seleção. |
| Impulsionamento | `promotions`, `prepare_commercial_promotion`, autorização em lote | Origem orgânica única; prazo comercial não amplia validade orgânica. |
| Métricas | Ingestão oficial existente, agregados diários, painel V2 | Browser não escreve agregado; limites/dedup/contexto/conta no servidor; coleta desligada por padrão. |
| Mídia | `storefront_media`, `storefront-media`, bucket privado e manutenção existentes | MIME/dimensões/WebP, caminhos servidor, FKs, leases e referências; gateway autoriza novamente após ler bytes. |
| Público/SEO | RPCs de catálogos, handlers HTML, sitemap e gateway | Mesmo direito no acesso direto/HTML/metadados; sem cache público de autorização. |
| Cache/Realtime | Epoch → hooks de seleção/validade → reconsulta backend | Realtime apenas invalida; geração descarta respostas antigas; relógio monotônico encurta prazo de servidor. |

## Fluxos definitivos

Compra: quantidade → cotação versionada → reserva idempotente → checkout existente → `payment_check` → confirmação transacional → carteira e ledger. Timeout ambíguo exige conciliação, sem repetir automaticamente uma operação financeira. Compra histórica não depende de catálogo de pacotes ativo.

Serviço: recurso concreto aprovado → cotação → confirmação expressa → revalidação de revisão/proprietário/saldo/capacidade → débito e ledger → pedido, direito e reservas. Falha em qualquer etapa desfaz a transação. Renovação é outro pedido; reversão é compensação auditada. Aprovar conteúdo ou pagar não remove suspensão.

Editorial: rascunho → revisão enviada → decisão CAS → snapshot aprovado. Editar/reprovar preserva snapshot anterior; expiração/suspensão remove elegibilidade no servidor. Produto, perfil, local, campanha e impulso conservam suas regras próprias; compartilham cobrança, mídia e princípios editoriais.

## Correções de assincronia e reuso

`useAdvertisingValidity` recebe `{ deadline, commit }`. Apenas a geração atual, montada e ainda válida executa `commit`; callbacks das páginas deixaram de modificar estado antes dessa verificação. Removida a segunda consulta de comunidades em destaque que podia sobrescrever o resultado autorizado.

`advertisingRecovery` compartilha o orçamento de recuperação entre os dois hooks, sem juntar entidades editoriais. Ao perder o canal, o conteúdo anterior é descartado e o backend é consultado até três vezes. Cada decisão dura no máximo cinco segundos a partir do início da consulta e nunca ultrapassa o vencimento do servidor. O limite não é renovado por foco ou erros repetidos; `SUBSCRIBED` permite nova autorização. Falha do backend ou esgotamento deixa a superfície indisponível. Não há polling ilimitado, consulta de carteira por render nem reaproveitamento de autorização vencida.

Há janela de propagação entre uma autorização e uma alteração concorrente, como em qualquer resposta de seleção. Durante falha do canal ela é limitada pela lease curta, não pela duração contratada. O gateway continua validando mídia diretamente. A recuperação trata interrupções breves; indisponibilidade prolongada permanece fechada.

Eventos `advertising-operational` e buffer de 100 entradas registram estado do canal, autorização, ausência de elegíveis, falha backend e esgotamento. Não contêm UUID, conteúdo, valores ou identidade; não são métricas de audiência nem prova automática de compensação. São diagnóstico local/da página, não telemetria durável de produção. Alterações administrativas/origem permanecem também no histórico operacional servidor existente.
