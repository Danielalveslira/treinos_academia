# InfinitePay Checkout Integrado — migração em etapas

Status: checkout publicado em produção; **pagamento real ainda não validado**.

Contrato conferido na [documentação oficial](https://www.infinitepay.io/checkout-documentacao):
`POST /links` recebe `handle`, `order_nsu`, `items` com preço em centavos,
`redirect_url` e `webhook_url`. `POST /payment_check` recebe `handle`, `order_nsu`,
`transaction_nsu` e `slug`; só `success=true`, `paid=true`, `amount` igual ao
snapshot e `capture_method` reconhecido autorizam o crédito. Não há assinatura
criptográfica pública documentada para o webhook.

## Arquitetura

- `cash_purchases` continua sendo a tabela única. Linhas antigas recebem
  `payment_provider=mercadopago`; o `mp_payment_id`, QR, funções e secrets legados
  permanecem para conciliação histórica. As novas linhas usam `infinitepay` e
  índices únicos para `order_nsu` e `transaction_nsu`.
- `infinitepay-create-checkout` aceita somente `packageId`, valida JWT e
  `has_app_access()`. A RPC de reserva lê o pacote ativo e o preço em
  `economy_config`, gera `order_nsu` no banco e reutiliza uma compra pendente
  do mesmo pacote. Uma lease de 24 horas evita criar dois links simultâneos
  mesmo se o processo cair antes de marcar a incerteza. Se a
  chamada a `/links` chegar ao provedor mas a resposta se perder, a compra fica
  marcada para conciliação: retry automático não cria outra cobrança.
- A URL do checkout é aceita somente nos hosts exatos
  `checkout.infinitepay.io` (observado na resposta real de `/links`) e
  `checkout.infinitepay.com.br`.
  `APP_PUBLIC_URL` e `INFINITEPAY_HANDLE` são configuração privada da função.
- O webhook sem assinatura é apenas um gatilho: procura o pedido por `order_nsu`,
  consulta `/payment_check` e só então chama a RPC de crédito. O retorno ao PWA
  usa `infinitepay-check-payment` autenticada, que confere dono da compra e faz
  a mesma consulta quando há identificadores de retorno. Nenhum query param
  altera saldo diretamente.
- A confirmação trava a compra, rejeita divergência de pedido/valor/transação,
  grava método Pix ou cartão e usa as mesmas funções de wallet e ledger do
  Mercado Pago. Uma compra com `financial_case_id` vai para `held_in_case`, sem
  recriar carteira. O fallback manual de admin recusa InfinitePay.
- O preço e a quantidade de EvoCash no frontend são informativos; só o snapshot
  gerado pelo banco entra no checkout. Nenhum payload completo de provedor é salvo.
- O payload de `/links` contém somente `handle`, `order_nsu`, `items`,
  `redirect_url` e `webhook_url`. Não envia `address` nem `customer`.
  A etapa “Entrega” observada no checkout real é renderizada pela InfinitePay
  e precisa ser desativada na configuração da conta, se essa opção estiver disponível.

## Configuração necessária antes do smoke

Secrets das Edge Functions: `INFINITEPAY_HANDLE` (InfiniteTag sem `$`) e
`APP_PUBLIC_URL` (origem HTTPS canônica do PWA). Os secrets padrão do Supabase
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) já são usados.
Habilitar o Checkout Integrado na conta InfinitePay. Publicar a migration antes
das três funções e do frontend. Configurar redirect para a origem exata do PWA;
o webhook é `https://<projeto>.supabase.co/functions/v1/infinitepay-webhook`.

## Smoke necessário antes de ativar

1. Criar checkout de pacote ativo; conferir preço em centavos e abrir no mobile/PWA.
2. Pagar uma vez via Pix e outra via cartão; conferir `cash_purchases`, saldo,
   exatamente uma linha de ledger e retorno ao app.
3. Reenviar webhook; conferir que saldo e ledger não mudam.
4. Enviar redirect falso e webhook falso; confirmar que não creditam.
5. Interromper `/links`, repetir a compra e verificar reutilização da mesma linha.
6. Testar pagamento tardio com exclusão financeira separada, inclusive conta já
   removida: estado `held_in_case`, sem wallet/ledger novos.
7. Reconciliar compras Mercado Pago pendentes antes de qualquer remoção do legado.

Compras InfinitePay abandonadas ficam pendentes para conciliação administrativa.
Um `/links` que responde 4xx marca a compra como `checkout_failed`; o retry
reaproveita o mesmo pedido se pacote e preço não mudaram. Timeout, 5xx ou
resposta sem URL permanecem em conciliação, porque o provedor pode ter emitido
um link apesar da resposta ambígua. A interface distingue esse estado de um
pagamento em andamento e não credita carteira ou ledger.
O comprador pode solicitar cancelamento de uma compra pendente. O pedido fica
registrado, o link deixa de ser oferecido na interface e a equipe deve conciliar
o provedor. A API pública do Checkout Integrado não documenta invalidação do
link; por isso a compra continua pendente e um pagamento tardio verificado ainda
é tratado pelo fluxo financeiro normal.
Não há parâmetro público documentado para cancelar um link: não expirar nem
cancelar automaticamente uma compra que ainda pode ser paga. O cancelamento
manual exige checagem operacional no provedor para evitar pagamento tardio após
cancelamento. O fluxo antigo do Mercado Pago permanece disponível durante o
período de transição.

O teste pgTAP valida a transação SQL; os testes de Edge Functions usam respostas
simuladas. A verificação de entrega real e disponibilidade do webhook depende do
smoke acima. Nenhuma chamada de pagamento real foi feita nesta branch.
