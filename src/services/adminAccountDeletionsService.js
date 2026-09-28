import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'

// deletionJobs não tem regra de leitura nenhuma -- superadmin incluso (ver
// getOwnStatus/listBlockedForReview em deletion-service.js) -- então o painel "Exclusão
// de contas" só existe através destas duas callables.
const listBlockedAccountDeletionsCallable = httpsCallable(functions, 'listBlockedAccountDeletions')
const reviewBlockedAccountDeletionCallable = httpsCallable(functions, 'reviewBlockedAccountDeletion')

export async function listBlockedAccountDeletions() {
  return (await listBlockedAccountDeletionsCallable()).data.jobs
}

// Ação segura: nunca altera saldo/ledger, só reavalia o bloqueio com os valores atuais
// e, se já estiver claro, retoma o job -- ver reviewFinancialBlock em deletion-service.js.
export async function reviewBlockedAccountDeletion(jobId, note) {
  return (await reviewBlockedAccountDeletionCallable({ jobId, note: note || undefined })).data
}
