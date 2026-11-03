// Única idade mínima dos fluxos de cadastro, conclusão de perfil e reaceite. O servidor aplica a
// mesma regra (set_birth_info em 20261212000004 e accept_legal_documents em 20261212000001),
// independentemente do minimumAge de versões jurídicas históricas (a 1.5.0 ainda declara 12).
export const MINIMUM_REGISTRATION_AGE = 18
export const MINIMUM_AGE_MESSAGE = `É necessário ter pelo menos ${MINIMUM_REGISTRATION_AGE} anos para se cadastrar.`

// Uma versão jurídica futura pode exigir mais, nunca menos.
export function registrationMinimumAge(manifest) {
  const declared = Number(manifest?.minimumAge)
  return Number.isFinite(declared)
    ? Math.max(MINIMUM_REGISTRATION_AGE, declared)
    : MINIMUM_REGISTRATION_AGE
}
