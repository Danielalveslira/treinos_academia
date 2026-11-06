import { readFileSync } from 'node:fs'
import { resolveManifestEntry } from './build-manifest-assets.mjs'
import React from 'react'
import { BookIcon, ChecklistIcon, GraphIcon, PeopleIcon } from '@primer/octicons-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrandMark } from '../src/components/BrandMark.js'
import {
  primerBox,
  primerHeaderLink,
  primerHeading,
  primerLabel,
  primerLink,
  primerMenuTrigger,
  primerPrimaryLink,
  primerStyles,
  primerText,
  primerThemeTrigger,
} from './public-primer.mjs'
import { DISCOVERY_PUBLIC_LINKS, LEGAL_PUBLIC_LINKS } from './public-navigation.mjs'
import { howItWorksBody } from './public-how-it-works.mjs'
import { forBusinessBody } from './public-for-business.mjs'
import { supplierInfoBody } from './public-supplier-info.mjs'

// Production currently redirects apex to www (measured 2026-10-19).
const origin = 'https://www.evolutus.com.br'

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  )
const link = primerLink
const discoveryLinks = DISCOVERY_PUBLIC_LINKS
const publicPaths = new Set([
  '/',
  '/locais',
  '/demo',
  '/demo-preview',
  '/informacoes-do-fornecedor',
  ...discoveryLinks.map(([href]) => href),
])
const enableTurboLinks = (html) =>
  html.replace(/<a\b([^>]*\bhref="([^"]+)"[^>]*)>/g, (match, attributes, href) =>
    publicPaths.has(href) ? `<a${attributes} data-turbo="true">` : match
  )
const brandMark = renderToStaticMarkup(React.createElement(BrandMark, { size: 28 }))
// Ações de convidado (Entrar/Criar conta) e a ação de quem já está autenticado (Ir para o
// app) convivem sempre no HTML -- quem decide qual mostrar é o CSS, a partir do atributo
// data-public-auth em <html> (ver public-header.css e src/publicHeaderAuth.js). Por padrão
// (sem o script, ou pra crawlers/sem JS) o visitante é o estado exibido, igual já era.
const headerGuestActions = `<span class="public-header-guest-actions">${primerHeaderLink('/login', 'Entrar', 'invisible', 'public-header-account public-header-login')}${primerHeaderLink('/cadastro', 'Criar conta', 'primary', 'public-header-account public-header-signup')}</span>`
const headerAppAction = primerHeaderLink(
  '/app',
  'Ir para o app',
  'primary',
  'public-header-account public-header-app-link'
)
const nav = `<header id="public-header" data-turbo-permanent><div class="public-header-inner"><a class="public-header-brand" href="/" aria-label="Evolutus, página inicial"><span class="public-header-brand-mark">${brandMark}</span><span>Evolutus</span></a><div class="public-header-actions"><div id="public-theme-root" class="public-theme-root">${primerThemeTrigger()}</div>${headerGuestActions}${headerAppAction}<div id="public-header-menu-root" class="public-header-menu-root">${primerMenuTrigger()}</div></div></div></header>`
const footer = primerBox(
  'footer',
  'site-footer',
  `<div class="footer-inner"><a class="footer-brand" href="/" aria-label="Evolutus, página inicial"><span class="footer-brand-mark" aria-hidden="true">${brandMark}</span><span>Evolutus</span></a><nav aria-label="Links do rodapé">${[['/como-funciona', 'Como funciona'], ['/para-empresas', 'Para empresas'], ['/atendimento', 'Atendimento'], ['/informacoes-do-fornecedor', 'Informações do fornecedor'], ...LEGAL_PUBLIC_LINKS].map(([href, label]) => link(href, label, 'footer-link')).join('')}</nav><small class="footer-copyright">© Evolutus</small></div>`
)
const homeStep = (number, title, body) =>
  primerBox(
    'li',
    'home-step',
    `${primerLabel(number, 'home-step-number')}${primerHeading('h3', '', title)}${primerText('p', '', body)}`
  )
const homeIcon = (Icon) =>
  renderToStaticMarkup(React.createElement(Icon, { size: 24, 'aria-hidden': true }))
const homeFeature = (Icon, title, body) =>
  primerBox(
    'li',
    'home-feature',
    `${homeIcon(Icon)}${primerHeading('h3', '', title)}${primerText('p', '', body)}`
  )
