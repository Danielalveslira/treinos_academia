import { getCommunityIcon } from '../constants/communityIcons'

// Badge compartilhado entre a listagem (Communities.jsx) e o painel de admin
// (AdminCommunities.jsx, tanto na lista quanto no preview do formulário) — antes eram
// duas caixas praticamente iguais implementadas em separado. imageUrl é suporte legado
// (o formulário nunca coletou esse campo; nenhuma comunidade real deveria tê-lo, mas
// não custa nada continuar respeitando um valor já gravado antes do ícone existir).
export function CommunityIcon({ community, size = 40 }) {
  const Icon = getCommunityIcon(community?.iconName)
  return (
    <span
      className="community-icon"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      aria-hidden="true"
    >
      {community?.imageUrl ? (
        // AUD-013: mesmo raciocínio de SponsoredAdCard -- imageUrl é um domínio
        // externo (legado, nem coletado pelo formulário atual), sem motivo pra
        // vazar de onde a imagem foi vista.
        <img
          src={community.imageUrl}
          alt=""
          className="community-icon-image"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
      )}
    </span>
  )
}
