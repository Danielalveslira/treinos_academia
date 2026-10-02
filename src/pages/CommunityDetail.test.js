import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Testa só a composição/ordem da view pura (CommunityFeedSection), com props diretas --
// mesmo espírito de WalletHeaderBadgesView/PromoteDialogBody: sem precisar montar
// useCommunityFeed/useSponsoredAds/Supabase de verdade. StatusCard, SponsoredAdCard,
// SponsoredAdBanner, AchievementForm, StatusForm e ErrorState são substituídos por
// marcadores mínimos -- a lógica interna deles já é responsabilidade de cada um, aqui só
// interessa ONDE CommunityFeedSection decide colocar cada bloco. Box/Heading/Text/Button/
// Spinner/Blankslate (Primer) continuam reais, como em SuperAdminRoute.test.js.
let directory
let render

function makeStatus(id, extra = {}) {
  return { id, authorId: 'author-1', type: 'text', ...extra }
}

function makeAd(id) {
  return { id }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-detail-tests-'))
  const outfile = join(directory, 'community-detail.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CommunityFeedSection } from './CommunityDetail.jsx'
        const noop = () => {}
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(CommunityFeedSection, {
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
            now: Date.now(),
            showToast: noop,
            votesByStatusId: {},
            setVote: noop,
            onEconomyVoted: noop,
            onDeleteStatus: noop,
            onCreateStatus: noop,
            onPromoted: noop,
            ...props,
          }))))
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
          stub(/\/components\/StatusCard$/, 'status-card-stub')
          stub(/\/components\/SponsoredAdCard$/, 'ad-card-stub')
          stub(/\/components\/SponsoredAdBanner$/, 'ad-banner-stub')
          stub(/\/components\/AchievementForm$/, 'achievement-form-stub')
          stub(/\/components\/StatusForm$/, 'status-form-stub')
          stub(/\/components\/ErrorState$/, 'error-state-stub')
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
          pluginBuild.onLoad({ filter: /.*/, namespace: 'achievement-form-stub' }, () => ({
            contents: `export function AchievementForm() { return null }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'status-form-stub' }, () => ({
            contents: `export function StatusForm() { return null }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'error-state-stub' }, () => ({
            resolveDir: projectRoot,
            contents: `
              import { createElement } from 'react'
              export function ErrorState({ error }) {
                return error ? createElement('div', { className: 'test-error-state' }, String(error)) : null
              }
            `,
          }))
        },
      },
    ],
    // CommunityDetail.jsx importa communitiesService/communityMembersService/useAuth/
    // useCommunityFeed/useSponsoredAds/useMyEconomyVotes/statusesService/promotionsService
    // no topo do arquivo -- mesmo só usando CommunityFeedSection (que não chama nenhum
    // desses hooks), o módulo inteiro é avaliado, incluindo a cadeia até supabase/config.js.
    // Mesmo bloco de WalletHeaderBadges.test.js/SuperAdminRoute.test.js -- só
    // createClient() precisa não explodir ao carregar, nunca é chamado por esta view.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
        DEV: false,
      }),
    },
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
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

test('sem destaques e sem anúncios: toolbar e feed vazio renderizam sem a seção Destaques', () => {
  const html = render({ statuses: [], featuredStatuses: [] })
  assert.doesNotMatch(html, />Destaques</)
  assert.match(html, />Publicar</)
  assert.match(html, /Nenhuma publicação nas últimas 24h/)
})

test('com 1 destaque e com anúncios: banner, Publicar e feed patrocinado vêm antes de Destaques, que vem antes do feed normal', () => {
  const html = render({
    bannerAds: [makeAd('ad-banner-1')],
    feedAds: [makeAd('ad-feed-1')],
    featuredStatuses: [makeStatus('feat-1')],
    statuses: [makeStatus('post-1')],
  })
  order(
    html,
    'test-ad-banner',
    '>Publicar<',
    'data-ad-id="ad-feed-1"',
    '>Destaques<',
    'data-status-id="feat-1"',
    'data-status-id="post-1"'
  )
  // exatamente 1 card em Destaques + 1 no feed normal, nenhum extra
  assert.equal((html.match(/test-status-card/g) || []).length, 2)
})

