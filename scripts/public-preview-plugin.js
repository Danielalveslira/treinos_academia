import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import { publicPages, renderPublicConfig, renderPublicPage } from './public-pages-template.mjs'

const routes = new Map(publicPages.map(({ path, file }) => [path, file]))

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
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        const path = new URL(request.url, 'http://localhost').pathname
        if (path === '/public-config.js') {
          send(response, request, renderPublicConfig(env), 'application/javascript; charset=utf-8')
        } else if (routes.has(path)) {
          send(response, request, renderPublicPage(path, env, { dev: true }), 'text/html; charset=utf-8')
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
        const file = routes.get(path) || (appRoute.test(path.slice(1)) ? 'app-shell.html' : null)
        if (!file) {
          if (/\.[\w]+$/.test(path)) return next()
          response.statusCode = 404
          response.setHeader('Content-Type', 'text/plain; charset=utf-8')
          response.end('Página não encontrada')
          return
        }
        send(response, request, readFileSync(join(server.config.root, 'dist', file)), 'text/html; charset=utf-8')
      })
    },
  }
}
