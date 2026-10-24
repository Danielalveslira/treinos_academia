// Fail closed: a successful SQL request alone does not mean a safe financial state.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function checkDiagnostics(input, phase) {
  if (!['before','after'].includes(phase)) throw Error('Expected before or after')
  const key=phase==='before'?'financial_preflight':'finance_postdeploy'
  let x=input.rows ? input.rows[0]?.[key] : input
  if(typeof x==='string')x=JSON.parse(x)
  if(!x||typeof x!=='object')throw Error('MISSING_FINANCIAL_DIAGNOSTICS')
  const zero=phase==='before'
    ? ['invalid_wallets','fractional_ledger','invalid_purchase_units','invalid_promotion_units','credited_without_provider_identity','wallet_ledger_discrepancies','credited_without_matching_ledger','duplicate_cash_purchase_credits','invalid_cash_package_config']
    : ['unapproved_new_financial_jobs','credited_missing_ledger','duplicate_purchase_credits','reversal_aggregate_mismatch','negative_wallets','daily_cap_excess']
  const failed=zero.filter(k=>x[k]!==0)
  if(phase==='before' && x.reward_cap!==10)failed.push('reward_cap')
  if(phase==='after') {
    if(x.latest_migration!=='20261115000002')failed.push('latest_migration')
    if(x.reversals_enabled!==false)failed.push('reversals_enabled')
    for(const key of ['authenticated_wallet_update','authenticated_credit_helper','anon_confirmation'])if(x.permissions?.[key]!==false)failed.push('permissions.'+key)
  }
  if(failed.length)throw Error('FINANCIAL_GATE_FAILED: '+failed.join(', '))
  return {phase,passed:true,latest_migration:x.latest_migration}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [phase,file]=process.argv.slice(2)
  console.log(JSON.stringify(checkDiagnostics(JSON.parse(readFileSync(file,'utf8')),phase)))
}
