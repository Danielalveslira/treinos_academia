// Verificação MANUAL (somente leitura) da prévia de atividade das Comunidades e dos RPCs em lote do feed contra o Supabase
// hospedado: roda a função real do app (listLatestCommunityActivity) e confere cada resultado
// contra uma consulta independente de "última publicação" por comunidade, o que valida a
// compatibilidade do PostgREST (limite do recurso embutido aplicado POR comunidade) e o RLS.
//
// Uso (conta de TESTE que seja membro de ao menos uma comunidade; nunca use service-role):
//   VERIFY_EMAIL=teste@exemplo.com VERIFY_PASSWORD='...' node scripts/verify-communities-activity.mjs
// Lê VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY de .env (só essas duas chaves). A senha e os
// tokens nunca são impressos. Faz login com a conta informada (cria uma sessão de auth) e só
// executa SELECTs; não escreve em nenhuma tabela.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'

const root = resolve(new URL('..', import.meta.url).pathname)
const { VERIFY_EMAIL: email, VERIFY_PASSWORD: password } = process.env
if (!email || !password) {
  console.error('Defina VERIFY_EMAIL e VERIFY_PASSWORD (conta de teste).')
  process.exit(2)
}

const env = Object.fromEntries(
  (await readFile(join(root, '.env'), 'utf8'))
    .split('\n')
    .map((line) => line.match(/^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
)
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes em .env.')
  process.exit(2)
}

let httpCalls = 0
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (...args) => {
      if (String(args[0]).includes('/rest/v1/')) httpCalls += 1
      return fetch(...args)
    },
  },
})
const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
if (signInError) {
  console.error('Falha no login da conta de teste:', signInError.status || '', signInError.code || '')
  process.exit(2)
}

