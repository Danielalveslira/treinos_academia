import { Text } from '@primer/react'
import StorefrontImage from '../StorefrontImage'
import { MarkdownViewer } from '../MarkdownViewer'

// Prévia estática: usa as classes dos formatos publicados, sem registrar métricas,
// iniciar rotação ou criar um link clicável antes da aprovação.
export default function AdvertisingCreativePreview({
  placements,
  partnerName,
  title,
  description,
  mediaId,
  imageUrl,
  ctaLabel = 'Saiba mais',
}) {
  const codes = (placements || []).map((item) => (typeof item === 'string' ? item : item.code))
  const showFeed = codes.includes('community_feed')
  const banners = codes.filter((code) =>
    ['home_banner', 'progress_banner', 'community_banner'].includes(code)
  )
  if (!showFeed && banners.length === 0) return null

  return (
    <div aria-label="Prévia do anúncio">
      {banners.map((code) => (
        <div key={code}>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
            {code === 'home_banner'
              ? 'Página inicial'
              : code === 'progress_banner'
                ? 'Progresso'
                : 'Comunidade'}{' '}
            · imagem e descrição não aparecem no banner.
          </Text>
          <div
            className={`sponsored-ad-banner${code === 'home_banner' ? ' sponsored-ad-banner--home' : ''}${code === 'progress_banner' ? ' sponsored-ad-banner--progress' : ''}`}
          >
            <div className="sponsored-ad-banner-content">
              <p className="sponsored-ad-banner-meta">
                <span className="sponsored-ad-pill">Patrocinado</span>
                <span className="sponsored-ad-banner-partner">{partnerName || 'Sua marca'}</span>
              </p>
              <div className="sponsored-ad-banner-line">
                <p className="sponsored-ad-banner-text">{title || 'Seu anúncio'}</p>
              </div>
            </div>
            <div className="sponsored-ad-banner-side">
              {ctaLabel && <span className="sponsored-ad-banner-cta">{ctaLabel}</span>}
            </div>
          </div>
        </div>
      ))}
      {showFeed && (
        <>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
            Prévia do card no feed
          </Text>
          <article className="sponsored-ad-card">
            <header className="sponsored-ad-card-header">
              <span className="sponsored-ad-pill">Patrocinado</span>
              <span className="sponsored-ad-partner">{partnerName || 'Sua marca'}</span>
            </header>
            {mediaId && (
              <div className="sponsored-ad-media">
                <StorefrontImage id={mediaId} size="100%" />
              </div>
            )}
            {imageUrl && !mediaId && (
              <div className="sponsored-ad-media">
                <img src={imageUrl} alt="" className="sponsored-ad-image" width="640" height="360" loading="lazy" referrerPolicy="no-referrer" />
              </div>
            )}
            <h3 className="sponsored-ad-title">{title || 'Seu anúncio'}</h3>
            {description && (
              <div className="sponsored-ad-description">
                <MarkdownViewer value={description} profile="ads" />
              </div>
            )}
            {ctaLabel && <span className="sponsored-ad-cta">{ctaLabel}</span>}
          </article>
        </>
      )}
    </div>
  )
}
