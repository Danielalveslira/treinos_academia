import { useState } from 'react'
import { Button, Flash } from '@primer/react'
import { uploadCommunityCover } from '../services/communitiesService'
import { CommunityCoverImage } from './CommunityCoverImage'

// Mesmo padrão de uso do avatar de perfil (Profile.jsx): upload acontece à parte do
// submit do formulário, assim que o arquivo é escolhido e confirmado -- não guarda o
// arquivo em estado do CommunityForm nem depende do onSubmit (name/descrição/ícone) pra
// subir a capa. Só aparece em edição (communityId já existe, ver CommunityForm.jsx):
// a capa é um arquivo no Storage no caminho {communityId}.webp, que não existe ainda na
// criação.
export function CommunityCoverPicker({ communityId, coverPath, onUploaded }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleUpload() {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const path = await uploadCommunityCover(communityId, file)
      setFile(null)
      onUploaded?.(path)
    } catch (err) {
      console.error('[CommunityCoverPicker] uploadCommunityCover:', err)
      setError(
        err?.message === 'COVER_TOO_LARGE'
          ? 'A imagem compactada ultrapassou 4 MB. Escolha outra foto.'
          : 'Não foi possível enviar a capa. Tente outra imagem.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="community-cover-picker">
      <strong>Capa</strong>
      <p>Aparece no topo do cartão em "Explorar comunidades". JPEG, PNG, WebP ou GIF.</p>
      {coverPath && (
        <CommunityCoverImage path={coverPath} className="community-cover-picker-preview" />
      )}
      {error && <Flash variant="danger">{error}</Flash>}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] || null)}
      />
      <Button type="button" onClick={handleUpload} loading={busy} disabled={!file || busy}>
        Enviar capa
      </Button>
    </div>
  )
}
