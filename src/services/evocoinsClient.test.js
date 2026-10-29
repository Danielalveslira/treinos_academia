import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// O frontend NUNCA decide quanto ganhou, qual ação foi feita nem o saldo: estes testes travam o
// código contra a introdução acidental de qualquer caminho de crédito pelo cliente.
const SRC = new URL('..', import.meta.url).pathname

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

const files = sourceFiles(SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

test('nenhum código do cliente chama o motor de crédito nem funções internas por RPC', () => {
  const internal =
    /\.rpc\(\s*['"](award_evocoins|_wallet_[a-z_]+|_ledger_[a-z_]+|settle_[a-z_]+|enqueue_pending_award|evocoins_[a-z_]+)['"]/
  for (const { file, text } of files) {
    assert.doesNotMatch(text, internal, file)
  }
})

test('nenhum código do cliente escreve em carteira, ledger, agregado diário, regras ou pendências', () => {
  const tables =
    'wallets|economy_transactions|economy_daily|economy_reward_rules|economy_reward_settings|economy_pending_awards'
  const write = new RegExp(`from\\(['"](${tables})['"]\\)\\s*\\.\\s*(insert|update|upsert|delete)`)
  for (const { file, text } of files) {
    assert.doesNotMatch(text, write, file)
  }
})

test('as RPCs de EvoCoins são chamadas sem nenhum argumento: valor, ação e dia vêm do servidor', () => {
  const rpcs = ['register_qualified_activity', 'complete_workout_session', 'get_my_evocoin_day']
  let found = 0
  for (const { file, text } of files) {
    for (const rpc of rpcs) {
      const calls = text.match(new RegExp(`\\.rpc\\(\\s*['"]${rpc}['"][^)]*\\)`, 'g')) || []
      for (const call of calls) {
        found++
        assert.match(call, new RegExp(`\\.rpc\\(\\s*['"]${rpc}['"]\\s*\\)`), `${file}: ${call}`)
      }
    }
  }
  assert.equal(found, rpcs.length, 'cada RPC é chamada em exatamente um lugar')
})

test('o cliente não envia valores de recompensa ao servidor', () => {
  for (const { file, text } of files) {
    assert.doesNotMatch(text, /p_reward|p_coins|rewardCoins\s*:\s*\d/, file)
  }
})

// `p_action` is also a legitimate command on non-reward administrative RPCs.
// The no-arguments check above protects ALL EvoCoins calls (including action/day)
// without confusing a refund state transition with a client-selected reward.
test('a proteção de recompensa distingue RPC administrativa e rejeita ação em EvoCoins', () => {
  const rewardCall =
    /\.rpc\(\s*['"](?:register_qualified_activity|complete_workout_session|get_my_evocoin_day)['"][^)]*\)/g
  const noArguments =
    /\.rpc\(\s*['"](?:register_qualified_activity|complete_workout_session|get_my_evocoin_day)['"]\s*\)/
  assert.deepEqual(
    "supabase.rpc('act_on_refund_request', { p_action: action })".match(rewardCall),
    null
  )
  for (const name of [
    'register_qualified_activity',
    'complete_workout_session',
    'get_my_evocoin_day',
  ]) {
    const poisoned = `supabase.rpc('${name}', { p_action: 'workout' })`.match(rewardCall)
    assert.equal(poisoned.length, 1)
    assert.doesNotMatch(poisoned[0], noArguments)
  }
})
