import { useRef, useState } from 'react'
import { Button, Dialog, FormControl, Text, Textarea } from '@primer/react'
import { DownloadIcon, ShareIcon } from '@primer/octicons-react'
import { ShareProgressCard } from './ShareProgressCard'
import { CAPTION_MAX_LENGTH, VARIANT_LABELS, buildProgressPayload } from '../utils/shareProgress'
import { buildShareSvg } from '../utils/shareProgressSvg'
import {
  canShareImageFiles,
  downloadFile,
  renderSvgToPngBlob,
  renderSvgToPublishBlob,
  shareImageFile,
  toPngFile,
} from '../utils/shareImage'

const PUBLISH_ERRORS = {
  IMAGE_TYPE_UNSUPPORTED:
    'Seu navegador não consegue gerar essa imagem. Atualize o navegador e tente novamente.',
  IMAGE_TOO_LARGE: 'A imagem ficou grande demais. Tente novamente.',
}

// Seletor de progresso (o MESMO da Home e das Comunidades): abas por variante disponível, preview e ações.
//  - sem `onPublish` (Home): "Compartilhar" (folha nativa, quando suportada) e "Baixar imagem";
//  - com `onPublish` (Comunidades): mensagem opcional + "Publicar na comunidade" como ação principal.
// O PNG/WebP só é gerado no clique (o preview é o próprio SVG). Fechar a folha de compartilhamento não é erro.
export function ShareProgressDialogBody({
  options,
  onPublish = null,
  publishLabel = 'Publicar na comunidade',
  env = globalThis,
}) {
  const [selectedVariant, setSelectedVariant] = useState(options[0]?.variant)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(null) // null | 'share' | 'download' | 'publish'
  const [message, setMessage] = useState({ kind: '', text: '' })
  const lock = useRef(false)
  const model = options.find((option) => option.variant === selectedVariant) || options[0]
  const shareSupported = typeof env.navigator?.share === 'function'
  const publishing = Boolean(onPublish)

  async function makeFile() {
    const blob = await renderSvgToPngBlob(buildShareSvg(model), {}, env)
    return toPngFile(blob, model.filename, env)
  }

  async function run(kind, action) {
    if (lock.current) return
    lock.current = true
    setBusy(kind)
    setMessage({ kind: '', text: '' })
    try {
      await action()
    } catch (error) {
      console.error('[ShareProgress]', kind, error)
      setMessage({
        kind: 'error',
        text:
          PUBLISH_ERRORS[error?.message] ||
          (kind === 'publish'
            ? 'Não foi possível publicar. Tente novamente.'
            : 'Não foi possível gerar a imagem. Tente novamente.'),
      })
    } finally {
      lock.current = false
      setBusy(null)
    }
  }

  const share = () =>
    run('share', async () => {
      const file = await makeFile()
      if (!canShareImageFiles(file, env)) {
        downloadFile(file, env)
        setMessage({
          kind: 'info',
          text: 'Seu navegador não compartilha imagens direto — a imagem foi baixada.',
        })
        return
      }
      const result = await shareImageFile(file, { title: 'Evolutus', text: model.shareText }, env)
      if (result === 'shared') setMessage({ kind: 'info', text: 'Compartilhado!' })
    })

  const download = () =>
    run('download', async () => {
      downloadFile(await makeFile(), env)
      setMessage({ kind: 'info', text: 'Imagem baixada.' })
    })

  // A publicação recebe o card como WebP (pipeline de fotos) + a mensagem + o tipo/período do progresso.
  const publish = () =>
    run('publish', async () => {
      const blob = await renderSvgToPublishBlob(buildShareSvg(model), env)
      await onPublish({ blob, ...buildProgressPayload(model, caption) })
    })

  if (!model) return null
  return (
    <div className={`share-progress${publishing ? ' is-publishing' : ''}`}>
      <div className="share-progress-tabs" role="tablist" aria-label="Período do progresso">
        {options.map((option) => (
          <button
            key={option.variant}
            type="button"
            role="tab"
            aria-selected={option.variant === model.variant}
            className={`share-progress-tab${option.variant === model.variant ? ' is-active' : ''}`}
            disabled={busy !== null}
            onClick={() => setSelectedVariant(option.variant)}
          >
            {VARIANT_LABELS[option.variant]}
          </button>
        ))}
      </div>
      <div className="share-progress-preview">
        <ShareProgressCard model={model} />
      </div>
      {publishing ? (
        <>
          <FormControl>
            <FormControl.Label>Mensagem (opcional)</FormControl.Label>
            <Textarea
              block
              rows={2}
              maxLength={CAPTION_MAX_LENGTH}
              value={caption}
              disabled={busy !== null}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Ex.: Semana concluída 💪"
            />
          </FormControl>
          <div className="share-progress-actions">
            <Button
              variant="primary"
              block
              size="large"
              loading={busy === 'publish'}
              disabled={busy !== null}
              onClick={publish}
            >
              {publishLabel}
            </Button>
          </div>
        </>
      ) : (
        <div className="share-progress-actions">
          {shareSupported && (
            <Button
              variant="primary"
              block
              leadingVisual={ShareIcon}
              loading={busy === 'share'}
              disabled={busy !== null}
              onClick={share}
            >
              Compartilhar
            </Button>
          )}
          <Button
            variant={shareSupported ? 'default' : 'primary'}
            block
            leadingVisual={DownloadIcon}
            loading={busy === 'download'}
            disabled={busy !== null}
            onClick={download}
          >
            Baixar imagem
          </Button>
        </div>
      )}
      <Text
        as="p"
        className="share-progress-message"
        role="status"
        aria-live="polite"
        data-kind={message.kind}
      >
        {message.text}
      </Text>
    </div>
  )
}

export function ShareProgressDialog({ options, onClose, onPublish = null, publishLabel }) {
  return (
    <Dialog
      title="Compartilhar progresso"
      subtitle={onPublish ? 'Compartilhe sua evolução com a comunidade.' : undefined}
      onClose={onClose}
      width="large"
      position={{ narrow: 'fullscreen', regular: 'center' }}
    >
      <ShareProgressDialogBody
        options={options}
        onPublish={onPublish}
        publishLabel={publishLabel}
      />
    </Dialog>
  )
}
