import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGreetingContext,
  getTimePeriod,
  resolveFirstName,
  resolveGreetingVoice,
} from './context.js'
import { greetingFromContext } from './select.js'
import { parseWelcomeCutoff } from './config.js'

const CUTOFF = Date.parse('2026-10-24T00:00:00-03:00')
const newcomer = {
  username: 'ana',
  accountStatus: 'active',
  createdAt: '2026-10-25T12:00:00Z',
  welcomeSeenAt: null,
  welcomeCutoffMs: CUTOFF,
}
const now = new Date(2026, 9, 26, 9, 0, 0)

test('voz: só "neutro" é escolha explícita; auto, legado (masculino/feminino) e qualquer outro valor usam o sexo do cadastro', () => {
  assert.equal(resolveGreetingVoice('neutro', 'feminino'), 'neutro')
  assert.equal(resolveGreetingVoice('neutro', 'masculino'), 'neutro')
  assert.equal(resolveGreetingVoice('auto', 'masculino'), 'masculino')
  assert.equal(resolveGreetingVoice('auto', 'feminino'), 'feminino')
  // Legado: contas que escolheram masculino/feminino antes desta mudança passam a se comportar como 'auto'.
  assert.equal(resolveGreetingVoice('masculino', 'feminino'), 'feminino')
  assert.equal(resolveGreetingVoice('feminino', 'masculino'), 'masculino')
  for (const sexo of ['nao_informar', undefined, null, '', 'outro', 42])
    assert.equal(resolveGreetingVoice('auto', sexo), 'neutro')
  for (const voice of [undefined, null, 'qualquer', 7, 'masculino', 'feminino']) {
    assert.equal(resolveGreetingVoice(voice, undefined), 'neutro')
    assert.equal(resolveGreetingVoice(voice, 'feminino'), 'feminino')
  }
})

test('período local: madrugada/noite, manhã, tarde (fronteiras 05:00, 12:00, 18:00)', () => {
  const at = (hour, minute = 0) => getTimePeriod(new Date(2026, 9, 10, hour, minute))
  assert.equal(at(0), 'night')
  assert.equal(at(4, 59), 'night')
  assert.equal(at(5), 'morning')
  assert.equal(at(11, 59), 'morning')
  assert.equal(at(12), 'afternoon')
  assert.equal(at(17, 59), 'afternoon')
  assert.equal(at(18), 'night')
  assert.equal(at(23, 59), 'night')
})

test('dia de negócio vem de America/Sao_Paulo, não do fuso do aparelho', () => {
  // 02:30Z de 11/out é 23:30 de 10/out em São Paulo.
  const ctx = buildGreetingContext({ now: new Date('2026-10-11T02:30:00Z'), username: 'ana' })
  assert.equal(ctx.dayKey, '2026-10-10')
  const next = buildGreetingContext({ now: new Date('2026-10-11T03:00:00Z'), username: 'ana' })
  assert.equal(next.dayKey, '2026-10-11')
})

test('nome: usa o que existe no perfil, sanitiza e cai em "atleta"', () => {
  assert.equal(buildGreetingContext({ now, firstName: '  Marcela  ' }).firstName, 'Marcela')
  assert.equal(buildGreetingContext({ now }).firstName, 'atleta')
  assert.equal(buildGreetingContext({ now, firstName: '\n​' }).firstName, 'atleta')
  assert.equal(buildGreetingContext({ now, firstName: 'x'.repeat(60) }).firstName.length, 20)
  assert.equal(resolveFirstName({ profile: { username: 'ana' }, user: {} }), 'ana')
  assert.equal(
    resolveFirstName({ profile: {}, user: { user_metadata: { display_name: 'Rui Costa' } } }),
    'Rui'
  )
  assert.equal(resolveFirstName({}), 'atleta')
})

test('boas-vindas: conta nova, perfil concluído, ativa e não confirmada => welcome', () => {
  const ctx = buildGreetingContext({ ...newcomer, now })
  assert.equal(ctx.category, 'welcome')
  assert.equal(ctx.canAcknowledgeWelcome, true)
})

