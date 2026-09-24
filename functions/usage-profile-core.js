// Perfil de USO autodeclarado no cadastro -- distinto de `role` (permissões
// administrativas) e do `kind` de uma Vitrine (professional/space). Só decide se os
// recursos de criação comercial (Vitrine) ficam visíveis/permitidos; nunca constitui
// certificação profissional nem eleva privilégio algum.
export const USAGE_PROFILES = ['common', 'professional', 'establishment_owner']

export function isValidUsageProfile(value) {
  return USAGE_PROFILES.includes(value)
}

// Profissional e responsável por estabelecimento podem criar uma Vitrine de
// QUALQUER um dos dois tipos (kind) -- a escolha no cadastro não restringe o tipo da
// Vitrine, só libera o acesso à criação. Contas legadas sem o campo (usageProfile
// ausente) ainda não são elegíveis: precisam declarar primeiro.
export function isEligibleForListingCreation(usageProfile) {
  return usageProfile === 'professional' || usageProfile === 'establishment_owner'
}
