// Conteúdo de administradores nunca é denunciável. authorIsSuperAdmin vem do
// servidor (firestore.rules exige que bata com o role real de quem publicou —
// veja statusesService.js), então é seguro decidir a UI com ele. Isso só
// controla se o botão aparece: quem cria a denúncia (functions/index.js)
// confere de novo o papel do autor na fonte antes de aceitar, então nem uma
// chamada manual da function consegue burlar a regra.
export function isReportableAuthor(status) {
  return status?.authorIsSuperAdmin !== true
}
