import manifest from '../../legal/showcase-manifest.json' with { type: 'json' }
import document from '../../legal/showcase-document.json' with { type: 'json' }

export const SHOWCASE_LEGAL_MANIFEST = manifest
export const SHOWCASE_LEGAL_DOCUMENT = document

export function hasCurrentShowcaseAcceptance(acceptance, currentManifest = manifest) {
  return Boolean(
    acceptance?.documentId === currentManifest.documentId &&
    acceptance?.version === currentManifest.version &&
    acceptance?.acceptedAt
  )
}

export function canSubmitShowcaseListing({ acceptance, confirmed, manifest: currentManifest }) {
  return Boolean(
    currentManifest?.published === true &&
    (hasCurrentShowcaseAcceptance(acceptance, currentManifest) || confirmed === true)
  )
}
