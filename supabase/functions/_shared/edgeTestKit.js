// Harness para testar o código REAL das Edge Functions em Node (o ambiente não tem Deno): empacota o
// index.ts com esbuild, troca `Deno` e o cliente Supabase (jsr:) por fakes em memória e devolve o handler
// passado a Deno.serve. Nada aqui toca rede nem Supabase de verdade.
import { Buffer } from 'node:buffer'
import { build } from 'esbuild'

export const SUPERADMIN = '11111111-1111-4111-8111-111111111111'
export const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222'
export const USER = '33333333-3333-4333-8333-333333333333'
export const CATALOG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const SET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// WebP mínimo ESTRUTURALMENTE válido para o leitor de cabeçalho e para a varredura de chunks: RIFF + VP8X
// (tamanho 10) + um chunk de preenchimento até 64 bytes. `chunk` troca o fourCC do preenchimento (ex.: 'EXIF',
// 'XMP ' para simular metadata); `riffSize`/`truncateTo` simulam arquivo cortado.
export function makeWebp(width = 1024, height = 1024, { truncateTo, riffSize, chunk = 'ALPH' } = {}) {
  const bytes = new Uint8Array(64)
  const view = new DataView(bytes.buffer)
  bytes.set(Buffer.from('RIFF'), 0)
  view.setUint32(4, riffSize ?? 64 - 8, true)
  bytes.set(Buffer.from('WEBP'), 8)
  bytes.set(Buffer.from('VP8X'), 12)
  view.setUint32(16, 10, true)
  const w = width - 1
  const h = height - 1
  bytes[24] = w & 0xff
  bytes[25] = (w >> 8) & 0xff
  bytes[26] = (w >> 16) & 0xff
  bytes[27] = h & 0xff
  bytes[28] = (h >> 8) & 0xff
  bytes[29] = (h >> 16) & 0xff
  bytes.set(Buffer.from(chunk), 30)
  view.setUint32(34, 64 - 38, true)
  return truncateTo ? bytes.subarray(0, truncateTo) : bytes
}

export async function loadHandler(entryUrl) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entryUrl).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    plugins: [
      {
        name: 'jsr-stub',
        setup(b) {
          b.onResolve({ filter: /^jsr:@supabase\/supabase-js/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            loader: 'js',
            contents: 'export const createClient = (url, key) => globalThis.__fake.client(key)',
          }))
        },
      },
    ],
  })
  let handler = null
  globalThis.Deno = {
    env: {
      get: (name) =>
        ({
          SUPABASE_URL: 'https://p.test',
          SUPABASE_ANON_KEY: 'anon-key',
          SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        })[name],
    },
    serve: (fn) => {
      handler = fn
    },
  }
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
  return handler
}

// Estado em memória: tabelas, buckets e chamadas registradas. `fail` injeta erros pontuais.
export function resetFake(overrides = {}) {
  const fake = {
    authUser: { id: SUPERADMIN },
    tables: {
      users: [
        { id: SUPERADMIN, role: 'superadmin' },
        { id: OTHER_ADMIN, role: 'superadmin' },
        { id: USER, role: 'user' },
      ],
      exercise_visual_sets: [
        { id: SET, catalog_id: CATALOG, version: 3, status: 'allocated', created_by: SUPERADMIN },
      ],
      exercise_visual_assets: [],
      exercise_catalog: [{ id: CATALOG, published_media_refs: { version: 3, images: [] } }],
    },
    buckets: { 'exercise-visual-drafts': new Map(), 'exercise-visuals': new Map() },
    rpcCalls: [],
    rpcResult: () => ({ data: { ok: true }, error: null }),
    downloads: [],
    uploads: [],
    removed: [],
    fail: {},
    ...overrides,
  }
  fake.client = (key) => (key === 'anon-key' ? userClient(fake) : adminClient(fake))
  globalThis.__fake = fake
  return fake
}

function userClient(fake) {
  return {
    auth: {
      getUser: async () =>
        fake.authUser
          ? { data: { user: fake.authUser }, error: null }
          : { data: { user: null }, error: { message: 'bad jwt' } },
    },
  }
}

function adminClient(fake) {
  return {
    from(table) {
      const filters = []
      const run = () =>
        (fake.tables[table] || []).filter((row) => filters.every(([col, val]) => row[col] === val))
      const builder = {
        select: () => builder,
        eq: (col, val) => {
          filters.push([col, val])
          return builder
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: run(), error: null }),
      }
      return builder
    },
    rpc: async (name, args) => {
      fake.rpcCalls.push([name, args])
      return fake.rpcResult(name, args)
    },
    storage: {
      from: (bucket) => ({
        download: async (path) => {
          fake.downloads.push([bucket, path])
          const bytes = fake.buckets[bucket]?.get(path)
          if (fake.fail.download?.(bucket, path) || !bytes)
            return { data: null, error: { message: 'Object not found' } }
          return { data: new Blob([bytes]), error: null }
        },
        upload: async (path, bytes, options) => {
          fake.uploads.push([bucket, path, options])
          const injected = fake.fail.upload?.(bucket, path)
          if (injected) return { error: injected }
          if (fake.buckets[bucket].has(path))
            return { error: { statusCode: '409', message: 'The resource already exists' } }
          fake.buckets[bucket].set(path, bytes)
          return { error: null }
        },
        exists: async (path) => ({
          data: fake.fail.exists ? false : fake.buckets[bucket].has(path),
          error: null,
        }),
        remove: async (paths) => {
          fake.removed.push([bucket, paths])
          if (fake.fail.remove) return { error: { message: 'boom' } }
          for (const path of paths) fake.buckets[bucket].delete(path)
          return { error: null }
        },
      }),
    },
  }
}

export const post = (body, { auth = 'Bearer jwt' } = {}) =>
  new Request('https://fn.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
