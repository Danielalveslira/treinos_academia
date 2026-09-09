import { Box, Link } from '@primer/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

// O schema padrão do rehype-sanitize remove `checked` de <input> — sem isso, checklists
// do GFM ("- [x] tarefa") sempre apareceriam desmarcadas.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [...(defaultSchema.attributes.input ?? []), 'type', 'checked', 'disabled'],
  },
}

const COMPONENTS = {
  a: (props) => <Link {...props} target="_blank" rel="noreferrer noopener" />,
  p: (props) => <Box as="p" {...props} sx={{ m: 0, mb: 2, '&:last-child': { mb: 0 } }} />,
  ul: (props) => <Box as="ul" {...props} sx={{ m: 0, mb: 2, pl: 4 }} />,
  ol: (props) => <Box as="ol" {...props} sx={{ m: 0, mb: 2, pl: 4 }} />,
  li: (props) => <Box as="li" {...props} sx={{ mb: 1 }} />,
  blockquote: (props) => (
    <Box
      as="blockquote"
      {...props}
      sx={{
        m: 0,
        mb: 2,
        pl: 3,
        borderLeft: '3px solid',
        borderColor: 'border.default',
        color: 'fg.muted',
      }}
    />
  ),
  code: ({ children, className }) =>
    className ? (
      <Box
        as="code"
        className={className}
        sx={{ display: 'block', overflowX: 'auto', fontFamily: 'mono', fontSize: 0 }}
      >
        {children}
      </Box>
    ) : (
      <Box
        as="code"
        sx={{
          fontFamily: 'mono',
          fontSize: 0,
          bg: 'neutral.muted',
          borderRadius: 1,
          px: 1,
        }}
      >
        {children}
      </Box>
    ),
  pre: (props) => (
    <Box
      as="pre"
      {...props}
      sx={{ m: 0, mb: 2, p: 2, bg: 'canvas.subtle', borderRadius: 2, overflowX: 'auto' }}
    />
  ),
  table: (props) => (
    <Box sx={{ overflowX: 'auto', mb: 2 }}>
      <Box as="table" {...props} sx={{ borderCollapse: 'collapse', width: '100%', fontSize: 1 }} />
    </Box>
  ),
  th: (props) => (
    <Box
      as="th"
      {...props}
      sx={{ textAlign: 'left', borderBottom: '1px solid', borderColor: 'border.default', p: 2 }}
    />
  ),
  td: (props) => (
    <Box as="td" {...props} sx={{ borderBottom: '1px solid', borderColor: 'border.muted', p: 2 }} />
  ),
  hr: () => (
    <Box as="hr" sx={{ border: 0, borderTop: '1px solid', borderColor: 'border.default', my: 3 }} />
  ),
}

// Renderiza Markdown salvo como HTML seguro: nunca interpreta HTML cru do conteúdo do
// usuário, só o que sobrevive a remark-gfm + rehype-sanitize.
export function MarkdownViewer({ value, sx }) {
  const content = String(value ?? '').replace(/\r\n/g, '\n')
  if (!content.trim()) return null

  return (
    <Box sx={{ fontSize: 1, lineHeight: 1.6, overflowWrap: 'anywhere', ...sx }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}