const homeCatalog = primerBox(
  'section',
  'home-section home-catalog',
  `<div class="home-catalog-heading">${homeIcon(BookIcon)}${primerHeading('h2', '', 'Catálogo Evolutus')}</div><p class="home-catalog-count" data-catalog-count>Exercícios para sua rotina</p>${primerText('p', 'home-catalog-description', 'Uma biblioteca de exercícios em constante expansão.')}<div class="home-catalog-footer">${primerText('p', '', 'Explore por grupo muscular e equipamento.')}${link('/cadastro', 'Crie sua conta para explorar')}</div>`
)
const homePicture = `<picture class="home-image"><source srcset="/img/banners/quadro-geral-960.webp 960w, /img/banners/quadro-geral-1774.webp 1774w" sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1199px) 45vw, 580px" type="image/webp"><img src="/img/banners/quadro-geral-960.webp" alt="Tela do Evolutus com resumo de treinos, indicadores e comunidades" width="1774" height="887" loading="eager" fetchpriority="high" decoding="async"></picture>`

// Esqueleto mínimo: só título da rota, em Primer puro, sem UI própria. Aguardando
// reconstrução (ver PROMPT_LIMPEZA_ROTAS_PUBLICAS_PRIMER_EVOLUTUS.md).
const skeleton = (label) =>
  primerBox('section', '', primerHeading('h1', '', label), { sx: { px: 4, py: 5 } })

// Cabeçalho compacto da Vitrine e o contêiner da ilha React do catálogo (ver
// src/features/publicProducts/). O catálogo em si não tem SSR/prerender: a RPC pública é
// lida em tempo real pelo cliente, então o HTML inicial mostra só o estado de carregamento.
const vitrineHead = primerBox(
  'section',
  'vitrine-head',
  `${primerHeading('h1', '', 'Vitrine')}${primerText('p', '', 'Produtos de vitrines aprovadas, em um só lugar.')}`
)
const vitrineLoading = primerBox('p', '', 'Carregando produtos…', {
  sx: { color: 'fg.muted', fontSize: 1, py: 5, textAlign: 'center' },
})
const vitrineBody = `${vitrineHead}${primerLink('/vitrine/gerenciar', 'Gerenciar minhas vitrines')}<section class="vitrine-catalog" aria-label="Catálogo de produtos de marcas parceiras"><div id="vitrine-root">${vitrineLoading}</div></section>`
const demoBody = `<div id="demo-root"><div class="demo-page"><div class="demo-layout">
  <aside class="demo-aside demo-static-aside"><span class="demo-eyebrow">EXPERIMENTE NA PRÁTICA</span><h1>Experimente registrar um treino</h1><p>Toque em <strong>Concluir série</strong> na tela ao lado e acompanhe seu progresso. Sem cadastro.</p><ul><li>Registre cargas e repetições</li><li>Veja sugestões e o resumo do treino</li></ul></aside>
  <div class="demo-phone"><div class="demo-screen"><div class="demo-intro"><h1>Experimente registrar um treino</h1><p>Marque uma série, acompanhe suas cargas e veja como fica seu histórico. Sem cadastro.</p></div><p class="demo-badge">Demonstração · dados fictícios · nada é salvo</p><header class="demo-session-header"><div class="demo-session-top"><span class="demo-session-icon">✓</span><span>FICHA DE EXEMPLO</span></div><h2>Treino A — Peito e Tríceps</h2><p class="demo-sheet-goal">Objetivo: peito e tríceps · 3 séries por exercício (ajustável)</p><div class="demo-progress-copy"><strong>0 de 12 séries concluídas</strong><span>0%</span></div><progress max="12" value="0" aria-label="Progresso da ficha de exemplo"></progress></header><p class="demo-context-note">Você não precisa lembrar a carga anterior: veja a sugestão e toque em <strong>Concluir série</strong> para experimentar.</p><div class="demo-exercise-list"><section class="demo-exercise"><div class="demo-exercise-toggle"><span class="demo-exercise-number">1</span><span class="demo-exercise-heading"><strong>Supino reto com barra</strong><small>Peito · 0/3 séries</small></span></div><div class="demo-static-card" role="status"><span>Preparando demonstração interativa…</span><a href="/cadastro">Criar conta e registrar meus treinos</a></div></section><section class="demo-exercise"><div class="demo-exercise-toggle"><span class="demo-exercise-number">2</span><span class="demo-exercise-heading"><strong>Supino inclinado com halteres</strong><small>Peito · 0/3 séries</small></span></div></section><section class="demo-exercise"><div class="demo-exercise-toggle"><span class="demo-exercise-number">3</span><span class="demo-exercise-heading"><strong>Crucifixo na máquina</strong><small>Peito · 0/3 séries</small></span></div></section><section class="demo-exercise"><div class="demo-exercise-toggle"><span class="demo-exercise-number">4</span><span class="demo-exercise-heading"><strong>Tríceps na polia</strong><small>Tríceps · 0/3 séries</small></span></div></section></div></div></div>
</div></div></div>`

