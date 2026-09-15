import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const URL_PREFIX = '/exercise-catalog-assets/v1/'
const GENERATED_ROOT = resolve('.generated/exercise-catalog-images/v1')
const SAFE_ASSET_PATH = /^[A-Za-z0-9_() .-]+\/(?:thumb|[0-9]+)\.webp$/

export function localExerciseCatalogImagesPlugin() {
  return {
    name: 'local-exercise-catalog-images',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (!pathname.startsWith(URL_PREFIX)) return next()

        let relativePath
        try {
          relativePath = decodeURIComponent(pathname.slice(URL_PREFIX.length))
        } catch {
          response.statusCode = 400
          return response.end()
        }

        if (!SAFE_ASSET_PATH.test(relativePath)) {
          response.statusCode = 404
          return response.end()
        }

        const filePath = resolve(GENERATED_ROOT, relativePath)
        if (!filePath.startsWith(`${GENERATED_ROOT}${sep}`) || !existsSync(filePath)) {
          response.statusCode = 404
          return response.end()
        }

        const metadata = await stat(filePath)
        response.setHeader('Content-Type', 'image/webp')
        response.setHeader('Content-Length', metadata.size)
        response.setHeader('Cache-Control', 'no-cache')
        if (request.method === 'HEAD') return response.end()
        createReadStream(filePath).pipe(response)
      })
    },
  }
}
