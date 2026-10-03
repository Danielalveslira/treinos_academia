// Lógica pura extraída de CommunityDetail.jsx para ser testável sem renderizar nada
// (mesmo espírito de cashPurchaseFlow.js/exerciseOrder.js). A elegibilidade para CRIAR
// comunidade vive em communityCreation.js (apresentação) e no banco (decisão).

// community.ownerId é a ÚNICA fonte autoritativa (mesma regra aplicada via RLS no
// Postgres) -- nunca o role de communityMembers, que é só para UI/representação.
export function canModerateCommunity({ isSuperAdmin, communityOwnerId, uid }) {
  return isSuperAdmin === true || (communityOwnerId != null && communityOwnerId === uid)
}
