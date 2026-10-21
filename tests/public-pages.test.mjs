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
  ['/profissionais', 'profissionais.html', false],
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
  for (const label of ['Seu treino, registrado com clareza.', 'Mais de 800 exercícios', 'séries', 'histórico'])
    assert.ok(html.includes(label), label)
  assert.match(html, /assets\/public-home-redirect\.js/)
  assert.match(html, /public-home-boot\.js/)
  assert.doesNotMatch(html, /<script>try/)
  assert.match(html, /<main id="content" tabindex="-1">[\s\S]*<h1>/)
  assert.doesNotMatch(html, /propaganda invasiva/)
  for (const file of [
    'como-funciona.html',
    'funcionalidades.html',
    'para-empresas.html',
    'guia-registro-treino.html',
    'vitrine.html',
    'profissionais.html',
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
  assert.match(html, /<source[^>]+sizes="\(max-width: 760px\) 100vw, \(max-width: 1240px\) 94vw, 1184px"/)
  assert.match(readFileSync('dist/sitemap.xml', 'utf8'), /<loc>https:\/\/www\.evolutus\.com\.br\/guia-registro-treino<\/loc>/)
})

test('banners oficiais substituem os mockups e carregam por prioridade', () => {
  const expected = [
    ['index.html', ['quadro-geral', 'exercicio']],
    ['como-funciona.html', ['exercicio', 'progresso']],
    ['funcionalidades.html', ['progresso', 'comunidade']],
    ['guia-registro-treino.html', ['exercicio']],
  ]
  for (const [file, banners] of expected) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.doesNotMatch(html, /product-preview|features-hero-art|feature-orbit/)
    assert.doesNotMatch(html, /capa_principal/)
    const images = [...html.matchAll(/<img[^>]+src="\/img\/banners\/([\w-]+)-1774\.webp"[^>]*>/g)]
    assert.deepEqual(images.map((match) => match[1]), banners)
    assert.equal((html.match(/fetchpriority="high"/g) || []).length, 1)
    assert.equal((html.match(/loading="lazy"/g) || []).length, banners.length - 1)
    for (const banner of banners) {
      assert.ok(readFileSync(`dist/img/banners/${banner}-960.webp`).length > 0)
      assert.ok(readFileSync(`dist/img/banners/${banner}-1774.webp`).length > 0)
    }
  }
  for (const file of ['para-empresas.html', 'vitrine.html', 'profissionais.html'])
    assert.doesNotMatch(readFileSync(`dist/${file}`, 'utf8'), /capa_principal/)
  assert.match(readFileSync('dist/funcionalidades.html', 'utf8'), /og:image" content="https:\/\/www\.evolutus\.com\.br\/img\/banners\/progresso-1774\.webp"/)
})

test('Primer é renderizado no HTML público sem carregar o shell React', () => {
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /assets\/primer-[^" ]+\.css/)
    assert.match(html, /public-redesign\.css/)
    assert.match(html, /prc-(?:Button|Link|Heading)-/)
    assert.doesNotMatch(html, /<script[^>]+src="\/assets\/(?:main|primer)-/)
  }
  const business = readFileSync('dist/para-empresas.html', 'utf8')
  for (const name of ['company', 'contact', 'email', 'segment', 'website', 'modality', 'message']) {
    const control = business.match(new RegExp(`<[^>]+name="${name}"[^>]*>`))?.[0]
    assert.ok(control, name)
    assert.match(control, /\brequired=/, name)
  }
  assert.match(business, /prc-Select-Select-/)
  assert.match(business, /prc-Textarea-TextArea-/)
  const showcase = readFileSync('dist/vitrine.html', 'utf8')
  assert.match(showcase, /id="products"[^>]*aria-busy="true"/)
  assert.match(showcase, /class="catalog-skeleton"/)
  const directory = readFileSync('dist/profissionais.html', 'utf8')
  assert.match(directory, /id="professional-filters"/)
  assert.match(readFileSync('public/public-pages.js', 'utf8'), /import\('\/public-professionals\.js'\)/)
  assert.match(directory, /name="tipo"/)
  assert.match(directory, /name="modalidade"/)
  assert.match(directory, /name="uf"/)
  assert.match(directory, /name="cidade"/)
  assert.match(directory, /name="atendimento"/)
})

test('diretório público precede o shell e detalhes legados continuam no shell noindex', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const directory = config.rewrites.findIndex((route) => route.source === '/profissionais')
  const shell = config.rewrites.findIndex((route) => route.destination === '/app-shell.html')
  assert.ok(directory >= 0 && directory < shell)
  assert.equal(config.rewrites[directory].destination, '/profissionais.html')
  const fallback = new RegExp(`^${config.rewrites[shell].source.match(/^\/:path\((.*)\)$/)[1]}$`)
  assert.equal(fallback.test('profissionais'), false)
  assert.equal(fallback.test('profissionais/11111111-1111-1111-1111-111111111111'), true)
  assert.doesNotMatch(readFileSync('dist/profissionais.html', 'utf8'), /<script[^>]+src="\/assets\/main-/)
})

test('Turbo atua apenas nas rotas HTML públicas e preserva os metadados estáticos', () => {
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /<header id="public-header"[^>]*data-turbo-permanent/)
    assert.match(html, /<meta name="view-transition" content="same-origin">/)
    assert.match(html, /<script type="module" src="\/assets\/publicTurbo-[\w-]+\.js"/)
    assert.match(html, /href="\/funcionalidades"[^>]*data-turbo="true"/)
    assert.doesNotMatch(html, /href="\/(?:login|cadastro|app|politica-de-privacidade)"[^>]*data-turbo="true"/)
  }
  assert.match(readFileSync('dist/profissionais.html', 'utf8'), /turbo-cache-control" content="no-cache"/)
})
