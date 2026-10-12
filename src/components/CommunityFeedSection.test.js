import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Testa a composição/ordem da view pura (CommunityFeedSection), com props diretas -- sem montar
// useCommunityFeed/useSponsoredAds/Supabase de verdade. StatusCard, SponsoredAdCard, SponsoredAdBanner,
// CommunityProgressShare, StatusForm e ErrorState são substituídos por marcadores mínimos: aqui só interessa
// ONDE a seção decide colocar cada bloco (abas, ordem, paginação). Primer (Button/Spinner) continua real.
let directory
let render
let mountClient

const NOW = Date.parse('2026-10-12T12:00:00Z')

function makeStatus(id, extra = {}) {
  return { id, authorId: 'author-1', type: 'text', ...extra }
}

function makeAd(id) {
  return { id }
}

const promoted = (id, extra = {}) =>
  makeStatus(id, {
    authorUsername: 'ana',
    text: '**Oferta** de hoje: [veja](https://evolutus.app)',
    promoted: true,
    promotedUntil: new Date(NOW + 3 * 86400000),
    ...extra,
  })

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-feed-section-tests-'))
  const outfile = join(directory, 'community-feed-section.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CommunityFeedSection } from './CommunityFeedSection.jsx'
        globalThis.IS_REACT_ACT_ENVIRONMENT = false
        const noop = () => {}
        const baseProps = {
          communityId: 'c1',
          currentUserId: 'user-1',
          author: { id: 'user-1', username: 'user1', role: 'user' },
          canModerate: false,
          canPost: true,
          bannerAds: [],
          feedAds: [],
          featuredStatuses: [],
          statuses: [],
          loadingFeed: false,
          feedError: null,
          formOpen: false,
          setFormOpen: noop,
          refreshFeed: noop,
          now: ${NOW},
          showToast: noop,
          votesByStatusId: {},
          onEconomyVoted: noop,
          onDeleteStatus: noop,
          onCreateStatus: noop,
          onPromoted: noop,
        }
        const tree = (props) => createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(CommunityFeedSection, { ...baseProps, ...props })))
        export const render = (props) => renderToStaticMarkup(tree(props))
        export const mountClient = (props) => {
          // ThemeProvider (Primer) lê window.matchMedia/document nos efeitos; o Node puro não tem.
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => { renderer = TestRenderer.create(tree(props)) })
          return {
            json: () => JSON.stringify(renderer.toJSON()),
            press: (className) => act(() => { renderer.root.findByProps({ className }).props.onClick() }),
            unmount: () => act(() => renderer.unmount()),
          }
        }
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
    plugins: [
      {
        name: 'community-feed-section-stubs',
        setup(pluginBuild) {
          const stub = (filter, namespace) =>
            pluginBuild.onResolve({ filter }, (args) => ({ path: args.path, namespace }))
          stub(/(^|\/)StatusCard$/, 'status-card-stub')
          stub(/(^|\/)SponsoredAdCard$/, 'ad-card-stub')
          stub(/(^|\/)SponsoredAdBanner$/, 'ad-banner-stub')
          stub(/(^|\/)CommunityProgressShare$/, 'progress-share-stub')
          stub(/(^|\/)StatusForm$/, 'status-form-stub')
          stub(/(^|\/)ErrorState$/, 'error-state-stub')
          // resolveDir aqui é obrigatório: um módulo virtual (namespace custom) não herda
          // nenhum diretório base, então `import ... from 'react'` dentro dele não acharia
          // node_modules/react sem isto.
          const projectRoot = new URL('../../', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
          pluginBuild.onLoad({ filter: /.*/, namespace: 'status-card-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function StatusCard({ status, authorAvatarPath }) {
                return createElement('div', { className: 'test-status-card', 'data-status-id': status.id, 'data-avatar-path': authorAvatarPath || '' }, status.id)
              }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'ad-card-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function SponsoredAdCard({ ad }) {
                return createElement('div', { className: 'test-ad-card', 'data-ad-id': ad.id }, ad.id)
              }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'ad-banner-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function SponsoredAdBanner({ ads }) {
                if (!ads || ads.length === 0) return null
                return createElement('div', { className: 'test-ad-banner' }, ads.map((ad) => ad.id).join(','))
              }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'progress-share-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function CommunityProgressShare() { return createElement('div', { className: 'test-progress-share' }, 'seletor-de-progresso') }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'status-form-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function StatusForm() { return createElement('div', { className: 'test-status-form' }, 'formulario-de-publicacao') }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'error-state-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function ErrorState({ error, onRetry }) {
                return error ? createElement('div', { className: 'test-error-state' }, String(error), onRetry ? createElement('button', null, 'Tentar novamente') : null) : null
              }
            `,
          }))
        },
      },
    ],
    // A cadeia de imports chega até supabase/config.js; só createClient() precisa não explodir ao carregar,
    // nunca é chamado por esta view.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
        DEV: false,
      }),
    },
  })
  ;({ render, mountClient } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function order(html, ...markers) {
  const indices = markers.map((marker) => {
    const index = html.indexOf(marker)
    assert.notEqual(index, -1, `esperava encontrar "${marker}" no HTML renderizado`)
    return index
  })
  for (let i = 1; i < indices.length; i += 1) {
    assert.ok(indices[i - 1] < indices[i], `esperava "${markers[i - 1]}" antes de "${markers[i]}"`)
  }
}
const count = (html, pattern) => (html.match(pattern) || []).length

test('sem publicações: abas, Publicar e estado vazio compacto; sem contador de destaques', () => {
  const html = render({ statuses: [], featuredStatuses: [] })
  assert.match(html, /role="tablist"/)
  assert.match(html, />Recentes</)
  assert.match(html, />Destaques</)
  assert.doesNotMatch(html, /cd-tab-count/)
  assert.match(html, />Publicar</)
  assert.match(html, /Nenhuma publicação por aqui ainda/)
  assert.doesNotMatch(html, /Você viu tudo por aqui/)
})

test('"Recentes" é a aba padrão: o feed aparece e os destaques ficam na outra aba (sem card duplicado)', () => {
  const html = render({
    featuredStatuses: [promoted('feat-1')],
    statuses: [makeStatus('post-1'), makeStatus('post-2')],
  })
  assert.match(html, /aria-selected="true"[^>]*>Recentes/)
  assert.doesNotMatch(html, /data-status-id="feat-1"/)
  assert.equal(count(html, /test-status-card/g), 2)
  assert.match(html, /cd-tab-count[^>]*>1</)
})

test('aba Destaques: o painel dos promovidos aparece e o de Recentes continua montado, só escondido', () => {
  const html = render({
    initialTab: 'featured',
    featuredStatuses: [promoted('feat-1'), promoted('feat-2')],
    statuses: [makeStatus('post-1')],
    hasMore: true,
  })
  assert.match(html, /aria-selected="true"[^>]*>[^<]*<svg[\s\S]*?Destaques/)
  assert.match(html, /id="cd-feed-panel-recent"[^>]*hidden=""/)
  assert.doesNotMatch(html, /id="cd-feed-panel-featured"[^>]*hidden/)
  // 2 destaques visíveis + 1 do feed (escondido, mas montado: voltar a Recentes é instantâneo)
  assert.equal(count(html, /test-status-card/g), 3)
})

test('Destaques vazio: mensagem curta, sem lista', () => {
  const html = render({
    initialTab: 'featured',
    featuredStatuses: [],
    statuses: [],
  })
  assert.match(html, /Nenhuma publicação em destaque no momento/)
  assert.equal(count(html, /test-status-card/g), 0)
})

test('Destaques só é montado quando alguém o abre (a aba inativa não custa render)', () => {
  const props = { featuredStatuses: [promoted('shared-1')], statuses: [makeStatus('shared-1')] }
  const recent = render(props)
  assert.equal(count(recent, /data-status-id="shared-1"/g), 1)
  assert.doesNotMatch(recent, /cd-feed-panel-featured/)
  const featured = render({ ...props, initialTab: 'featured' })
  assert.equal(count(featured, /data-status-id="shared-1"/g), 2)
})

test('ordem em Recentes: banner, Publicar, anúncio do feed, próximos treinos e só então o feed', () => {
  const event = makeStatus('workout-1', {
    type: 'workout',
    workout: { title: 'Treino de pernas', date: new Date(NOW + 60000) },
  })
  const html = render({
    bannerAds: [makeAd('ad-banner-1')],
    feedAds: [makeAd('ad-feed-1')],
    upcomingWorkouts: [event],
    statuses: [event, makeStatus('post-1'), makeStatus('post-2')],
  })
  order(
    html,
    'test-ad-banner',
    '>Publicar<',
    'data-ad-id="ad-feed-1"',
    '>Próximos treinos<',
    'data-status-id="workout-1"',
    'data-status-id="post-1"',
    'data-status-id="post-2"'
  )
  assert.equal(count(html, /data-status-id="workout-1"/g), 1)
})

test('a toolbar mantém as classes community-toolbar/community-publish-actions', () => {
  const html = render({})
  assert.match(html, /\bcommunity-toolbar\b/)
  assert.match(html, /\bcommunity-publish-actions\b/)
  order(html, 'community-toolbar', 'role="tablist"', '>Publicar<', '>Compartilhar progresso<')
})

test('sem permissão de postar: sem Publicar/Compartilhar progresso, com o aviso, e as abas continuam', () => {
  const html = render({ canPost: false, featuredStatuses: [promoted('feat-1')] })
  assert.doesNotMatch(html, />Publicar</)
  assert.doesNotMatch(html, />Compartilhar progresso</)
  assert.match(html, /Somente o superadmin pode publicar nesta comunidade/)
  assert.match(html, /role="tablist"/)
})

test('o mesmo avatar público acompanha o autor no feed e nos treinos', () => {
  const workout = makeStatus('workout-avatar', {
    type: 'workout',
    workout: { title: 'Treino', date: new Date(NOW + 60000) },
  })
  const html = render({
    upcomingWorkouts: [workout],
    statuses: [makeStatus('post-avatar', { authorId: 'author-2' })],
    authorAvatars: { 'author-1': 'profileAvatars/author-1/current.webp' },
  })
  assert.equal(count(html, /data-avatar-path="profileAvatars\/author-1\/current.webp"/g), 1)
  assert.match(html, /data-status-id="post-avatar" data-avatar-path=""/)
})

test('treino que passou é removido da seção mesmo se ainda estiver no cache', () => {
  const pastEvent = makeStatus('workout-past', {
    type: 'workout',
    workout: { title: 'Treino antigo', date: new Date(NOW - 60000) },
  })
  const html = render({ upcomingWorkouts: [pastEvent] })
  assert.doesNotMatch(html, />Próximos treinos</)
  assert.doesNotMatch(html, /data-status-id="workout-past"/)
})

test('treino compartilhado fora dos 20 primeiros continua visível e sem duplicação', () => {
  const upcomingWorkouts = Array.from({ length: 20 }, (_, index) =>
    makeStatus(`workout-${index}`, {
      type: 'workout',
      workout: { title: `Treino ${index}`, date: new Date(NOW + (index + 1) * 60000) },
    })
  )
  const sharedStatus = makeStatus('workout-shared', {
    type: 'workout',
    workout: { title: 'Treino compartilhado', date: new Date(NOW + 86400000) },
  })
  const html = render({ upcomingWorkouts, sharedStatus })
  assert.equal(count(html, /data-status-id="workout-shared"/g), 1)
  assert.equal(count(html, /test-status-card/g), 21)
})

test('publicação comum de link fora das páginas carregadas aparece uma vez em bloco próprio', () => {
  const statuses = Array.from({ length: 10 }, (_, index) => makeStatus(`post-${index}`))
  const sharedStatus = makeStatus('post-old', { type: 'text', text: 'Post antigo' })
  const html = render({ statuses, sharedStatus })
  assert.match(html, />Publicação do link</)
  assert.equal(count(html, /data-status-id="post-old"/g), 1)
  assert.equal(count(html, /test-status-card/g), 11)
})

test('publicação de link que já está no feed carregado não é duplicada', () => {
  const html = render({
    statuses: [makeStatus('post-1'), makeStatus('post-2')],
    sharedStatus: makeStatus('post-2'),
  })
  assert.doesNotMatch(html, />Publicação do link</)
  assert.equal(count(html, /data-status-id="post-2"/g), 1)
})

test('link para um post que só existe em Destaques ainda ganha o bloco do link em Recentes', () => {
  const target = makeStatus('promo-1')
  const html = render({
    featuredStatuses: [target],
    statuses: [makeStatus('post-1')],
    sharedStatus: target,
  })
  assert.match(html, />Publicação do link</)
  assert.equal(count(html, /data-status-id="promo-1"/g), 1)
})

test('conquista, enquete e foto de link fora do feed usam o mesmo bloco, sem lógica por tipo', () => {
  for (const type of ['achievement', 'poll', 'photo']) {
    const html = render({ sharedStatus: makeStatus(`${type}-1`, { type }) })
    assert.match(html, />Publicação do link</)
    assert.match(html, new RegExp(`data-status-id="${type}-1"`))
  }
})

test('treino de link já passado (comentários ainda abertos) aparece no bloco do link', () => {
  const sharedStatus = makeStatus('workout-past', {
    type: 'workout',
    workout: { title: 'Treino de ontem', date: new Date(NOW - 3600000) },
  })
  const html = render({ sharedStatus })
  assert.doesNotMatch(html, />Próximos treinos</)
  assert.match(html, />Publicação do link</)
  assert.equal(count(html, /data-status-id="workout-past"/g), 1)
})

test('publicação inexistente ou removida (sem resultado) não renderiza bloco de link', () => {
  const html = render({ statuses: [makeStatus('post-1')], sharedStatus: null })
  assert.doesNotMatch(html, />Publicação do link</)
})

test('paginação: com mais páginas mostra o botão; carregando desabilita; fim da lista avisa', () => {
  const statuses = [makeStatus('post-1')]
  assert.match(render({ statuses, hasMore: true }), />Carregar mais publicações</)
  const loading = render({ statuses, hasMore: true, loadingMore: true })
  assert.match(loading, /disabled=""[\s\S]*Carregando…/)
  const end = render({ statuses, hasMore: false })
  assert.match(end, /Você viu tudo por aqui/)
  assert.doesNotMatch(end, /Carregar mais publicações/)
})

test('paginação: falha mostra o erro com "Tentar novamente" e some o botão automático', () => {
  const html = render({ statuses: [makeStatus('post-1')], hasMore: true, moreError: 'sem rede' })
  assert.match(html, /test-error-state/)
  assert.match(html, /Tentar novamente/)
  assert.doesNotMatch(html, />Carregar mais publicações</)
})

test('erro do feed (primeira página) não mostra paginação', () => {
  const html = render({ feedError: 'falhou', hasMore: true })
  assert.match(html, /test-error-state/)
  assert.doesNotMatch(html, /Carregar mais publicações|Você viu tudo/)
})

test('a ação da comunidade é "Compartilhar progresso" (genérica), logo depois de Publicar', () => {
  const html = render({ statuses: [], featuredStatuses: [] })
  order(html, '>Publicar<', '>Compartilhar progresso<')
  assert.doesNotMatch(html, /Conquista do dia|Sua conquista de hoje|Compartilhar conquista/)
  assert.doesNotMatch(html, /test-progress-share/)
})

test('formOpen = "progress" esconde a toolbar (abas e botões); quem não pode publicar não vê o seletor', () => {
  const html = render({ formOpen: 'progress' })
  assert.doesNotMatch(html, />Compartilhar progresso</)
  assert.doesNotMatch(html, /role="tablist"/)
  const blocked = render({ canPost: false, formOpen: 'progress' })
  assert.doesNotMatch(blocked, /test-progress-share/)
})

test('os formulários são lazy (import dinâmico) e aparecem depois que o chunk resolve', async () => {
  const progress = mountClient({ formOpen: 'progress' })
  const status = mountClient({ formOpen: 'status' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.match(progress.json(), /seletor-de-progresso/)
    assert.match(status.json(), /formulario-de-publicacao/)
  } finally {
    progress.unmount()
    status.unmount()
  }
})

test('destaque compacto: aparece UM resumo de uma linha no topo de Recentes, sem markdown, com o autor', () => {
  const html = render({
    featuredStatuses: [promoted('p1')],
    statuses: [makeStatus('a'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
  })
  assert.equal(count(html, /class="cd-spotlight"/g), 1)
  assert.match(html, /Em destaque · @ana/)
  assert.match(html, /Oferta de hoje: veja/)
  assert.doesNotMatch(html, /\*\*|\]\(/, 'sem sintaxe de markdown')
  assert.doesNotMatch(
    html,
    /data-status-id="p1"/,
    'não renderiza o post inteiro (nada de card duplicado)'
  )
})

test('destaque compacto: é a primeira coisa de Recentes, antes de "Próximos treinos", da publicação do link e do feed', () => {
  const event = makeStatus('workout-1', {
    type: 'workout',
    workout: { title: 'Treino', date: new Date(NOW + 60000) },
  })
  const html = render({
    featuredStatuses: [promoted('p1')],
    statuses: [makeStatus('a'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
    upcomingWorkouts: [event],
    sharedStatus: makeStatus('link-1'),
  })
  order(html, 'cd-spotlight', '>Próximos treinos<', '>Publicação do link<', 'data-status-id="a"')
})

test('destaque compacto: só UM por vez, mesmo com vários promovidos; com vários mostra a posição 1/3 e a seta', () => {
  const html = render({
    featuredStatuses: [
      promoted('p1', { authorUsername: 'primeira' }),
      promoted('p2', { authorUsername: 'segunda' }),
      promoted('p3', { authorUsername: 'terceira' }),
    ],
    statuses: [makeStatus('a'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
  })
  assert.equal(count(html, /class="cd-spotlight"/g), 1)
  assert.equal(count(html, /@(primeira|segunda|terceira)/g) >= 1, true)
  assert.equal(count(html, /Em destaque · @/g), 1, 'apenas um destaque na tela')
  assert.match(html, /cd-spotlight-count[^>]*>1\/3</)
  assert.match(html, /cd-spotlight-next/)
})

test('destaque compacto: com um único destaque não há contador, seta nem controles', () => {
  const html = render({
    featuredStatuses: [promoted('p1')],
    statuses: [makeStatus('a'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
  })
  assert.equal(count(html, /class="cd-spotlight"/g), 1)
  assert.doesNotMatch(html, /cd-spotlight-nav|cd-spotlight-next|cd-spotlight-count/)
})

test('destaque compacto: todo destaque elegível participa do rodízio, mesmo já estando entre as 3 primeiras publicações', () => {
  const html = render({
    featuredStatuses: [promoted('p1'), promoted('p2')],
    statuses: [promoted('p1'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
  })
  assert.equal(count(html, /class="cd-spotlight"/g), 1)
  assert.match(html, /cd-spotlight-count[^>]*>1\/2</)
  const solo = render({
    featuredStatuses: [promoted('p1')],
    statuses: [promoted('p1'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
  })
  assert.equal(
    count(solo, /class="cd-spotlight"/g),
    1,
    'um único destaque no topo do feed também aparece'
  )
})

test('destaque compacto: não aparece sem destaque nem com promoção vencida', () => {
  assert.doesNotMatch(render({ featuredStatuses: [], statuses: [makeStatus('a')] }), /cd-spotlight/)
  assert.doesNotMatch(
    render({
      featuredStatuses: [promoted('p1', { promotedUntil: new Date(NOW - 3600 * 1000) })],
      statuses: [makeStatus('a')],
    }),
    /cd-spotlight/,
    'promoção encerrada (o relógio do componente anda por minuto) não é destaque'
  )
})

test('destaque compacto: resumo por tipo (enquete, foto sem legenda, conquista)', () => {
  const poll = promoted('p-poll', {
    type: 'poll',
    text: undefined,
    poll: { question: 'Qual treino hoje?', options: [] },
  })
  assert.match(render({ featuredStatuses: [poll], statuses: [] }), /Enquete: Qual treino hoje\?/)
  const photo = promoted('p-photo', { type: 'photo', text: undefined, caption: '' })
  assert.match(render({ featuredStatuses: [photo], statuses: [] }), /Compartilhou uma foto/)
})

test('destaque compacto: tocar leva à aba Destaques, onde o post completo aparece', async () => {
  const view = mountClient({
    featuredStatuses: [promoted('p1')],
    statuses: [makeStatus('a'), makeStatus('b'), makeStatus('c'), makeStatus('d')],
  })
  try {
    assert.doesNotMatch(
      view.json(),
      /"data-status-id":"p1"/,
      'o post completo não está na tela de Recentes'
    )
    view.press('cd-spotlight')
    assert.match(
      view.json(),
      /"data-status-id":"p1"/,
      'agora o painel Destaques foi montado com o post'
    )
    assert.match(
      view.json(),
      /"aria-selected":true[^}]*}[^]*?Destaques|Destaques[^]*?"aria-selected":true/
    )
  } finally {
    view.unmount()
  }
})

test('destaque EXPIRADO que ficou na cache não aparece na aba Destaques nem no contador', () => {
  const expired = promoted('old', { promotedUntil: new Date(NOW - 3600 * 1000) })
  const html = render({
    initialTab: 'featured',
    featuredStatuses: [expired, promoted('ok')],
    statuses: [],
  })
  assert.doesNotMatch(
    html,
    /data-status-id="old"/,
    'promoção encerrada não é exibida como destaque'
  )
  assert.match(html, /data-status-id="ok"/)
  assert.match(html, /cd-tab-count[^>]*>1</, 'o contador só conta o que ainda vale')
})

test('só destaques expirados: aba vazia, sem contador e sem destaque no topo', () => {
  const expired = [
    promoted('a', { promotedUntil: new Date(NOW - 7200 * 1000) }),
    promoted('b', { promotedUntil: new Date(NOW - 3600 * 1000) }),
  ]
  const featuredTab = render({
    initialTab: 'featured',
    featuredStatuses: expired,
    statuses: [makeStatus('x')],
  })
  assert.match(featuredTab, /Nenhuma publicação em destaque no momento/)
  assert.doesNotMatch(featuredTab, /cd-tab-count/)
  assert.doesNotMatch(
    render({ featuredStatuses: expired, statuses: [makeStatus('x')] }),
    /cd-spotlight/
  )
})

test('item sem as marcas de promoção (promoted/promotedUntil) não é tratado como destaque', () => {
  const html = render({
    initialTab: 'featured',
    featuredStatuses: [makeStatus('no-flags')],
    statuses: [],
  })
  assert.doesNotMatch(html, /data-status-id="no-flags"/)
})

test('campanha de banner+feed: banner no topo e card no meio do feed (depois de 3 publicações), nunca colados', () => {
  const html = render({
    bannerAds: [makeAd('both')],
    inlineFeedAds: [makeAd('both')],
    statuses: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => makeStatus(id)),
  })
  assert.equal(count(html, /test-ad-banner/g), 1)
  assert.equal(count(html, /test-ad-card/g), 1)
  order(
    html,
    'test-ad-banner',
    'data-status-id="p1"',
    'data-status-id="p3"',
    'test-ad-card',
    'data-status-id="p4"'
  )
})

test('campanha só de feed continua no topo do feed; sem campanhas não há blocos nem espaço reservado', () => {
  const withTop = render({ feedAds: [makeAd('top')], statuses: [makeStatus('p1')] })
  order(withTop, 'test-ad-card', 'data-status-id="p1"')
  const none = render({ statuses: [makeStatus('p1')] })
  assert.equal(count(none, /test-ad-(card|banner)/g), 0)
  assert.doesNotMatch(none, /sponsored-ad-banner-slot/)
})

test('espaço do banner só é reservado com a dica ativa e enquanto não há banner', () => {
  assert.match(render({ reserveBannerSlot: true }), /sponsored-ad-banner-slot/)
  assert.doesNotMatch(
    render({ reserveBannerSlot: true, bannerAds: [makeAd('b')] }),
    /sponsored-ad-banner-slot/
  )
  assert.doesNotMatch(render({ reserveBannerSlot: false }), /sponsored-ad-banner-slot/)
})

test('cards tardios entram dentro do feed (após a 1ª publicação); o banner continua SEMPRE no topo', () => {
  const html = render({
    bannerAds: [makeAd('b1')],
    feedAds: [],
    inlineFeedAds: [makeAd('c1')],
    inlineFirstAfter: 1,
    statuses: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => makeStatus(id)),
  })
  order(html, 'test-ad-banner', 'data-status-id="p1"', 'test-ad-card', 'data-status-id="p2"')
  assert.equal(count(html, /test-ad-banner/g), 1)
  assert.equal(count(html, /test-ad-card/g), 1)
})

test('cards tardios com o feed ainda carregando não aparecem sob o spinner', () => {
  const html = render({
    inlineFeedAds: [makeAd('c1')],
    loadingFeed: true,
    statuses: [],
  })
  assert.equal(count(html, /test-ad-(banner|card)/g), 0)
})
