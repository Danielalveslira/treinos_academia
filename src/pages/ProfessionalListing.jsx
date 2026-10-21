import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Spinner } from '@primer/react'
import { PublicLayout } from '../components/PublicLayout'
import { ProfessionalListingView } from '../components/ProfessionalListingView'
import { useAuth } from '../hooks/useAuth'
import { getPublishedProfessionalListing } from '../services/professionalListingsService'

export default function ProfessionalListing() {
  const { listingId } = useParams()
  const { user } = useAuth()
  const [listing, setListing] = useState(undefined)
  const [error, setError] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    setListing(undefined)
    setError(false)
    getPublishedProfessionalListing(listingId)
      .then((value) => active && setListing(value))
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [listingId])

  async function share() {
    const data = {
      title: listing.displayName,
      text: `Conheça ${listing.displayName} no Evolutus`,
      url: window.location.href,
    }
    try {
      if (navigator.share) await navigator.share(data)
      else {
        await navigator.clipboard.writeText(data.url)
        setNotice('Link copiado.')
      }
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') setNotice('Não foi possível compartilhar.')
    }
  }

  return (
    <PublicLayout>
      <div className="professional-detail-page">
        <a className="profile-back" href="/profissionais">
          ← Voltar ao diretório
        </a>
        {listing === undefined && !error ? (
          <div className="professional-state">
            <Spinner aria-label="Carregando vitrine" />
          </div>
        ) : error || !listing ? (
          <section className="professional-state">
            <h1>Esta vitrine não está disponível.</h1>
            <p>Ela pode estar em revisão, suspensa ou ter sido removida.</p>
          </section>
        ) : (
          <ProfessionalListingView
            listing={listing}
            listingId={listingId}
            user={user}
            notice={notice}
            onShare={share}
          />
        )}
      </div>
    </PublicLayout>
  )
}
