import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Rota direta /comunidades/:id: o que a página renderiza (e quais leituras de conteúdo habilita) para cada estado
// de acesso que o SERVIDOR devolveu. Banido/indisponível/não-membro não montam feed, composer nem ações de
// membro, e as leituras de conteúdo ficam desligadas. Hooks pesados e o feed são fakes; o gate é o código real.
let directory
let mount
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms))

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-detail-access-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter, Route, Routes } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import CommunityDetail from './CommunityDetail.jsx'

        export const mount = (path) => {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.document = global.document || {
            visibilityState: 'visible',
            listeners: new Set(),
            addEventListener(type, fn) { if (type === 'visibilitychange') this.listeners.add(fn) },
            removeEventListener(type, fn) { this.listeners.delete(fn) },
            fireVisible() { this.listeners.forEach((fn) => fn()) },
          }
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              createElement(ThemeProvider, null, createElement(BaseStyles, null,
                createElement(MemoryRouter, { initialEntries: [path] },
                  createElement(Routes, null,
                    createElement(Route, { path: '/comunidades/:id', element: createElement(CommunityDetail) }),
                    createElement(Route, { path: '/comunidades', element: createElement('div', null, 'EXPLORAR') }))))))
          })
          return renderer
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
        name: 'fakes',
        setup(pluginBuild) {
          const fake = (filter, contents) => {
            pluginBuild.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'fake' }))
            pluginBuild.onLoad({ filter, namespace: 'fake' }, () => ({
              contents,
              loader: 'jsx',
              resolveDir: new URL('../..', import.meta.url).pathname,
            }))
          }
          fake(
            /\/hooks\/useAuth(\.js)?$/,
            `export const useAuth = () => ({ user: { uid: 'u1' }, profile: { username: 'ana', role: 'user' }, isSuperAdmin: false })`
          )
          fake(
            /\/hooks\/useCommunityFeed(\.js)?$/,
            `export const useCommunityFeed = (id, enabled) => { globalThis.__enabled.feed.push(enabled); return { statuses: [], hasMore: false, loading: false, loadingMore: false, refreshing: false, refreshEpoch: 0, error: null, moreError: null, refresh() {}, loadMore() {}, addStatusLocally() {}, remove() {}, updateEconomyVoteCounts() {}, updateCommentCount() {}, updatePostPromotion() {} } }`
          )
          fake(
            /\/hooks\/useUpcomingWorkouts(\.js)?$/,
            `export const useUpcomingWorkouts = (id, enabled) => { globalThis.__enabled.workouts.push(enabled); return { workouts: [], loading: false, error: null, refresh() {}, setWorkouts() {} } }`
          )
          fake(
            /\/hooks\/useSponsoredAds(\.js)?$/,
            `const none = []; export const useSponsoredAds = () => ({ feedAds: none, inlineFeedAds: none, bannerAds: none, loading: false, error: null })`
          )
          fake(
            /\/hooks\/useMyEconomyVotes(\.js)?$/,
            `export const useMyEconomyVotes = () => ({ votesByStatusId: {}, setVote() {} })`
          )
          fake(
            /\/hooks\/useCommunityAuthorAvatars(\.js)?$/,
            `export const useCommunityAuthorAvatars = () => ({})`
          )
          fake(
            /\/hooks\/useFeedScrollMemory(\.js)?$/,
            `export const useFeedScrollMemory = () => {}`
          )
          fake(
            /\/hooks\/useConfirmDelete(\.js)?$/,
            `export const useConfirmDelete = () => () => Promise.resolve(false)`
          )
          fake(
            /\/services\/communitiesService(\.js)?$/,
            `export const getCommunity = async () => globalThis.__community; export const updateCommunity = async () => {}; export const setCommunityActive = async () => {}; export const deleteCommunity = async () => {}`
          )
          fake(
            /\/services\/communityMembersService(\.js)?$/,
            `
            export const getCommunityAccess = async () => { globalThis.__accessCalls += 1; return globalThis.__access }
            export const joinCommunity = async () => { globalThis.__joinCalls += 1; if (globalThis.__joinError) throw globalThis.__joinError; return globalThis.__joinResult }
            export const leaveCommunity = async () => {}`
          )
          fake(
            /\/services\/statusesService(\.js)?$/,
            `export const createPhotoStatus = async () => {}; export const createTextStatus = async () => {}; export const createPollStatus = async () => {}; export const createWorkoutStatus = async () => {}; export const getSharedStatus = async () => null`
          )
          fake(
            /\/services\/promotionsService(\.js)?$/,
            `export const listFeaturedStatusesForCommunity = async () => []`
          )
          fake(
            /\/components\/CommunityFeedSection(\.jsx)?$/,
            `export const CommunityFeedSection = (props) => <section data-testid="feed"><span>FEED_INTERNO</span>{props.canPost && <span>COMPOSER</span>}</section>`
          )
          fake(
            /\/components\/CommunityHeader(\.jsx)?$/,
            `export const CommunityHeader = ({ menuProps }) => { globalThis.__menu = menuProps; return <header>HEADER{menuProps.member ? ' MENU_MEMBRO' : ''}</header> }`
          )
          fake(/\/components\/CommunityForm(\.jsx)?$/, `export const CommunityForm = () => null`)
          fake(
            /\/components\/CommunityMembersModeration(\.jsx)?$/,
            `export const CommunityMembersModeration = () => <div>MEMBROS_INTERNOS</div>`
          )
          fake(/\/components\/PromoteDialog(\.jsx)?$/, `export const PromoteDialog = () => null`)
        },
      },
    ],
  })
  ;({ mount } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  const { clearPageCache } = await import('../utils/pageCache.js')
  clearPageCache()
  globalThis.__enabled = { feed: [], workouts: [] }
  globalThis.__accessCalls = 0
  globalThis.__joinCalls = 0
  globalThis.__joinError = null
  globalThis.__joinResult = 'joined'
  globalThis.__menu = null
  globalThis.__community = {
    id: 'c1',
    name: 'Corredores',
    description: '',
    postAccess: 'everyone',
    ownerId: 'dono',
    isActive: true,
  }
})