test('boas-vindas: conta antiga (antes do corte) NÃO recebe falsa primeira recepção', () => {
  const ctx = buildGreetingContext({ ...newcomer, createdAt: '2026-10-23T23:59:59-03:00', now })
  assert.notEqual(ctx.category, 'welcome')
  assert.equal(ctx.canAcknowledgeWelcome, false)
  const edge = buildGreetingContext({ ...newcomer, createdAt: '2026-10-24T00:00:00-03:00', now })
  assert.equal(edge.category, 'welcome')
})

test('boas-vindas: sem corte configurado ninguém é elegível (falha segura)', () => {
  const ctx = buildGreetingContext({ ...newcomer, welcomeCutoffMs: null, now })
  assert.notEqual(ctx.category, 'welcome')
})

test('boas-vindas: já confirmada, coluna ausente (undefined), sem username ou conta inativa => normal', () => {
  for (const patch of [
    { welcomeSeenAt: '2026-10-25T13:00:00Z' },
    { welcomeSeenAt: undefined },
    { username: null },
    { accountStatus: 'disabled' },
    { createdAt: 'lixo' },
    { createdAt: undefined },
  ])
    assert.notEqual(
      buildGreetingContext({ ...newcomer, ...patch, now }).category,
      'welcome',
      JSON.stringify(patch)
    )
})

test('boas-vindas: offline nunca decide nem confirma', () => {
  const ctx = buildGreetingContext({ ...newcomer, offlineLocal: true, now })
  assert.notEqual(ctx.category, 'welcome')
  assert.equal(ctx.canAcknowledgeWelcome, false)
})

test('boas-vindas travadas continuam mesmo após o servidor confirmar, mas treino concluído prevalece', () => {
  const confirmed = {
    ...newcomer,
    welcomeSeenAt: '2026-10-25T13:00:00Z',
    welcomeLatched: true,
    now,
  }
  const stays = buildGreetingContext(confirmed)
  assert.equal(stays.category, 'welcome')
  assert.equal(stays.canAcknowledgeWelcome, false, 'já confirmada: não confirma de novo')
  assert.equal(
    buildGreetingContext({ ...confirmed, todayState: 'completed' }).category,
    'completed'
  )
  assert.equal(
    buildGreetingContext({ ...confirmed, todayState: 'in_progress' }).category,
    'in_progress'
  )
})

test('a frase de boas-vindas é a mesma antes e depois do ACK (mesma semente)', () => {
  const before = greetingFromContext(buildGreetingContext({ ...newcomer, now }), 'u1')
  const after = greetingFromContext(
    buildGreetingContext({
      ...newcomer,
      welcomeSeenAt: '2026-10-25T13:00:00Z',
      welcomeLatched: true,
      now,
    }),
    'u1'
  )
  assert.equal(before.heading, after.heading)
})

test('virada de voz (preferência) troca só a gramática, mantendo a categoria', () => {
  const masculine = buildGreetingContext({ now, greetingVoice: 'neutro', sexo: 'masculino' })
  const feminine = buildGreetingContext({ now, greetingVoice: 'auto', sexo: 'feminino' })
  assert.equal(masculine.category, feminine.category)
  assert.equal(masculine.voice, 'neutro')
  assert.equal(feminine.voice, 'feminino')
})

test('voz: preferência antiga masculino/feminino (contas que escolheram antes da mudança) vira auto', () => {
  const legacyMasculino = buildGreetingContext({ now, greetingVoice: 'masculino', sexo: 'feminino' })
  const autoEquivalent = buildGreetingContext({ now, greetingVoice: 'auto', sexo: 'feminino' })
  assert.equal(legacyMasculino.voice, autoEquivalent.voice)
})

test('parseWelcomeCutoff exige ISO com fuso; qualquer outra coisa desliga', () => {
  assert.equal(parseWelcomeCutoff('2026-10-24T00:00:00-03:00'), CUTOFF)
  assert.equal(parseWelcomeCutoff('2026-10-24T03:00:00Z'), CUTOFF)
  for (const value of [
    '2026-10-24',
    '24/10/2026',
    '',
    undefined,
    null,
    'agora',
    '2026-13-45T00:00:00Z',
  ])
    assert.equal(parseWelcomeCutoff(value), null, String(value))
})
