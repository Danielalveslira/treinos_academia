import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DAILY_CATEGORIES, VOICES, getPool } from './catalog.js'
import { addDaysToDayKey } from '../../utils/businessDate.js'
import {
  chooseGreetingMessage,
  dayOrdinal,
  greetingFromContext,
  hashString,
  selectGreetingCategory,
} from './select.js'

test('dayOrdinal é aritmética de datas puras (independe do fuso do aparelho)', () => {
  assert.equal(dayOrdinal('1970-01-01'), 0)
  assert.equal(dayOrdinal('2026-10-11') - dayOrdinal('2026-10-10'), 1)
  assert.equal(dayOrdinal('2026-03-01') - dayOrdinal('2026-02-28'), 1)
  assert.equal(dayOrdinal('2028-03-01') - dayOrdinal('2028-02-28'), 2) // bissexto
})

test('hashString é estável', () => {
  assert.equal(hashString('abc'), hashString('abc'))
  assert.notEqual(hashString('abc'), hashString('abd'))
})

test('mesma pessoa/categoria/voz/dia => mesma frase, sempre (F5, outra aba, outro aparelho)', () => {
  const args = { category: 'morning', voice: 'neutro', userId: 'user-1', dayKey: '2026-10-10' }
  const first = chooseGreetingMessage(args)
  for (let i = 0; i < 50; i += 1) assert.equal(chooseGreetingMessage({ ...args }).id, first.id)
})

test('dias consecutivos na mesma categoria não repetem antes de consumir a pool', () => {
  for (const category of DAILY_CATEGORIES) {
    for (const voice of VOICES) {
      const size = getPool(category, voice).length
      const ids = []
      let day = '2026-10-01'
      for (let i = 0; i < size; i += 1) {
        ids.push(chooseGreetingMessage({ category, voice, userId: 'u1', dayKey: day }).id)
        day = addDaysToDayKey(day, 1)
      }
      assert.equal(new Set(ids).size, size, `${category}/${voice} repetiu em ${size} dias`)
      // e o ciclo recomeça igual depois de esgotar
      assert.equal(chooseGreetingMessage({ category, voice, userId: 'u1', dayKey: day }).id, ids[0])
    }
  }
})

test('pelo menos 12 dias seguidos sem repetição em qualquer voz', () => {
  for (const voice of VOICES) {
    const ids = new Set()
    let day = '2026-12-25' // atravessa mês e ano
    for (let i = 0; i < 12; i += 1) {
      ids.add(chooseGreetingMessage({ category: 'rest', voice, userId: 'u2', dayKey: day }).id)
      day = addDaysToDayKey(day, 1)
    }
    assert.equal(ids.size, 12)
  }
})

test('usuários diferentes percorrem ordens diferentes (sem perder a estabilidade de cada um)', () => {
  const sequence = (userId) =>
    Array.from(
      { length: 12 },
      (_, i) =>
        chooseGreetingMessage({
          category: 'morning',
          voice: 'neutro',
          userId,
          dayKey: addDaysToDayKey('2026-10-01', i),
        }).id
    )
  assert.deepEqual(sequence('alice'), sequence('alice'))
  assert.notDeepEqual(sequence('alice'), sequence('bruno'))
})

test('voz masculina/feminina mescla as próprias com as neutras da mesma categoria', () => {
  const seen = new Set()
  let day = '2026-10-01'
  for (let i = 0; i < 16; i += 1) {
    seen.add(
      chooseGreetingMessage({ category: 'night', voice: 'feminino', userId: 'u3', dayKey: day })
        .voice
    )
    day = addDaysToDayKey(day, 1)
  }
  assert.deepEqual([...seen].sort(), ['feminino', 'neutro'])
})

test('boas-vindas: uma frase por conta+voz, que não depende do dia', () => {
  const a = chooseGreetingMessage({
    category: 'welcome',
    voice: 'neutro',
    userId: 'u1',
    dayKey: '2026-10-24',
  })
  const b = chooseGreetingMessage({
    category: 'welcome',
    voice: 'neutro',
    userId: 'u1',
    dayKey: '2026-11-30',
  })
  assert.equal(a.id, b.id)
  assert.equal(a.category, 'welcome')
})

test('prioridade: completed > in_progress > welcome > rest > planned_due > planned > return > período', () => {
  const base = { timePeriod: 'morning', hasActivityData: true }
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'completed', welcomeActive: true }),
    'completed'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'in_progress', welcomeActive: true }),
    'in_progress'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'rest', welcomeActive: true }),
    'welcome'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'planned', welcomeActive: true }),
    'welcome'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'rest', daysSinceLastActivity: 9 }),
    'rest'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'planned', reminderDue: true }),
    'planned_due'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'planned', reminderDue: false }),
    'planned'
  )
  assert.equal(
    selectGreetingCategory({
      ...base,
      todayState: 'planned',
      reminderDue: true,
      daysSinceLastActivity: 9,
    }),
    'planned_due'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'none', daysSinceLastActivity: 3 }),
    'return'
  )
  assert.equal(
    selectGreetingCategory({ ...base, todayState: 'none', daysSinceLastActivity: 2 }),
    'morning'
  )
  assert.equal(selectGreetingCategory({ ...base, todayState: 'none' }), 'morning')
  assert.equal(
    selectGreetingCategory({ ...base, timePeriod: 'night', todayState: 'none' }),
    'night'
  )
})

test('sem histórico confiável: nada de descanso/plano/retorno, só saudação por período', () => {
  const base = { timePeriod: 'afternoon', hasActivityData: false, daysSinceLastActivity: 9 }
  for (const todayState of ['rest', 'planned', 'none'])
    assert.equal(selectGreetingCategory({ ...base, todayState, reminderDue: true }), 'afternoon')
  // mas o que a própria Home comprovou continua valendo
  assert.equal(selectGreetingCategory({ ...base, todayState: 'completed' }), 'completed')
})

test('treino concluído nunca cai em frase de "vamos treinar"', () => {
  for (const voice of VOICES) {
    let day = '2026-10-01'
    for (let i = 0; i < 20; i += 1) {
      const greeting = greetingFromContext(
        { category: 'completed', voice, dayKey: day, firstName: 'Ana' },
        'u1'
      )
      assert.equal(greeting.trainedToday, true)
      assert.doesNotMatch(
        greeting.heading.toLowerCase(),
        /vamos treinar|pronto para treinar|comece/
      )
      day = addDaysToDayKey(day, 1)
    }
  }
})

test('greetingFromContext devolve só o contrato da UI', () => {
  const greeting = greetingFromContext(
    { category: 'welcome', voice: 'feminino', dayKey: '2026-10-24', firstName: 'Bia' },
    'u9'
  )
  assert.deepEqual(Object.keys(greeting).sort(), [
    'category',
    'eyebrow',
    'heading',
    'id',
    'isWelcome',
    'trainedToday',
  ])
  assert.equal(greeting.isWelcome, true)
  assert.equal(greeting.trainedToday, false)
  assert.equal(greeting.eyebrow, 'BOAS-VINDAS AO EVOLUTUS')
})