test('com vários destaques: Publicar continua antes de Destaques, e nenhum item extra aparece', () => {
  const html = render({
    featuredStatuses: [makeStatus('feat-1'), makeStatus('feat-2'), makeStatus('feat-3')],
    statuses: [makeStatus('post-1'), makeStatus('post-2')],
  })
  order(html, '>Publicar<', '>Destaques<', 'data-status-id="feat-1"')
  order(html, '>Destaques<', 'data-status-id="feat-3"', 'data-status-id="post-1"')
  assert.equal((html.match(/test-status-card/g) || []).length, 5)
})

test('sem anúncio: a ordem toolbar -> Destaques -> feed continua correta sem nenhum marcador de anúncio', () => {
  const html = render({
    bannerAds: [],
    feedAds: [],
    featuredStatuses: [makeStatus('feat-1')],
    statuses: [makeStatus('post-1')],
  })
  assert.doesNotMatch(html, /test-ad-banner|test-ad-card/)
  order(html, '>Publicar<', '>Destaques<', 'data-status-id="feat-1"', 'data-status-id="post-1"')
})

test('um post promovido que também está no feed normal aparece exatamente 2 vezes (Destaques + feed), nunca mais que isso', () => {
  const html = render({
    featuredStatuses: [makeStatus('shared-1')],
    statuses: [makeStatus('shared-1')],
  })
  const occurrences = (html.match(/data-status-id="shared-1"/g) || []).length
  assert.equal(occurrences, 2)
})

test('feed normal continua funcionando: múltiplos posts renderizam, na ordem recebida, depois de Destaques', () => {
  const html = render({
    featuredStatuses: [makeStatus('feat-1')],
    statuses: [makeStatus('post-1'), makeStatus('post-2'), makeStatus('post-3')],
  })
  order(
    html,
    'data-status-id="feat-1"',
    'data-status-id="post-1"',
    'data-status-id="post-2"',
    'data-status-id="post-3"'
  )
})

test('o mesmo avatar público acompanha o autor no feed, nos destaques e nos treinos', () => {
  const workout = makeStatus('workout-avatar', {
    type: 'workout',
    workout: { title: 'Treino', date: new Date(Date.now() + 60000) },
  })
  const html = render({
    upcomingWorkouts: [workout],
    featuredStatuses: [makeStatus('feat-avatar')],
    statuses: [makeStatus('post-avatar', { authorId: 'author-2' })],
    authorAvatars: { 'author-1': 'profileAvatars/author-1/current.webp' },
  })
  assert.equal(
    (html.match(/data-avatar-path="profileAvatars\/author-1\/current.webp"/g) || []).length,
    2
  )
  assert.match(html, /data-status-id="post-avatar" data-avatar-path=""/)
})

test('a toolbar de Publicações mantém as mesmas classes CSS (community-toolbar/community-publish-actions), então a regra @media que a empilha no mobile continua valendo sem mudança', () => {
  const html = render({ featuredStatuses: [makeStatus('feat-1'), makeStatus('feat-2')] })
  // Box do Primer mescla suas próprias classes geradas com a nossa (className="community-toolbar"
  // vira algo como class="Box-sc-xxxx community-toolbar") -- \b garante que "community-toolbar"
  // é um token da classe, não substring de outra coisa.
  assert.match(html, /\bcommunity-toolbar\b/)
  assert.match(html, /\bcommunity-publish-actions\b/)
  // mesma estrutura DOM em qualquer largura de tela (não há reordenação condicional por
  // viewport neste componente) -- a ordem verificada acima vale igual para mobile/desktop.
  order(html, 'community-toolbar', '>Destaques<')
})

