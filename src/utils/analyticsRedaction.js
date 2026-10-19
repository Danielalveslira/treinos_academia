// beforeSend do Vercel Analytics e do Speed Insights (ver src/main.jsx): nenhuma rota deste
// app depende de query params ou de fragmento nas métricas, e algumas carregam dado sensível
// (token_hash de /redefinir-senha, purchase_id/order_nsu/transaction_nsu do retorno de
// pagamento em /evocash). Por isso query string e fragmento são removidos de toda URL antes
// do envio -- allowlist vazia em vez de blocklist de rotas sensíveis, já que não há rota que
// precise manter query ou hash nas métricas.
export function redactAnalyticsUrl(urlString) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return urlString
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function redactAnalyticsEvent(event) {
  return { ...event, url: redactAnalyticsUrl(event.url) }
}
