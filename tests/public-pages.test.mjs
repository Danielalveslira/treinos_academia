import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const origin = 'https://www.evolutus.com.br'
const routes = [
  ['/', 'index.html', true],
  ['/como-funciona', 'como-funciona.html', true],
  ['/para-empresas', 'para-empresas.html', true],
  ['/vitrine', 'vitrine.html', false],
  ['/profissionais', 'profissionais.html', false],
]

test('build entrega HTML específico e completo antes de JavaScript', () => {
  const titles = new Set()
  for (const [path, file, indexable] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /<html lang="pt-BR">/)
    assert.match(html, /<h1[^>]*>[\s\S]+?<\/h1>/)
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
  for (const label of ['Planeje, registre e acompanhe seus treinos.', 'Crie sua conta', 'séries', 'histórico'])
    assert.ok(html.includes(label), label)
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.equal((html.match(/<picture\b/g) || []).length, 1)
  assert.match(html, /href="\/public-home\.css"/)
  assert.match(html, /assets\/public-home-redirect\.js/)
  assert.match(html, /public-home-boot\.js/)
  assert.doesNotMatch(html, /<script>try/)
  assert.match(html, /<main id="content" tabindex="-1">[\s\S]*<h1[^>]*>/)
  assert.doesNotMatch(html, /propaganda invasiva/)
  for (const file of [
    'como-funciona.html',
    'para-empresas.html',
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

test('footer público compacto usa Primer e links existentes', () => {
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    const footer = html.match(/<footer[^>]*class="[^"]*site-footer[^"]*"[^>]*>[\s\S]*?<\/footer>/)?.[0]
    assert.ok(footer, file)
    assert.match(footer, /Box-sc-/)
    assert.match(footer, /aria-label="Links do rodapé"/)
    assert.match(footer, /class="footer-link prc-Link-/)
    for (const path of ['/como-funciona', '/para-empresas', '/atendimento', '/termos-de-uso', '/politica-de-privacidade'])
      assert.ok(footer.includes(`href="${path}"`), `${file}: ${path}`)
    assert.doesNotMatch(footer, /\/funcionalidades|\/guia-registro-treino/)
  }
})

test('header público concentra ações e menu em componentes Primer', () => {
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /<header id="public-header" data-turbo-permanent>/)
    assert.match(html, /class="brand-mark-arrow"/)
    assert.match(html, /class="brand-mark-letter"/)
    assert.match(html, /assets\/publicHeaderMenu-[\w-]+\.js/)
    assert.match(html, /assets\/publicHeaderMenu-[\w-]+\.css/)
    const linkedCss = [...html.matchAll(/href="(\/assets\/[^"]+\.css)"/g)]
      .map(([, file]) => readFileSync(`dist${file}`, 'utf8')).join('\n')
    assert.match(linkedCss, /data-color-mode=dark/)
    assert.match(linkedCss, /data-dark-theme=dark/)
    assert.doesNotMatch(html, /class="public-header-nav"/)
    assert.match(html, /id="public-theme-root" class="public-theme-root"><button data-component="IconButton"[^>]*aria-label="Alternar tema"/)
    assert.match(html, /class="[^"]*public-header-signup[^"]*"[^>]*data-variant="primary"/)
    assert.match(html, /id="public-header-menu-root" class="public-header-menu-root"><button data-component="IconButton"[^>]*aria-label="Menu de navegação"/)
    assert.equal((html.match(/id="public-theme-root"/g) || []).length, 1)
    assert.equal((html.match(/id="public-header-menu-root"/g) || []).length, 1)
    assert.doesNotMatch(html, /public-header-fallback|<summary/)
    for (const href of ['/', '/login', '/cadastro'])
      assert.match(html, new RegExp(`href="${href}"`))
    assert.doesNotMatch(html, /public-menu-trigger|public-menu-panel|\/funcionalidades|\/guia-registro-treino/)
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

test('variantes públicas redirecionam para URL limpa e como-funciona entra no sitemap', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const redirectSources = config.redirects.map(({ source }) => source)
  assert.ok(redirectSources.some((source) => source.endsWith('.html')))
  assert.ok(redirectSources.some((source) => source.endsWith('/')))
  assert.ok(config.rewrites.some((route) => route.source === '/como-funciona'))
  const html = readFileSync('dist/como-funciona.html', 'utf8')
  assert.match(html, /<h1[^>]*>Como funciona<\/h1>/)
  assert.match(readFileSync('dist/sitemap.xml', 'utf8'), /<loc>https:\/\/www\.evolutus\.com\.br\/como-funciona<\/loc>/)
})

test('home usa uma imagem oficial otimizada', () => {
  const expected = [
    ['index.html', ['quadro-geral']],
  ]
  for (const [file, banners] of expected) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.doesNotMatch(html, /product-preview|features-hero-art|feature-orbit/)
    assert.doesNotMatch(html, /capa_principal/)
    const images = [...html.matchAll(/<img[^>]+src="\/img\/banners\/([\w-]+)-960\.webp"[^>]*>/g)]
    assert.deepEqual(images.map((match) => match[1]), banners)
    assert.equal((html.match(/fetchpriority="high"/g) || []).length, 1)
    assert.equal((html.match(/loading="eager"/g) || []).length, 1)
    for (const banner of banners) {
      assert.ok(readFileSync(`dist/img/banners/${banner}-960.webp`).length > 0)
      assert.ok(readFileSync(`dist/img/banners/${banner}-1774.webp`).length > 0)
    }
  }
  for (const file of ['como-funciona.html', 'para-empresas.html', 'vitrine.html', 'profissionais.html'])
    assert.doesNotMatch(readFileSync(`dist/${file}`, 'utf8'), /capa_principal|official-banner/)
  assert.match(readFileSync('dist/como-funciona.html', 'utf8'), /og:image" content="https:\/\/www\.evolutus\.com\.br\/img\/banners\/quadro-geral-1774\.webp"/)
})

test('Primer é renderizado no HTML público sem carregar o shell React', () => {
  for (const [, file] of routes) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, /assets\/primer-[^" ]+\.css/)
    assert.match(html, /public-redesign\.css/)
    assert.match(html, /prc-(?:Button|Link|Heading)-/)
    assert.doesNotMatch(html, /<script[^>]+src="\/assets\/(?:main|primer)-/)
  }
})

test('rotas em reconstrução têm esqueleto mínimo, sem UI legada', () => {
  for (const [file, label] of [
    ['como-funciona.html', 'Como funciona'],
    ['para-empresas.html', 'Para empresas'],
    ['profissionais.html', 'Profissionais'],
  ]) {
    const html = readFileSync(`dist/${file}`, 'utf8')
    assert.match(html, new RegExp(`<h1[^>]*>${label}</h1>`))
    assert.equal((html.match(/<h1/g) || []).length, 1)
    assert.match(html, /<main id="content" tabindex="-1"><section class="Box-[^"]+"><h1 class="prc-Heading-[^"]+">[^<]+<\/h1><\/section><\/main>/)
    assert.doesNotMatch(html, /commercial-form|catalog-filters|professional-filters|product-preview-root|profile-preview-root|directory-grid|products-list|journey-row|faq-section/)
  }
  assert.ok(!existsSync('public/public-products.js'))
  assert.ok(!existsSync('public/public-professionals.js'))
  assert.ok(!existsSync('dist/public-config.js'))
  for (const css of ['public-pages.css', 'public-redesign.css', 'public-foundation.css']) {
    assert.doesNotMatch(readFileSync(`dist/${css}`, 'utf8'), /\.journey-|\.faq-|\.commercial-|\.lead-form|\.catalog-|\.directory-|\.product-/)
  }
})

test('Vitrine reconstruída: cabeçalho compacto real e ilha do catálogo sob demanda', () => {
  const html = readFileSync('dist/vitrine.html', 'utf8')
  assert.match(html, /<h1[^>]*>Vitrine<\/h1>/)
  assert.equal((html.match(/<h1/g) || []).length, 1)
  assert.match(html, /Produtos de marcas parceiras, em um só lugar\./)
  assert.match(html, /<section class="[^"]*\bvitrine-head\b[^"]*">/)
  assert.match(html, /<section class="vitrine-catalog" aria-label="Catálogo de produtos de marcas parceiras">/)
  assert.match(html, /<div id="vitrine-root">/)
  assert.match(html, /Carregando produtos…/)
  assert.match(html, /href="\/public-products\.css"/)
  // Nenhuma UI legada ressuscitada e nenhum entry point novo: o catálogo chega via
  // import() dinâmico dentro do bundle Turbo já existente (ver src/publicTurbo.js).
  assert.doesNotMatch(html, /catalog-filters|product-card-template|product-dialog|EVOLUTUS_PUBLIC_CONFIG|<dialog\b/)
  assert.doesNotMatch(html, /<script[^>]+src="\/assets\/(?:mountPublicProducts|ProductDialog)-/)
  assert.doesNotMatch(readFileSync('dist/public-products.css', 'utf8'), /\.catalog-|\.product-|\.directory-|!important/)
})

test('rotas excluídas não são geradas, anunciadas nem reescritas', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const sitemap = readFileSync('dist/sitemap.xml', 'utf8')
  for (const path of ['/funcionalidades', '/guia-registro-treino']) {
    assert.ok(!existsSync(`dist/${path.slice(1)}.html`))
    assert.ok(!config.rewrites.some(({ source }) => source === path))
    assert.ok(!sitemap.includes(path))
    for (const [, file] of routes)
      assert.ok(!readFileSync(`dist/${file}`, 'utf8').includes(`href="${path}"`))
  }
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
    assert.match(html, /href="\/como-funciona"[^>]*data-turbo="true"/)
    assert.doesNotMatch(html, /href="\/(?:login|cadastro|app|politica-de-privacidade)"[^>]*data-turbo="true"/)
  }
})

 test('Home V2 renders truthful catalogue fallback and four real features without app hydration', () => {
  const html = readFileSync('dist/index.html', 'utf8')
  assert.ok(html.indexOf('home-hero') < html.indexOf('home-catalog'))
  assert.ok(html.indexOf('home-catalog') < html.indexOf('home-steps'))
  for (const text of ['Catálogo Evolutus','Exercícios para sua rotina','Fichas de treino','Catálogo oficial','Sua evolução','Comunidades','Organize suas fichas']) assert.ok(html.includes(text), text)
  assert.match(html, /data-catalog-count/)
  assert.match(html, /src="\/public-catalog-count.js"/)
  assert.doesNotMatch(html, /[0-9]+ exercícios publicados|exercise_catalog|service_role/)
 })
