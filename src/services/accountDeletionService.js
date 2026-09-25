import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'

// Único jeito seguro do cliente saber o próprio estado de exclusão -- deletionJobs não
// tem regra de leitura nenhuma pro dono (ver firestore.rules), então um permission-denied
// na leitura do próprio perfil, sozinho, não diz se a exclusão está em processamento,
// bloqueada por revisão financeira ou se a conta já foi excluída de vez (ver
// AuthContext.jsx, handlePossibleGhostSession). Devolve só { state }, nunca blockReason,
// saldo ou qualquer outro dado financeiro.
export async function getMyDeletionStatus() {
  return (await httpsCallable(functions, 'getMyDeletionStatus')()).data
}
