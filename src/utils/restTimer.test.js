import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearStoredRest,
  configuredRestSeconds,
  createRest,
  DEFAULT_REST_SECONDS,
  extendRest,
  formatRestClock,
  formatRestDuration,
  isRestExpired,
  loadStoredRest,
  MAX_TOTAL_REST_SECONDS,
  normalizeRestSeconds,
  parseStoredRest,
  remainingSeconds,
  resolveRestSeconds,
  restProgress,
  saveStoredRest,
} from './restTimer.js'

const NOW = 1_000_000
const SCOPE = 'user-a:sheet-a:2026-11-01'

function memoryStorage() {
  const store = new Map()
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

test('normalizeRestSeconds: ausente usa 90s, 0 desativa, fora da faixa é limitado', () => {
  assert.equal(normalizeRestSeconds(null), DEFAULT_REST_SECONDS)
  assert.equal(normalizeRestSeconds(undefined), DEFAULT_REST_SECONDS)
  assert.equal(normalizeRestSeconds(''), DEFAULT_REST_SECONDS)
  assert.equal(normalizeRestSeconds('abc'), DEFAULT_REST_SECONDS)
  assert.equal(normalizeRestSeconds(0), 0)
  assert.equal(normalizeRestSeconds(-5), 0)
  assert.equal(normalizeRestSeconds(60), 60)
  assert.equal(normalizeRestSeconds('45'), 45)
  assert.equal(normalizeRestSeconds(59.6), 60)
  assert.equal(normalizeRestSeconds(5000), 900)
})

test('createRest: calcula o término absoluto e não cria contagem desativada', () => {
  const rest = createRest({
    scope: SCOPE,
    exerciseId: 'squat',
    setKey: 3,
    restSeconds: 60,
    now: NOW,
  })
  assert.deepEqual(rest, {
    id: `squat:${NOW}`,
    scope: SCOPE,
    exerciseId: 'squat',
    setKey: 3,
    durationSeconds: 60,
    endsAt: NOW + 60_000,
  })
  assert.equal(createRest({ scope: SCOPE, exerciseId: 'squat', restSeconds: 0, now: NOW }), null)
  assert.equal(createRest({ scope: null, exerciseId: 'squat', restSeconds: 60, now: NOW }), null)
  assert.equal(createRest({ scope: SCOPE, exerciseId: '', restSeconds: 60, now: NOW }), null)
  assert.equal(
    createRest({ scope: SCOPE, exerciseId: 'squat', restSeconds: null, now: NOW }).durationSeconds,
    90
  )
})

test('tempo restante arredonda para cima, nunca fica negativo e independe de timers atrasados', () => {
  const rest = createRest({ scope: SCOPE, exerciseId: 'squat', restSeconds: 90, now: NOW })
  assert.equal(remainingSeconds(rest, NOW), 90)
  assert.equal(remainingSeconds(rest, NOW + 1), 90)
  assert.equal(remainingSeconds(rest, NOW + 1000), 89)
  assert.equal(remainingSeconds(rest, NOW + 89_001), 1)
  // Aba suspensa por 10 minutos: ao voltar, o cálculo é direto, sem "recuperar" ticks perdidos.
  assert.equal(remainingSeconds(rest, NOW + 600_000), 0)
  assert.equal(remainingSeconds(null, NOW), 0)
})

test('expiração e progresso', () => {
  const rest = createRest({ scope: SCOPE, exerciseId: 'squat', restSeconds: 60, now: NOW })
  assert.equal(isRestExpired(rest, NOW + 59_999), false)
  assert.equal(isRestExpired(rest, NOW + 60_000), true)
  assert.equal(restProgress(rest, NOW), 0)
  assert.equal(restProgress(rest, NOW + 30_000), 0.5)
  assert.equal(restProgress(rest, NOW + 120_000), 1)
})

test('+15s soma ao término e à duração; depois de acabar conta a partir de agora; respeita o teto', () => {
  const rest = createRest({ scope: SCOPE, exerciseId: 'squat', restSeconds: 60, now: NOW })
  const extended = extendRest(rest, 15, NOW + 10_000)
  assert.equal(extended.endsAt, NOW + 75_000)
  assert.equal(extended.durationSeconds, 75)
  assert.equal(extended.id, rest.id)
  const late = extendRest(rest, 15, NOW + 70_000)
  assert.equal(late.endsAt, NOW + 85_000)
  const capped = { ...rest, durationSeconds: MAX_TOTAL_REST_SECONDS }
  assert.equal(extendRest(capped, 15, NOW), capped)
  assert.equal(extendRest(null), null)
})

test('formatação: MM:SS e duração legível', () => {
  assert.equal(formatRestClock(72), '01:12')
  assert.equal(formatRestClock(0), '00:00')
  assert.equal(formatRestClock(900), '15:00')
  assert.equal(formatRestDuration(90), '1min30s')
  assert.equal(formatRestDuration(120), '2min')
  assert.equal(formatRestDuration(45), '45s')
})

test('restauração: aceita somente o mesmo escopo, íntegro e ainda ativo', () => {
  const storage = memoryStorage()
  const rest = createRest({
    scope: SCOPE,
    exerciseId: 'squat',
    setKey: 4,
    restSeconds: 60,
    now: NOW,
  })
  saveStoredRest(rest, storage)
  const raw = [...storage.store.values()][0]
  // Só o essencial é persistido (sem chave de série, nome, dados de treino).
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    'durationSeconds',
    'endsAt',
    'exerciseId',
    'scope',
    'v',
  ])
  const restored = parseStoredRest(raw, SCOPE, NOW + 20_000)
  assert.equal(restored.exerciseId, 'squat')
  assert.equal(restored.endsAt, rest.endsAt)
  assert.equal(restored.setKey, null)
  assert.equal(remainingSeconds(restored, NOW + 20_000), 40)

  assert.equal(parseStoredRest(raw, 'user-b:sheet-a:2026-11-01', NOW), null, 'outro usuário')
  assert.equal(parseStoredRest(raw, 'user-a:sheet-b:2026-11-01', NOW), null, 'outra ficha')
  assert.equal(parseStoredRest(raw, 'user-a:sheet-a:2026-11-02', NOW), null, 'outro dia')
  assert.equal(parseStoredRest(raw, SCOPE, NOW + 60_000), null, 'expirado')
  assert.equal(parseStoredRest(raw, null, NOW), null)
})

