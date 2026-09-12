// users/{uid}.communityIds espelha as comunidades de que o usuário participa — existe
// só pra sponsoredAds/{adId} poder checar filiação com um único get() em vez de iterar
// o array communityIds do próprio anúncio (a linguagem de regras do Firestore não
// suporta isso; ver canReadSponsoredAd em firestore.rules). Só a Admin SDK grava este
// campo, mesmo raciocínio de memberCount em community-members-service.js: nenhuma regra
// especial necessária, e o cliente nunca escreve nele diretamente.
//
// Extraído em módulo próprio (mesmo padrão de community-members-service.js) pra poder
// ser testado com db/FieldValue falsos, sem precisar do emulador.
export function createSyncUserCommunityIds({ db, FieldValue }) {
  return async function syncUserCommunityIds(userId, communityId, action) {
    if (!userId || !communityId) return
    try {
      await db.doc(`users/${userId}`).update({
        communityIds:
          action === 'join'
            ? FieldValue.arrayUnion(communityId)
            : FieldValue.arrayRemove(communityId),
      })
    } catch (error) {
      // Perfil pode não existir mais (conta excluída correndo com o próprio
      // join/leave) — nesse caso não há nada pra sincronizar.
      console.error('syncUserCommunityIds', userId, communityId, error.code)
    }
  }
}
