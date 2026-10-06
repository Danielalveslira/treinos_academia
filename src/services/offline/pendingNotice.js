// Contador mínimo (SEM dependências) do que está salvo neste aparelho e ainda não sincronizou, só para o
// aviso do menu da conta. Fica separado do syncStatusStore de propósito: o menu faz parte do bundle de
// entrada e não pode puxar a pilha de sync (orçamento de boot). Reflete SEMPRE só o usuário atual: o
// syncStatusStore o zera ao trocar de usuário e o recontagem vem da outbox DAQUELE usuário.
let count = 0
const listeners = new Set()

export const getPendingCount = () => count
export function subscribePendingCount(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function publishPendingCount(next) {
  const value = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0
  if (value === count) return
  count = value
  for (const listener of listeners) listener()
}

// Aviso do logout. Não impede nada, não mostra dado do treino (só a quantidade) e não promete o que não
// controla: a fila é desta CONTA e só sincroniza quando ela entrar de novo.
export function describeLogoutNotice(pending) {
  if (!pending || pending < 1) return null
  return pending === 1
    ? '1 alteração ainda está salva neste aparelho. Ela será sincronizada quando você entrar novamente nesta conta.'
    : `${pending} alterações ainda estão salvas neste aparelho. Elas serão sincronizadas quando você entrar novamente nesta conta.`
}
