import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '@primer/react'
import { ProfessionalListingCard } from './ProfessionalListingCard'
import { listPublishedProfessionalListings } from '../services/professionalListingsService'

const KIND_TABS = [
  { value: 'professional', label: 'Profissionais' },
  { value: 'space', label: 'Estabelecimentos' },
]
const DISCOVERY_FILTERS = { modality: '*', uf: '*', city: '*', serviceMode: '*' }
const DISCOVERY_PAGE_SIZE = 4

export function ProfessionalsDiscovery() {
  const [kind, setKind] = useState('professional')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // Uma única consulta por troca de aba -- os cards em si já deduplicam o
    // download do avatar entre si (ProfileAvatar/photoBlobCache), então nenhuma
    // requisição extra por card é feita aqui.
    listPublishedProfessionalListings({ kind, ...DISCOVERY_FILTERS }, null, DISCOVERY_PAGE_SIZE)
      .then((page) => active && setItems(page.items))
      .catch(() => active && setError('Não foi possível carregar profissionais e estabelecimentos.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [kind])

  return (
    <section className="home-discovery" aria-labelledby="home-discovery-title">
      <div className="home-discovery-heading">
        <div>
          <span className="eyebrow">REDE EVOLUTUS</span>
          <h2 id="home-discovery-title">Encontre profissionais e lugares para treinar</h2>
        </div>
        <div className="home-discovery-toggle" role="group" aria-label="Tipo de vitrine">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={tab.value === kind ? 'active' : ''}
              aria-pressed={tab.value === kind}
              onClick={() => setKind(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="home-discovery-state">
          <Spinner aria-label="Carregando profissionais e estabelecimentos" />
        </div>
      ) : error ? (
        <p className="home-discovery-state">{error}</p>
      ) : items.length === 0 ? (
        <p className="home-discovery-state">Ainda não há vitrines publicadas nesta categoria.</p>
      ) : (
        <div className="home-discovery-grid">
          {items.map((listing) => (
            <ProfessionalListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
      <Link className="home-discovery-all" to={`/profissionais?tipo=${kind}`}>
        Ver todos
      </Link>
    </section>
  )
}
