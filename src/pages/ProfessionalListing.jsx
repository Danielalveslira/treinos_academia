import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Flash, Spinner } from '@primer/react'
import {
  LinkExternalIcon,
  LocationIcon,
  PeopleIcon,
  ShareAndroidIcon,
  ReportIcon,
} from '@primer/octicons-react'
import { PublicLayout } from '../components/PublicLayout'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { useAuth } from '../hooks/useAuth'
import { getPublishedProfessionalListing } from '../services/professionalListingsService'
import {
  CATEGORY_OPTIONS,
  LISTING_KIND_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
  optionLabel,
} from '../constants/professionalListingTaxonomy'
import { safeExternalContact } from '../utils/professionalListing'

const CONTACT_LABELS = { whatsapp: 'WhatsApp', instagram: 'Instagram', website: 'Site' }

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

  const contacts = listing?.publicContacts?.map(safeExternalContact).filter(Boolean) || []
  return (
    <PublicLayout>
      <div className="professional-detail-page">
        <Link className="profile-back" to="/profissionais">
          ← Voltar ao diretório
        </Link>
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
          <>
            {notice && <Flash role="status">{notice}</Flash>}
            <header className="professional-detail-hero">
              <ProfileAvatar
                path={listing.avatarPath}
                name={listing.displayName}
                professional={listing.kind === 'professional'}
                className="professional-detail-avatar"
              />
              <div>
                <span className="profile-eyebrow">
                  {optionLabel(LISTING_KIND_OPTIONS, listing.kind).toUpperCase()}
                </span>
                <h1>{listing.displayName}</h1>
                <p>{optionLabel(CATEGORY_OPTIONS, listing.categoryKey)}</p>
                <span className="professional-detail-location">
                  <LocationIcon /> {listing.city}, {listing.uf} ·{' '}
                  {optionLabel(SERVICE_MODE_OPTIONS, listing.serviceMode)}
                </span>
              </div>
              <Button onClick={share} leadingVisual={ShareAndroidIcon}>
                Compartilhar
              </Button>
            </header>
            <div className="professional-detail-grid">
              <main className="professional-detail-content">
                <section>
                  <h2>Apresentação</h2>
                  <p>{listing.bio}</p>
                </section>
                <section>
                  <h2>Modalidades</h2>
                  <div className="professional-tags">
                    {listing.modalityKeys.map((key) => (
                      <span key={key}>{optionLabel(MODALITY_OPTIONS, key)}</span>
                    ))}
                  </div>
                </section>
                {listing.specialties?.length > 0 && (
                  <section>
                    <h2>Especialidades</h2>
                    <ul>
                      {listing.specialties.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </main>
              <aside className="professional-contact-card">
                <h2>Entre em contato</h2>
                <p>
                  Negocie diretamente com o profissional ou espaço. O Evolutus não processa
                  pagamentos.
                </p>
                {contacts.map((contact) => (
                  <Button
                    key={contact.type}
                    as="a"
                    href={contact.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    leadingVisual={LinkExternalIcon}
                    block
                  >
                    {CONTACT_LABELS[contact.type]}
                  </Button>
                ))}
                {contacts.length === 0 && <p>Nenhum contato público informado.</p>}
                {listing.linkedCommunity && (
                  <Button
                    as={Link}
                    to={`/comunidades/${listing.linkedCommunity.id}`}
                    leadingVisual={PeopleIcon}
                    block
                  >
                    Ver comunidade {listing.linkedCommunity.name}
                  </Button>
                )}
                {user ? (
                  <Button
                    as={Link}
                    to={`/atendimento?tipo=report&vitrine=${listingId}`}
                    variant="invisible"
                    leadingVisual={ReportIcon}
                  >
                    {listing.kind === 'professional'
                      ? 'Denunciar profissional'
                      : 'Denunciar estabelecimento'}
                  </Button>
                ) : (
                  <Link to="/login">Entre para denunciar conteúdo</Link>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  )
}
