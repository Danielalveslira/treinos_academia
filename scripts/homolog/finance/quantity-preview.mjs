// Local-only provider stand-in. Not imported by production Vite config or Edge Functions.
import { jwt } from '../keys.mjs'
const base='http://127.0.0.1:55554'
const headers={Authorization:'Bearer '+jwt({role:'service_role'}),'Content-Type':'application/json'}
const orderPattern=/^evo_[0-9a-f]{32}$/
export function quantityPreviewPlugin(){return {
 name:'local-quantity-checkout-preview',enforce:'pre',
 transform(code,id){
  if(id.endsWith('/src/pages/EvoCash.jsx')) return code.replace('href={purchase.checkoutUrl}', `href={purchase.checkoutUrl?.includes('/fixture?lenc=') ? '/_finance_local_checkout?order_nsu='+new URL(purchase.checkoutUrl).searchParams.get('lenc') : purchase.checkoutUrl}`)
  if(!id.endsWith('/src/utils/cashPurchaseFlow.js'))return
  return code.replace('navigate(url.toString())',"if (url.pathname === '/fixture' && /^evo_[0-9a-f]{32}$/.test(url.searchParams.get('lenc') || '')) return navigate('/_finance_local_checkout?order_nsu=' + url.searchParams.get('lenc')); navigate(url.toString())")
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://localhost')
  if(url.pathname!=='/_finance_local_checkout')return next()
  try{
   const order=url.searchParams.get('order_nsu')
   if(!orderPattern.test(order||'')){res.statusCode=400;res.end('Invalid local order');return}
   const result=await fetch(base+'/rest/v1/cash_purchases?select=id,amount_centavos,cash_amount,provider_order_nsu&provider_order_nsu=eq.'+order,{headers})
   const rows=await result.json();const p=rows[0]
   if(!result.ok||!p){res.statusCode=404;res.end('Pedido local não encontrado');return}
   const hint={order_nsu:order,transaction_nsu:'synthetic-'+p.id,slug:'synthetic-'+p.id}
   const returnPath='/evocash?checkout_return=1&purchase_id='+p.id
   if(req.method==='POST'){
    const config={...hint,paid:true,amount:p.amount_centavos,capture_method:'pix'}
    const configured=await fetch(base+'/__provider/config',{method:'POST',headers,body:JSON.stringify(config)})
    if(!configured.ok)throw Error('Mock configuration failed')
    const hook=await fetch(base+'/functions/v1/infinitepay-webhook',{method:'POST',headers,body:JSON.stringify(hint)})
    if(!hook.ok)throw Error('Local provider verification failed: '+hook.status)
    res.statusCode=303;res.setHeader('Location',returnPath+'&'+new URLSearchParams(hint));res.end();return
   }
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store')
   res.end(`<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pagamento simulado · Evolutus</title><style>body{font:17px system-ui;max-width:480px;margin:50px auto;padding:24px;line-height:1.6;background:#f6f8fa;color:#1f2328}section{padding:24px;border:1px solid #d0d7de;border-radius:12px}button{font:inherit;padding:12px 18px;background:#1f883d;color:white;border:0;border-radius:8px;cursor:pointer}a{color:#0969da}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#f0f6fc}a{color:#58a6ff}}</style><section><p>AMBIENTE LOCAL · SIMULAÇÃO</p><h1>Pagamento de teste</h1><p>${p.cash_amount} EvoCash</p><p>Valor fictício: R$ ${BigInt(p.amount_centavos)/100n},${(BigInt(p.amount_centavos)%100n).toString().padStart(2,'0')}</p><p>Nenhum dado de cartão ou pagamento real é utilizado. A aprovação percorre o webhook e a confirmação do backend local.</p><form method="post"><button>Simular pagamento aprovado</button></form><p><a href="${returnPath}">Voltar sem pagar</a></p></section></html>`)
  }catch(error){console.error('[local quantity preview]',error.message);res.statusCode=502;res.end('A simulação local não concluiu. Volte ao histórico para verificar o pedido.')}
 })}
}}
