// Apresentação (puro, testável) do estado de uma exclusão de conta -- compartilhado entre a
// tela do usuário (AccountDeletionBlockedGate) e o painel admin. Os estados são os de
// deletion_jobs.state; "pendência separada" NÃO é um estado, é pending/blocked +
// financialCase (ver migration 20261004000001_account_deletion_financial_case.sql).

export const DELETION_STATE_LABELS = {
  pending: 'Em andamento',
  blocked_financial_review: 'Em revisão financeira',
  // Estado técnico: banco já limpo, aguardando a confirmação da remoção no Auth (o worker repete até confirmar).
  auth_cleanup: 'Finalizando (remoção do acesso)',
  complete: 'Concluída',
  cancelled: 'Cancelada',
}

export const BLOCK_REASON_LABELS = {
  pending_cash_purchase: 'Compra de EvoCash pendente',
  positive_cash_balance: 'Saldo de EvoCash positivo',
}

export const REVIEW_RESULT_LABELS = {
  resumed: 'Bloqueio removido -- exclusão retomada',
  still_blocked: 'Revalidado -- continuou bloqueado',
  case_separated: 'Caso financeiro separado -- exclusão retomada',
  cancelled: 'Solicitação cancelada -- conta reativada',
}

export const CASE_STATUS_LABELS = {
  open: 'Aberto',
  resolved: 'Resolvido',
  cancelled: 'Cancelado',
}

export const PURCHASE_STATUS_LABELS = {
  pending: 'Pendente',
  credited: 'Creditada',
  cancelled: 'Cancelada',
  held_in_case: 'Retida no caso financeiro',
}

export const CASE_EVENT_LABELS = {
  separated: 'Caso separado',
  late_payment_held: 'Pagamento tardio retido no caso',
  purchase_cancelled: 'Compra pendente cancelada',
  held_payment_restored: 'Pagamento retido creditado na carteira',
  resolved: 'Caso resolvido',
  cancelled: 'Caso cancelado',
  retention_hold_set: 'Retenção estendida (legal hold) ativada',
  retention_hold_released: 'Retenção estendida (legal hold) removida',
}

export const SEPARATED_CASE_MESSAGE =
  'Seu processo financeiro continuará sendo tratado separadamente. A exclusão da conta seguirá normalmente.'

// Mapeia a revisão do próprio usuário (get_my_deletion_review) para o que a tela mostra.
// Só usa campos que o servidor já considera públicos para o titular -- nunca valores.
export function describeDeletionProgress(review) {
  const separated = Boolean(review?.financialCaseSeparated)
  // Sem detalhes do servidor (ainda carregando) assume o caso original do gate: revisão aberta.
  const blocked = review?.state ? review.state === 'blocked_financial_review' : true
  const steps = [
    { key: 'requested', label: 'Solicitação recebida', status: 'done' },
    {
      key: 'financial_review',
      label: 'Revisão financeira',
      status: blocked ? 'current' : 'done',
    },
  ]
  if (separated) {
    steps.push({ key: 'case_separated', label: 'Pendência financeira separada', status: 'done' })
  }
  steps.push({
    key: 'deletion',
    label: 'Exclusão da conta',
    status: blocked ? 'todo' : 'current',
  })

  return {
    headline: 'Exclusão em análise',
    situation: blocked ? 'Em revisão financeira' : 'Exclusão em andamento',
    steps,
    separatedMessage: separated ? SEPARATED_CASE_MESSAGE : null,
  }
}

// Texto do aviso de confirmação de cada ação admin -- fica aqui (não no JSX) para ser
// testável e para o painel nunca divergir do que o banco realmente faz.
export const ADMIN_ACTIONS = {
  revalidate: {
    title: 'Revalidar bloqueio',
    confirm: 'Revalidar',
    description:
      'Reavalia saldo e compras com os valores atuais. Se não houver mais motivo de bloqueio, a exclusão é retomada. Não altera saldo nem ledger.',
    danger: false,
  },
  separate: {
    title: 'Prosseguir com a exclusão mantendo o caso financeiro',
    confirm: 'Prosseguir e manter caso',
    description:
      'Cria um caso financeiro separado com o saldo atual e as referências de compras/ledger, e libera a exclusão da conta. NÃO zera o EvoCash, NÃO apaga o ledger, NÃO quita nem converte o saldo em dinheiro -- a pendência continua a ser tratada à parte, pelo protocolo do caso. A exclusão da conta é irreversível depois de concluída.',
    danger: true,
  },
  cancel: {
    title: 'Cancelar solicitação e reativar conta',
    confirm: 'Cancelar exclusão',
    description:
      'A conta volta ao estado anterior e a exclusão não será feita. Só é possível enquanto a exclusão não foi concluída. Se existir caso financeiro separado, ele é encerrado como cancelado (não apagado) e pagamentos retidos nele são creditados na carteira.',
    danger: true,
  },
}

export const NOTE_MIN_LENGTH = 5

// Retenção financeira de um caso (política: aberto = preservado enquanto pendente; resolvido = 1
// ano a partir de resolved_at; hold = preservado além do prazo). Só apresentação -- o prazo é
// calculado e guardado pelo servidor (retention_until). Datas no fuso de Brasília, DD/MM/AAAA.
export function describeCaseRetention(financialCase) {
  if (!financialCase) return []
  const lines = []
  const until = financialCase.retentionUntil
    ? new Date(financialCase.retentionUntil).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      })
    : null
  if (financialCase.retentionHold) {
    lines.push('Retenção estendida')
    lines.push(`Motivo: ${financialCase.retentionHoldReason || '—'}`)
    if (until) lines.push(`Prazo original: ${until}`)
    return lines
  }
  if (financialCase.status === 'open') return ['Retenção: inicia após a resolução']
  if ((financialCase.status === 'resolved' || financialCase.status === 'cancelled') && until)
    return [`Retenção até: ${until}`]
  return []
}
