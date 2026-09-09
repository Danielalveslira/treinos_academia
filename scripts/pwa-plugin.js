import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function pwaPlugin() {
  return {
    name: 'treinos-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((file) => !file.endsWith('.map'))
      const publicAssets = [
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'icons/apple-touch-icon.png',
      ]
      const hash = createHash('sha256')
      for (const file of assets) hash.update(bundle[file].code || bundle[file].source)
      for (const file of publicAssets) hash.update(readFileSync(`public/${file}`))
      const template = readFileSync('scripts/service-worker.js', 'utf8')
      hash.update(template)
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 16))
        .replace(
          '__ASSETS__',
          JSON.stringify([...assets, ...publicAssets].map((file) => `/${file}`))
        )
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
