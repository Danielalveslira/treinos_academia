import manifest from '../../legal/showcase-manifest.json' with { type: 'json' }
import document from '../../legal/showcase-document.json' with { type: 'json' }

export const SHOWCASE_LEGAL_MANIFEST = manifest
export const SHOWCASE_LEGAL_DOCUMENT = document

// Ciência da versão vigente -- nunca um gate de publicação (ver decisão de produto:
// nova versão dos Termos nunca bloqueia/despublica a Vitrine). `policy` é a linha ao
// vivo de showcase_legal_policy (não o manifesto estático do bundle), porque é o
// servidor quem decide qual versão está realmente publicada agora.
export function hasCurrentShowcaseAcknowledgement(acknowledgement, policy) {
  return Boolean(
    policy?.version &&
    acknowledgement?.version === policy.version &&
    acknowledgement?.acknowledgedAt
  )
}

export function shouldShowShowcaseTermsBanner({ policy, acknowledgement }) {
  return Boolean(policy?.published && policy?.version) &&
    !hasCurrentShowcaseAcknowledgement(acknowledgement, policy)
}
