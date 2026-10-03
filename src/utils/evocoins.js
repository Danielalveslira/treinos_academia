// Apresentação das EvoCoins por participação. O servidor decide TUDO (quanto foi pago, quanto
// já entrou hoje, o teto): aqui só se formata o que ele devolveu -- nenhuma regra de valor ou
// de limite vive no cliente.

import { saoPauloDayKey } from './qualifiedActivity.js'

// "+1 EvoCoin" / "+3 EvoCoins"; null quando não houve crédito (nada a mostrar).
export function formatAwardMessage(coins) {
  const amount = Number(coins)
  if (!Number.isInteger(amount) || amount <= 0) return null
  return `+${amount} ${amount === 1 ? 'EvoCoin' : 'EvoCoins'}`
}

// Crédito percebido = aumento da reputação (lifetime_coins_earned) confirmado pelo servidor via
// Realtime. Gastar não mexe nesse campo, então nunca vira "+N". Sem base conhecida (primeira
// leitura) não há como saber o que é novo: 0.
export function awardDelta(previousLifetime, nextLifetime) {
  if (!Number.isFinite(previousLifetime) || !Number.isFinite(nextLifetime)) return 0
  const delta = nextLifetime - previousLifetime
  return delta > 0 ? delta : 0
}

// Normaliza a resposta de get_my_evocoin_day. Um dia diferente do atual (aba aberta na virada)
// vale zero ganho até a próxima leitura -- nunca exibe o número de ontem como se fosse de hoje.
export function dailyCoinsFromServer(raw, now = new Date()) {
  if (!raw || !Number.isFinite(raw.dailyEarned) || !Number.isFinite(raw.dailyLimit)) return null
  const sameDay = !raw.day || raw.day === saoPauloDayKey(now)
  return {
    earned: sameDay ? raw.dailyEarned : 0,
    limit: raw.dailyLimit,
    day: raw.day || saoPauloDayKey(now),
  }
}

// "EvoCoins de hoje: 7 / 10"
export function formatDailyProgress(daily, now = new Date()) {
  if (!daily) return null
  const earned = daily.day && daily.day !== saoPauloDayKey(now) ? 0 : daily.earned
  return `EvoCoins de hoje: ${earned} / ${daily.limit}`
}
