import { lazy, Suspense } from 'react'
import { Box } from '@primer/react'
import { markdownContainerSx } from './markdownStyles'
import { needsMarkdown } from '../utils/markdownHint'
import { ExpandableContent } from './ExpandableContent'
import { useInView } from '../hooks/useInView'
import { previewMarkdown } from '../utils/markdownPreview'

// Texto das publicações do feed. A maioria é texto corrido simples: renderiza direto, sem baixar nem
// executar o renderizador de markdown (react-markdown + remark-gfm + rehype-sanitize, ~160 kB). Só
// texto com sinal de sintaxe (ver utils/markdownHint.js) carrega o chunk sob demanda; enquanto ele
// chega, o próprio texto aparece em `pre-wrap` (sem espaço vazio) e depois é trocado pelo renderizado.
const MarkdownViewer = lazy(() =>
  import('./MarkdownViewer').then((module) => ({ default: module.MarkdownViewer }))
)

function PlainText({ text, sx }) {
  return (
    <Box sx={{ ...markdownContainerSx, ...sx }}>
      <p>{text}</p>
    </Box>
  )
}

// Só texto com chance real de ser extenso passa pelo recorte "Ver mais" (e paga a medição de layout):
// uma publicação curta nunca precisa disso.
const EXPANDABLE_MIN_LENGTH = 400

// Texto muito longo (até 7000 caracteres, com tabelas e seções) custa caro para transformar em árvore de
// elementos: num feed com vários, tudo de uma vez travava o celular por segundos. Esses textos só são
// renderizados quando o card chega perto da tela; até lá aparece um espaço reservado leve (começo do texto).
const DEFER_MIN_LENGTH = 1500
const PLACEHOLDER_CHARS = 280

function LongTextPlaceholder({ text, sx }) {
  const preview =
    text.length > PLACEHOLDER_CHARS ? `${text.slice(0, PLACEHOLDER_CHARS).trimEnd()}…` : text
  return (
    <div style={{ minHeight: 240 }}>
      <PlainText text={preview} sx={sx} />
    </div>
  )
}

function DeferredStatusText({ content, value, sx, profile }) {
  const [ref, near] = useInView({ rootMargin: '700px 0px' })
  // Só o começo (até uma fronteira segura) é processado de cara; o texto completo, se a pessoa pedir "Ver mais".
  const { preview, truncated } = previewMarkdown(content)
  const placeholder = <LongTextPlaceholder text={content.trim()} sx={sx} />
  return (
    <div ref={ref}>
      {near ? (
        <ExpandableContent
          renderFull={
            truncated
              ? () => (
                  <Suspense fallback={placeholder}>
                    <MarkdownViewer value={value} sx={sx} profile={profile} />
                  </Suspense>
                )
              : null
          }
        >
          <Suspense fallback={placeholder}>
            <MarkdownViewer value={truncated ? preview : value} sx={sx} profile={profile} />
          </Suspense>
        </ExpandableContent>
      ) : (
        placeholder
      )}
    </div>
  )
}

// `profile` passa direto para MarkdownViewer (ver MarkdownViewer.jsx) -- 'ads' remove
// link/imagem/tabela para o conteúdo de anúncios, reaproveitando aqui o mesmo carregamento
// sob demanda do chunk de markdown que o feed de publicações já usa.
export function StatusText({ value, sx, profile = 'default' }) {
  const content = typeof value === 'string' ? value.replace(/\r\n/g, '\n') : ''
  if (!content.trim()) return null
  if (!needsMarkdown(content)) return <PlainText text={content.trim()} sx={sx} />
  if (content.length >= DEFER_MIN_LENGTH) {
    return <DeferredStatusText content={content} value={value} sx={sx} profile={profile} />
  }
  const rendered = (
    <Suspense fallback={<PlainText text={content.trim()} sx={sx} />}>
      <MarkdownViewer value={value} sx={sx} profile={profile} />
    </Suspense>
  )
  return content.length >= EXPANDABLE_MIN_LENGTH ? (
    <ExpandableContent>{rendered}</ExpandableContent>
  ) : (
    rendered
  )
}
