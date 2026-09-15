const CATALOG_URL = '/exercise-catalog/v1/catalog.json'
let catalogPromise

function validateCatalog(catalog) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.exercises)) {
    throw new Error('Formato de catálogo incompatível')
  }
  return catalog
}

export function loadExerciseCatalog({ force = false } = {}) {
  if (force) catalogPromise = undefined
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL, { cache: 'default' })
      .then((response) => {
        if (!response.ok) throw new Error(`Falha ao carregar catálogo (${response.status})`)
        return response.json()
      })
      .then(validateCatalog)
      .catch((error) => {
        catalogPromise = undefined
        throw error
      })
  }
  return catalogPromise
}

export function clearExerciseCatalogCache() {
  catalogPromise = undefined
}
