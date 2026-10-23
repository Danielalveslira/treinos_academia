import test from 'node:test'
import assert from 'node:assert/strict'
import { productionGate } from './vercel-production-gate.mjs'
const project=()=>({id:'prj_WYVlCGYu021KZCrqfp62qRH2cbIE',accountId:'expected-team',name:'treinos_academia',autoAssignCustomDomains:true,link:{type:'github',org:'Danielalveslira',repo:'treinos_academia',productionBranch:'main'},targets:{production:{id:'existing-production'}}})
function mock(p=project(), refuse=false){
 const calls=[]
 const fetcher=async(url,options)=>{
  calls.push({url,method:options.method,body:options.body})
  if(url.endsWith('/v2/teams'))return {ok:true,json:async()=>({teams:[{id:'expected-team',slug:'danielalvesliras-projects'}]})}
  if(options.method==='PATCH'&&!refuse)p.autoAssignCustomDomains=false
  return {ok:true,json:async()=>structuredClone(p)}
 }
 return {fetcher,calls}
}
test('default inspection cannot mutate remote configuration',async()=>{
 const m=mock();const result=await productionGate({token:'test-token',fetcher:m.fetcher})
 assert.equal(result.applied,false);assert.ok(m.calls.every(c=>c.method==='GET'))
})
test('approved hold changes only automatic domain assignment, preserving target',async()=>{
 const m=mock();const result=await productionGate({token:'test-token',apply:true,fetcher:m.fetcher})
 assert.equal(result.autoAssignCustomDomains,false)
 assert.deepEqual(JSON.parse(m.calls.find(c=>c.method==='PATCH').body),{autoAssignCustomDomains:false})
 assert.equal(result.productionDeploymentId,'existing-production')
})
test('fails closed for wrong project and ineffective hold',async()=>{
 const bad=project();bad.link.org='other-owner';const m=mock(bad)
 await assert.rejects(productionGate({token:'test-token',apply:true,fetcher:m.fetcher}),/TARGET_MISMATCH/)
 assert.ok(m.calls.every(c=>c.method==='GET'))
 const n=mock(project(),true)
 await assert.rejects(productionGate({token:'test-token',apply:true,fetcher:n.fetcher}),/HOLD_NOT_CONFIRMED/)
})
test('already held project needs no further mutation',async()=>{
 const p=project();p.autoAssignCustomDomains=false;const m=mock(p)
 assert.equal((await productionGate({token:'test-token',apply:true,fetcher:m.fetcher})).applied,false)
 assert.ok(m.calls.every(c=>c.method==='GET'))
})
