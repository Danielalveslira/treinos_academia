import { useEffect, useState } from 'react'
import { PersonIcon } from '@primer/octicons-react'
import { loadAvatarBytes } from '../services/profileAvatarService'
import { getCachedPhotoUrl, setCachedPhotoUrl } from '../utils/photoBlobCache'

export function ProfileAvatar({ path, name = '', className = '', professional = true }) {
  const [image, setImage] = useState(() => ({ path, url: path ? getCachedPhotoUrl(path) || '' : '' }))
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
    loadAvatarBytes(path)
      .then((bytes) => {
        if (!active) return
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
        setCachedPhotoUrl(path, objectUrl)
        setImage({ path, url: objectUrl })
      })
      .catch(() => active && setImage({ path, url: '' }))
    return () => {
      active = false
    }
  }, [path])

  const url = image.path === path ? image.url : ''
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
