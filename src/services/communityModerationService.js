import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

const setCommunityMemberBanCallable = httpsCallable(functions, 'setCommunityMemberBan')

// Fase 5 -- caminho DEDICADO para banir/desbanir de UMA comunidade (nunca
// decideSupportRequest, ver community-moderation-service.js no backend). Autorizado
// por superadmin OU community.ownerId===uid; um community_ban aplicado pela moderação
// global (com decisionId) só pode ser desfeito por um superadmin, nunca pelo dono.
export async function setCommunityMemberBan({ communityId, targetUserId, banned, reason }) {
  return (await setCommunityMemberBanCallable({ communityId, targetUserId, banned, reason })).data
}

// Só quem as Rules já deixam (superadmin, ou o dono da própria comunidade) consegue
// listar as restrições dela -- usado para saber quem já está banido antes de oferecer
// banir/desbanir na UI.
export async function listCommunityRestrictions(communityId) {
  const snapshot = await getDocs(
    query(collection(db, 'communityRestrictions'), where('communityId', '==', communityId))
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}
