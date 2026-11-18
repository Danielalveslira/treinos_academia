import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Conteúdo do usuário (publicações, conquistas, resumo em comentários) passa por MarkdownViewer. Estes testes
// renderizam ataques conhecidos pelo componente REAL (react-markdown + remark-gfm + rehype-sanitize) e
// conferem o HTML final: sem script, sem manipuladores de evento, sem URL perigosa, sem carregar recurso externo.
let directory
let renderAsync

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markdown-security-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToPipeableStream } from 'react-dom/server'
        import { Writable } from 'node:stream'
        import { StatusText } from './StatusText.jsx'
        import { MarkdownViewer } from './MarkdownViewer.jsx'
        const run = (element) => new Promise((resolve, reject) => {
          const chunks = []
          const { pipe } = renderToPipeableStream(element, {
            onAllReady() { pipe(new Writable({ write(c, _e, d) { chunks.push(c); d() }, final(d) { resolve(Buffer.concat(chunks).toString()); d() } })) },
            onError: reject,
          })
        })
        export const renderAsync = (value, viaStatusText = false, profile = undefined) =>
          run(createElement(viaStatusText ? StatusText : MarkdownViewer, { value, profile }))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  ;({ renderAsync } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const ATTACKS = {
  script: '<script>alert(1)</script>',
  imgOnerror: '<img src=x onerror=alert(1)>',
  jsLink: '[x](javascript:alert(1))',
  jsLinkMixedCase: '[x](JaVaScRiPt:alert(1))',
  jsLinkSpaces: '[x](   javascript:alert(1))',
  jsLinkEntity: '[x](&#106;avascript:alert(1))',
  jsLinkTab: '[x](java\tscript:alert(1))',
  dataLink: '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  vbscript: '[x](vbscript:msgbox(1))',
  fileLink: '[x](file:///etc/passwd)',
  jsImage: '![x](javascript:alert(1))',
  anchorHtml: '<a href="javascript:alert(1)">x</a>',
  iframe: '<iframe src="https://evil.example"></iframe>',
  svg: '<svg onload=alert(1)></svg>',
  style: '<style>body{display:none}</style>',
  inlineStyle: '<div style="position:fixed;inset:0">x</div>',
  details: '<details open ontoggle=alert(1)>x</details>',
  form: '<form action="https://evil.example"><input name=p></form>',
  meta: '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  base: '<base href="https://evil.example/">',
  autolinkJs: '<javascript:alert(1)>',
  referenceLink: '[x][1]\n\n[1]: javascript:alert(1)',
  tableHtml: '| A |\n| - |\n| <img src=x onerror=alert(1)> |',
  idClobber: '<a id="x" name="y">x</a>',
  mixed:
    '**ok** <script>alert(1)</script> [ok](https://evolutus.app) <b onmouseover=alert(1)>x</b>',
}

for (const viaStatusText of [false, true]) {
  for (const [name, source] of Object.entries(ATTACKS)) {
    test(`${viaStatusText ? 'StatusText' : 'MarkdownViewer'}: ${name} não executa nada nem carrega recurso externo`, async () => {
      const html = await renderAsync(source.padEnd(viaStatusText ? 1600 : 0, ' '), viaStatusText)
      assert.doesNotMatch(
        html,
        /<script|<iframe|<svg|<style|<form|<meta|<base|<object|<embed|<link/i
      )
      assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'nenhum manipulador de evento')
      assert.doesNotMatch(html, /\sstyle\s*=/i, 'nenhum style inline vindo do usuário')
      assert.doesNotMatch(
        html,
        /(?:href|src|action|formaction|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data|file):/i
      )
      assert.doesNotMatch(html, /<img\b/i, 'imagem de origem externa nunca é carregada')
    })
  }
}

test('links seguros continuam funcionando e abrem sem vazar o referrer', async () => {
  const html = await renderAsync('[site](https://evolutus.app) e [mail](mailto:oi@evolutus.app)')
  assert.match(
    html,
    /<a [^>]*href="https:\/\/evolutus\.app"[^>]*target="_blank"[^>]*rel="noreferrer noopener"/
  )
  assert.match(html, /href="mailto:oi@evolutus\.app"/)
})