test('restauração: descarta dados inválidos ou adulterados', () => {
  const valid = {
    v: 1,
    scope: SCOPE,
    exerciseId: 'squat',
    durationSeconds: 60,
    endsAt: NOW + 30_000,
  }
  const cases = [
    'not json',
    'null',
    '[]',
    JSON.stringify({ ...valid, v: 2 }),
    JSON.stringify({ ...valid, exerciseId: 7 }),
    JSON.stringify({ ...valid, exerciseId: '' }),
    JSON.stringify({ ...valid, durationSeconds: 0 }),
    JSON.stringify({ ...valid, durationSeconds: 1.5 }),
    JSON.stringify({ ...valid, durationSeconds: MAX_TOTAL_REST_SECONDS + 1 }),
    JSON.stringify({ ...valid, endsAt: 'soon' }),
    // Término mais distante que a própria duração: relógio alterado ou dado forjado.
    JSON.stringify({ ...valid, endsAt: NOW + 10 * 60_000 }),
  ]
  for (const raw of cases) assert.equal(parseStoredRest(raw, SCOPE, NOW), null, raw)
  assert.ok(parseStoredRest(JSON.stringify(valid), SCOPE, NOW))
})

test('loadStoredRest remove o registro inválido; storage bloqueado nunca lança', () => {
  const storage = memoryStorage()
  storage.setItem('evolutus:rest-timer', 'lixo')
  assert.equal(loadStoredRest(SCOPE, NOW, storage), null)
  assert.equal(storage.store.size, 0)

  const blocked = {
    getItem() {
      throw new Error('SecurityError')
    },
    setItem() {
      throw new Error('QuotaExceeded')
    },
    removeItem() {
      throw new Error('SecurityError')
    },
  }
  assert.equal(loadStoredRest(SCOPE, NOW, blocked), null)
  assert.doesNotThrow(() =>
    saveStoredRest(
      createRest({ scope: SCOPE, exerciseId: 'a', restSeconds: 30, now: NOW }),
      blocked
    )
  )
  assert.doesNotThrow(() => clearStoredRest(blocked))
  assert.doesNotThrow(() => clearStoredRest(undefined))
})

test('pular = limpar: saveStoredRest(null) e clearStoredRest removem a contagem', () => {
  const storage = memoryStorage()
  saveStoredRest(createRest({ scope: SCOPE, exerciseId: 'a', restSeconds: 30, now: NOW }), storage)
  assert.equal(storage.store.size, 1)
  saveStoredRest(null, storage)
  assert.equal(storage.store.size, 0)
  saveStoredRest(createRest({ scope: SCOPE, exerciseId: 'a', restSeconds: 30, now: NOW }), storage)
  clearStoredRest(storage)
  assert.equal(storage.store.size, 0)
})

test('configuredRestSeconds: só inteiros 0–900 contam como escolha; 0 nunca é "ausente"', () => {
  assert.equal(configuredRestSeconds(0), 0)
  assert.equal(configuredRestSeconds('0'), 0)
  assert.equal(configuredRestSeconds(60), 60)
  assert.equal(configuredRestSeconds('120'), 120)
  assert.equal(configuredRestSeconds(900), 900)
  for (const value of [
    null,
    undefined,
    '',
    ' ',
    'abc',
    '-1',
    '1.5',
    -1,
    901,
    1.5,
    NaN,
    {},
    [],
    false,
    true,
  ])
    assert.equal(configuredRestSeconds(value), null, JSON.stringify(value))
})

test('prioridade: exercício > padrão do usuário > 90s, distinguindo null de 0', () => {
  // Usuário sem preferência, exercício sem tempo próprio (ficha antiga): padrão do sistema.
  assert.equal(resolveRestSeconds(null, null), 90)
  assert.equal(resolveRestSeconds(undefined, undefined), 90)
  // Exercício herdando o padrão do usuário.
  assert.equal(resolveRestSeconds(null, 60), 60)
  assert.equal(resolveRestSeconds(undefined, 120), 120)
  // Exercício com tempo próprio vence o padrão do usuário.
  assert.equal(resolveRestSeconds(45, 120), 45)
  assert.equal(resolveRestSeconds(90, 30), 90)
  // 0 desativa e não é substituído por padrão nenhum.
  assert.equal(resolveRestSeconds(0, 120), 0)
  assert.equal(resolveRestSeconds(null, 0), 0)
  // Valores corrompidos caem para o próximo nível em vez de travar o cronômetro.
  assert.equal(resolveRestSeconds(5000, 60), 60)
  assert.equal(resolveRestSeconds(null, 'x'), 90)
})

test('formatRestDuration(0) é "Sem descanso"', () => {
  assert.equal(formatRestDuration(0), 'Sem descanso')
})
