import { Link } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import {
  LinkExternalIcon,
  LocationIcon,
  PeopleIcon,
  ShareAndroidIcon,
  ReportIcon,
} from '@primer/octicons-react'
import StorefrontImage from './StorefrontImage'
import {
  CATEGORY_OPTIONS,
  LISTING_KIND_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
  optionLabel,
} from '../constants/professionalListingTaxonomy'
import { safeExternalContact } from '../utils/professionalListing'

const CONTACT_LABELS = { whatsapp: 'WhatsApp', instagram: 'Instagram', website: 'Site' }

export function ProfessionalListingView({ listing, listingId, user, notice, onShare }) {
  const contacts = listing.publicContacts?.map(safeExternalContact).filter(Boolean) || []

  return (
    <>
      {notice && <Flash role="status">{notice}</Flash>}
      <header className="professional-detail-hero">
        <StorefrontImage id={listing.mediaId} alt={listing.displayName} size={104} />
        <div className="professional-detail-identity">
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
        <Button
          className="professional-detail-share"
          onClick={onShare}
          leadingVisual={ShareAndroidIcon}
        >
          Compartilhar
        </Button>
      </header>
      <div className="professional-detail-grid">
        <main className="professional-detail-content">
          <section className="professional-detail-section">
            <h2>Apresentação</h2>
            <p>{listing.bio}</p>
            {listing.address && <p>{listing.address}</p>}
            {listing.openingHours && <p>{listing.openingHours}</p>}
          </section>
          <section className="professional-detail-section">
            <h2>Modalidades</h2>
            <div className="professional-tags">
              {listing.modalityKeys.map((key) => (
                <span key={key}>{optionLabel(MODALITY_OPTIONS, key)}</span>
              ))}
            </div>
          </section>
          {listing.specialties?.length > 0 && (
            <section className="professional-detail-section">
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
          <div className="professional-contact-heading">
            <h2>Entre em contato</h2>
            <p>
              Negocie diretamente com o profissional ou espaço. O Evolutus não processa pagamentos.
            </p>
          </div>
          {contacts.length > 0 && (
            <div className="professional-contact-actions">
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
            </div>
          )}
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
          <div className="professional-report-action">
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
          </div>
        </aside>
      </div>
    </>
  )
}
