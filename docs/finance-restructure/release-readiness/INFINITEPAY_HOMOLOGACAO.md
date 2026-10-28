# InfinitePay — validação limitada, homologação externa pendente

## Contrato e implementação

Revisadas em 2026-10-28 as [instruções oficiais de Checkout](https://www.infinitepay.io/checkout-documentacao) e a [central de ajuda sobre opções avançadas](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay). Criação por /links com preço inteiro em centavos; confirmação por /payment_check com identificadores do pedido/provedor. Opções single_payment e valid_until exigem configuração compatível da conta; API key vai no X-Api-Key somente no servidor.

Código em supabase/functions/infinitepay-create-checkout, infinitepay-webhook, infinitepay-admin-reconcile e _shared/infinitepay.js reaproveita a compra e o crédito oficiais. Cotação/pedido são autoridade do valor, o retorno visual não credita; payment_check verifica pagamento e valor original. Identificadores divergentes e segunda transação verificada vão para revisão; crédito idempotente é feito no banco. URLs de checkout têm allowlist HTTPS; lease e estado incerto impedem recriação automática de link. Moeda explícita diferente de BRL é recusada; o exemplo oficial pode omitir moeda, portanto a operação BRL da conta precisa ser confirmada externamente.

As fontes oficiais apresentam webhook_url no guia e webhook com seleção de eventos na ajuda mais recente. O código usa webhook_url no caminho de confirmação. Não se presumiu suporte automático a novos eventos refunded/canceled nem foi reescrita a integração. Confirmar contrato habilitado na conta e entrega/retry/ordem dos eventos antes de homologar. Reversão financeira auditável não equivale a integração automática de estorno no provedor.

## Evidência sem dinheiro

Reexecução local de cinco arquivos: core.test.js, handler.test.js, payment.test.js, limitedJson.test.js e batch.test.js: 26 testes aprovados, zero falhas/skips. Evidência em evidence/infinitepay-local.log. São mocks controlados do provedor, não transações homologadas. SQL/concorrência reais do CI validam o banco local descartável; tampouco comprovam operação da conta InfinitePay.

| Cenário | Evidência disponível | Falta para homologação real |
|---|---|---|
| Criar link, pagamento único e validade | Payload e rejeições simulados | Conta habilitada e resposta oficial autorizada |
| Link expirado/cancelado/pendente | Guards/estados e cancelado pago/não pago simulados | Semântica efetiva do provedor |
| Confirmado/duplicado/webhook repetido | payment_check e crédito único simulados; integridade SQL no CI | Entrega real e correlação com transação |
| Fora de ordem/pagamento tardio | Estados terminais/replays e pedido cancelado pago simulados | Sequência real completa não validada |
| Timeout/resultado incerto | Falha remota e persistência interrompida simuladas | Recuperação operacional no ambiente autorizado |
| Valor/ID incorreto | Rejeição simulada | Contrato efetivo da conta |
| Sessão revogada | Gates SQL/Edge locais e remotos | Ambiente real sem criação de transação |
| Falha de saldo/conciliação | Atomicidade SQL e batch simulado | Falha/recuperação end-to-end real não provocada |
| Reversão/estorno | Proteções/terminalidade locais | Procedimento contratual e financeiro real pendente |

Nenhum sandbox oficial ou credencial de homologação foi comprovado. Nenhum link/pagamento real foi criado, nenhuma API financeira da conta foi chamada nesta etapa. Configuração efetiva de secrets/merchant, taxas, aceitação de créditos pré-pagos, assinatura/autenticidade dos eventos e operação de estorno precisam ser confirmadas com responsável e provedor. Webhook não é prova suficiente sem verificação server-to-server.

## Pedido futuro de autorização específica

Se não existir sandbox, propor teste controlado de R$ 10 apenas se compatível com mínimo oficial e preço aprovado, em conta e ambiente explicitamente identificados pelo responsável. Antes de criar link: aprovar valor, comprador, merchant, versão de preço, limite de uma transação, taxas não recuperáveis, política de estorno e evidências redigidas. Conferir pedido → payment_check → um crédito → ledger e replay sem segundo crédito; conciliar recebimento. Reembolso pelo procedimento autorizado do provedor e reversão auditada, sem editar saldo ou apagar pedido. Transação recusada/incerta exige investigação antes de repetir. Essa proposta não autoriza sua execução.
