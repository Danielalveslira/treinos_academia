import { useEffect, useState } from 'react'
import { PersonIcon } from '@primer/octicons-react'
import { loadAvatarBytes } from '../services/profileAvatarService'
import { getCachedPhotoUrl, setCachedPhotoUrl } from '../utils/photoBlobCache'

export function ProfileAvatar({ path, name = '', className = '', professional = true }) {
  const [url, setUrl] = useState(() => (path ? getCachedPhotoUrl(path) || '' : ''))
  useEffect(() => {
    let active = true
    if (!path) {
      setUrl('')
      return () => {
        active = false
      }
    }
    const cached = getCachedPhotoUrl(path)
    if (cached) {
      setUrl(cached)
      return () => {
        active = false
      }
    }
    loadAvatarBytes(path)
      .then((bytes) => {
        if (!active) return
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
        setCachedPhotoUrl(path, objectUrl)
        setUrl(objectUrl)
      })
      .catch(() => active && setUrl(''))
    return () => {
      active = false
    }
  }, [path])

  return (
    <span className={`profile-avatar-image ${className}`.trim()} aria-hidden="true">
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
