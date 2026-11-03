// Documentos comerciais específicos e suas rotas públicas estáveis. O conteúdo vem do
// registro imutável do servidor (legal_document_versions); ?version= abre versões antigas.
export const COMMERCIAL_DOCUMENTS = {
  'evocash-terms': { path: '/condicoes-evocash', label: 'Condições do EvoCash' },
  'advertising-terms': {
    path: '/termos-publicidade',
    label: 'Termos de Publicidade e Impulsionamento',
  },
  'showcase-publication-terms': {
    path: '/termos-publicacao-vitrine',
    label: 'Termos das Vitrines',
  },
  'cancellation-refund-policy': {
    path: '/politica-de-reembolso',
    label: 'Política de Cancelamento, Arrependimento e Reembolsos',
  },
}

export function commercialDocumentLink(documentId, version) {
  const doc = COMMERCIAL_DOCUMENTS[documentId]
  if (!doc) return null
  return version ? `${doc.path}?version=${encodeURIComponent(version)}` : doc.path
}

// Os termos congelados na cotação só podem ser aceitos quando existe versão publicada,
// ela ainda vigora e há digest das condições exibidas. Caso contrário a contratação
// fica indisponível (o servidor também recusa).
export function commercialTermsState(terms) {
  if (!terms || !terms.version || !terms.digest || !terms.conditionsDigest) return 'unavailable'
  if (terms.current !== true) return 'changed'
  return 'ready'
}

export function commercialTermsLabel(terms) {
  return COMMERCIAL_DOCUMENTS[terms?.documentId]?.label || 'Termos da contratação'
}

export const COMMERCIAL_TERMS_ERRORS = {
  COMMERCIAL_TERMS_UNAVAILABLE:
    'Os termos desta contratação ainda não foram publicados. Nenhum valor foi cobrado.',
  COMMERCIAL_TERMS_CHANGED:
    'Os termos mudaram depois da cotação. Nada foi cobrado; gere uma nova cotação para revisar a versão vigente.',
  COMMERCIAL_TERMS_MISMATCH:
    'Os termos exibidos não correspondem à cotação. Nada foi cobrado; gere uma nova cotação.',
  COMMERCIAL_CONDITIONS_MISMATCH:
    'As condições exibidas não correspondem à cotação. Nada foi cobrado; gere uma nova cotação.',
  COMMERCIAL_TERMS_ACCEPTANCE_REQUIRED:
    'É preciso aceitar os termos desta contratação antes de continuar. Nada foi cobrado.',
  ORDER_NOT_QUOTED: 'Esta cotação já foi utilizada. Consulte o histórico.',
  MINOR_PURCHASE_BLOCKED:
    'Compras e contratações não estão disponíveis para contas de menores de 18 anos.',
}

export function commercialTermsError(error) {
  return COMMERCIAL_TERMS_ERRORS[error?.message] || null
}
