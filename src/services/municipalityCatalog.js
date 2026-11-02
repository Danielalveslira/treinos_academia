import { buildMunicipalityIndex } from '../utils/municipalities.js'

// Carrega o catálogo de municípios só quando uma tela precisa dele (import() dinâmico = chunk
// próprio, fora do bundle inicial). Uma única promessa por sessão: várias montagens do seletor (ex.:
// cadastro -> gate -> Perfil) reaproveitam o mesmo índice, sem baixar/processar de novo. Nenhuma
// chamada à API do IBGE em tempo de uso -- o catálogo é estático e versionado.
export function createMunicipalityCatalogLoader(importer) {
  let pending = null
  let loaded = null
  return {
    load() {
      if (loaded) return Promise.resolve(loaded)
      if (!pending) {
        pending = importer()
          .then((source) => {
            loaded = buildMunicipalityIndex(source)
            return loaded
          })
          .catch((error) => {
            // Falha não fica memorizada: "Tentar novamente" refaz o import.
            pending = null
            throw error
          })
      }
      return pending
    },
    peek() {
      return loaded
    },
  }
}

const defaultLoader = createMunicipalityCatalogLoader(() => import('../data/ibgeMunicipalities.js'))

export const loadMunicipalityCatalog = () => defaultLoader.load()
export const peekMunicipalityCatalog = () => defaultLoader.peek()
