import { useEffect, useRef, useState } from 'react'
import { Button, Flash } from '@primer/react'
import { ImageIcon } from '@primer/octicons-react'
import { uploadCommunityCover } from '../services/communitiesService'
import { CommunityCoverImage } from './CommunityCoverImage'
import { describeAccountAccessError } from '../utils/accountAccessErrors'
import {
  coverCropRect,
  drawCoverCrop,
  encodeCoverCrop,
  UnsupportedImageError,
  validateImageFile,
} from '../utils/imageCompression'

export function CommunityCoverPicker({ communityId, coverPath, onUploaded }) {
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [source, setSource] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!source) return
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      if (dialog?.open) dialog.close()
      source.bitmap.close?.()
      URL.revokeObjectURL(source.url)
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
    setSuccess('')
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
      setSource({ bitmap, url: URL.createObjectURL(file) })
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

  async function saveCover() {
    if (!source || busy) return
    setBusy(true)
    setError('')
    try {
      const crop = await encodeCoverCrop(canvasRef.current)
      const path = await uploadCommunityCover(communityId, crop)
      onUploaded?.(path)
      setSuccess('Capa atualizada com sucesso.')
      setSource(null)
    } catch (err) {
      console.error('[CommunityCoverPicker] uploadCommunityCover:', err)
      setError(
        err?.message === 'COVER_TOO_LARGE'
          ? 'A imagem compactada ultrapassou 4 MB. Escolha outra foto.'
          : describeAccountAccessError(err?.message) ||
              (err instanceof UnsupportedImageError ? err.message : null) ||
              'Não foi possível enviar a capa. Tente novamente.'
      )
    } finally {
      setBusy(false)
    }
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
          <button
            type="button"
            className="community-cover community-cover-picker-empty"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImageIcon size={28} />
            <span>Adicionar capa da comunidade</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        className="community-cover-file-input"
        type="file"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={busy}
        aria-label="Selecionar imagem de capa"
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      {coverPath && (
        <Button
          type="button"
          leadingVisual={ImageIcon}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Trocar capa da comunidade
        </Button>
      )}
      <p>Recomendado: 1200 × 600 px (proporção 2:1). Você poderá ajustar o enquadramento.</p>
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
          <img
            src={source.url}
            alt="Imagem original selecionada"
            className="community-cover-original"
          />
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
            <Button
              type="button"
              variant="primary"
              loading={busy}
              disabled={busy}
              onClick={saveCover}
            >
              Salvar capa
            </Button>
          </div>
        </dialog>
      )}
    </div>
  )
}
