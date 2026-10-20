const REASONS = {
  daily_activity: 'Atividade do dia',
  workout_completed: 'Treino concluído',
  post_published: 'Publicação',
  comment_posted: 'Comentário',
  vote_reward: 'Apoio recebido',
  support_received: 'Apoio recebido',
  vote_charge: 'Reação em publicação',
  cash_purchase_confirmed: 'Compra confirmada',
  promotion_purchase: 'Promoção',
  community_creation: 'Criação de comunidade',
  community_upgrade: 'Melhoria de comunidade',
  create_community: 'Criação de comunidade',
}

export function economyTransactionLabel(transaction) {
  return REASONS[transaction.reason] ?? (transaction.direction === 'credit' ? 'Crédito' : 'Uso')
}

export function economyTransactionAmount(transaction) {
  const sign = transaction.direction === 'credit' ? '+' : '−'
  const unit = transaction.asset === 'cash' ? 'EvoCash' : 'EvoCoins'
  return `${sign}${Number(transaction.amount).toLocaleString('pt-BR')} ${unit}`
}
