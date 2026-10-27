# Fase 1 — preços e cotações EvoCash

## Autorização e escopo

Em 27/10/2026 o usuário aceitou o inventário da Fase 0 e autorizou avançar à Fase 1, esclarecendo que não existem usuários com saldo ou operações financeiras reais. As contagens registradas no inventário são dados de desenvolvimento. Essa instrução substitui a necessidade de compatibilidade criada exclusivamente para supostos clientes financeiros reais; permanecem as proteções financeiras e a proibição de operações/alterações em produção.

A branch `finance-price-phase1`, em `/tmp/evolutus-finance-phase1`, parte do commit local da Fase 0 `95fed8f`. O workspace original foi preservado. Esta entrega cobre o §4 e a Fase 1 do planejamento; `/evocash` e o checkout por quantidade pertencem à Fase 2.

## O que mudou

Migration única `20261128000001_evocash_pricing.sql`:

- `evocash_price_versions`: preço, limites, validade da cotação e limiar de impacto por versão imutável, sem seed de preço comercial.
- `evocash_pricing_state`: revisão para compare-and-swap, última versão e gate de cotações inicialmente desligado. Esta fase não oferece RPC para ativação.
- `evocash_price_audit`: eventos append-only de publicação/pausa, ator, motivo, chave idempotente e payload, sem senha ou credenciais.
- `evocash_purchase_quotes`: quantidade, centavos, versão e validade congelados. Cotação não cria compra nem reserva saldo/limite.

Valores financeiros atravessam a API como strings inteiras e são calculados em BIGINT/NUMERIC no servidor. O cliente somente converte a entrada decimal para centavos exatos com BigInt e formata as respostas; não determina o total de uma cotação ou da simulação. O dia de limite de compra é UTC. As datas de vigência são armazenadas em `timestamptz` e exibidas em Brasília; a entrada agendada usa o fuso do dispositivo, com confirmação explícita da conversão.

A vigência efetiva é a última versão com `active_from <=` relógio do servidor; início único e estritamente crescente impede ambiguidade. Versões futuras não entram em vigor antes da hora. Uma nova publicação não pode ser inserida antes de uma versão já programada. A pausa permite interromper novas cotações sem editar versões, pedidos ou saldos.

API administrativa: `admin_get_evocash_pricing`, `admin_preview_evocash_price`, `admin_publish_evocash_price`, `admin_pause_evocash_quotes`, `admin_list_evocash_prices`. Fundação para a Fase 2: `create_evocash_purchase_quote`, sem chamada InfinitePay.

Na rota existente `/admin/compras-evocash`, as abas **Compras / Precificação / Histórico de preços** reutilizam Primer, navegação administrativa e os fluxos operacionais atuais. A aba Compras só monta seus hooks quando aberta. Precificação permite simulação no servidor, comparação percentual, programação e confirmação com senha/justificativa. Edições invalidam a simulação anterior. O histórico usa tabela paginada por revisão, autor, motivo e vigência, sem consultas por linha.

## Proteções

- RLS nas quatro tabelas. Sem acesso direto de clientes às tabelas administrativas; quotes só são legíveis pelo dono com acesso/sessão ativos. Escritas diretas e helpers internos não são concedidos a anon/authenticated/service_role.
- RPCs administrativas revalidam superadmin, conta ativa e `has_app_access`. Publicação/pausa exigem AMR assinado de autenticação há no máximo cinco minutos. `iat`/`token_refresh` não substituem autenticação. Senha é enviada exclusivamente ao Auth, nunca ao RPC de preço.
- Funções privilegiadas com `search_path=''`, objetos qualificados, revogação e grants explícitos. Locks de mutação têm espera máxima de cinco segundos; acesso é rechecado depois dos locks.
- Publicação/pausa são atômicas com auditoria; lock da linha de controle + revisão impedem perda de atualização. Replay com a mesma chave e payload devolve o resultado original; outra operação/payload é recusada.
- Limiar de confirmação adicional vem da versão anterior, para não poder ser enfraquecido pela própria nova proposta. Limite operacional de dez publicações por minuto por administrador.
- Cotações compartilham o lock de preço e serializam pedidos de cotação por usuário. Limite operacional de dez novas cotações por minuto; replay válido não consome nova operação. Preços, quotes e auditoria rejeitam UPDATE/DELETE mesmo pelo proprietário da função.
- Limites técnicos herdados do núcleo/provedor: até 1.000.000 unidades por pedido, até 10.000.000 centavos por checkout; limites comerciais são preenchidos pelo administrador dentro dessas faixas, sem assumir tarifas aprovadas.
- **Nenhuma escrita em carteira, ledger ou compras. Nenhum novo checkout. Nenhuma ativação real.** Na Fase 2 os limites serão revalidados e reservados atomicamente durante a formalização do pedido; a cotação desta fase não garante disponibilidade de limite futuro.

