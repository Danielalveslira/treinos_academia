// Fase 5 (privilégios com EvoCash) -- lógica pura extraída de CommunityDetail.jsx/
// CreateCommunity.jsx para ser testável sem renderizar nada (mesmo espírito de
// cashPurchaseFlow.js/exerciseOrder.js).

// community.ownerId é a ÚNICA fonte autoritativa (mesma regra aplicada via RLS no
// Postgres) -- nunca o role de communityMembers, que é só para UI/representação.
export function canModerateCommunity({ isSuperAdmin, communityOwnerId, uid }) {
  return isSuperAdmin === true || (communityOwnerId != null && communityOwnerId === uid)
}

// Espelha createCommunityEligibilityReason (functions/economy/privilege-core.js), mas
// devolve TODOS os requisitos (para exibir uma checklist), não só o primeiro que falha
// -- a Function é sempre a decisão de verdade; isto é só UX.
export function evaluateCommunityCreationRequirements({
  privilege,
  accountAgeDays,
  emailVerified,
  lifetimeCoinsEarned,
  cashBalance,
}) {
  if (!privilege) return { requirements: [], allMet: false }
  const requirements = [
    {
      key: 'accountAge',
      label: `Conta com pelo menos ${privilege.minimumAccountAgeDays} dias`,
      met: accountAgeDays >= privilege.minimumAccountAgeDays,
      detail: `Sua conta tem ${accountAgeDays} dia(s)`,
    },
    {
      key: 'emailVerified',
      label: 'E-mail verificado',
      met: !privilege.requireEmailVerified || emailVerified === true,
      detail: emailVerified ? 'Verificado' : 'Não verificado',
    },
    {
      key: 'lifetimeCoins',
      label: `Pelo menos ${privilege.minimumLifetimeCoins} EvoCoins de reputação`,
      met: lifetimeCoinsEarned >= privilege.minimumLifetimeCoins,
      detail: `Você tem ${lifetimeCoinsEarned}`,
    },
    {
      key: 'cashBalance',
      label: `${privilege.cashCost} EvoCash`,
      met: cashBalance >= privilege.cashCost,
      detail: `Você tem ${cashBalance}`,
    },
  ]
  return { requirements, allMet: requirements.every((requirement) => requirement.met) }
}
