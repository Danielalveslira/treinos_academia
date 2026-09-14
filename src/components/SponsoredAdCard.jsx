import { Link as RouterLink } from 'react-router-dom'
import { Box, Text, Button } from '@primer/react'
import { MegaphoneIcon } from '@primer/octicons-react'

// "Patrocinado" é obrigatório e nunca condicional — transparência com o usuário sobre
// conteúdo pago, independente de qual parceiro ou comunidade.
export function SponsoredAdCard({ ad }) {
  const hasCta = Boolean(ad.ctaLabel)
  return (
    <Box as="article" className="sponsored-ad-card" aria-label={`Publicidade de ${ad.partnerName}`}>
      <Box className="sponsored-ad-badge">
        <MegaphoneIcon size={12} />
        <span>Patrocinado</span>
      </Box>
      {/* AUD-013: imageUrl aponta pro domínio do parceiro, fora do nosso controle.
          referrerPolicy evita vazar a URL de onde o card foi visto (informação
          nenhuma o parceiro precisa pra só exibir a própria imagem); loading="lazy"
          evita a requisição pra imagens fora da viewport. Migrar pra um proxy/CDN
          próprio removeria o request de terceiro por completo, mas é uma peça de
          infraestrutura maior, fora do escopo desta correção pontual. */}
      {ad.imageUrl && (
        <img
          src={ad.imageUrl}
          alt=""
          className="sponsored-ad-image"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
      <Text className="sponsored-ad-partner">{ad.partnerName}</Text>
      <Text className="sponsored-ad-title">{ad.title}</Text>
      {ad.description && <Text className="sponsored-ad-description">{ad.description}</Text>}
      {hasCta &&
        (ad.ctaType === 'internal' ? (
          <Button as={RouterLink} to={ad.ctaTarget} size="small" className="sponsored-ad-cta">
            {ad.ctaLabel}
          </Button>
        ) : (
          <Button
            as="a"
            href={ad.ctaTarget}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            className="sponsored-ad-cta"
          >
            {ad.ctaLabel}
          </Button>
        ))}
    </Box>
  )
}
