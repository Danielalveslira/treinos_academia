// Cria o pagamento PIX no Mercado Pago para uma compra de EvoCash. Chamada pelo
// cliente (JWT do próprio comprador) depois de reservar a linha pendente via a RPC
// request_cash_purchase — nunca fala com o Mercado Pago antes de a elegibilidade/preço
// já estarem resolvidos e travados no banco (fail-closed, preço nunca vem do cliente).
//
// Idempotência ponta a ponta: se o mesmo requestId já tiver QR code gravado (retry de
// rede, por exemplo), devolve o que já existe em vez de criar um segundo pagamento no
// Mercado Pago.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MP_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonError('NOT_AUTHENTICATED', 401)
    }
    const { packageId, requestId } = await req.json()
    if (!packageId || !requestId) {
      return jsonError('INVALID_REQUEST', 400)
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) {
      return jsonError('NOT_AUTHENTICATED', 401)
    }
    const uid = userData.user.id

    const { data: purchase, error: rpcErr } = await userClient.rpc('request_cash_purchase', {
      p_package_id: packageId,
      p_request_id: requestId,
    })
    if (rpcErr) {
      return jsonError(rpcErr.message, 400)
    }

    // Replay já tem QR code gravado (tentativa anterior chegou até o Mercado Pago) --
    // devolve sem criar um segundo pagamento.
    if (purchase.replay && purchase.qrCode) {
      return jsonOk(purchase)
    }
    // Replay sem QR code ainda: outra chamada pode estar em andamento neste exato
    // instante (mesma corrida do requestId), mas nada aqui garante exclusão mútua entre
    // duas chamadas concorrentes a esta Edge Function -- aceitável (o pior caso é criar
    // 2 pagamentos MP para a mesma compra pendente; o primeiro webhook aprovado credita,
    // o segundo é ignorado por já não estar 'pending'). Segue para criar no Mercado Pago.

    if (!MP_ACCESS_TOKEN) {
      return jsonError('MERCADOPAGO_NOT_CONFIGURED', 503)
    }

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': `${uid}:${requestId}`,
      },
      body: JSON.stringify({
        transaction_amount: purchase.amountCentavos / 100,
        description: `EvoCash — ${purchase.packageId}`,
        payment_method_id: 'pix',
        payer: { email: userData.user.email },
        external_reference: purchase.id,
      }),
    })
    const mpPayment = await mpResponse.json()
    if (!mpResponse.ok) {
      console.error('[mercadopago-create-payment] Mercado Pago error:', mpPayment)
      return jsonError('MERCADOPAGO_REQUEST_FAILED', 502)
    }

    const qrCode = mpPayment.point_of_interaction?.transaction_data?.qr_code ?? null
    const qrCodeBase64 = mpPayment.point_of_interaction?.transaction_data?.qr_code_base64 ?? null
    const ticketUrl = mpPayment.point_of_interaction?.transaction_data?.ticket_url ?? null

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { error: attachErr } = await adminClient.rpc('attach_mercadopago_payment', {
      p_purchase_id: purchase.id,
      p_mp_payment_id: mpPayment.id,
      p_mp_status: mpPayment.status,
      p_qr_code: qrCode,
      p_qr_code_base64: qrCodeBase64,
      p_ticket_url: ticketUrl,
    })
    if (attachErr) {
      console.error('[mercadopago-create-payment] attach_mercadopago_payment failed:', attachErr)
      return jsonError('INTERNAL_ERROR', 500)
    }

    return jsonOk({ ...purchase, qrCode, qrCodeBase64, ticketUrl })
  } catch (error) {
    console.error('[mercadopago-create-payment] unexpected error:', error)
    return jsonError('INTERNAL_ERROR', 500)
  }
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
}

function jsonError(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}