test('protocolos incomuns (irc, xmpp) também não viram link', async () => {
  const html = await renderAsync('[a](irc://x/y) [b](xmpp:alguem@x.org)')
  assert.doesNotMatch(html, /href="(irc|ircs|xmpp):/i)
})

test('imagem em markdown vira texto inerte (o alt), sem requisição externa', async () => {
  const html = await renderAsync('![foto do treino](https://evil.example/pixel.png)')
  assert.doesNotMatch(html, /<img|evil\.example/)
  assert.match(html, /foto do treino/)
})

test('ids e nomes vindos do usuário não conseguem sobrescrever objetos globais (clobbering)', async () => {
  const html = await renderAsync('texto[^1]\n\n[^1]: nota')
  assert.doesNotMatch(html, /\bid="(?!user-content-)/)
})

// Perfil `ads` (seção 5 do prompt de reestruturação): nenhum link sobrevive -- nem
// markdown explícito, nem autolink do GFM, nem link de referência -- e nenhuma tabela ou
// imagem aparece. Só o CTA oficial do anúncio pode navegar.
const ADS_LINK_SOURCES = {
  explicitLink: '[clique aqui](https://evolutus.app)',
  autolink: 'veja https://evolutus.app agora',
  referenceLink: '[clique aqui][1]\n\n[1]: https://evolutus.app',
  pastedHtmlLink: '<a href="https://evolutus.app">clique aqui</a>',
}

for (const [name, source] of Object.entries(ADS_LINK_SOURCES)) {
  test(`MarkdownViewer (perfil ads): ${name} nunca é clicável, só sobra o texto`, async () => {
    const html = await renderAsync(source, false, 'ads')
    assert.doesNotMatch(html, /<a\b/i, 'nenhuma tag de link sobrevive no perfil de publicidade')
    assert.match(html, /evolutus\.app|clique aqui/)
  })
}

test('MarkdownViewer (perfil ads): imagem em markdown não aparece, nem como texto', async () => {
  const html = await renderAsync('![foto do treino](https://evil.example/pixel.png)', false, 'ads')
  assert.doesNotMatch(html, /<img|evil\.example|foto do treino/)
})

test('MarkdownViewer (perfil ads): tabela colapsa para texto simples, sem estrutura de tabela', async () => {
  const html = await renderAsync('| A | B |\n| - | - |\n| 1 | 2 |', false, 'ads')
  assert.doesNotMatch(html, /<table|<tr|<td|<th/i)
})

test('MarkdownViewer (perfil ads): negrito, itálico, título, lista e citação continuam permitidos', async () => {
  const html = await renderAsync('# Título\n\n**forte** e _itálico_\n\n- item\n\n> citação', false, 'ads')
  assert.match(html, /<h1[^>]*>Título<\/h1>/)
  assert.match(html, /<strong>forte<\/strong>/)
  assert.match(html, /<em>itálico<\/em>/)
  assert.match(html, /<li>item<\/li>/)
  assert.match(html, /<blockquote>/)
})

for (const [name, source] of Object.entries(ATTACKS)) {
  test(`MarkdownViewer (perfil ads): ${name} também não executa nada nem carrega recurso externo`, async () => {
    const html = await renderAsync(source, false, 'ads')
    assert.doesNotMatch(
      html,
      /<script|<iframe|<svg|<style|<form|<meta|<base|<object|<embed|<link/i
    )
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'nenhum manipulador de evento')
    assert.doesNotMatch(html, /\sstyle\s*=/i, 'nenhum style inline vindo do usuário')
    assert.doesNotMatch(
      html,
      /(?:href|src|action|formaction|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data|file):/i
    )
    assert.doesNotMatch(html, /<a\b|<img\b/i, 'perfil ads não tem link nem imagem algum')
  })
}
