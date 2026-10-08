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

// Telas/módulos que precisam abrir SEM rede no cold start offline (Home, Treino, Histórico, Exercícios,
// detalhe do exercício e o indicador de sincronização). Identificados pelo caminho-fonte, nunca pelo
// nome com hash: o hash muda a cada build e esta lista é resolvida contra o bundle gerado. Fica de fora
// o que é pesado ou exige servidor (Progresso/gráficos, Comunidades, Admin...): isso segue sob demanda.
export const OFFLINE_ESSENTIAL_MODULES = [
  'src/pages/Dashboard.jsx',
  'src/pages/NewWorkout.jsx',
  'src/pages/History.jsx',
  'src/pages/Exercises.jsx',
  'src/pages/ExerciseDetail.jsx',
  'src/components/SyncStatus.jsx',
  // Dependências dinâmicas do próprio cold start (abrir sem rede e pausar o Realtime):
  'src/services/offline/bootstrapEntry.js',
  'src/supabase/realtimeOffline.js',
]

// Chunks (JS/CSS) dos módulos essenciais: o chunk-fachada de cada um + TUDO que ele importa
// ESTATICAMENTE (chunks compartilhados e CSS). Imports dinâmicos não entram. Já exclui o que o boot
// precacheia. Falha o build se um módulo essencial sumir/for renomeado: o offline quebraria em silêncio.
export function collectOfflineAssets(bundle, bootAssets, modules = OFFLINE_ESSENTIAL_MODULES) {
  const boot = new Set(bootAssets)
  const seen = new Set()
  const visit = (fileName) => {
    const chunk = bundle[fileName]
    if (!chunk || chunk.type !== 'chunk' || seen.has(fileName)) return
    seen.add(fileName)
    for (const css of chunk.viteMetadata?.importedCss ?? []) seen.add(css)
    chunk.imports.forEach(visit)
  }
  for (const module of modules) {
    const facade = Object.values(bundle).find(
      (chunk) => chunk.type === 'chunk' && chunk.facadeModuleId?.replaceAll('\\', '/').endsWith(`/${module}`)
    )
    if (!facade) throw new Error(`Módulo offline essencial não encontrado no bundle: ${module}`)
    visit(facade.fileName)
  }
  return [...seen]
    .map((file) => `/${file}`)
    .filter((url) => !boot.has(url))
    .sort()
}

// Endpoint e chave PÚBLICA (anon) da RPC de telemetria do Push. Sem as duas variáveis (ou com URL que
// não seja https) o Service Worker sai sem telemetria, nunca com valores parciais.
export function pushAckConfig(env = {}) {
  const base = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '') : ''
  const key = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : ''
  let url = null
  try {
    const parsed = new URL(base)
    if (parsed.protocol === 'https:' && !parsed.search && !parsed.hash) url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/rest/v1/rpc/push_delivery_ack`
  } catch { /* URL inválida: sem telemetria */ }
  return url && key ? { url, key } : { url: null, key: null }
}

export function pwaPlugin() {
  let ack = { url: null, key: null }
  return {
    name: 'treinos-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      ack = pushAckConfig(config.env)
    },
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((file) => !file.endsWith('.map'))
      const hash = createHash('sha256')
      // A versão muda a cada alteração de qualquer arquivo do build (não só do boot): o
      // service worker novo é o sinal de "há versão nova" para PwaControls.
      for (const file of files) hash.update(bundle[file].code || bundle[file].source)
      for (const file of PUBLIC_SHELL_FILES) hash.update(readFileSync(`public/${file}`))
      const template = readFileSync('scripts/service-worker.js', 'utf8')
      const bootAssets = collectBootAssets(bundle)
      hash.update(template)
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 16))
        .replace(
          '__SHELL_URLS__',
          JSON.stringify(['/index.html', ...PUBLIC_SHELL_FILES.map((file) => `/${file}`)])
        )
        .replace('__BOOT_ASSETS__', JSON.stringify(bootAssets))
        .replace('__OFFLINE_ASSETS__', JSON.stringify(collectOfflineAssets(bundle, bootAssets)))
        .replace('__PUSH_ACK_URL__', () => JSON.stringify(ack.url))
        .replace('__PUSH_ACK_KEY__', () => JSON.stringify(ack.key))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
