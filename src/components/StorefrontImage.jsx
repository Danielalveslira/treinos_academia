import { useEffect, useState } from 'react'
import { Box } from '@primer/react'
import { loadStorefrontImage } from '../services/storefrontService'
export default function StorefrontImage({ id, alt = '', size = 64 }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    setSrc(null)
    if (!id) return
    const controller = new AbortController()
    let objectUrl
    loadStorefrontImage(id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {})
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])
  return src ? (
    <Box
      as="img"
      src={src}
      alt={alt}
      sx={{ width: size, height: size, objectFit: 'contain', borderRadius: 2 }}
    />
  ) : null
}
