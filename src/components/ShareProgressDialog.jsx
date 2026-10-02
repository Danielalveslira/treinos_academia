import { useRef, useState } from 'react'
import { Button, Dialog, Text } from '@primer/react'
import { DownloadIcon, ShareIcon } from '@primer/octicons-react'
import { ShareProgressCard } from './ShareProgressCard'
import { VARIANT_LABELS } from '../utils/shareProgress'
import { buildShareSvg } from '../utils/shareProgressSvg'
import {
  canShareImageFiles,
  downloadFile,
  renderSvgToPngBlob,
  shareImageFile,
  toPngFile,
} from '../utils/shareImage'

// Preview + compartilhar/baixar. O PNG só é gerado no clique (o preview é o SVG). "Compartilhar" usa a folha
// nativa (Web Share com arquivo); sem suporte, cai para download e avisa. Fechar a folha não é erro.
export function ShareProgressDialogBody({ options, env = globalThis }) {
  const [selectedVariant, setSelectedVariant] = useState(options[0]?.variant)
  const [busy, setBusy] = useState(null) // null | 'share' | 'download'
  const [message, setMessage] = useState({ kind: '', text: '' })
  const lock = useRef(false)
  const model = options.find((option) => option.variant === selectedVariant) || options[0]
  const shareSupported = typeof env.navigator?.share === 'function'

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
      setMessage({ kind: 'error', text: 'Não foi possível gerar a imagem. Tente novamente.' })
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

  if (!model) return null
  return (
    <div className="share-progress">
      <div className="share-progress-tabs" role="tablist" aria-label="Formato do card">
        {options.map((option) => (
          <button
            key={option.variant}
            type="button"
            role="tab"
            aria-selected={option.variant === model.variant}
            className={`share-progress-tab${option.variant === model.variant ? ' is-active' : ''}`}
            onClick={() => setSelectedVariant(option.variant)}
          >
            {VARIANT_LABELS[option.variant]}
          </button>
        ))}
      </div>
      <div className="share-progress-preview">
        <ShareProgressCard model={model} />
      </div>
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

export function ShareProgressDialog({ options, onClose }) {
  return (
    <Dialog
      title="Compartilhar progresso"
      onClose={onClose}
      width="large"
      position={{ narrow: 'fullscreen', regular: 'center' }}
    >
      <ShareProgressDialogBody options={options} />
    </Dialog>
  )
}
