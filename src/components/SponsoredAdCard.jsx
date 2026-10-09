import { useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useAdClick, useAdImpression } from '../hooks/useAdMetrics'

// Publicação patrocinada no feed: mesma superfície/raio dos cards do feed, mas com selo "Patrocinado"
// sempre visível (nunca condicional — transparência com o usuário sobre conteúdo pago, independente de
// parceiro ou comunidade). Sem consulta própria, sem observador, sem timer; só CSS. A medição de impressão e clique
// (desligada por padrão, ver hooks/useAdMetrics.js) usa o coletor compartilhado: nada fica neste componente.
export function SponsoredAdCard({ ad, communityId = null }) {
  const [imageFailed, setImageFailed] = useState(false)
  const rootRef = useRef(null)
  useAdImpression(rootRef, ad.id, 'community_feed', communityId)
  const onCtaClick = useAdClick(ad.id, 'community_feed', communityId)
  const hasCta = Boolean(ad.ctaLabel)
  return (
    <article
      ref={rootRef}
      className="sponsored-ad-card"
      aria-label={`Patrocinado: ${ad.partnerName}`}
    >
      <header className="sponsored-ad-card-header">
        <span className="sponsored-ad-pill">Patrocinado</span>
        <span className="sponsored-ad-partner">{ad.partnerName}</span>
      </header>
      {/* AUD-013: imageUrl aponta pro domínio do parceiro, fora do nosso controle.
          referrerPolicy evita vazar a URL de onde o card foi visto (informação
          nenhuma o parceiro precisa pra só exibir a própria imagem); loading="lazy"
          evita a requisição pra imagens fora da viewport. Migrar pra um proxy/CDN
          próprio removeria o request de terceiro por completo, mas é uma peça de
          infraestrutura maior, fora do escopo desta correção pontual. A moldura
          16:9 é reservada no CSS: a imagem chegando não desloca o feed. */}
      {ad.imageUrl && !imageFailed && (
        <div className="sponsored-ad-media">
          <img
            src={ad.imageUrl}
            alt=""
            width="640"
            height="360"
            className="sponsored-ad-image"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        </div>
      )}
      <h3 className="sponsored-ad-title">{ad.title}</h3>
      {ad.description && <p className="sponsored-ad-description">{ad.description}</p>}
      {hasCta &&
        (ad.ctaType === 'internal' ? (
          <RouterLink to={ad.ctaTarget} className="sponsored-ad-cta" onClick={onCtaClick}>
            {ad.ctaLabel}
          </RouterLink>
        ) : (
          <a
            href={ad.ctaTarget}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="sponsored-ad-cta"
            onClick={onCtaClick}
            onAuxClick={onCtaClick}
          >
            {ad.ctaLabel}
          </a>
        ))}
    </article>
  )
}
