// Única idade mínima dos fluxos de cadastro, conclusão de perfil e reaceite. O servidor aplica a
// mesma regra (set_birth_info e accept_legal_documents em 20261213000002, que atualizou o piso
// de 18 para 16), independentemente do minimumAge de versões jurídicas históricas (a 1.5.0 ainda
// declara 12). Compras e contratações continuam exigindo 18+ (private.is_known_minor), por uma
// regra independente desta constante.
export const MINIMUM_REGISTRATION_AGE = 16
export const MINIMUM_AGE_MESSAGE = `É necessário ter pelo menos ${MINIMUM_REGISTRATION_AGE} anos para se cadastrar.`

// Uma versão jurídica futura pode exigir mais, nunca menos.
export function registrationMinimumAge(manifest) {
  const declared = Number(manifest?.minimumAge)
  return Number.isFinite(declared)
    ? Math.max(MINIMUM_REGISTRATION_AGE, declared)
    : MINIMUM_REGISTRATION_AGE
}
