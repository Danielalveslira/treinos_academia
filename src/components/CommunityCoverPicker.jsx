import { useState } from 'react'
import { Flash } from '@primer/react'
import { ImageIcon } from '@primer/octicons-react'
import { uploadCommunityCover } from '../services/communitiesService'
import { CommunityCoverImage } from './CommunityCoverImage'
import { describeAccountAccessError } from '../utils/accountAccessErrors'
import { CoverCropField } from './communityCreation/CoverCropField'

// Edição de capa pós-criação (communityId já existe): o crop/zoom/compressão em si vive em
// CoverCropField (reaproveitado também pelo wizard de criação, antes de existir communityId).
// Aqui só o upload de fato, igual ao comportamento original.
export function CommunityCoverPicker({ communityId, coverPath, onUploaded }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleCropped(blob) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const path = await uploadCommunityCover(communityId, blob)
      onUploaded?.(path)
      setSuccess('Capa atualizada com sucesso.')
    } catch (err) {
      console.error('[CommunityCoverPicker] uploadCommunityCover:', err)
      setError(
        err?.message === 'COVER_TOO_LARGE'
          ? 'A imagem compactada ultrapassou 4 MB. Escolha outra foto.'
          : describeAccountAccessError(err?.message) || 'Não foi possível enviar a capa. Tente novamente.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="community-cover-picker">
      <strong>Capa da comunidade</strong>
      <div className="community-cover-picker-display">
        {coverPath ? (
          <div className="community-cover">
            <span className="community-cover-fallback">
              <ImageIcon size={28} />
            </span>
            <CommunityCoverImage path={coverPath} className="community-cover-image" />
          </div>
        ) : (
          <div className="community-cover community-cover-picker-empty">
            <ImageIcon size={28} />
            <span>Nenhuma capa definida</span>
          </div>
        )}
      </div>
      <p>Recomendado: 1200 × 600 px (proporção 2:1). Você poderá ajustar o enquadramento.</p>
      <CoverCropField hasExisting={Boolean(coverPath)} disabled={busy} onCropped={handleCropped} />
      {busy && <span role="status">Processando capa…</span>}
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {success && (
        <Flash variant="success" role="status">
          {success}
        </Flash>
      )}
    </div>
  )
}
