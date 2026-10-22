// Fixtures descartáveis para a stack de homologação local. Nunca aceita URL remota.
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { jwt } from '../homolog/keys.mjs'

const output = '/tmp/evolutus-load/fixtures.json'
const auth = 'http://127.0.0.1:55432'
const rest = 'http://127.0.0.1:55431'
const service = jwt({ role: 'service_role' })
const anon = jwt({ role: 'anon' })
const count = Number(process.env.LOAD_USERS || 100)
if (!Number.isInteger(count) || count < 5 || count > 1000) throw new Error('LOAD_USERS deve estar entre 5 e 1000')

async function api(url, method, body, key = service) {
  const response = await fetch(url, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`${method} ${new URL(url).pathname}: ${response.status} ${raw.slice(0, 350)}`)
  return raw ? JSON.parse(raw) : null
}

async function main() {
  // Respostas das duas portas locais são verificadas antes de qualquer escrita.
  await Promise.all([api(`${auth}/health`, 'GET'), api(`${rest}/`, 'GET')])
  try {
    const prior = JSON.parse(await readFile(output, 'utf8'))
    if (prior.users.length >= count) {
      console.log(`Fixture local reutilizada: ${prior.users.length} usuários (${prior.runId})`)
      return
    }
  } catch { /* preparar uma fixture nova */ }

  const runId = process.env.LOAD_RECOVER_RUN_ID || randomUUID().slice(0, 8)
  const password = `Load!${randomUUID()}aA1`
  const users = []
  const recovering = Boolean(process.env.LOAD_RECOVER_RUN_ID)
  const existing = recovering ? (await api(`${auth}/admin/users?page=1&per_page=1000`, 'GET')).users
    .filter((user) => user.email?.startsWith(`load-${runId}-`)) : []
  if (recovering && existing.length !== count) throw new Error(`Esperados ${count} usuários do run ${runId}, encontrados ${existing.length}`)
  for (let start = 0; start < count; start += 5) {
    const batch = await Promise.all(Array.from({ length: Math.min(5, count - start) }, async (_, offset) => {
      const i = start + offset
      const email = `load-${runId}-${i}@example.invalid`
      const created = recovering
        ? await api(`${auth}/admin/users/${existing.find((user) => user.email === email)?.id}`, 'PUT', { password })
        : await api(`${auth}/admin/users`, 'POST', { email, password, email_confirm: true, user_metadata: { load_test: runId } })
      const session = await api(`${auth}/token?grant_type=password`, 'POST', { email, password }, anon)
      return { id: created.id, email, accessToken: session.access_token, refreshToken: session.refresh_token }
    }))
    users.push(...batch)
  }
  const day = new Date().toISOString().slice(0, 10)
  const exercises = recovering
    ? (await api(`${rest}/exercises?select=id,user_id&name=eq.${encodeURIComponent(`Supino teste ${runId}`)}`, 'GET'))
    : users.map((user) => ({ id: randomUUID(), user_id: user.id, name: `Supino teste ${runId}`, muscle_group: 'peito', type: 'strength', active: true }))
  if (!recovering) await api(`${rest}/exercises`, 'POST', exercises)
  if (recovering && exercises.length !== count) throw new Error(`Exercícios da fixture incompletos: ${exercises.length}`)
  const exerciseByUser = new Map(exercises.map((exercise) => [exercise.user_id, exercise.id]))
  const workouts = exercises.flatMap((exercise, i) => Array.from({ length: 30 }, (_, n) => ({
    id: randomUUID(), user_id: users[i].id, exercise_id: exerciseByUser.get(users[i].id), type: 'strength',
    date: new Date(Date.now() - n * 86400000).toISOString().slice(0, 10),
    set_details: [{ weight: 20 + n % 4, reps: 10 }, { weight: 20 + n % 4, reps: 8 }], sets: 2, note: `load-${runId}`,
  })))
  if (!recovering) for (let i = 0; i < workouts.length; i += 250) await api(`${rest}/workouts`, 'POST', workouts.slice(i, i + 250))

  const existingCommunity = recovering
    ? (await api(`${rest}/communities?select=id&name=eq.${encodeURIComponent(`Comunidade carga ${runId}`)}`, 'GET'))[0]
    : null
  const community = existingCommunity || (await api(`${rest}/communities`, 'POST', [{
    id: randomUUID(), name: `Comunidade carga ${runId}`, description: 'Fixture local de desempenho',
    created_by: users[0].id, owner_id: users[0].id, is_active: true, tier: 'essential',
  }]))[0]
  if (!existingCommunity) {
    await api(`${rest}/community_members`, 'POST', users.map((user) => ({ community_id: community.id, user_id: user.id })))
    await api(`${rest}/statuses`, 'POST', Array.from({ length: 30 }, (_, i) => ({
      community_id: community.id, author_id: users[i % users.length].id,
      author_username: `load_${runId}_${i}`, type: 'text', text: `Publicação sintética ${i}`,
    })))
  }
  const fixture = { runId, createdAt: new Date().toISOString(), day, auth, rest, anon, communityId: community.id, users: users.map((user) => ({ ...user, exerciseId: exerciseByUser.get(user.id) })) }
  await mkdir('/tmp/evolutus-load', { recursive: true })
  await writeFile(output, JSON.stringify(fixture), { mode: 0o600 })
  await chmod(output, 0o600)
  console.log(`Fixture local criada: ${count} usuários, ${workouts.length} treinos, 30 publicações (${runId})`)
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
