import { Link } from 'react-router-dom'
import { Button, Label } from '@primer/react'
import { LocationIcon } from '@primer/octicons-react'
import { ProfileAvatar } from './ProfileAvatar'
import {
  CATEGORY_OPTIONS,
  LISTING_KIND_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
  optionLabel,
} from '../constants/professionalListingTaxonomy'

export function ProfessionalListingCard({ listing }) {
  return (
    <article className="professional-card">
      <ProfileAvatar
        path={listing.avatarPath}
        name={listing.displayName}
        professional={listing.kind === 'professional'}
        className="professional-card-avatar"
      />
      <div className="professional-card-body">
        <div className="professional-card-labels">
          <Label>{optionLabel(LISTING_KIND_OPTIONS, listing.kind)}</Label>
          <span>{optionLabel(SERVICE_MODE_OPTIONS, listing.serviceMode)}</span>
        </div>
        <h2>{listing.displayName}</h2>
        <p className="professional-card-category">
          {optionLabel(CATEGORY_OPTIONS, listing.categoryKey)}
        </p>
        <p className="professional-card-location">
          <LocationIcon /> {listing.city}, {listing.uf}
        </p>
        <ul className="professional-card-modalities" aria-label="Modalidades">
          {listing.modalityKeys.slice(0, 3).map((key) => (
            <li key={key}>{optionLabel(MODALITY_OPTIONS, key)}</li>
          ))}
        </ul>
      </div>
      <Button as={Link} to={`/profissionais/${listing.id}`} variant="primary">
        Ver vitrine
      </Button>
    </article>
  )
}
