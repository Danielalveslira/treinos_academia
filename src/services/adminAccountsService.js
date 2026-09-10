import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'

export async function setAccountStatus(userId, disabled, reason = '') {
  return (await httpsCallable(functions, 'setAccountStatus')({ userId, disabled, reason })).data
}

export async function deleteAccountPermanently(userId, confirmation) {
  return (await httpsCallable(functions, 'deleteAccountPermanently')({ userId, confirmation })).data
}

// Via Cloud Function (não leitura direta do Firestore) porque o e-mail só existe no
// Authentication — precisa do Admin SDK para juntar os dois no painel admin.
export async function listAccountsPage(filters = {}) {
  return (await httpsCallable(functions, 'listAccountsForAdmin')(filters)).data
}

export async function listDeletionJobs() {
  return (await httpsCallable(functions, 'listDeletionJobs')()).data.jobs
}

// Utilitário de uma única execução — ver comentário em functions/index.js. Remover
// junto do botão em AdminAccounts.jsx depois de rodado com sucesso em produção.
export async function purgePaymentData() {
  return (await httpsCallable(functions, 'purgePaymentData')()).data
}
