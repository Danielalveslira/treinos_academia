import { useEffect, useState } from 'react'
import { getCommunityCoverBlob } from '../services/communitiesService'
import { getCachedPhotoUrl, loadPhotoOnce } from '../utils/photoBlobCache'

// Mesma estratégia de ProfileAvatar.jsx (cache de blob: por path, uma única requisição por
// path mesmo com vários cards montando ao mesmo tempo). Sem cover_path, não renderiza nada
// -- o chamador decide o fundo de substituição (ver .community-cover em app.css).
export function CommunityCoverImage({ path, className = '' }) {
  const [url, setUrl] = useState(() => (path ? getCachedPhotoUrl(path) || '' : ''))

  useEffect(() => {
    if (!path) {
      setUrl('')
      return
    }
    const cached = getCachedPhotoUrl(path)
    if (cached) {
      setUrl(cached)
      return
    }
    let active = true
    loadPhotoOnce(path, () => getCommunityCoverBlob(path).then((blob) => URL.createObjectURL(blob)))
      .then((resolved) => active && setUrl(resolved))
      .catch((error) => {
        console.error('[CommunityCoverImage] getCommunityCoverBlob:', path, error)
        if (active) setUrl('')
      })
    return () => {
      active = false
    }
  }, [path])

  if (!url) return null
  return <img src={url} alt="" className={className} loading="lazy" />
}
