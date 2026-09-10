// memberCount denormalizado em communities/{id}, mantido por gatilho — o painel admin
// (useAdminCommunities) lê esse campo direto em vez de rodar uma aggregation query por
// comunidade exibida. Só a Admin SDK grava este campo (o cliente nunca escreve nele
// diretamente), então não há necessidade de regra especial nem risco de manipulação.
//
// Extraído em módulo próprio (em vez de ficar direto em index.js) pra poder ser testado
// contra o emulador sem precisar simular o CloudEvent completo de um gatilho Firestore.
export function createBumpMemberCount({ db, FieldValue }) {
  return async function bumpMemberCount(communityId, delta) {
    if (!communityId) return
    const ref = db.doc(`communities/${communityId}`)
    try {
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        if (!snapshot.exists) return
        if (typeof snapshot.data().memberCount === 'number') {
          tx.update(ref, { memberCount: FieldValue.increment(delta) })
          return
        }
        // Comunidade anterior a este campo: incrementar a partir de um "0" assumido
        // subestimaria a contagem real pra sempre — o painel (useAdminCommunities) só
        // recalcula via aggregation enquanto o campo estiver ausente; uma vez gravado
        // (mesmo errado), nunca mais é corrigido sozinho. O evento que disparou este
        // gatilho já está refletido no próprio Firestore neste momento (join: o
        // documento novo já existe; leave: o documento já foi apagado), então uma
        // contagem de verdade agora já é o total correto, sem somar delta de novo.
        const aggregate = await tx.get(
          db.collection('communityMembers').where('communityId', '==', communityId).count()
        )
        tx.update(ref, { memberCount: aggregate.data().count })
      })
    } catch (error) {
      // Comunidade já pode ter sido excluída (corrida com cleanupDeletedCommunity) —
      // nesse caso o documento não existe mais e não há contagem para manter.
      console.error('bumpMemberCount', communityId, error.code)
    }
  }
}
