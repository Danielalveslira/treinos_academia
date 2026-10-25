import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let render

// Só a navegação (desktop/mobile) de Layout.jsx: o shell inteiro (conta, carteira,
// notificações, sync) depende de auth/supabase reais, então tudo isso é stubado — o que
// importa aqui é o rótulo "Fichas", o caminho preservado /exercicios e "Treinar" como ação
// para /treinar (replace=false, state de origem), sem tocar PWA, histórico ou offline.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'layout-nav-tests-'))
  const outfile = join(directory, 'layout.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { Layout } from './Layout.jsx'
        export function render(path) {
          return renderToStaticMarkup(
            createElement(MemoryRouter, { initialEntries: [path] }, createElement(Layout))
          )
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
        name: 'layout-test-stubs',
        setup(context) {
          const stub = (filter, path) => context.onResolve({ filter }, () => ({ path, namespace: 'stub' }))
          stub(/\.\/ErrorBoundary$/, 'passthrough')
          stub(/\.\/PageFallback$/, 'noop')
          stub(/\.\/BrandMark$/, 'noop')
          stub(/\.\/AccountMenu$/, 'noop')
          stub(/\.\/WalletHeaderBadges$/, 'noop')
          stub(/\.\/EvoCoinsAwardNotice$/, 'noop')
          stub(/\.\/SyncStatus$/, 'sync-status-module')
          stub(/features\/notifications\/components\/NotificationBell$/, 'notification-bell-module')
          stub(/features\/notifications\/hooks\/usePushSubscriptionSync$/, 'noop-hook')
          stub(/hooks\/useAuth$/, 'use-auth')
          stub(/hooks\/useLogout$/, 'use-logout')
          stub(/hooks\/useQualifiedActivity$/, 'noop-hook')
          stub(/hooks\/useActivityHeartbeat$/, 'noop-hook')
          stub(/hooks\/useOnlineStatus$/, 'use-online')
          stub(/hooks\/useSyncScheduler$/, 'noop-hook')
          stub(/hooks\/useWarmOfflineRoutes$/, 'noop-hook')
          stub(/services\/offline\/database$/, 'offline-shell')
          stub(/utils\/offlineRoutes$/, 'offline-capable')
          stub(/utils\/legal$/, 'legal')
          // routeLoaders.js dynamically import()s every page (Dashboard, ExercisesArea,
          // NewWorkout, TreinarPage...) -- esbuild inlines those too without this stub,
          // dragging the whole app (and real Supabase/auth config) into the test bundle.
          stub(/routeLoaders$/, 'route-loaders')

          context.onLoad({ filter: /^passthrough$/, namespace: 'stub' }, () => ({
            contents: `export const ErrorBoundary = ({ children }) => children`,
            loader: 'jsx',
          }))
          context.onLoad({ filter: /^noop$/, namespace: 'stub' }, () => ({
            contents: `
              export const PageFallback = () => null
              export const BrandMark = () => null
              export const AccountMenu = () => null
              export const WalletHeaderBadges = () => null
              export const EvoCoinsAwardNotice = () => null
            `,
            loader: 'jsx',
          }))
          context.onLoad({ filter: /^sync-status-module$/, namespace: 'stub' }, () => ({
            contents: `export const SyncStatus = () => null`,
            loader: 'jsx',
          }))
          context.onLoad({ filter: /^notification-bell-module$/, namespace: 'stub' }, () => ({
            contents: `export const NotificationBell = () => null`,
            loader: 'jsx',
          }))
          context.onLoad({ filter: /^noop-hook$/, namespace: 'stub' }, () => ({
            contents: `export const useQualifiedActivity = () => {}
              export const useActivityHeartbeat = () => {}
              export const useSyncScheduler = () => {}
              export const useWarmOfflineRoutes = () => {}
              export const usePushSubscriptionSync = () => {}`,
          }))
          context.onLoad({ filter: /^use-auth$/, namespace: 'stub' }, () => ({
            contents: `export const useAuth = () => ({
              user: { uid: 'u1' },
              profile: { accountStatus: 'active', username: 'dani' },
              legalAccess: {},
              deletionStatus: null,
              offlineLocal: false,
              serverAccessAllowed: true,
            })`,
          }))
          context.onLoad({ filter: /^use-logout$/, namespace: 'stub' }, () => ({
            contents: `export const useLogout = () => ({ logout: () => {}, logoutAll: () => {}, signingOut: false, error: '' })
              export const confirmAndLogoutAll = () => {}`,
          }))
          context.onLoad({ filter: /^use-online$/, namespace: 'stub' }, () => ({
            contents: `export const useOnlineStatus = () => true`,
          }))
          context.onLoad({ filter: /^offline-shell$/, namespace: 'stub' }, () => ({
            contents: `export const isOfflineShellEnabled = () => false`,
          }))
          context.onLoad({ filter: /^offline-capable$/, namespace: 'stub' }, () => ({
            contents: `export const isOfflineCapablePath = () => true`,
          }))
          context.onLoad({ filter: /^legal$/, namespace: 'stub' }, () => ({
            contents: `export const resolveLegalGateState = () => 'allowed'`,
          }))
          context.onLoad({ filter: /^route-loaders$/, namespace: 'stub' }, () => ({
            contents: `export const preloadRoute = () => {}`,
          }))
        },
      },
    ],
  })
  ;({ render } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('menu shows "Fichas" (not "Exercícios") linking to the preserved /exercicios path', () => {
  const html = render('/app')
  assert.match(html, /href="\/exercicios"[^>]*>[\s\S]*?<span>Fichas<\/span>/)
  assert.doesNotMatch(html, />Exercícios</)
})

test('"Treinar" is an action link to /treinar, not a replaced tab to /novo-treino', () => {
  const html = render('/app')
  assert.match(html, /class="nav-link nav-link-action"[^>]*href="\/treinar"/)
  assert.doesNotMatch(html, /href="\/novo-treino"[^>]*nav-link-action/)
})

test('desktop and mobile navigations both render the full item set once each', () => {
  const html = render('/app')
  assert.equal((html.match(/>Fichas</g) || []).length, 2)
  assert.equal((html.match(/>Treinar</g) || []).length, 2)
  assert.match(html, /aria-label="Navegação principal"/)
  assert.match(html, /aria-label="Navegação principal mobile"/)
})
