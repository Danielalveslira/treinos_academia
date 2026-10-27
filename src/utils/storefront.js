import { commercialError } from './commercial'
const messages = {
  STOREFRONT_RATE_LIMIT: 'Aguarde antes de alterar novamente o conteúdo.',
  INVALID_STOREFRONT_LIMITS: 'Informe limites inteiros válidos e confirme a alteração.',
  STOREFRONT_NOT_FOUND: 'Vitrine indisponível ou sem permissão de acesso.',
  PRODUCT_NOT_FOUND: 'Produto indisponível ou pertencente a outra vitrine.',
  EDITORIAL_REVISION_CONFLICT: 'O conteúdo mudou. Atualize antes de salvar ou aprovar.',
  STOREFRONT_INCOMPLETE:
    'Complete a descrição da vitrine e os dados dos produtos, incluindo imagens, antes de enviar.',
  STOREFRONT_SUSPENDED: 'A vitrine está suspensa. Somente a moderação pode remover esse bloqueio.',
  STOREFRONT_LIMITS_UNCONFIGURED: 'O cadastro aguarda configuração dos limites comerciais.',
  STOREFRONT_LIMIT: 'Limite de vitrines atingido.',
  PRODUCT_LIMIT: 'Limite de produtos atingido.',
  INVALID_STOREFRONT_MEDIA: 'A imagem precisa ter sido enviada para esta vitrine.',
  INVALID_PRODUCT_PRICE: 'Informe o preço em centavos inteiros.',
  IMAGE_TOO_LARGE: 'A imagem deve ter até 1 MB após otimização.',
  UPLOAD_FAILED: 'Não foi possível enviar a imagem. Tente novamente.',
  INVALID_IMAGE: 'Arquivo inválido. Escolha uma imagem JPEG, PNG ou WebP.',
  MODERATION_REASON_REQUIRED: 'Informe o motivo da decisão (mínimo de cinco caracteres).',
  OWNERSHIP_EVIDENCE_REQUIRED:
    'Informe a referência da comprovação de titularidade e confirme a associação.',
  OWNER_NOT_VERIFIED:
    'O titular comprovado deve corresponder ao proprietário da vitrine de destino.',
  LEGACY_PRODUCT_CHANGED: 'O produto legado mudou. Atualize a lista antes de associar.',
  LEGACY_PRODUCT_NOT_FOUND: 'Produto legado indisponível ou já associado.',
  INVALID_CLEANUP_CONFIGURATION:
    'Informe uma tolerância de 1 a 720 horas e confirme a configuração.',
}
export const storefrontError = (error) => messages[error?.message] || commercialError(error)
export const editorialLabels = {
  draft: 'Rascunho',
  submitted: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Reprovada',
  suspended: 'Suspensa',
  archived: 'Arquivada pelo proprietário',
}
export const publicationLabels = {
  active: 'Ativa',
  expired: 'Arquivada por expiração',
  private: 'Privada',
  suspended: 'Suspensa',
  revoked: 'Direito revogado',
}
