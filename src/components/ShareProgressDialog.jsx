import { useEffect, useRef, useState } from 'react'
import { Button, FormControl, Textarea } from '@primer/react'
import { DownloadIcon, ShareIcon } from '@primer/octicons-react'
import { ModalSheet, ModalSheetFrame } from './ModalSheet'
import { useSheetTitleId } from '../hooks/useSheetTitleId'
import { SHARE_RESULT_MESSAGES } from '../utils/shareMessages'
import { ShareProgressCard } from './ShareProgressCard'
import { CAPTION_MAX_LENGTH, VARIANT_LABELS, buildProgressPayload } from '../utils/shareProgress'
import { buildShareSvg } from '../utils/shareProgressSvg'
import { buildShareText } from '../utils/shareText'
import {
  appUrl,
  downloadFile,
  renderSvgToPngBlob,
  renderSvgToPublishBlob,
  shareWithFallback,
  toPngFile,
} from '../utils/shareImage'

const TIMEOUT_MESSAGE = 'A imagem demorou demais para ficar pronta. Tente novamente.'
const PUBLISH_ERRORS = {
  IMAGE_TYPE_UNSUPPORTED:
    'Seu navegador não consegue gerar essa imagem. Atualize o navegador e tente novamente.',
  IMAGE_TOO_LARGE: 'A imagem ficou grande demais. Tente novamente.',
  IMAGE_RENDER_TIMEOUT: TIMEOUT_MESSAGE,
  PNG_ENCODE_TIMEOUT: TIMEOUT_MESSAGE,
}

// Se a folha nativa nunca devolver (alguns WebViews), os botões voltam sozinhos depois deste prazo.
const NATIVE_SHARE_WATCHDOG_MS = 30000

// Erro -> mensagem (ou null para ficar em silêncio). Nunca devolve "carregando": o estado ocupado sempre acaba.
function describeError(kind, error) {
  // O navegador exige o toque do usuário "fresco" para abrir a folha de compartilhamento; se a imagem demorou a
  // ficar pronta ela já está pronta agora, então basta tocar de novo.
  if (error?.name === 'NotAllowedError') {
    return { kind: 'info', text: 'Imagem pronta. Toque em Compartilhar novamente.' }
  }
  // Já existe uma folha de compartilhamento aberta: não é falha do usuário nem nossa.
  if (error?.name === 'InvalidStateError') return { kind: '', text: '' }
  return {
    kind: 'error',
    text:
      PUBLISH_ERRORS[error?.message] ||
      (kind === 'publish'
        ? 'Não foi possível publicar. Tente novamente.'
        : kind === 'share'
          ? 'Não foi possível compartilhar. Tente novamente.'
          : 'Não foi possível gerar a imagem. Tente novamente.'),
  }
}

