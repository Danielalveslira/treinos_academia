import process from 'node:process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import storefrontDetail from '../api/storefront.js'
import catalogSnapshot from '../api/public-catalog-snapshot.js'
import {
  publicPages,
  renderPublicPage,
  renderRobots,
  renderSitemap,
} from './public-pages-template.mjs'

const routes = new Map(publicPages.map(({ path, file }) => [path, file]))
const variant = (path) => {
  const clean = path.endsWith('.html')
    ? path.slice(0, -5)
    : path.endsWith('/')
      ? path.slice(0, -1)
      : path
  return clean !== path && routes.has(clean) && clean !== '/' ? clean : null
}

function redirect(response, request, path) {
  response.statusCode = 301
  response.setHeader('Location', path + new URL(request.url, 'http://localhost').search)
  response.end()
}

function send(response, request, body, contentType) {
  response.statusCode = 200
  response.setHeader('Content-Type', contentType)
  response.setHeader('Cache-Control', 'no-cache')
  response.end(request.method === 'HEAD' ? undefined : body)
}

export function publicPreviewPlugin() {
  return {
    name: 'evolutus-public-preview',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, 'VITE_')
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        const path = new URL(request.url, 'http://localhost').pathname
        if (/^\/vitrine\/[0-9a-f-]{36}$/i.test(path)) {
          for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
            if (!process.env[name] && env[name]) process.env[name] = env[name]
          return storefrontDetail(request, response)
        }
        if (path === '/robots.txt')
          return send(response, request, renderRobots(), 'text/plain; charset=utf-8')
        if (path === '/sitemap.xml')
          return send(response, request, renderSitemap(), 'application/xml; charset=utf-8')
        const canonical = variant(path)
        if (canonical) return redirect(response, request, canonical)
        if (path === '/api/public-catalog-snapshot') {
          for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
            if (!process.env[name] && env[name]) process.env[name] = env[name]
          return catalogSnapshot(request, response)
        }
        if (routes.has(path)) {
          try {
            const html = renderPublicPage(path, env, { dev: true })
            // Generated HTML bypasses Vite's normal index.html middleware. Apply its
            // transforms so @vitejs/plugin-react installs the refresh preamble before
            // the public menu island is imported.
            const transformed = await server.transformIndexHtml(path, html, request.originalUrl)
            send(response, request, transformed, 'text/html; charset=utf-8')
          } catch (error) {
            next(error)
          }
        } else next()
      })
    },
    configurePreviewServer(server) {
      const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
      const source = config.rewrites.find((route) => route.destination === '/app-shell.html').source
      const match = source.match(/^\/:path\((.*)\)$/)
      const appRoute = new RegExp(`^${match[1]}$`)
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        const path = new URL(request.url, 'http://localhost').pathname
        const canonical = variant(path)
        if (canonical) return redirect(response, request, canonical)
        const file = routes.get(path) || (appRoute.test(path.slice(1)) ? 'app-shell.html' : null)
        if (!file) {
          if (/\.[\w]+$/.test(path)) return next()
          response.statusCode = 404
          response.setHeader('Content-Type', 'text/plain; charset=utf-8')
          response.end('Página não encontrada')
          return
        }
        send(
          response,
          request,
          readFileSync(join(server.config.root, 'dist', file)),
          'text/html; charset=utf-8'
        )
      })
    },
  }
}
