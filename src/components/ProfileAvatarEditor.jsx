import { useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import { Button, Flash } from '@primer/react'
import { ModalSheet, ModalSheetFrame } from './ModalSheet'
import { drawAvatarCrop, encodeAvatarCrop } from '../utils/avatarCrop'
import { readImageDimensions } from '../utils/imageDimensions'
import { uploadProfileAvatar } from '../services/profileAvatarService'
import { describeAccountAccessError } from '../utils/accountAccessErrors'

const CROPPER_STYLE = { cropAreaStyle: { borderRadius: '30%' } }
const EDITOR_MAX_DIMENSION = 1600

export function ProfileAvatarEditor({ file, onCancel, onChooseAnother, onSaved }) {
  const [source, setSource] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pixels, setPixels] = useState(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('')
  const busyRef = useRef(false)
  const previewRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    let active = true
    let url
    let bitmap
    async function decode() {
      try {
        const dimensions = await readImageDimensions(file)
        if (!active) return
        if (
          !dimensions ||
          !dimensions.width ||
          !dimensions.height ||
          dimensions.width * dimensions.height > 80_000_000
        ) {
          throw new Error('Imagem grande demais ou inválida para processar com segurança.')
        }
        const resize =
          dimensions.width >= dimensions.height
            ? { resizeWidth: Math.min(dimensions.width, EDITOR_MAX_DIMENSION) }
            : { resizeHeight: Math.min(dimensions.height, EDITOR_MAX_DIMENSION) }
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', ...resize })
        if (!active) {
          bitmap.close?.()
          bitmap = null
          return
        }
        if (bitmap.width * bitmap.height > EDITOR_MAX_DIMENSION * EDITOR_MAX_DIMENSION)
          throw new Error('Imagem grande demais para processar com segurança.')
        // The cropper image uses a bounded raster of the same decoded bitmap.
        const preview = document.createElement('canvas')
        preview.width = bitmap.width
        preview.height = bitmap.height
        let previewBlob
        try {
          const context = preview.getContext('2d')
          if (!context) throw new Error('Não foi possível processar a imagem.')
          context.drawImage(bitmap, 0, 0)
          previewBlob = await new Promise((resolve) => preview.toBlob(resolve, 'image/png'))
        } finally {
          preview.width = preview.height = 0
        }
        if (!previewBlob) throw new Error('Não foi possível processar a imagem.')
        url = URL.createObjectURL(previewBlob)
        if (!active) {
          bitmap.close?.()
          URL.revokeObjectURL(url)
          bitmap = null
          url = null
          return
        }
        setSource({ bitmap, url })
      } catch (cause) {
        bitmap?.close?.()
        if (url) URL.revokeObjectURL(url)
        bitmap = null
        url = null
        if (active) setError(cause.message || 'Não foi possível ler essa imagem.')
      }
    }
    decode()
    return () => {
      active = false
      mountedRef.current = false
      bitmap?.close?.()
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  useEffect(() => {
    if (!source || !pixels || !previewRef.current) return
    drawAvatarCrop(previewRef.current, source.bitmap, pixels, rotation)
  }, [source, pixels, rotation])

  function reset() {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
  }

  function cancel() {
    if (!busyRef.current) onCancel()
  }

  async function save() {
    if (!source || !pixels || busyRef.current) return
    busyRef.current = true
    setPhase('Processando imagem…')
    setError('')
    try {
      const canvas = document.createElement('canvas')
      let blob
      try {
        drawAvatarCrop(canvas, source.bitmap, pixels, rotation)
        blob = await encodeAvatarCrop(canvas)
      } finally {
        canvas.width = canvas.height = 0
      }
      if (!mountedRef.current) return
      setPhase('Enviando e confirmando foto…')
      const result = await uploadProfileAvatar(blob)
      if (mountedRef.current) onSaved(result, blob)
    } catch (cause) {
      if (mountedRef.current)
        setError(
          describeAccountAccessError(cause?.message) ||
            cause?.message ||
            'Não foi possível salvar a foto. Tente novamente.'
        )
    } finally {
      busyRef.current = false
      if (mountedRef.current) setPhase('')
    }
  }

  return (
    <ModalSheet onClose={cancel}>
      <ModalSheetFrame
        titleId="avatar-editor-title"
        title="Ajustar foto"
        subtitle="Arraste a imagem ou use os controles para escolher o enquadramento."
        onClose={cancel}
        closeDisabled={Boolean(phase)}
        className="avatar-editor-sheet"
        footer={
          <div className="avatar-editor-actions">
            <Button type="button" disabled={Boolean(phase)} onClick={cancel}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={Boolean(phase)}
              disabled={Boolean(phase) || !pixels}
              onClick={save}
            >
              Salvar foto
            </Button>
          </div>
        }
      >
        {source ? (
          <>
            <div className="avatar-editor-crop" aria-label="Arraste para posicionar a foto" aria-busy={Boolean(phase)}>
              <Cropper
                image={source.url}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={1}
                cropShape="rect"
                style={CROPPER_STYLE}
                showGrid={false}
                restrictPosition
                onCropChange={(value) => { if (!busyRef.current) setCrop(value) }}
                onZoomChange={(value) => { if (!busyRef.current) setZoom(value) }}
                onCropAreaChange={(_, croppedPixels) => setPixels(croppedPixels)}
              />
            </div>
            <div className="avatar-editor-preview">
              <canvas
                ref={previewRef}
                width="320"
                height="320"
                aria-label="Prévia da foto de perfil"
              />
              <span>Prévia do perfil</span>
            </div>
            <label className="avatar-editor-control">
              Zoom
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                disabled={Boolean(phase)}
              />
            </label>
            <div className="avatar-editor-position">
              <label>
                Horizontal{' '}
                <input
                  type="range"
                  min="-1000"
                  max="1000"
                  value={Math.round(crop.x)}
                  onChange={(event) =>
                    setCrop((current) => ({ ...current, x: Number(event.target.value) }))
                  }
                  disabled={Boolean(phase)}
                />
              </label>
              <label>
                Vertical{' '}
                <input
                  type="range"
                  min="-1000"
                  max="1000"
                  value={Math.round(crop.y)}
                  onChange={(event) =>
                    setCrop((current) => ({ ...current, y: Number(event.target.value) }))
                  }
                  disabled={Boolean(phase)}
                />
              </label>
            </div>
            <div className="avatar-editor-tools">
              <Button
                type="button"
                disabled={Boolean(phase)}
                onClick={() => setRotation((value) => (value + 270) % 360)}
              >
                Girar à esquerda
              </Button>
              <Button
                type="button"
                disabled={Boolean(phase)}
                onClick={() => setRotation((value) => (value + 90) % 360)}
              >
                Girar à direita
              </Button>
              <Button type="button" disabled={Boolean(phase)} onClick={reset}>
                Redefinir
              </Button>
              <Button
                type="button"
                disabled={Boolean(phase)}
                onClick={() => { if (!busyRef.current) onChooseAnother() }}
              >
                Escolher outra foto
              </Button>
            </div>
            {file.type === 'image/gif' && (
              <p className="avatar-editor-note">GIF: será usado apenas o primeiro quadro.</p>
            )}
          </>
        ) : (
          !error && <p role="status">Preparando imagem…</p>
        )}
        {phase && (
          <p role="status" aria-live="polite">
            {phase}
          </p>
        )}
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
      </ModalSheetFrame>
    </ModalSheet>
  )
}
