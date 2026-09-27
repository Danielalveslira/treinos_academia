// Webhook oficial do Mercado Pago (IPN/notificações). Rota pública (sem JWT do
// Supabase — configurada com verify_jwt=false em supabase/config.toml), autenticada
// pela assinatura HMAC do próprio Mercado Pago (x-signature), nunca pelo corpo da
// notificação em si.
//
// Regra de segurança central: NUNCA confiar no status vindo do payload do webhook.
// Depois de validar a assinatura, sempre busca o pagamento de volta na API do Mercado
// Pago (GET /v1/payments/{id}) usando o access token secreto, e só credita com o status
// que essa resposta autoritativa devolveu.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')
const MP_WEBHOOK_SECRET = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const rawBody = await req.text()
    let body: Record<string, unknown> = {}
    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      // Notificação antiga (topic/id via query string, sem corpo JSON) -- segue com body vazio.
    }

    const paymentId =
      (body?.data as { id?: string | number } | undefined)?.id ??
      url.searchParams.get('data.id') ??
      url.searchParams.get('id')

    const type = (body?.type as string | undefined) ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
    if (type && type !== 'payment') {
      // Mercado Pago também notifica outros tópicos (ex. merchant_order) -- só
      // pagamento nos interessa aqui.
      return new Response('ignored', { status: 200 })
    }
    if (!paymentId) {
      return new Response('missing payment id', { status: 400 })
    }

    if (MP_WEBHOOK_SECRET) {
      const signatureHeader = req.headers.get('x-signature')
      const requestId = req.headers.get('x-request-id') ?? ''
      const valid = await isValidSignature(signatureHeader, String(paymentId), requestId, MP_WEBHOOK_SECRET)
      if (!valid) {
        console.error('[mercadopago-webhook] assinatura inválida, notificação rejeitada')
        return new Response('invalid signature', { status: 401 })
      }
    } else {
      console.warn('[mercadopago-webhook] MERCADOPAGO_WEBHOOK_SECRET não configurado -- assinatura NÃO verificada (ok só em desenvolvimento)')
    }

    if (!MP_ACCESS_TOKEN) {
      console.error('[mercadopago-webhook] MERCADOPAGO_ACCESS_TOKEN não configurado')
      return new Response('mercadopago not configured', { status: 503 })
    }

    // Nunca confia no status do payload -- busca a fonte da verdade na própria API.
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    })
    if (!paymentResponse.ok) {
      console.error('[mercadopago-webhook] falha ao buscar pagamento', paymentId, paymentResponse.status)
      return new Response('failed to fetch payment', { status: 502 })
    }
    const payment = await paymentResponse.json()

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data, error } = await admin.rpc('credit_cash_purchase_from_webhook', {
      p_mp_payment_id: payment.id,
      p_mp_status: payment.status,
    })
    if (error) {
      if (error.message === 'PURCHASE_NOT_FOUND') {
        // Pagamento do Mercado Pago não corresponde a nenhuma compra nossa (ex.
        // criado fora do fluxo do app) -- não é erro nosso, só não há o que creditar.
        return new Response('purchase not found', { status: 200 })
      }
      console.error('[mercadopago-webhook] credit_cash_purchase_from_webhook falhou:', error)
      return new Response('internal error', { status: 500 })
    }

    console.log('[mercadopago-webhook] resultado:', data)
    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error('[mercadopago-webhook] erro inesperado:', error)
    return new Response('internal error', { status: 500 })
  }
})

// Formato oficial do Mercado Pago: "ts=<timestamp>,v1=<hash>" -- template assinado é
// "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (request-id omitido quando ausente).
async function isValidSignature(
  signatureHeader: string | null, dataId: string, requestId: string, secret: string
): Promise<boolean> {
  if (!signatureHeader) return false
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=')
      return [key.trim(), value?.trim()]
    })
  )
  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return false

  const template = requestId
    ? `id:${dataId};request-id:${requestId};ts:${ts};`
    : `id:${dataId};ts:${ts};`

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(template))
  const computedHex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return computedHex === v1
}
