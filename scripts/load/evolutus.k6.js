// k6 em homologação LOCAL: `docker run --network host ... grafana/k6 run /work/evolutus.k6.js`.
// O endereço dos serviços é fixo em loopback; este arquivo não aceita alvos remotos.
/* global __ENV, __VU */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const fixture = JSON.parse(open('/fixture/fixtures.json'))
if (fixture.auth !== 'http://127.0.0.1:55432' || fixture.rest !== 'http://127.0.0.1:55431') {
  throw new Error('A fixture deve apontar exclusivamente para a homologação local')
}
const site = 'http://127.0.0.1:4173'
const vus = Number(__ENV.LOAD_VUS || 5)
const duration = __ENV.LOAD_DURATION || '45s'
const profile = __ENV.LOAD_PROFILE || 'sustained'
if (!Number.isInteger(vus) || vus < 1 || vus > 1000) throw new Error('LOAD_VUS inválido')
if (vus > fixture.users.length) throw new Error('Crie ao menos uma conta sintética local por VU antes de aumentar a carga')
const publicVus = Math.max(1, Math.round(vus * 0.4))
const writeVus = Math.max(1, Math.round(vus * 0.15))
const readVus = vus - publicVus - writeVus
if (readVus < 1) throw new Error('Distribuição de VUs inválida')

function scenario(exec, n, d) {
  return { executor: 'constant-vus', exec, vus: n, duration: d, gracefulStop: '5s' }
}
const scenarios = profile === 'spike'
  ? {
      public: { executor: 'ramping-vus', exec: 'publicJourney', startVUs: 0, stages: [
        { duration: '10s', target: Math.max(1, Math.round(publicVus / 5)) },
        { duration: '5s', target: publicVus }, { duration: '25s', target: publicVus },
        { duration: '10s', target: 0 },
      ] },
      read: { executor: 'ramping-vus', exec: 'readJourney', startVUs: 0, stages: [
        { duration: '10s', target: Math.max(1, Math.round(readVus / 5)) },
        { duration: '5s', target: readVus }, { duration: '25s', target: readVus },
        { duration: '10s', target: 0 },
      ] },
      write: { executor: 'ramping-vus', exec: 'writeJourney', startVUs: 0, stages: [
        { duration: '10s', target: 1 }, { duration: '5s', target: writeVus },
        { duration: '25s', target: writeVus }, { duration: '10s', target: 0 },
      ] },
    }
  : { public: scenario('publicJourney', publicVus, duration), read: scenario('readJourney', readVus, duration), write: scenario('writeJourney', writeVus, duration) }