// Seletor de progresso (o MESMO da Home e das Comunidades), dentro da folha modal mobile-first (ModalSheet):
//  - sem `onPublish` (Home): "Compartilhar" = folha NATIVA do aparelho (imagem + mensagem com o link); sem suporte a
//    arquivo, copia a mensagem e baixa a imagem. "Baixar imagem" = SÓ download;
//  - com `onPublish` (Comunidades): mensagem opcional + "Publicar na comunidade" (publicação INTERNA; não é
//    compartilhamento externo).
// O PNG da variante visível é preparado em segundo plano: assim o clique em "Compartilhar" chama o share nativo
// na hora (o navegador exige que isso aconteça logo após o toque do usuário).
//
// Estado ocupado (`busy`): 'share'/'download'/'publish' = trabalhando (spinner no botão); 'sharing' = folha
// nativa aberta (botões travados, SEM spinner -- não é carregamento). Todo caminho (sucesso, erro, cancelamento,
// timeout) passa pelo `finally` de run() e volta a null; toques repetidos são ignorados por `lock`.
export function ShareProgressDialogBody({
  options,
  onPublish = null,
  publishLabel = 'Publicar na comunidade',
  onClose,
  env = globalThis,
}) {
  const titleId = useSheetTitleId()
  const [selectedVariant, setSelectedVariant] = useState(options[0]?.variant)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(null) // null | 'share' | 'sharing' | 'download' | 'publish'
  const [message, setMessage] = useState({ kind: '', text: '' })
  const lock = useRef(false)
  const files = useRef(new Map()) // variant -> { promise, file }
  const model = options.find((option) => option.variant === selectedVariant) || options[0]
  const publishing = Boolean(onPublish)

  function prepareFile(target) {
    const existing = files.current.get(target.variant)
    if (existing) return existing
    const entry = { file: null, promise: null }
    entry.promise = renderSvgToPngBlob(buildShareSvg(target), {}, env).then((blob) => {
      entry.file = toPngFile(blob, target.filename, env)
      return entry.file
    })
    entry.promise.catch(() => files.current.delete(target.variant))
    files.current.set(target.variant, entry)
    return entry
  }

  useEffect(() => {
    if (publishing || !model) return undefined
    // Depois de a folha pintar: o render do PNG (1080x1350) não disputa o primeiro frame nem trava a abertura.
    const timer = setTimeout(() => prepareFile(model).promise.catch(() => {}), 60)
    return () => clearTimeout(timer)
    // Só quando a variante visível muda; prepareFile só usa refs/props estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.variant, publishing])

  async function run(kind, action) {
    if (lock.current) return
    lock.current = true
    setBusy(kind)
    setMessage({ kind: '', text: '' })
    try {
      await action()
    } catch (error) {
      console.error('[ShareProgress]', kind, error)
      setMessage(describeError(kind, error))
    } finally {
      lock.current = false
      setBusy(null)
    }
  }

  // Compartilhar: folha nativa com imagem + título + mensagem (link dentro do texto). Sem suporte a arquivo, o
  // fallback copia a mensagem e baixa a imagem. Com o PNG já pronto, o share roda no toque. O spinner só
  // existe enquanto a imagem ainda está sendo preparada (com prazo, ver shareImage.js); ao abrir a folha do
  // aparelho o botão deixa de girar.
  const share = () =>
    run('share', async () => {
      const entry = prepareFile(model)
      const file = entry.file || (await entry.promise)
      setBusy('sharing')
      let watchdog
      const timeout = new Promise((resolve) => {
        watchdog = setTimeout(() => resolve('cancelled'), NATIVE_SHARE_WATCHDOG_MS)
      })
      try {
        setMessage(
          SHARE_RESULT_MESSAGES[
            await Promise.race([
              shareWithFallback(file, buildShareText(model.variant, appUrl(env)), env),
              timeout,
            ])
          ]
        )
      } finally {
        clearTimeout(watchdog)
      }
    })

  // Baixar imagem: SÓ download (não compartilha, não copia link, não publica).
  const download = () =>
    run('download', async () => {
      const entry = prepareFile(model)
      downloadFile(entry.file || (await entry.promise), env)
      setMessage({ kind: 'info', text: 'Imagem baixada.' })
    })

  // A publicação recebe o card como WebP (pipeline de fotos) + a mensagem + o tipo/período do progresso.
  const publish = () =>
    run('publish', async () => {
      const blob = await renderSvgToPublishBlob(buildShareSvg(model), env)
      await onPublish({ blob, ...buildProgressPayload(model, caption) })
    })

  if (!model) return null

  const footer = (
    <div className="share-progress-footer">
      <p
        className="share-progress-message"
        role="status"
        aria-live="polite"
        data-kind={message.kind}
      >
        {message.text}
      </p>
      <div className="share-progress-actions">
        {publishing ? (
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
        ) : (
          <>
            <Button
              variant="primary"
              block
              size="large"
              leadingVisual={ShareIcon}
              loading={busy === 'share'}
              disabled={busy !== null}
              onClick={share}
            >
              Compartilhar
            </Button>
            <Button
              block
              size="large"
              leadingVisual={DownloadIcon}
              loading={busy === 'download'}
              disabled={busy !== null}
              onClick={download}
            >
              Baixar imagem
            </Button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <ModalSheetFrame
      titleId={titleId}
      title="Compartilhar progresso"
      subtitle={publishing ? 'Compartilhe sua evolução com a comunidade.' : undefined}
      onClose={onClose}
      footer={footer}
    >
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
        {publishing && (
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
        )}
      </div>
    </ModalSheetFrame>
  )
}

// Mesma folha para a Home e para as Comunidades.
export function ShareProgressDialog({ options, onClose, onPublish = null, publishLabel }) {
  return (
    <ModalSheet onClose={onClose}>
      <ShareProgressDialogBody
        options={options}
        onPublish={onPublish}
        publishLabel={publishLabel}
        onClose={onClose}
      />
    </ModalSheet>
  )
}
