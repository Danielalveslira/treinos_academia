import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseBackfillArgs, runEconomyVoteCountsBackfill } from './economy-vote-counts-backfill-core.mjs'

const { apply } = parseBackfillArgs(process.argv.slice(2))

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

await runEconomyVoteCountsBackfill({
  apply,
  listStatusIdsMissingCounts: async () => {
    const snapshot = await db.collection('statuses').get()
    return snapshot.docs
      .filter((item) => {
        const data = item.data()
        return typeof data.positiveVoteCount !== 'number' || typeof data.negativeVoteCount !== 'number'
      })
      .map((item) => item.id)
  },
  countVotesByValue: async (statusId) => {
    const votesRef = db.collection(`statuses/${statusId}/economyVotes`)
    const [positiveAgg, negativeAgg] = await Promise.all([
      votesRef.where('value', '==', 1).count().get(),
      votesRef.where('value', '==', -1).count().get(),
    ])
    return { positive: positiveAgg.data().count, negative: negativeAgg.data().count }
  },
  applyCounts: async (statusId, { positive, negative }) => {
    await db.doc(`statuses/${statusId}`).update({ positiveVoteCount: positive, negativeVoteCount: negative })
  },
  log: console.log,
})
