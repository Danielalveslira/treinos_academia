// Conteúdo de administradores nunca é denunciável. authorIsSuperAdmin vem do
// servidor (trigger enforce_status_author_badge grava o role real de quem publicou,
// nunca o que o cliente manda — veja statusesService.js), então é seguro decidir a UI
// com ele. O autor também
// nunca denuncia a própria publicação — ele já pode excluí-la diretamente, então
// "denunciar" a própria publicação nunca é uma denúncia de verdade, só ruído na
// fila de moderação. Isso só controla se o botão aparece: quem cria a denúncia
// (functions/index.js, submitSupportRequest) confere de novo as duas regras na
// fonte antes de aceitar, então nem uma chamada manual da function burla isso.
export function isReportableAuthor(status, currentUserId) {
  return status?.authorIsSuperAdmin !== true && status?.authorId !== currentUserId
}