const textContent = (instance) =>
  instance.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
const pageText = (renderer) => textContent(renderer.root)
const enterButtons = (renderer) =>
  renderer.root.findAll((node) => node.type === 'button' && /^Entrar$/.test(textContent(node)))

async function open(access) {
  globalThis.__access = access
  const renderer = mount('/comunidades/c1')
  await wait()
  return renderer
}

test('member: mostra feed e composer, habilita as leituras e o menu de membro', async () => {
  const renderer = await open('member')
  const text = pageText(renderer)
  assert.match(text, /FEED_INTERNO/)
  assert.match(text, /COMPOSER/)
  assert.match(text, /MENU_MEMBRO/)
  assert.equal(globalThis.__enabled.feed.at(-1), true)
  assert.equal(enterButtons(renderer).length, 0)
  renderer.unmount()
})

test('not_member: só o fluxo público com Entrar; nenhum conteúdo interno e leituras desligadas', async () => {
  const renderer = await open('not_member')
  const text = pageText(renderer)
  assert.match(text, /Entre para ver o feed/)
  assert.doesNotMatch(text, /FEED_INTERNO|COMPOSER|MENU_MEMBRO|MEMBROS_INTERNOS/)
  assert.equal(enterButtons(renderer).length, 1)
  assert.equal(globalThis.__enabled.feed.at(-1), false)
  renderer.unmount()
})

test('banned (URL direta): estado dedicado, sem feed, composer, membros, menu de membro nem Entrar', async () => {
  const renderer = await open('banned')
  const text = pageText(renderer)
  assert.match(text, /Acesso à comunidade bloqueado/)
  assert.match(text, /Você não pode acessar o conteúdo desta comunidade\./)
  assert.doesNotMatch(
    text,
    /FEED_INTERNO|COMPOSER|MENU_MEMBRO|MEMBROS_INTERNOS|Entre para ver o feed|Erro/
  )
  assert.equal(enterButtons(renderer).length, 0)
  assert.equal(globalThis.__enabled.feed.at(-1), false)
  assert.equal(globalThis.__enabled.workouts.at(-1), false)
  assert.equal(globalThis.__menu.member, false)
  renderer.unmount()
})

