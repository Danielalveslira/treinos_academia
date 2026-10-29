export const refundCategories = {
  withdrawal: 'Arrependimento legal',
  duplicate_payment: 'Cobrança indevida ou duplicada',
  fraud: 'Suspeita de fraude',
  not_credited: 'Compra não creditada / saldo divergente',
  service_failure: 'Falha na entrega do serviço',
  voluntary_cancellation: 'Cancelamento contratual voluntário',
  other: 'Outro problema ou direito',
}
export const refundStates = {
  requested: 'Recebida',
  under_review: 'Em análise',
  needs_information: 'Aguardando informação',
  approved: 'Aprovada',
  awaiting_provider_refund: 'Aguardando estorno na InfinitePay',
  provider_refund_confirmed: 'Estorno comprovado administrativamente',
  completed: 'Concluída',
  rejected: 'Recusada — contestação disponível',
  canceled_by_requester: 'Cancelada pelo solicitante',
  provider_refund_failed: 'Falha no estorno externo',
  disputed: 'Em contestação',
}
export const refundDate = (value) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value)) + ' (Brasília)'
    : 'Sujeito à análise'
export function refundError(error) {
  const text = String(error?.message || '')
  const messages = {
    REFUND_REQUESTS_NOT_ENABLED:
      'Solicitações financeiras aguardam liberação. Você pode registrar outros problemas e direitos.',
    WITHDRAWAL_WINDOW_CLOSED_USE_COMPLAINT:
      'O prazo informado de arrependimento encerrou. Reportar problema e contestar cobrança continuam disponíveis.',
    REFUND_REVISION_CONFLICT: 'A solicitação mudou. Atualize antes de tentar novamente.',
    RECENT_AUTH_REQUIRED: 'Confirme sua senha novamente para esta decisão.',
    REFUND_SETTLEMENT_NOT_ENABLED:
      'Liquidação desabilitada até aprovação jurídica/comercial e operacional.',
    CONSUMED_OR_UNRESERVED_CREDITS_REQUIRE_INVESTIGATION:
      'Créditos consumidos ou não reservados exigem investigação. O protocolo permanece aberto.',
    PARTIAL_OR_PREVIOUS_REVERSAL_REQUIRES_INVESTIGATION:
      'Estorno parcial ou anterior exige investigação, sem nova liquidação automática.',
    EXTERNAL_REFUND_REQUIRES_RECONCILIATION:
      'Há evidência de devolução externa. Concilie o pedido antes de liberar os créditos reservados.',
    REFUND_TRANSITION_DENIED: 'Esta ação não é permitida no estado atual.',
    LEGAL_AND_CONTRACT_REVIEW_REQUIRED:
      'Registre a análise jurídica, a classificação e os contratos relacionados.',
    INVALID_REFUND_EVIDENCE:
      'Confira a evidência, a identidade da transação, o canal original e a limitação de verificação.',
  }
  return (
    Object.entries(messages).find(([code]) => text.includes(code))?.[1] ||
    'Não foi possível concluir. Atualize para conferir o protocolo antes de tentar novamente.'
  )
}
// A response from the server authorizes the initial display. Monotonic elapsed
// time can only shorten it; wall-clock changes never extend legal eligibility.
export function withdrawalRemaining(source, receivedAt, now = performance.now()) {
  return Math.max(
    0,
    Date.parse(source.deadlineAt) - Date.parse(source.serverNow) - Math.max(0, now - receivedAt)
  )
}

export function withdrawalRemainingLabel(milliseconds) {
  if (milliseconds <= 0) return null
  const minutes = Math.ceil(milliseconds / 60000)
  if (minutes < 60) return `${minutes} min restantes (orientação)`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `${hours} h restantes (orientação)`
  const days = Math.floor(hours / 24)
  const extraHours = hours % 24
  return `${days} ${days === 1 ? 'dia' : 'dias'}${extraHours ? ` e ${extraHours} h` : ''} restantes (orientação)`
}

// An internal policy snapshot is not a published contractual policy. Keep it in
// the backend audit trail; only publish its body after explicit approval.
export function publicRefundPolicy(policy) {
  if (policy?.approved === true && policy.body) return policy.body
  return 'Para contratações abrangidas pelo direito de arrependimento, você pode solicitar a desistência em até 7 dias, conforme a legislação aplicável. O prazo depende do marco legal da contratação ou do recebimento do produto ou serviço. A duração de um serviço não é o prazo de arrependimento.\n\nSolicite pelo aplicativo. Você recebe confirmação e protocolo e pode acompanhar a análise e enviar informações na mesma solicitação. O motivo é opcional para arrependimento.\n\nDepois desse prazo, permanecem seus direitos relativos a cobrança indevida, pagamento duplicado, falha de serviço, descumprimento da oferta e outras obrigações legais. O valor devido e a forma de restituição são analisados conforme a lei e a compra original, sem desconto automático por uso nem renúncia de direitos.\n\nEstas informações gerais não acrescentam condições de cancelamento ou reembolso à sua contratação.'
}
