import { Box, Link } from '@primer/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { markdownContainerSx } from './markdownStyles'

// Só http, https e mailto viram link (o padrão do rehype-sanitize ainda aceita irc, ircs e xmpp, que não têm
// uso aqui e só ampliam a superfície).
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'] },
}

const COMPONENTS = {
  // Conteúdo de usuário nunca carrega recurso externo: uma imagem em markdown (o editor nem oferece) viraria
  // rastreador do IP de quem lê, consumo de dados em rede fraca e dezenas de downloads num feed. Fica só o texto
  // alternativo, inerte.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  a: ({ href, title, children }) => (
    <Link href={href} title={title} target="_blank" rel="noreferrer noopener">
      {children}
    </Link>
  ),
  table: ({ children }) => (
    <Box
      role="region"
      aria-label="Tabela"
      tabIndex={0}
      sx={{
        overflowX: 'auto',
        overflowY: 'hidden',
        mb: 2,
        border: '1px solid',
        borderColor: 'border.muted',
        borderRadius: 2,
        maxWidth: '100%',
      }}
    >
      <table>{children}</table>
    </Box>
  ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled
      aria-label={checked ? 'Concluído' : 'Pendente'}
    />
  ),
}

export function MarkdownViewer({ value, sx }) {
  const content = typeof value === 'string' ? value.replace(/\r\n/g, '\n') : ''
  if (!content.trim()) return null

  return (
    <Box sx={{ ...markdownContainerSx, ...sx }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        components={COMPONENTS}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}