export const options = {
  scenarios,
  rps: profile === 'stress' ? 150 : undefined,
  discardResponseBodies: false,
  noConnectionReuse: false,
  thresholds: {
    http_req_failed: ['rate<0.01', { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
    functional_failures: ['rate<0.01', { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
    http_req_duration: [{ threshold: 'p(95)<5000', abortOnFail: true, delayAbortEval: '20s' }],
    'http_req_duration{scenario:public}': ['p(95)<500'],
    'http_req_duration{scenario:read}': ['p(95)<1000'],
    'http_req_duration{scenario:write}': ['p(95)<1000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const functionalFailures = new Rate('functional_failures')
let session
let iteration = 0
let socialPosts = 0
function identity() {
  if (!session) session = { ...fixture.users[(__VU - 1) % fixture.users.length] }
  return session
}
function apiHeaders(token) {
  return { apikey: fixture.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}
function verify(response, name, valid = () => true) {
  let ok = response.status >= 200 && response.status < 300
  if (ok) {
    try { ok = valid(response.headers['Content-Type']?.includes('json') ? response.json() : response.body) } catch { ok = false }
  }
  if (!ok && iteration < 3) console.error(`${name}: HTTP ${response.status}, ${String(response.body).slice(0, 180)}`)
  check(response, { [`${name} funcional`]: () => ok })
  functionalFailures.add(!ok, { journey: name })
}
function pause() { sleep(profile === 'stress' ? 0.5 + Math.random() * 0.5 : 2 + Math.random() * 2) }

export function publicJourney() {
  const path = ['/', '/como-funciona', '/vitrine', '/profissionais'][iteration++ % 4]
  const response = http.get(`${site}${path}`, { tags: { name: `public ${path}` }, timeout: '8s' })
  verify(response, `public ${path}`, (body) => typeof body === 'string' && body.includes('<html'))
  if (path === '/vitrine' || path === '/profissionais') {
    const directory = http.post(`${fixture.rest}/rpc/public_list_professionals`, JSON.stringify({
      p_kind: path === '/profissionais' ? 'professional' : 'space', p_offset: 0, p_limit: 20,
    }), { headers: apiHeaders(fixture.anon), tags: { name: 'directory rpc' }, timeout: '8s' })
    verify(directory, 'directory', (body) => Array.isArray(body.items))
  }
  pause()
}

export function readJourney() {
  const user = identity()
  const branch = iteration++ % 5
  if (branch === 0) {
    const since = new Date(Date.now() - 371 * 86400000).toISOString().slice(0, 10)
    const responses = http.batch([
      ['GET', `${fixture.rest}/workouts?select=*&user_id=eq.${user.id}&date=gte.${since}&order=date.desc,created_at.desc&limit=500`, null, { headers: apiHeaders(user.accessToken), tags: { name: 'dashboard workouts' }, timeout: '8s' }],
      ['POST', `${fixture.rest}/rpc/get_workout_statistics`, JSON.stringify({ p_user_id: user.id, p_day: null }), { headers: apiHeaders(user.accessToken), tags: { name: 'dashboard stats' }, timeout: '8s' }],
    ])
    responses.forEach((response, i) => verify(response, `dashboard ${i}`, Array.isArray))
  } else if (branch === 1) {
    const response = http.get(`${fixture.rest}/exercises?select=*&user_id=eq.${user.id}&active=eq.true`, { headers: apiHeaders(user.accessToken), tags: { name: 'train exercises' }, timeout: '8s' })
    verify(response, 'train selection', (body) => Array.isArray(body) && body.length > 0)
  } else if (branch === 2) {
    const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    const response = http.post(`${fixture.rest}/rpc/list_progress_days`, JSON.stringify({ p_start: start, p_end: fixture.day }), { headers: apiHeaders(user.accessToken), tags: { name: 'progress rpc' }, timeout: '8s' })
    verify(response, 'progress', Array.isArray)
  } else if (branch === 3) {
    const responses = http.batch([
      ['GET', `${fixture.rest}/status_publications?select=id,community_id,author_id,type,created_at,text&community_id=eq.${fixture.communityId}&order=created_at.desc&limit=11`, null, { headers: apiHeaders(user.accessToken), tags: { name: 'community feed' }, timeout: '8s' }],
      ['POST', `${fixture.rest}/rpc/list_my_community_access`, '{}', { headers: apiHeaders(user.accessToken), tags: { name: 'community access' }, timeout: '8s' }],
    ])
    responses.forEach((response, i) => verify(response, `community ${i}`, Array.isArray))
  } else {
    const response = http.get(`${fixture.auth}/user`, { headers: apiHeaders(user.accessToken), tags: { name: 'auth user' }, timeout: '8s' })
    verify(response, 'auth user', (body) => body.id === user.id)
    if (iteration % 25 === 0) {
      const refreshed = http.post(`${fixture.auth}/token?grant_type=refresh_token`, JSON.stringify({ refresh_token: user.refreshToken }), { headers: apiHeaders(fixture.anon), tags: { name: 'auth refresh' }, timeout: '8s' })
      verify(refreshed, 'auth refresh', (body) => Boolean(body.access_token && body.refresh_token))
      if (refreshed.status === 200) {
        const data = refreshed.json()
        user.accessToken = data.access_token
        user.refreshToken = data.refresh_token
      }
    }
  }
  pause()
}

export function writeJourney() {
  const user = identity()
  const branch = iteration++ % 5
  // O stress acelera leitura/treino sem transformar a política legítima de 5 posts/min
  // por autor em um falso erro de infraestrutura. A escrita social fica no load/soak.
  if (profile === 'stress' || branch < 4 || socialPosts >= 2) {
    const response = http.post(`${fixture.rest}/workouts?select=id`, JSON.stringify({
      user_id: user.id, exercise_id: user.exerciseId, type: 'strength', date: fixture.day,
      set_details: [{ weight: 24, reps: 10 }, { weight: 24, reps: 8 }], sets: 2,
      note: `load-${fixture.runId}`,
    }), { headers: { ...apiHeaders(user.accessToken), Prefer: 'return=representation' }, tags: { name: 'workout write' }, timeout: '8s' })
    verify(response, 'workout write', (body) => Array.isArray(body) && body.length === 1)
  } else {
    const response = http.post(`${fixture.rest}/statuses?select=id`, JSON.stringify({
      community_id: fixture.communityId, author_id: user.id, type: 'text',
      text: `Mensagem sintética load-${fixture.runId} ${Date.now()}`,
    }), { headers: { ...apiHeaders(user.accessToken), Prefer: 'return=representation' }, tags: { name: 'community write' }, timeout: '8s' })
    verify(response, 'community write', (body) => Array.isArray(body) && body.length === 1)
    if (response.status >= 200 && response.status < 300) socialPosts += 1
  }
  pause()
}
