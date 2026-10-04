import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Arquivos de public/ sem hash no nome: entram no cache do shell (versionado por build).
const PUBLIC_SHELL_FILES = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
]

// JS/CSS necessários para o boot: o(s) chunk(s) de entrada, tudo que eles importam
// ESTATICAMENTE (o <link rel="modulepreload"> do index.html) e o CSS desses chunks. Chunks de
// rota (import() dinâmico: Admin, Comunidades, gráficos...) ficam de fora: são baixados e
// guardados em cache só quando o usuário abre aquela tela.
export function collectBootAssets(bundle) {
  const seen = new Set()
  const visit = (fileName) => {
    const chunk = bundle[fileName]
    if (!chunk || chunk.type !== 'chunk' || seen.has(fileName)) return
    seen.add(fileName)
    for (const css of chunk.viteMetadata?.importedCss ?? []) seen.add(css)
    chunk.imports.forEach(visit)
  }
  Object.values(bundle)
    .filter((chunk) => chunk.type === 'chunk' && chunk.isEntry)
    .forEach((chunk) => visit(chunk.fileName))
  return [...seen].sort().map((file) => `/${file}`)
}

export function pwaPlugin() {
  return {
    name: 'treinos-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((file) => !file.endsWith('.map'))
      const hash = createHash('sha256')
      // A versão muda a cada alteração de qualquer arquivo do build (não só do boot): o
      // service worker novo é o sinal de "há versão nova" para PwaControls.
      for (const file of files) hash.update(bundle[file].code || bundle[file].source)
      for (const file of PUBLIC_SHELL_FILES) hash.update(readFileSync(`public/${file}`))
      const template = readFileSync('scripts/service-worker.js', 'utf8')
      hash.update(template)
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 16))
        .replace(
          '__SHELL_URLS__',
          JSON.stringify(['/index.html', ...PUBLIC_SHELL_FILES.map((file) => `/${file}`)])
        )
        .replace('__BOOT_ASSETS__', JSON.stringify(collectBootAssets(bundle)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
