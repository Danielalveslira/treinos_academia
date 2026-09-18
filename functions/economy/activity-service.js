import { evaluateCheckpoint, todayKey } from './activity-core.js'

export { todayKey }

export function createActivityService({
  db,
  FieldValue,
  wallet,
  ledger,
  getEconomyConfig,
  assertWritableAccount,
  now = Date.now,
}) {
  return async function registerQualifiedActivity(uid) {
    const nowMs = now()
    const dateKey = todayKey(nowMs)
    const dailyRef = db.doc(`users/${uid}/economyDaily/${dateKey}`)
    const naturalKey = `daily-activity:${dateKey}`

    return db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)

      const dailySnapshot = await tx.get(dailyRef)
      const daily = dailySnapshot.exists ? dailySnapshot.data() : null

      // Config lida por chamada (com cache em memória no config-service) em vez de uma
      // vez só no módulo: os limiares podem mudar sem precisar reimplantar a função.
      const config = await getEconomyConfig()
      const { requiredMinutes, rewardCoins } = config.dailyActivity

      const result = evaluateCheckpoint({ daily, nowMs, requiredMinutes })
      if (!result.apply) {
        return { granted: false, reason: result.reason }
      }

      if (!result.rewardEligible) {
        // {merge:true}: economyDaily/{date} também guarda votesCharged/voteCoinsSpent
        // (ver vote-service.js) -- um set() sem merge aqui apagaria silenciosamente os
        // contadores de voto do dia sempre que um checkpoint de atividade rodasse.
        tx.set(
          dailyRef,
          { ...result.nextDaily, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
        return { granted: false, activeMinutes: result.nextDaily.activeMinutes }
      }

      // Segunda trava de idempotência, além da flag activityRewardGranted: mesmo que o
      // dia já tivesse sido marcado como premiado sem o ledger ter sido criado (uma
      // falha a meio caminho, por exemplo), o ledger nunca deixa creditar duas vezes.
      const alreadyLedgered = await ledger.alreadyRecorded(tx, uid, naturalKey)
      if (alreadyLedgered) {
        tx.set(
          dailyRef,
          { ...result.nextDaily, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
        return { granted: false, reason: 'already_ledgered' }
      }

      const currentWallet = await wallet.getWallet(tx, uid)
      wallet.creditCoins(tx, uid, currentWallet, rewardCoins)
      ledger.record(tx, uid, naturalKey, {
        asset: 'coin',
        direction: 'credit',
        amount: rewardCoins,
        reason: 'daily_activity',
        referenceType: 'economyDaily',
        referenceId: dateKey,
      })
      tx.set(
        dailyRef,
        { ...result.nextDaily, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )

      return { granted: true, rewardCoins, activeMinutes: result.nextDaily.activeMinutes }
    })
  }
}
