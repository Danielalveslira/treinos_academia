import { useEffect, useState } from 'react'
import { PersonIcon } from '@primer/octicons-react'
import { loadAvatarBytes } from '../services/profileAvatarService'
import { getCachedPhotoUrl, loadPhotoOnce } from '../utils/photoBlobCache'
import { useInView } from '../hooks/useInView'

// `lazy`: no feed, o avatar só é baixado quando chega perto da tela (cards bem abaixo não custam rede
// nem memória enquanto não são vistos). Sem `lazy` (padrão) o comportamento é o de sempre.
export function ProfileAvatar({
  path,
  name = '',
  className = '',
  professional = true,
  lazy = false,
}) {
  const [wrapperRef, visible] = useInView({ disabled: !lazy })
  const [image, setImage] = useState(() => ({
    path,
    url: path ? getCachedPhotoUrl(path) || '' : '',
  }))
  useEffect(() => {
    let active = true
    if (!path) {
      setImage({ path, url: '' })
      return () => {
        active = false
      }
    }
    const cached = getCachedPhotoUrl(path)
    if (cached) {
      setImage({ path, url: cached })
      return () => {
        active = false
      }
    }
    if (!visible) {
      return () => {
        active = false
      }
    }
    // loadPhotoOnce agrupa montagens concorrentes do MESMO path (ex.: o mesmo autor
    // aparecendo em "Destaques" e no feed principal ao mesmo tempo) numa única
    // requisição ao Storage, em vez de uma por card.
    loadPhotoOnce(path, () =>
      loadAvatarBytes(path).then((bytes) =>
        URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
      )
    )
      .then((url) => active && setImage({ path, url }))
      .catch((error) => {
        // Sem isto, uma foto autorizada e aprovada que falha ao carregar (Rules,
        // rede, path inconsistente) parece indistinguível de "sem foto elegível" --
        // mesmo fallback visual, zero rastro pra investigar. Todo outro catch deste
        // tipo no app já loga (ver StatusCard.jsx, EconomyVoteBar.jsx etc.).
        console.error('[ProfileAvatar] loadAvatarBytes:', path, error)
        if (active) setImage({ path, url: '' })
      })
    return () => {
      active = false
    }
  }, [path, visible])

  const url = image.path === path ? image.url : ''
  return (
    <span
      ref={wrapperRef}
      className={`profile-avatar-image ${className}`.trim()}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" />
      ) : professional && name ? (
        name[0].toUpperCase()
      ) : (
        <PersonIcon size={28} />
      )}
    </span>
  )
}
