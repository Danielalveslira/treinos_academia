import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
let directory, exercise
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'commercial-promotion-ui-'))
  const outfile = join(directory, 'test.cjs')
  await build({
    stdin: {
      contents: `
 import {PromoteDialogBody} from './PromoteDialog.jsx'
 import {reset,render,flush,cleanup} from 'react'
 import {configure,calls} from '../services/promotionsService'
 export async function exercise(response,error,late=false) {
 reset();configure(response,error,late)
 const props={targetType:'post',targetId:'original-post'}
 let tree=render(()=>PromoteDialogBody(props))
 if(late)cleanup()
 await flush()
 tree=render(()=>PromoteDialogBody(props))
 cleanup()
 return {tree,calls:[...calls]}
 }`,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'isolated-ui',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(react|react\/jsx-runtime|@primer\/react)$|services\/(promotionsService|advertisingService)$|Commercial(LeasePurchase|OrderHistory)$/,
            },
            ({ path }) => ({ path, namespace: 'stub' })
          )
          b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            contents:
              path === 'react'
                ? `let states=[],effects=[],index=0,stops=[];export function reset(){states=[];effects=[];index=0;stops=[]}export function render(fn){index=0;return fn()}export function useState(init){let i=index++;if(!(i in states))states[i]=init;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]}export function useEffect(fn){if(!effects.length)effects.push(fn)}export async function flush(){stops=effects.map(f=>f());await Promise.resolve();await Promise.resolve()}export function cleanup(){for(const f of stops)f?.()}`
                : path === 'react/jsx-runtime'
                  ? `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment'`
                  : path === '@primer/react'
                    ? `export const Box='box',Button='button',Dialog='dialog',Flash='flash',Spinner='spinner',Text='text'`
                    : path.includes('promotionsService')
                      ? `let response,error;export const calls=[];export function configure(r,e){response=r;error=e;calls.length=0}export async function resubmitCommercialPromotion(){};export async function prepareCommercialPromotion(type,id){calls.push(['prepare',type,id]);if(error)throw Error(error);return response};export async function getDirectPostBoostOffer(id){calls.push(['offer',id]);if(error)throw Error(error);return response};export async function prepareDirectPostBoost(id){calls.push(['direct',id]);return response}`
                      : path.includes('advertisingService')
                        ? `export const getAdvertisingOrders=()=>[]`
                        : path.includes('CommercialLeasePurchase')
                          ? `export default 'purchase'`
                          : `export default 'history'`,
          }))
        },
      },
    ],
  })
  ;({ exercise } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  const children = tree.props?.children
  return [
    ...(tree.type === type ? [tree] : []),
    ...(Array.isArray(children) ? children : [children]).flatMap((n) => nodes(n, type)),
  ]
}
test('opening a post promotion only reads its offer and mounts no history', async () => {
  const tariff = { salesEnabled: true, price: '7', minDays: 1, maxDays: 30 }
  const { tree, calls } = await exercise({ resourceId: null, tariff })
  assert.deepEqual(calls, [['offer', 'original-post']])
  assert.equal(nodes(tree, 'purchase').length, 1)
  assert.equal(nodes(tree, 'purchase')[0].props.compact, true)
  assert.equal(nodes(tree, 'history').length, 0)
})
test('post promotion delegates quoting to the existing lease', async () => {
  const tariff = { salesEnabled: true, price: '7', minDays: 1, maxDays: 30 }
  const { tree } = await exercise({ resourceId: 'promotion', tariff })
  const payment = nodes(tree, 'purchase')[0]
  assert.equal(payment.props.resourceId, 'promotion')
  assert.deepEqual(payment.props.tariff, tariff)
  assert.equal(typeof payment.props.prepareResource, 'function')
})
test('permission failure cannot display payment controls', async () => {
  const { tree } = await exercise(null, 'AD_COMMUNITY_PERMISSION_REQUIRED')
  assert.equal(nodes(tree, 'purchase').length, 0)
  assert.match(JSON.stringify(tree), /proprietário precisa permitir/)
})
