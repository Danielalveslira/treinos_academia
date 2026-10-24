import test from 'node:test'
import assert from 'node:assert/strict'
import { checkDiagnostics } from './check-finance-diagnostics.mjs'
const before=()=>({invalid_wallets:0,fractional_ledger:0,invalid_purchase_units:0,invalid_promotion_units:0,credited_without_provider_identity:0,wallet_ledger_discrepancies:0,credited_without_matching_ledger:0,duplicate_cash_purchase_credits:0,invalid_cash_package_config:0,reward_cap:10})
const after=()=>({unapproved_new_financial_jobs:0,credited_missing_ledger:0,duplicate_purchase_credits:0,reversal_aggregate_mismatch:0,negative_wallets:0,daily_cap_excess:0,latest_migration:'20261115000002',reversals_enabled:false,permissions:{authenticated_wallet_update:false,authenticated_credit_helper:false,anon_confirmation:false}})
test('validates CLI wrapper and refuses financial mismatch',()=>{
 assert.equal(checkDiagnostics({rows:[{financial_preflight:before()}]},'before').passed,true)
 const x=before();x.wallet_ledger_discrepancies=1
 assert.throws(()=>checkDiagnostics(x,'before'),/wallet_ledger_discrepancies/)
})
test('missing fields and wrong limits cannot silently pass',()=>{
 const x=before();delete x.invalid_wallets
 assert.throws(()=>checkDiagnostics(x,'before'),/invalid_wallets/)
 x.invalid_wallets=0;x.reward_cap=11
 assert.throws(()=>checkDiagnostics(x,'before'),/reward_cap/)
})
test('postdeploy requires safe schema, flags and permissions',()=>{
 assert.equal(checkDiagnostics(after(),'after').passed,true)
 for(const field of ['latest_migration','reversals_enabled','negative_wallets']){
  const x=after();x[field]=field==='latest_migration'?'20261111000001':field==='reversals_enabled'?true:1
  assert.throws(()=>checkDiagnostics(x,'after'),new RegExp(field))
 }
 const x=after();delete x.permissions
 assert.throws(()=>checkDiagnostics(x,'after'),/permissions/)
})