Referência primária consultada para AMR: [Supabase JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields).

## Reutilização e limpeza

Reutilizados os guards de acesso/sessão, o Auth, o padrão de Dialog/FormControl/Flash/UnderlineNav e a página operacional existente. As quatro tabelas novas têm responsabilidades distintas; não foi criado um segundo ledger, motor de crédito, carteira ou integração de pagamento.

Busca de consumidores confirmou que `CashPackageCards`, `getCashPurchaseSettings`, `requestCashPurchase({packageId})` e `reserve_infinitepay_cash_purchase` ainda pertencem ao checkout ativo, cuja substituição está na Fase 2. Não foram classificados como órfãos nesta entrega. A Fase 1 não acrescenta adaptador legado, modalidade de compra fictícia nem API v2 de compatibilidade. A retirada desse caminho ocorrerá junto da implementação de seu substituto, sem necessidade de sustentar clientes financeiros inexistentes. Migrações históricas, testes de segurança e mecanismos de auditoria/reversão continuam úteis e foram preservados.

Os launchers temporários do preview e suas configurações ficam em `.finance-local`, fora do Git; não são arquitetura de produção.

## Verificação executada

Evidências textuais em `evidence/`. As capturas PNG permanecem locais, sem versionamento, conforme `docs/CAPTURES_POLICY.md`.

- 57 asserções pgTAP novas: autorização, sessão/AMR, RLS, inteiros/overflow, imutabilidade, snapshots, idempotência, limites operacionais, vigência agendada, pausa e preservação de saldo/ledger/compras. Executadas na stack local com schemas reais de Auth/Storage. Fixtures ficam dentro de transação revertida.
- Concorrência real, em processos/commits separados: quatro publicadores disputando uma revisão (um vencedor); seis replays de publicação; seis replays de cotação; corrida de publicação e seis novas cotações. Sem snapshot misturado e sem alteração monetária. O script passou a integrar o job SQL obrigatório do CI.
- Quatro arquivos JS novos/afetados passaram (`evocashPricingService`, `evocashPricing`, `cashPurchaseFlow`, `AppRoutes`); os testes novos verificam strings exatas, conversão/formatador e que a senha não chega ao RPC.
- ESLint dos arquivos alterados e build passaram. Permanece o aviso de chunks grandes já existente; não há alegação de benchmark novo.
- Browser real: Auth → React → PostgREST → PostgreSQL → resposta → simulação/confirmação/publicação/histórico. Compras continua montando. Seis capturas de viewport/tema (320/390/1440, claro/escuro), sem overflow da página, sem pageerror e sem requisição a Supabase/InfinitePay de produção.

Os testes do baseline inalterado não foram repetidos indiscriminadamente. A execução completa do CI remoto permanece para o futuro PR/push; esta entrega não fez push, merge ou deploy. As verificações locais não equivalem a aprovação comercial/jurídica ou lançamento de vendas.

## Preview

Servidor Vite da branch desta fase na porta 5173, com proxy para a stack **local** `evolutus_price_phase1_*`, em portas loopback 55551–55555. Os antigos servidores Vite IPv4/IPv6 foram encerrados para evitar mostrar versões diferentes da aplicação.

- `/admin/compras-evocash?tab=pricing`: precificação e simulação.
- `/admin/compras-evocash?tab=prices`: histórico.
- `/evocash`: interface anterior; compra por quantidade não integra esta fase.

Uma conta superadmin fictícia foi criada somente nessa stack. Seus dados de acesso foram entregues ao usuário e permanecem no arquivo local ignorado `.finance-local/phase1-preview/access.json`; não se usa uma conta de produção. O preço exibido é fictício, publicado pelo smoke local com justificativa identificada como teste. A migration não contém esse preço e o gate de cotações permanece desligado.

## Aplicação e rollback

Não há aplicação autorizada em produção. Para homologação futura: atualizar a base a partir da main, aplicar a única migration em transação, executar pgTAP/concorrência e validar Auth/RPC/UI com dados sintéticos. Confirmar tabelas RLS e grants mínimos, nenhum preço sem aprovação e `quoting_enabled=false`. Implantação eventual exige decisão específica posterior.

Rollback de UI: voltar à revisão anterior. Manter o schema aditivo e auditoria; não executar DROP nem apagar snapshots para desfazer a interface. Pausa de novas cotações usa a RPC auditada e não altera qualquer pedido aceito. No preview local descartável, pode-se interromper os containers e o Vite sem afetar produção.

## Próxima fase

A Fase 2 substitui a compra por pacote pela compra por quantidade e integra cotações ao único motor InfinitePay existente. Antes de liberar vendas ainda são necessários preços/limites aprovados, política comercial/jurídica, revalidação atômica de limites na reserva e testes das falhas/reconciliação do provedor. As demais fases do plano não foram antecipadas.