test('sem permissão de postar, a toolbar ainda aparece (só sem os botões Publicar/Conquista) antes de Destaques', () => {
  const html = render({
    canPost: false,
    featuredStatuses: [makeStatus('feat-1')],
  })
  assert.doesNotMatch(html, />Publicar</)
  order(html, '>Publicações<', '>Destaques<')
})

test('próximos treinos ficam em seção própria e não duplicam em Destaques ou no feed', () => {
  const event = makeStatus('workout-1', {
    type: 'workout',
    workout: { title: 'Treino de pernas', date: new Date(Date.now() + 60000) },
  })
  const html = render({
    upcomingWorkouts: [event],
    featuredStatuses: [event, makeStatus('feat-1')],
    statuses: [event, makeStatus('post-1')],
  })

  order(
    html,
    '>Publicações<',
    '>Próximos treinos<',
    'data-status-id="workout-1"',
    '>Destaques<',
    'data-status-id="feat-1"',
    'data-status-id="post-1"'
  )
  assert.equal((html.match(/data-status-id="workout-1"/g) || []).length, 1)
})

test('treino que passou é removido da seção mesmo se ainda estiver no cache', () => {
  const pastEvent = makeStatus('workout-past', {
    type: 'workout',
    workout: { title: 'Treino antigo', date: new Date(Date.now() - 60000) },
  })
  const html = render({ upcomingWorkouts: [pastEvent] })
  assert.doesNotMatch(html, />Próximos treinos</)
  assert.doesNotMatch(html, /data-status-id="workout-past"/)
})

test('treino compartilhado fora dos 20 primeiros continua visível e sem duplicação', () => {
  const upcomingWorkouts = Array.from({ length: 20 }, (_, index) =>
    makeStatus(`workout-${index}`, {
      type: 'workout',
      workout: { title: `Treino ${index}`, date: new Date(Date.now() + (index + 1) * 60000) },
    })
  )
  const sharedStatus = makeStatus('workout-shared', {
    type: 'workout',
    workout: { title: 'Treino compartilhado', date: new Date(Date.now() + 86400000) },
  })
  const html = render({ upcomingWorkouts, sharedStatus })
  assert.match(html, /data-status-id="workout-shared"/)
  assert.equal((html.match(/data-status-id="workout-shared"/g) || []).length, 1)
  assert.equal((html.match(/test-status-card/g) || []).length, 21)
})

test('publicação comum de link fora da primeira página aparece uma vez em bloco próprio', () => {
  const statuses = Array.from({ length: 30 }, (_, index) => makeStatus(`post-${index}`))
  const sharedStatus = makeStatus('post-old', { type: 'text', text: 'Post antigo' })
  const html = render({ statuses, sharedStatus })
  assert.match(html, />Publicação do link</)
  assert.equal((html.match(/data-status-id="post-old"/g) || []).length, 1)
  assert.equal((html.match(/test-status-card/g) || []).length, 31)
})

test('publicação de link que já está no feed carregado não é duplicada', () => {
  const statuses = [makeStatus('post-1'), makeStatus('post-2')]
  const html = render({ statuses, sharedStatus: makeStatus('post-2') })
  assert.doesNotMatch(html, />Publicação do link</)
  assert.equal((html.match(/data-status-id="post-2"/g) || []).length, 1)
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
    workout: { title: 'Treino de ontem', date: new Date(Date.now() - 3600000) },
  })
  const html = render({ sharedStatus })
  assert.doesNotMatch(html, />Próximos treinos</)
  assert.match(html, />Publicação do link</)
  assert.equal((html.match(/data-status-id="workout-past"/g) || []).length, 1)
})

test('publicação inexistente ou removida (sem resultado) não renderiza bloco de link', () => {
  const html = render({ statuses: [makeStatus('post-1')], sharedStatus: null })
  assert.doesNotMatch(html, />Publicação do link</)
})
