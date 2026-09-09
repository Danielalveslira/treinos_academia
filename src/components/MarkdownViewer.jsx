import { Box, Link } from '@primer/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

const COMPONENTS = {
  a: ({ href, title, children }) => (
    <Link href={href} title={title} target="_blank" rel="noreferrer noopener">
      {children}
    </Link>
  ),
  table: ({ children }) => (
    <Box role="region" aria-label="Tabela" tabIndex={0} sx={{ overflowX: 'auto', mb: 2 }}>
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
    <Box
      sx={{
        minWidth: 0,
        fontSize: 1,
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
        '& p': { m: 0, mb: 2, whiteSpace: 'pre-wrap', '&:last-child': { mb: 0 } },
        '& ul, & ol': { m: 0, mb: 2, pl: 4 },
        '& li': { mb: 1 },
        '& blockquote': {
          m: 0,
          mb: 2,
          pl: 3,
          borderLeft: '3px solid',
          borderColor: 'border.default',
          color: 'fg.muted',
        },
        '& code': { fontFamily: 'mono', fontSize: 0, bg: 'neutral.muted', borderRadius: 1, px: 1 },
        '& pre': { m: 0, mb: 2, p: 2, bg: 'canvas.subtle', borderRadius: 2, overflowX: 'auto' },
        '& pre code': { bg: 'transparent', p: 0, whiteSpace: 'pre', overflowWrap: 'normal' },
        '& table': { borderCollapse: 'collapse', width: '100%', fontSize: 1 },
        '& th, & td': {
          textAlign: 'left',
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          p: 2,
        },
        '& th': { borderColor: 'border.default' },
        '& hr': { border: 0, borderTop: '1px solid', borderColor: 'border.default', my: 3 },
        '& img': { maxWidth: '100%', height: 'auto' },
        ...sx,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={COMPONENTS}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}
