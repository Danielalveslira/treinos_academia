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

// Perfil de publicidade (seção 5 do prompt de reestruturação): só o CTA oficial do
// anúncio pode navegar e registrar clique, então nenhum link sobrevive aqui -- nem
// markdown explícito, nem autolink do GFM, nem link de referência. Allowlist própria,
// não derivada de defaultSchema, para nunca herdar `a`/`img`/`table` por acidente numa
// atualização futura do rehype-sanitize. Qualquer tag fora desta lista é removida pelo
// sanitizador mantendo só o texto (hast-util-sanitize "unwrap"), nunca o atributo
// (href/src) -- é assim que um link markdown sobra como texto simples não clicável e uma
// imagem (sem filhos, só atributos) desaparece por completo, sem precisar de componente
// próprio para cada tag.
const ADS_SANITIZE_SCHEMA = {
  tagNames: [
    'p',
    'strong',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'br',
  ],
  attributes: {},
  protocols: {},
}

const SANITIZE_SCHEMAS = { default: SANITIZE_SCHEMA, ads: ADS_SANITIZE_SCHEMA }

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

export function MarkdownViewer({ value, sx, profile = 'default' }) {
  const content = typeof value === 'string' ? value.replace(/\r\n/g, '\n') : ''
  if (!content.trim()) return null
  const schema = SANITIZE_SCHEMAS[profile] || SANITIZE_SCHEMAS.default
  // No perfil `ads`, a/img/table já saem da árvore pelo próprio schema (ver acima); os
  // componentes de a/img/table do perfil padrão nunca chegam a ser chamados para esse
  // conteúdo, então não precisam de uma variante própria.
  const components = profile === 'ads' ? undefined : COMPONENTS

  return (
    <Box sx={{ ...markdownContainerSx, ...sx }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={components}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}
