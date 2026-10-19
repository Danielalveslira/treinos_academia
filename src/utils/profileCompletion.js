// Pura, sem React -- usada por ProfileCompletionGate.jsx e testada isoladamente.
// `profile` ausente (null/undefined) significa "ainda carregando" (ou um estado de erro
// já tratado antes pelo ProtectedRoute, que só chega até o gate com profile carregado) --
// NUNCA tratado como "perfil vazio, precisa completar". Só um profile já carregado, sem
// username, dispara o gate (ver completeUserProfile: username é a última RPC de
// propósito, então sua presença prova que as etapas anteriores já rodaram).
export function needsProfileCompletion(profile) {
  if (!profile) return false
  return !profile.username
}
