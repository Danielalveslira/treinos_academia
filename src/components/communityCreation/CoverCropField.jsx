import { useEffect, useRef, useState } from 'react'
import { Button, Flash } from '@primer/react'
import { ImageIcon } from '@primer/octicons-react'
import {
  coverCropRect,
  drawCoverCrop,
  encodeCoverCrop,
  UnsupportedImageError,
  validateImageFile,
} from '../../utils/imageCompression'

// Editor de capa (seleção + recorte 2:1 + zoom/posição + compressão), extraído de
// CommunityCoverPicker para ser usável ANTES de existir communityId: devolve só o Blob já
// cropado/comprimido via onCropped -- nunca faz upload. Reaproveitado em dois lugares:
// - CommunityCoverPicker (pós-criação): onCropped chama uploadCommunityCover(communityId, blob).
// - Etapa "Informações" do wizard de criação: onCropped guarda o blob em memória; o upload só
//   ocorre depois que create_community/create_free_community devolve o communityId (o caminho
//   de Storage é determinístico `{communityId}.webp` -- estruturalmente pós-criação nos dois casos).
export function CoverCropField({ triggerLabel, hasExisting = false, disabled = false, onCropped }) {
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [source, setSource] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!source) return
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      if (dialog?.open) dialog.close()
      source.bitmap.close?.()
    }
  }, [source])

  useEffect(() => {
    if (source && canvasRef.current) {
      drawCoverCrop(
        canvasRef.current,
        source.bitmap,
        coverCropRect(source.bitmap.width, source.bitmap.height, zoom, position.x, position.y)
      )
    }
  }, [source, zoom, position])

  async function selectFile(file) {
    if (!file || busy) return
    setError('')
    const invalid = validateImageFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    try {
      const bitmap = await createImageBitmap(file)
      setZoom(1)
      setPosition({ x: 0.5, y: 0.5 })
      setSource({ bitmap })
    } catch {
      setError('Não foi possível ler essa imagem. Escolha outro arquivo.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function closeEditor() {
    if (!busy) setSource(null)
  }

  function moveFromPointer(event) {
    if (!dragRef.current || !source) return
    const dx = event.clientX - dragRef.current.clientX
    const dy = event.clientY - dragRef.current.clientY
    const { width, height } = source.bitmap
    const crop = coverCropRect(width, height, zoom)
    const bounds = event.currentTarget.getBoundingClientRect()
    setPosition({
      x: Math.max(
        0,
        Math.min(
          1,
          dragRef.current.x - ((dx / bounds.width) * crop.width) / Math.max(1, width - crop.width)
        )
      ),
      y: Math.max(
        0,
        Math.min(
          1,
          dragRef.current.y -
            ((dy / bounds.height) * crop.height) / Math.max(1, height - crop.height)
        )
      ),
    })
  }

  async function confirmCrop() {
    if (!source || busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await encodeCoverCrop(canvasRef.current)
      setSource(null)
      onCropped(blob)
    } catch (err) {
      console.error('[CoverCropField] encodeCoverCrop:', err)
      setError(
        err instanceof UnsupportedImageError
          ? err.message
          : 'Não foi possível processar essa imagem. Tente outro arquivo.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="community-cover-crop-field">
      <input
        ref={inputRef}
        className="community-cover-file-input"
        type="file"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={disabled || busy}
        aria-label="Selecionar imagem de capa"
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      <Button
        type="button"
        leadingVisual={ImageIcon}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {triggerLabel ?? (hasExisting ? 'Trocar capa da comunidade' : 'Adicionar capa da comunidade')}
      </Button>
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {source && (
        <dialog
          ref={dialogRef}
          className="community-cover-dialog"
          aria-labelledby="community-cover-dialog-title"
          onCancel={(event) => {
            if (busy) event.preventDefault()
            else closeEditor()
          }}
        >
          <h2 id="community-cover-dialog-title">Ajustar capa</h2>
          <p>
            Arraste para posicionar o recorte. A área abaixo mostra como a capa aparecerá nos cards.
          </p>
          <canvas
            ref={canvasRef}
            className="community-cover-editor-canvas"
            aria-label="Prévia do recorte 2:1"
            onPointerDown={(event) => {
              dragRef.current = { clientX: event.clientX, clientY: event.clientY, ...position }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={moveFromPointer}
            onPointerUp={() => {
              dragRef.current = null
            }}
            onPointerCancel={() => {
              dragRef.current = null
            }}
          />
          <label className="community-cover-zoom">
            Zoom
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <div className="community-cover-position-controls">
            <label>
              Horizontal
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={position.x}
                onChange={(event) =>
                  setPosition((current) => ({ ...current, x: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              Vertical
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={position.y}
                onChange={(event) =>
                  setPosition((current) => ({ ...current, y: Number(event.target.value) }))
                }
              />
            </label>
          </div>
          <div className="community-cover-dialog-actions">
            <Button type="button" disabled={busy} onClick={closeEditor}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" loading={busy} disabled={busy} onClick={confirmCrop}>
              Usar esta capa
            </Button>
          </div>
        </dialog>
      )}
    </div>
  )
}