export const publicPages = [
  {
    path: '/',
    file: 'index.html',
    title: 'Evolutus | Organize seus Treinos e Evolua com Clareza',
    description:
      'Planeje treinos, registre séries, repetições e cargas e consulte histórico e indicadores no Evolutus.',
    body: `${primerBox('section', 'home-hero', `<div class="home-hero-copy">${primerLabel('Seu espaço de treino', 'home-kicker')}${primerHeading('h1', '', 'Planeje, registre e acompanhe seus treinos.')}${primerText('p', 'home-lead', 'Organize sua rotina, anote cada sessão e veja sua evolução em um só lugar.')}<div class="home-hero-actions">${primerPrimaryLink('/cadastro', 'Criar conta', 'home-primary')}${link('/demo', 'Experimente agora', 'home-secondary')}${link('/como-funciona', 'Como funciona', 'home-secondary')}</div></div>${homePicture}`)}
      ${homeCatalog}
      ${primerBox('section', 'home-section home-steps', `${primerHeading('h2', '', 'Comece em três passos')}${primerBox('ol', 'home-step-list', `${homeStep('01', 'Crie sua conta', 'Prepare seu espaço para organizar os treinos.')}${homeStep('02', 'Organize suas fichas', 'Reúna seus exercícios e registre séries, repetições e cargas nos treinos.')}${homeStep('03', 'Acompanhe sua evolução', 'Consulte seu histórico e indicadores ao longo do tempo.')}`)}<p class="home-steps-demo">${link('/demo', 'Experimente registrar um treino na demonstração')}</p>`)}
      ${primerBox('section', 'home-section home-capabilities', `${primerHeading('h2', '', 'O essencial para sua rotina')}${primerBox('ul', 'home-feature-list', `${homeFeature(ChecklistIcon, 'Fichas de treino', 'Organize exercícios, dias e objetivos da sua rotina.')}${homeFeature(BookIcon, 'Catálogo oficial', 'Consulte exercícios oficiais, instruções e imagens disponíveis.')}${homeFeature(GraphIcon, 'Sua evolução', 'Acompanhe sessões, cargas, histórico e indicadores.')}${homeFeature(PeopleIcon, 'Comunidades', 'Conecte-se com pessoas que compartilham objetivos.')}`)}<p class="home-discovery">${link('/profissionais', 'Profissionais')}${link('/vitrine', 'Vitrine')}${link('/para-empresas', 'Para empresas')}</p>`)}
      ${primerBox('section', 'home-final', `${primerHeading('h2', '', 'Seu próximo treino começa aqui.')}${primerPrimaryLink('/cadastro', 'Criar conta', 'home-primary')}`)}`,
  },
  {
    path: '/demo',
    file: 'demo.html',
    title: 'Experimente o registro de treino | Demo Evolutus',
    description:
      'Teste uma ficha de treino interativa do Evolutus: registre cargas e repetições, consulte a carga anterior e veja seu resumo. Sem cadastro e sem salvar dados.',
    body: demoBody,
  },
  {
    path: '/demo-preview',
    file: 'demo-preview.html',
    title: 'Prévia da demonstração | Evolutus',
    description: 'Prévia da demonstração interativa de treino do Evolutus.',
    canonicalPath: '/demo',
    indexable: false,
    body: demoBody,
  },
  {
    path: '/como-funciona',
    file: 'como-funciona.html',
    title: 'Como funciona o Evolutus | Organize e acompanhe seus treinos',
    description:
      'Organize fichas, registre cargas e repetições e acompanhe histórico e indicadores. Veja como funciona o Evolutus e experimente sem cadastro.',
    body: howItWorksBody,
  },
  {
    path: '/para-empresas',
    file: 'para-empresas.html',
    title: 'Parcerias e Publicidade Fitness | Evolutus para Empresas',
    description:
      'Apresente sua marca ao público fitness por meio de publicidade patrocinada ou vitrine de produtos. Envie uma proposta para análise do Evolutus.',
    body: forBusinessBody,
  },
  {
    path: '/informacoes-do-fornecedor',
    file: 'informacoes-do-fornecedor.html',
    title: 'Informações do fornecedor | Evolutus',
    description:
      'Identificação do fornecedor responsável pelo Evolutus, do processador de pagamentos e do controlador de dados pessoais.',
    body: supplierInfoBody,
  },
  {
    path: '/vitrine',
    file: 'vitrine.html',
    title: 'Vitrine Evolutus | Produtos e Marcas Parceiras',
    description:
      'Explore produtos aprovados de marcas parceiras do Evolutus. Veja os detalhes e siga para a loja externa do parceiro para comprar.',
    indexable: false,
    body: vitrineBody,
  },
  {
    path: '/profissionais',
    file: 'profissionais.html',
    title: 'Profissionais | Evolutus',
    description:
      'Encontre profissionais e espaços de treino com informações divulgadas por seus responsáveis. O contato e a contratação são feitos diretamente.',
    indexable: false,
    body: `${skeleton('Profissionais')}<p>${link('/locais', 'Ver estabelecimentos')} · ${link('/minha-vitrine', 'Gerenciar meu cadastro')}</p><section class="vitrine-catalog"><div id="public-listings-root" data-kind="professional"></div></section>`,
  },
  {
    path: '/locais',
    file: 'locais.html',
    title: 'Estabelecimentos | Evolutus',
    description: 'Encontre estabelecimentos e espaços de treino com publicação vigente.',
    indexable: false,
    body: `${skeleton('Estabelecimentos')}<p>${link('/profissionais', 'Ver profissionais')} · ${link('/minha-vitrine', 'Gerenciar meu cadastro')}</p><section class="vitrine-catalog"><div id="public-listings-root" data-kind="space"></div></section>`,
  },
]

