import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const origin = 'https://www.evolutus.com.br'
const routes = [
  ['/', 'index.html', true],
  ['/como-funciona', 'como-funciona.html', true],
  ['/funcionalidades', 'funcionalidades.html', true],
  ['/para-empresas', 'para-empresas.html', true],
  ['/guia-registro-treino', 'guia-registro-treino.html', true],
  ['/vitrine', 'vitrine.html', false],
]

test('build entrega HTML específico e completo antes de JavaScript', () => {
  const titles = new Set()
  for (const [path, file, indexable] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /<html lang="pt-BR">/)
    assert.match(html, /<h1>[\s\S]+?<\/h1>/)
    assert.match(html, /<meta name="description" content="[^"]+">/)
    assert.match(html, /<meta property="og:title" content="[^"]+">/)
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="${origin.replaceAll('.', '\\.')}\\${path}">`)
    )
    assert.match(
      html,
      new RegExp(`<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,follow'}">`)
    )
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1]
    assert.ok(title)
    assert.ok(!titles.has(title))
    titles.add(title)
    const schema = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1]
    assert.equal(JSON.parse(schema)['@type'], path === '/' ? 'WebSite' : 'WebPage')
  }
})

test('sitemap só inclui páginas indexáveis e o shell do app declara noindex', () => {
  const sitemap = readFileSync('dist/sitemap.xml', 'utf8')
  for (const [path, , indexable] of routes) {
    assert.equal(sitemap.includes(`<loc>${origin}${path}</loc>`), indexable)
  }
  for (const path of ['/app', '/login', '/admin/parcerias'])
    assert.ok(!sitemap.includes(`<loc>${origin}${path}</loc>`))
  assert.match(
    readFileSync('dist/app-shell.html', 'utf8'),
    /<meta name="robots" content="noindex,follow"/
  )
  assert.match(
    readFileSync('dist/robots.txt', 'utf8'),
    new RegExp(`Sitemap: ${origin.replaceAll('.', '\\.')}\/sitemap.xml`)
  )
})

test('homepage mantém conteúdo indexável e encaminha apenas a rota raiz', () => {
  const html = readFileSync('dist/index.html', 'utf8')
  for (const label of ['Saiba o que treinou.', 'Mais de 800 exercícios', 'Séries', 'Histórico'])
    assert.ok(html.includes(label), label)
  assert.match(html, /assets\/public-home-redirect\.js/)
  assert.match(html, /public-home-boot\.js/)
  assert.doesNotMatch(html, /<script>try/)
  assert.match(html, /<main id="content">[\s\S]*<h1>/)
  assert.doesNotMatch(html, /propaganda invasiva/)
  for (const file of [
    'como-funciona.html',
    'funcionalidades.html',
    'para-empresas.html',
    'guia-registro-treino.html',
    'vitrine.html',
  ])
    assert.doesNotMatch(readFileSync(`dist/${file}`, 'utf8'), /public-home-redirect\.js/)
})

test('marca pública usa Evolutus no header e rodapé sem alterar o domínio canônico', () => {
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /aria-label="Evolutus, página inicial"/)
    assert.equal((html.match(/<span>Evolutus<\/span>/g) || []).length, 2)
    assert.doesNotMatch(html, /Evolutus\.com|brand-dot/)
    assert.match(html, /https:\/\/www\.evolutus\.com\.br/)
  }
})

test('links internos e âncoras das cinco páginas têm destino', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const fallback = config.rewrites.find((route) => route.destination === '/app-shell.html')
  const appRoute = new RegExp(`^${fallback.source.match(/^\/:path\((.*)\)$/)[1]}$`)
  const publicPaths = new Set(routes.map(([path]) => path))
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]))
    for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      if (href.startsWith('#')) assert.ok(ids.has(href.slice(1)), `${file}: ${href}`)
      else if (href.startsWith('/'))
        assert.ok(publicPaths.has(href) || appRoute.test(href.slice(1)), `${file}: ${href}`)
    }
  }
})

test('rotas internas fazem fallback ao shell, URLs públicas desconhecidas não', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const fallback = config.rewrites.find((route) => route.destination === '/app-shell.html')
  assert.ok(fallback)
  const match = fallback.source.match(/^\/:path\((.*)\)$/)
  assert.ok(match)
  const regex = new RegExp(`^${match[1]}$`)
  assert.ok(regex.test('app'))
  assert.ok(regex.test('comunidades/abc'))
  assert.ok(!regex.test('nao-existe'))
  assert.ok(!regex.test('vitrine/produto-removido'))
})

test('variantes públicas redirecionam para URL limpa e o guia entra no sitemap', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const redirectSources = config.redirects.map(({ source }) => source)
  assert.ok(redirectSources.some((source) => source.endsWith('.html')))
  assert.ok(redirectSources.some((source) => source.endsWith('/')))
  assert.ok(config.rewrites.some((route) => route.source === '/guia-registro-treino'))
  const html = readFileSync('dist/guia-registro-treino.html', 'utf8')
  assert.match(html, /<h1>Como registrar séries, repetições e cargas<\/h1>/)
  assert.match(html, /<source[^>]+sizes="\(max-width: 760px\) 100vw, 45vw"/)
  assert.match(readFileSync('dist/sitemap.xml', 'utf8'), /<loc>https:\/\/www\.evolutus\.com\.br\/guia-registro-treino<\/loc>/)
})
