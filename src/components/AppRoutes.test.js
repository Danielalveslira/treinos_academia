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

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'app-route-tests-'))
  const outfile = join(directory, 'routes.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { AppRoutes } from '../App.jsx'
        import { getProviderMounts, resetProviderMounts } from '../contexts/ExercisesContext'
        import { getProtectedMounts, resetProtectedMounts } from '../components/ProtectedRoute'
        export function render(path) {
          resetProviderMounts()
          resetProtectedMounts()
          const html = renderToStaticMarkup(
            createElement(MemoryRouter, { initialEntries: [path] }, createElement(AppRoutes))
          )
          return { html, providerMounts: getProviderMounts(), protectedMounts: getProtectedMounts() }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'app-route-test-stubs',
        setup(buildContext) {
          buildContext.onResolve(
            { filter: /^(react|react\/jsx-runtime|react-router-dom)$/, namespace: 'stub' },
            ({ path }) => ({ path: require.resolve(path) })
          )
          const stub = (filter, path) =>
            buildContext.onResolve({ filter }, () => ({ path, namespace: 'stub' }))
          stub(/contexts\/AuthContext$/, 'auth-context')
          stub(/contexts\/WalletContext$/, 'wallet-context')
          stub(/contexts\/ExercisesContext$/, 'exercises-context')
          stub(/components\/ProtectedRoute$/, 'protected-route')
          stub(/components\/SuperAdminRoute$/, 'admin-route')
          stub(/components\/Layout$/, 'layout')
          stub(/components\/PageFallback$/, 'fallback')
          stub(/routeLoaders$/, 'route-loaders')
          stub(/pages\//, 'page')

          buildContext.onLoad({ filter: /^auth-context$/, namespace: 'stub' }, () => ({
            contents: `export const AuthProvider = ({ children }) => children`,
          }))
          buildContext.onLoad({ filter: /^wallet-context$/, namespace: 'stub' }, () => ({
            contents: `export const WalletProvider = ({ children }) => children`,
          }))
          buildContext.onLoad({ filter: /^exercises-context$/, namespace: 'stub' }, () => ({
            contents: `
              let mounts = 0
              export const ExercisesProvider = ({ children }) => {
                mounts += 1
                return children
              }
              export const getProviderMounts = () => mounts
              export const resetProviderMounts = () => { mounts = 0 }
            `,
            loader: 'jsx',
          }))
          buildContext.onLoad({ filter: /^protected-route$/, namespace: 'stub' }, () => ({
            contents: `
              let mounts = 0
              export const ProtectedRoute = ({ children }) => { mounts += 1; return children }
              export const getProtectedMounts = () => mounts
              export const resetProtectedMounts = () => { mounts = 0 }
            `,
          }))
          buildContext.onLoad({ filter: /^admin-route$/, namespace: 'stub' }, () => ({
            contents: `export const SuperAdminRoute = ({ children }) => children`,
          }))
          buildContext.onLoad({ filter: /^layout$/, namespace: 'stub' }, () => ({
            contents: `
              import { Suspense } from 'react'
              import { Outlet } from 'react-router-dom'
              export const Layout = () => <Suspense fallback={<span>carregando</span>}><Outlet /></Suspense>
            `,
            loader: 'jsx',
          }))
          buildContext.onLoad({ filter: /^fallback$/, namespace: 'stub' }, () => ({
            contents: `export const PageFallback = () => <span>carregando</span>`,
            loader: 'jsx',
          }))
          buildContext.onLoad({ filter: /^route-loaders$/, namespace: 'stub' }, () => ({
            contents: `
              const page = () => Promise.resolve({ default: () => <span>página</span> })
              export const routeLoaders = {
                '/app': page,
                '/treinar': page,
                '/novo-treino': page,
                '/historico': page,
                '/progresso': page,
                '/exercicios': page,
                '/comunidades': page,
              }
            `,
            loader: 'jsx',
          }))
          buildContext.onLoad({ filter: /^page$/, namespace: 'stub' }, () => ({
            contents: `export default function Page() { return <span>página</span> }`,
            loader: 'jsx',
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

test('exercise data provider wraps only routes that consume exercise data', () => {
  for (const path of [
    '/app',
    '/exercicios',
    '/exercicios/squat',
    '/treinar',
    '/novo-treino',
    '/historico',
    '/progresso',
  ]) {
    assert.equal(render(path).providerMounts, 1, path)
  }
})

test('unrelated protected routes do not mount the exercise data provider', () => {
  for (const path of [
    '/perfil',
    '/entenda-suas-moedas',
    '/comunidades',
    '/comunidades/community-1',
    '/admin/contas',
    '/admin/comunidades',
    '/admin/compras-evocash',
    // A aba de configuração PIX vive na mesma rota via ?tab= (não uma rota própria,
    // ver AdminCashPurchases.jsx) -- /admin/pagamentos nunca existiu como rota real.
    '/admin/compras-evocash?tab=pix',
    '/minha-vitrine',
  ]) {
    assert.equal(render(path).providerMounts, 0, path)
  }
})

test('professional directory and terms are public while published management requires login', () => {
  assert.equal(render('/profissionais').protectedMounts, 0)
  assert.equal(render('/profissionais/listing-1').protectedMounts, 0)
  assert.equal(render('/termos-publicacao-vitrine').protectedMounts, 0)
  assert.equal(render('/minha-vitrine').protectedMounts, 1)
  assert.equal(render('/minha-vitrine').html.includes('pÃ¡gina'), false)
})