// Empacota o serviço real do app trocando só o cliente Supabase pelo autenticado acima.
const dir = await mkdtemp(join(tmpdir(), 'verify-communities-'))
try {
  const outfile = join(dir, 'service.cjs')
  await build({
    stdin: {
      contents: `export { listLatestCommunityActivity, ACTIVITY_BATCH_SIZE } from './src/services/statusesService.js'`,
      resolveDir: root,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'authenticated-supabase',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({ path: args.path, namespace: 'auth' }))
          b.onLoad({ filter: /.*/, namespace: 'auth' }, () => ({
            contents: 'export const supabase = globalThis.__verifySupabase',
          }))
        },
      },
    ],
  })
  globalThis.__verifySupabase = supabase
  const { listLatestCommunityActivity, ACTIVITY_BATCH_SIZE } = createRequire(import.meta.url)(outfile)

  const { data: me } = await supabase.auth.getUser()
  const { data: memberships, error: membersError } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', me.user.id)
  if (membersError) throw membersError
  const ids = memberships.map((row) => row.community_id)
  console.log(`Comunidades da conta de teste: ${ids.length} (lote = ${ACTIVITY_BATCH_SIZE})`)
  if (ids.length === 0) {
    console.error('A conta precisa ser membro de ao menos uma comunidade.')
    process.exit(2)
  }

  httpCalls = 0
  const { activity, checkedIds, partial } = await listLatestCommunityActivity(ids)
  const batchCalls = httpCalls
  console.log(`Função do app: ${batchCalls} requisições REST, ${Object.keys(activity).length} prévias, verificadas ${checkedIds.length}/${ids.length}, partial=${partial}`)

  // Verdade independente: a última publicação não expirada de cada comunidade, uma a uma.
  const nowIso = new Date().toISOString()
  let mismatches = 0
  for (const id of ids) {
    const { data, error } = await supabase
      .from('statuses')
      .select('id')
      .eq('community_id', id)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const expected = data[0]?.id ?? null
    const got = activity[id]?.id ?? null
    if (expected !== got) {
      mismatches += 1
      console.error(`DIVERGENTE ${id}: esperado=${expected} obtido=${got}`)
    }
  }

  // N comunidades => ceil(N/lote) leituras de publicações (+ avatares dos autores, em lotes
  // também); o ponto é NÃO ser 1 requisição por comunidade.
  const maxCalls = Math.ceil(ids.length / ACTIVITY_BATCH_SIZE) + Math.ceil(Object.keys(activity).length / ACTIVITY_BATCH_SIZE)
  const checks = [
    ['resultado do lote == consulta por comunidade (limite por comunidade OK)', mismatches === 0],
    ['todas as comunidades foram verificadas, sem falha parcial', checkedIds.length === ids.length && !partial],
    [`requisições em lote: ${batchCalls} <= ${maxCalls} (não 1 por comunidade)`, batchCalls <= maxCalls],
  ]
  // --- RPCs em lote do feed (migration 20261017000001) x RPCs unitárias de sempre -------------------------
  // Para as enquetes/treinos recentes das comunidades da conta, o lote precisa devolver exatamente o que a
  // chamada unitária devolve; e ids que a conta não pode ver (aleatórios) não devolvem nada (fail-closed).
  const { data: recent, error: recentError } = await supabase
    .from('statuses')
    .select('id,type')
    .in('community_id', ids.slice(0, 40))
    .in('type', ['poll', 'workout'])
    .order('created_at', { ascending: false })
    .limit(40)
  if (recentError) throw recentError
  const polls = recent.filter((row) => row.type === 'poll').map((row) => row.id).slice(0, 10)
  const workouts = recent.filter((row) => row.type === 'workout').map((row) => row.id).slice(0, 10)
  const rpcBatchAvailable = (await supabase.rpc('get_poll_results_batch', { p_status_ids: [] })).error === null
  if (!rpcBatchAvailable) console.log('AVISO  RPCs em lote ainda não existem neste projeto (migration 20261017000001): o app usa o fallback unitário.')
  if (rpcBatchAvailable) {
    const batchPolls = await supabase.rpc('get_poll_results_batch', { p_status_ids: polls })
    let pollMismatches = 0
    for (const id of polls) {
      const single = await supabase.rpc('get_poll_results', { p_status_id: id })
      const fromBatch = Object.fromEntries((batchPolls.data ?? []).filter((r) => r.status_id === id).map((r) => [r.option_id, Number(r.votes)]))
      const fromSingle = Object.fromEntries((single.data ?? []).map((r) => [r.option_id, Number(r.votes)]))
      if (JSON.stringify(Object.entries(fromBatch).sort()) !== JSON.stringify(Object.entries(fromSingle).sort())) pollMismatches += 1
    }
    const batchWorkouts = await supabase.rpc('count_workout_participants_batch', { p_status_ids: workouts })
    let workoutMismatches = 0
    for (const id of workouts) {
      const single = await supabase.rpc('count_workout_participants', { p_status_id: id })
      const fromBatch = (batchWorkouts.data ?? []).find((r) => r.status_id === id)?.participants
      if (Number(fromBatch) !== Number(single.data)) workoutMismatches += 1
    }
    const strangers = Array.from({ length: 5 }, () => crypto.randomUUID())
    const strangerPolls = await supabase.rpc('get_poll_results_batch', { p_status_ids: strangers })
    const strangerWorkouts = await supabase.rpc('count_workout_participants_batch', { p_status_ids: strangers })
    console.log(`RPCs em lote: ${polls.length} enquetes e ${workouts.length} treinos comparados com as chamadas unitárias`)
    checks.push(
      ['RPC em lote de enquetes == chamada unitária', batchPolls.error === null && pollMismatches === 0],
      ['RPC em lote de treinos == chamada unitária', batchWorkouts.error === null && workoutMismatches === 0],
      ['ids que a conta não pode ver não devolvem nada (fail-closed)', (strangerPolls.data ?? []).length === 0 && (strangerWorkouts.data ?? []).length === 0]
    )
  }
  checks.forEach(([label, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`))
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1
} finally {
  await supabase.auth.signOut()
  await rm(dir, { recursive: true, force: true })
}
