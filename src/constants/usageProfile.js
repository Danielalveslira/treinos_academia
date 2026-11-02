// Espelha functions/usage-profile-core.js (runtimes diferentes, sem pacote
// compartilhado entre functions/ e src/ -- replicado, não importado, mesmo padrão já
// usado por professionalListingTaxonomy.js/professional-listing-core.js). Perfil de
// USO autodeclarado: distinto de `role` (permissões administrativas) e do `kind` de
// uma Vitrine (professional/space). Nunca é certificação profissional.
export const USAGE_PROFILE_OPTIONS = [
  {
    value: 'common',
    label: 'Usuário comum',
    description: 'Treinar, acompanhar meu progresso e participar das comunidades.',
  },
  {
    value: 'professional',
    label: 'Profissional',
    description: 'Sou personal trainer ou outro profissional da área.',
  },
  {
    value: 'establishment_owner',
    label: 'Responsável por estabelecimento',
    description: 'Administro uma academia, estúdio ou espaço de prática física.',
  },
]

export const USAGE_PROFILES = USAGE_PROFILE_OPTIONS.map((option) => option.value)

// Textos curtos da etapa final do cadastro -- mesmos valores internos (e mesma ordem) acima.
export const SIGNUP_USAGE_PROFILE_OPTIONS = [
  { value: 'common', label: 'Usuário', description: 'Acompanhar meus treinos e evolução.' },
  {
    value: 'professional',
    label: 'Profissional',
    description: 'Divulgar meus serviços profissionais.',
  },
  {
    value: 'establishment_owner',
    label: 'Estabelecimento',
    description: 'Gerenciar meu negócio no Evolutus.',
  },
]

// Profissional e responsável por estabelecimento podem criar uma Vitrine de
// QUALQUER um dos dois tipos -- a escolha aqui não restringe o tipo da Vitrine, só
// libera o acesso à criação. Ausente (conta legada que nunca declarou) não é
// elegível: precisa declarar primeiro.
export function isEligibleForListingCreation(usageProfile) {
  return usageProfile === 'professional' || usageProfile === 'establishment_owner'
}
