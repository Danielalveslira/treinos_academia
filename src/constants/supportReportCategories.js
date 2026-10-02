// Única fonte da lista de categorias de denúncia (kind='report') -- espelha exatamente o
// check constraint de support_requests.category (ver migration
// 20261002000002_admin_vitrines_denuncias.sql). Usado tanto no formulário de denúncia
// (Support.jsx) quanto na central de moderação (AdminModeration.jsx) -- nunca duplicado.
export const REPORT_CATEGORY_OPTIONS = [
  ['false_information', 'Informação falsa'],
  ['image_or_identity_misuse', 'Uso indevido de imagem ou identidade'],
  ['fraud_or_scam', 'Golpe ou fraude'],
  ['inappropriate_behavior', 'Comportamento inadequado'],
  ['prohibited_content', 'Conteúdo proibido'],
  ['professional_issue', 'Problema com o profissional'],
  ['establishment_issue', 'Problema com o estabelecimento'],
  ['spam', 'Spam'],
  ['other', 'Outro'],
].map(([value, label]) => ({ value, label }))
