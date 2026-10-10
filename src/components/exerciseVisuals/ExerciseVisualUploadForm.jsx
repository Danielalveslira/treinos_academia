import { useState } from 'react'
import { Button, Flash } from '@primer/react'
import { validateImageFile } from '../../utils/imageCompression'

function FileField({ id, label, file, onChange, disabled }) {
  return (
    <div className="ev-file">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      {file && <span className="ev-muted">{file.name}</span>}
    </div>
  )
}

// Envio das duas imagens (de qualquer origem: IA, prompt externo ou arte própria). A conversão para WebP
// acontece no navegador e é revalidada no servidor (exercise-visual-confirm); o conjunto vai para revisão.
export function ExerciseVisualUploadForm({
  busy,
  disabled,
  onSubmit,
  onCancel,
  onStartFileChange,
}) {
  const [startFile, setStartFile] = useState(null)
  const [endFile, setEndFile] = useState(null)
  const [tool, setTool] = useState('')
  const [error, setError] = useState('')
  const locked = disabled || Boolean(busy)

  async function submit(event) {
    event.preventDefault()
    const invalid = validateImageFile(startFile) || validateImageFile(endFile)
    if (invalid) {
      setError(
        invalid.replace(
          'Selecione uma imagem.',
          'Selecione as duas imagens (posição inicial e final).'
        )
      )
      return
    }
    setError('')
    const ok = await onSubmit({ startFile, endFile, tool })
    if (ok) {
      setStartFile(null)
      setEndFile(null)
      onStartFileChange?.(null)
    }
  }

  return (
    <form className="ev-upload" onSubmit={submit}>
      <div className="ev-upload-files">
        <FileField
          id="visual-start"
          label="Posição inicial"
          file={startFile}
          onChange={(file) => {
            setStartFile(file)
            onStartFileChange?.(file)
          }}
          disabled={locked}
        />
        <FileField
          id="visual-end"
          label="Posição final"
          file={endFile}
          onChange={setEndFile}
          disabled={locked}
        />
      </div>
      <label className="ev-file">
        <span>Ferramenta usada (opcional)</span>
        <input
          type="text"
          className="ev-input"
          maxLength={40}
          placeholder="Ex.: nome da IA ou “arte própria”"
          value={tool}
          disabled={locked}
          onChange={(event) => setTool(event.target.value)}
        />
      </label>
      <p className="ev-muted">
        Convertidas para WebP (até 1024px; a miniatura de 320px sai da posição inicial). Nada é
        publicado automaticamente: o conjunto vai para revisão.
      </p>
      {error && <Flash variant="danger">{error}</Flash>}
      <div className="ev-actions">
        <Button type="submit" variant="primary" disabled={locked || !startFile || !endFile}>
          {busy === 'upload' ? 'Enviando…' : 'Enviar para revisão'}
        </Button>
        {onCancel && (
          <Button type="button" disabled={Boolean(busy)} onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  )
}