test('unavailable: mensagem própria, sem conteúdo e sem Entrar', async () => {
  const renderer = await open('unavailable')
  const text = pageText(renderer)
  assert.match(text, /Esta comunidade não está disponível\./)
  assert.doesNotMatch(text, /FEED_INTERNO|COMPOSER|Entre para ver o feed/)
  assert.equal(enterButtons(renderer).length, 0)
  renderer.unmount()
})

test('estado desconhecido do servidor nega acesso', async () => {
  const renderer = await open('qualquer-coisa')
  assert.doesNotMatch(pageText(renderer), /FEED_INTERNO|COMPOSER/)
  assert.equal(enterButtons(renderer).length, 0)
  renderer.unmount()
})

test('tela mostrava Entrar, mas o servidor recusa com banned: vira bloqueado na hora, sem refresh e sem erro', async () => {
  const renderer = await open('not_member')
  assert.equal(enterButtons(renderer).length, 1)
  globalThis.__joinResult = 'banned'
  await enterButtons(renderer)[0].props.onClick()
  await wait()
  const text = pageText(renderer)
  assert.equal(globalThis.__joinCalls, 1)
  assert.match(text, /Acesso à comunidade bloqueado/)
  assert.doesNotMatch(text, /Erro|Entre para ver o feed|FEED_INTERNO/)
  assert.equal(enterButtons(renderer).length, 0)
  renderer.unmount()
})

test('entrada recusada por indisponibilidade vira estado indisponível', async () => {
  const renderer = await open('not_member')
  globalThis.__joinResult = 'unavailable'
  await enterButtons(renderer)[0].props.onClick()
  await wait()
  assert.match(pageText(renderer), /Esta comunidade não está disponível\./)
  renderer.unmount()
})

test('falha de rede ao entrar: mensagem de rede, continua com Entrar e nenhum erro técnico', async () => {
  const renderer = await open('not_member')
  globalThis.__joinError = { message: 'TypeError: Failed to fetch', code: '' }
  await enterButtons(renderer)[0].props.onClick()
  await wait()
  const text = pageText(renderer)
  assert.match(text, /Não foi possível conectar\. Verifique sua internet e tente novamente\./)
  assert.doesNotMatch(text, /Failed to fetch|TypeError/)
  assert.equal(enterButtons(renderer).length, 1)
  renderer.unmount()
})

test('erro inesperado ao entrar: mensagem genérica', async () => {
  const renderer = await open('not_member')
  globalThis.__joinError = { message: 'relation "x" does not exist', code: '42P01' }
  await enterButtons(renderer)[0].props.onClick()
  await wait()
  const text = pageText(renderer)
  assert.match(text, /Não foi possível entrar na comunidade\. Tente novamente\./)
  assert.doesNotMatch(text, /relation|42P01/)
  renderer.unmount()
})

test('voltar para a aba revalida: quem era membro e foi removido perde feed e composer sem refresh', async () => {
  const renderer = await open('member')
  assert.match(pageText(renderer), /FEED_INTERNO/)
  const callsBefore = globalThis.__accessCalls
  globalThis.__access = 'banned'
  document.fireVisible()
  await wait()
  const text = pageText(renderer)
  assert.ok(globalThis.__accessCalls > callsBefore)
  assert.match(text, /Acesso à comunidade bloqueado/)
  assert.doesNotMatch(text, /FEED_INTERNO|COMPOSER|MENU_MEMBRO|Entre para ver o feed/)
  assert.equal(globalThis.__enabled.feed.at(-1), false)
  assert.equal(enterButtons(renderer).length, 0)
  renderer.unmount()
})

test('removido sem ban (not_member) ao voltar para a aba: volta ao fluxo público, sem conteúdo interno', async () => {
  const renderer = await open('member')
  globalThis.__access = 'not_member'
  document.fireVisible()
  await wait()
  const text = pageText(renderer)
  assert.match(text, /Entre para ver o feed/)
  assert.doesNotMatch(text, /FEED_INTERNO|COMPOSER/)
  renderer.unmount()
})