export function renderPublicPage(path, env = {}, { dev = false } = {}) {
  const page = publicPages.find((entry) => entry.path === path)
  if (!page) return null
  const verification = [
    ['google-site-verification', env.VITE_GOOGLE_SITE_VERIFICATION],
    ['msvalidate.01', env.VITE_BING_SITE_VERIFICATION],
  ]
    .filter(([, value]) => typeof value === 'string' && /^[a-zA-Z0-9_-]{10,200}$/.test(value))
    .map(([name, value]) => `<meta name="${name}" content="${escape(value)}">`)
    .join('')
  const canonical = `${origin}${page.canonicalPath || page.path}`
  const description = escape(page.description)
  const title = escape(page.title)
  const manifest = dev ? null : JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
  const authRef = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.VITE_SUPABASE_URL || '')
    ? new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
    : ''
  const homeBootstrap =
    path === '/' && authRef
      ? `<script src="/public-home-boot.js" data-auth-ref="${authRef}" data-redirect-src="${dev ? '/src/publicHomeRedirect.js' : `/${resolveManifestEntry(manifest, 'src/publicHomeRedirect.js').file}`}"></script>`
      : ''
  // Fora da Home: ela já tem seu próprio redirecionamento completo (acima) e nunca chega a
  // mostrar o cabeçalho de visitante pra quem está logado -- sincronizar o cabeçalho aqui
  // de novo seria redundante. Nas demais páginas públicas (/vitrine incluída), o cabeçalho
  // precisa refletir a sessão real sem recarregar: o boot evita o flash de "Entrar"/"Criar
  // conta" antes da checagem (publicHeaderAuth.js) confirmar.
  const headerAuthBoot =
    path !== '/' && authRef
      ? `<script src="/public-header-auth-boot.js" data-auth-ref="${authRef}"></script>`
      : ''
  const headerAuthScript =
    path !== '/' && authRef
      ? `<script type="module" src="${dev ? '/src/publicHeaderAuth.js' : '/assets/public-header-auth.js'}"></script>`
      : ''
  const schema =
    path === '/'
      ? { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Evolutus', url: origin }
      : {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: page.title,
          description: page.description,
          url: canonical,
          inLanguage: 'pt-BR',
        }
  const header = dev ? null : resolveManifestEntry(manifest, 'src/PublicHeaderMenu.jsx')
  const turbo = dev ? null : resolveManifestEntry(manifest, 'src/publicTurbo.js')
  const sharedStyles = header
    ? header.importedCss.map((file) => `<link rel="stylesheet" href="/${file}">`).join('')
    : ''
  const headerStyles = dev
    ? '<link rel="stylesheet" href="/src/styles/public-header.css">'
    : header.css.map((file) => `<link rel="stylesheet" href="/${file}">`).join('')
  const socialImage = `${origin}/img/banners/quadro-geral-1774.webp`
  const body = page.body
  if (path === '/demo' || path === '/demo-preview') {
    const demo = dev ? null : resolveManifestEntry(manifest, 'src/workoutDemoEntry.jsx')
    const demoStyles = demo
      ? [...demo.importedCss, ...demo.css]
          .filter((file) => !header.importedCss.includes(file))
          .map((file) => `<link rel="stylesheet" href="/${file}">`)
          .join('')
      : '<link rel="stylesheet" href="/src/styles/workoutDemo.css">'
    const demoPreload = dev ? '/src/workoutDemoEntry.jsx' : `/${demo.file}`
    return enableTurboLinks(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0d1117"><meta name="robots" content="${page.indexable === false ? 'noindex,follow' : 'index,follow'}">${verification}<meta name="turbo-cache-control" content="no-cache"><meta name="view-transition" content="same-origin"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${socialImage}"><meta property="og:locale" content="pt_BR"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${socialImage}"><link rel="icon" href="/icons/icon-192.png"><script src="/boot-public-theme.js"></script>${headerAuthBoot}${sharedStyles}<link rel="stylesheet" href="/public-pages.css"><link rel="stylesheet" href="/public-redesign.css"><link rel="stylesheet" href="/public-foundation.css">${headerStyles}${primerStyles()}${demoStyles}<link rel="modulepreload" href="${demoPreload}"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script><script type="module" src="${dev ? '/src/publicTurbo.js' : `/${turbo.file}`}" data-turbo-track="reload"></script><script type="module" src="${dev ? '/src/PublicHeaderMenu.jsx' : `/${header.file}`}" data-turbo-track="reload"></script>${headerAuthScript}</head><body class="public-demo" data-turbo-prefetch="false"><a class="skip" href="#content">Pular para o conteúdo</a>${nav}<main id="content" tabindex="-1">${body}</main>${footer}<script src="/public-pages.js" defer></script></body></html>`
    )
  }
  return enableTurboLinks(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1117"><meta name="robots" content="${page.indexable === false ? 'noindex,follow' : 'index,follow'}">${verification}<meta name="view-transition" content="same-origin"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${socialImage}"><meta property="og:locale" content="pt_BR"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${socialImage}"><link rel="icon" href="/icons/icon-192.png"><script src="/boot-public-theme.js"></script>${homeBootstrap}${headerAuthBoot}${sharedStyles}<link rel="stylesheet" href="/public-pages.css"><link rel="stylesheet" href="/public-redesign.css"><link rel="stylesheet" href="/public-foundation.css">${path === '/' ? '<link rel="stylesheet" href="/public-home.css"><script src="/public-catalog-count.js" defer></script>' : ''}${path === '/como-funciona' ? '<link rel="stylesheet" href="/public-how-it-works.css">' : ''}${path === '/para-empresas' ? '<link rel="stylesheet" href="/public-for-business.css">' : ''}${path === '/informacoes-do-fornecedor' ? '<link rel="stylesheet" href="/public-supplier-info.css">' : ''}${path === '/vitrine' ? '<link rel="stylesheet" href="/public-products.css">' : ''}${['/profissionais', '/locais'].includes(path) ? '<link rel="stylesheet" href="/public-listings.css">' : ''}${headerStyles}${primerStyles()}<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script><script type="module" src="${dev ? '/src/publicTurbo.js' : `/${turbo.file}`}" data-turbo-track="reload"></script><script type="module" src="${dev ? '/src/PublicHeaderMenu.jsx' : `/${header.file}`}" data-turbo-track="reload"></script>${headerAuthScript}</head><body class="public-${page.path === '/' ? 'home' : page.path.slice(1)}" data-turbo-prefetch="false"><a class="skip" href="#content">Pular para o conteúdo</a>${nav}<main id="content" tabindex="-1">${body}</main>${footer}<script src="/public-pages.js" defer></script></body></html>`
  )
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages
    .filter((page) => page.indexable !== false)
    .map((page) => `<url><loc>${origin}${page.path}</loc></url>`)
    .join('')}</urlset>`
}
