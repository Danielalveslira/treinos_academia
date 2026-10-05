import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, MESSAGE_POOLS, fit, pickIndex, renderPushMessage, workoutReminderMessage } from './messages.js'

const emoji = /\p{Extended_Pictographic}/u
const ALL_TYPES = [
  'post_like', 'comment_like', 'post_reply', 'comment_reply', 'comment_mention', 'economy_credit', 'economy_debit',
  'moderation_notice', 'report_resolved', 'admin_report', 'admin_appeal', 'admin_privacy_request',
  'admin_moderation_decision', 'admin_restriction', 'admin_deletion_review', 'admin_broadcast',
  'workout_reminder_before', 'workout_reminder_start',
]
const LONG_NAME = 'u'.repeat(40)

function job(type, extra = {}) {
  return { notification_id: 1, notification_type: type, actor_username: 'daniel', metadata: {}, variant: 0, group_count: 1, ...extra }
}

test('fit: não parte emoji, corta em palavra e respeita o limite', () => {
  assert.equal(fit('curto', 20), 'curto')
  assert.equal(fit('😀'.repeat(10), 5).includes('\uD83D') && Array.from(fit('😀'.repeat(10), 5)).length <= 5, true)
  const cut = fit('uma frase bem comprida que precisa ser cortada em algum ponto', 30)
  assert.ok(Array.from(cut).length <= 30)
  assert.ok(cut.endsWith('…'))
  assert.ok(!/\s…$/.test(cut), 'sem espaço antes das reticências')
  assert.equal(fit('  espaços   múltiplos  ', 50), 'espaços múltiplos')
  assert.equal(fit(null, 10), '')
})

test('todo texto renderizado cabe nos limites, no pior caso de nome e tamanho de grupo', () => {
  for (const type of ALL_TYPES) {
    for (let variant = 0; variant < 40; variant += 1) {
      for (const group_count of [1, 2, 9, 1000]) {
        const { title, body } = renderPushMessage(job(type, {
          variant, group_count, actor_username: LONG_NAME,
          metadata: { variant, asset: 'coin', amount: 123456789, title: 't'.repeat(300), body: 'b'.repeat(500) },
        }))
        assert.ok(Array.from(title).length <= LIMITS.title, `${type}#${variant} título ${Array.from(title).length}`)
        assert.ok(Array.from(body).length <= LIMITS.body, `${type}#${variant} corpo ${Array.from(body).length}`)
        assert.ok(title.length > 0 && body.length > 0, `${type} vazio`)
      }
    }
  }
})

test('o essencial vem nas primeiras palavras (Android/Windows cortam cedo)', () => {
  for (const pool of [...MESSAGE_POOLS.post_like.single, ...MESSAGE_POOLS.comment_like.single, ...MESSAGE_POOLS.post_reply, ...MESSAGE_POOLS.comment_reply]) {
    assert.ok(Array.from(pool[0]).length <= 32, `título curto: ${pool[0]}`)
    if (pool[1].includes('{actor}')) assert.ok(pool[1].indexOf('{actor}') <= 12, `autor no início: ${pool[1]}`)
  }
})

test('catálogo tem variedade suficiente e sem mensagens repetidas', () => {
  const minimum = { post_like: 8, comment_like: 6, post_reply: 6, comment_reply: 6, workout_reminder_before: 12, workout_reminder_start: 12 }
  for (const [type, min] of Object.entries(minimum)) {
    const pool = Array.isArray(MESSAGE_POOLS[type]) ? MESSAGE_POOLS[type] : MESSAGE_POOLS[type].single
    assert.ok(pool.length >= min, `${type} tem ${pool.length} < ${min}`)
    assert.equal(new Set(pool.map((m) => m.join('|'))).size, pool.length, `${type} tem mensagens duplicadas`)
    assert.equal(new Set(pool.map((m) => m[0])).size, pool.length, `${type} repete título`)
  }
  assert.ok(MESSAGE_POOLS.workout_reminder_before.length + MESSAGE_POOLS.workout_reminder_start.length >= 20, 'treino: 20+ variantes no total')
})

test('antirrepetição: com a sequência do banco (passo 1 ou 2) nunca repete duas vezes seguidas', () => {
  for (const type of ['post_like', 'comment_like', 'post_reply', 'comment_reply', 'comment_mention', 'economy_credit']) {
    for (const start of [0, 1, 7, 999, 1234567]) {
      let previous = null
      let seq = start
      for (let step = 0; step < 200; step += 1) {
        const current = renderPushMessage(job(type, { variant: seq, metadata: { asset: 'coin', amount: 5 } }))
        if (previous) assert.notDeepEqual(current, previous, `${type} repetiu em seq=${seq}`)
        previous = current
        seq += 1 + (step % 2)
      }
    }
  }
})

test('treino: dias consecutivos nunca repetem a mensagem e antes/horário percorrem tudo', () => {
  for (const type of ['workout_reminder_before', 'workout_reminder_start']) {
    const size = MESSAGE_POOLS[type].length
    const base = 9600 // dias desde 2000-01-01, como no banco
    const seen = new Set()
    for (let day = 0; day < 60; day += 1) {
      const a = workoutReminderMessage(type, base + day)
      const b = workoutReminderMessage(type, base + day + 1)
      assert.notDeepEqual(a, b, `${type} repetiu no dia ${day}`)
      seen.add(a[0])
    }
    assert.equal(seen.size, size, `${type} deveria usar todas as ${size} variantes em 60 dias`)
  }
})

test('idempotente: o mesmo job renderiza sempre a mesma mensagem', () => {
  for (const type of ALL_TYPES) {
    const j = job(type, { variant: 12345, group_count: 3, metadata: { variant: 777, asset: 'coin', amount: 25 } })
    assert.deepEqual(renderPushMessage(j), renderPushMessage({ ...j }))
  }
  assert.equal(pickIndex(-3, 5), 2)
  assert.equal(pickIndex(undefined, 5), 0)
})

test('curtidas: nome do autor, grupo e concordância', () => {
  const single = renderPushMessage(job('post_like', { variant: 0 }))
  assert.equal(single.title, '🔥 Seu post chamou atenção')
  assert.equal(single.body, '@daniel curtiu sua publicação.')
  const two = renderPushMessage(job('post_like', { variant: 0, group_count: 2 }))
  assert.match(two.body, /^@daniel e mais 1 pessoa curtiram /)
  const many = renderPushMessage(job('comment_like', { variant: 1, group_count: 4 }))
  assert.match(many.body, /^@daniel e mais 3 pessoas curtiram /)
  assert.equal(renderPushMessage(job('comment_like', { variant: 1 })).title, '👏 Concordância detectada')
})

test('nome de usuário suspeito nunca vai para o Push', () => {
  for (const actor_username of ['<script>alert(1)</script>', 'a b', 'x'.repeat(41), '', null, '@@@', 'ola\nmundo']) {
    const { body } = renderPushMessage(job('post_reply', { actor_username }))
    assert.ok(body.startsWith('Alguém'), `aceitou ${JSON.stringify(actor_username)}`)
  }
})

test('privacidade: moderação, atendimento e finanças são genéricos na tela bloqueada', () => {
  const moderation = new Set()
  for (const action of ['warning', 'remove_content', 'temporary_suspension', 'community_ban', 'system_ban', 'restore', '<x>']) {
    const m = renderPushMessage(job('moderation_notice', { metadata: { action, reason: 'MOTIVO-SECRETO', rule: 'REGRA' } }))
    moderation.add(JSON.stringify(m))
    assert.ok(!/suspens|remov|ban|advert|MOTIVO|REGRA/i.test(m.title + m.body), `vazou detalhe: ${action}`)
  }
  assert.equal(moderation.size, 1, 'todas as ações geram o mesmo texto genérico')
  for (const kind of ['report', 'appeal', 'privacy']) {
    const m = renderPushMessage(job('report_resolved', { metadata: { kind } }))
    assert.ok(!/den[uú]ncia|recurso|privacidade/i.test(m.title + m.body), `vazou o tipo do caso: ${kind}`)
  }
  const cash = renderPushMessage(job('economy_credit', { metadata: { asset: 'cash', amount: 4321, reason: 'cash_purchase_confirmed' } }))
  assert.ok(!/4321|4\.321/.test(cash.title + cash.body), 'valor em EvoCash não aparece')
  const debit = renderPushMessage(job('economy_debit', { metadata: { asset: 'coin', amount: 9876, reason: 'chargeback' } }))
  assert.ok(!/9876|9\.876|chargeback|estorno/i.test(debit.title + debit.body), 'ajuste não expõe valor nem motivo')
  const adminReport = renderPushMessage(job('admin_report', { metadata: { target: 'comment' } }))
  assert.ok(!/coment|publica/i.test(adminReport.title + adminReport.body), 'denúncia não revela o alvo')
})

test('economia: EvoCoins mostram o valor da ledger; sem valor válido cai em texto sem número', () => {
  const withAmount = renderPushMessage(job('economy_credit', { variant: 0, metadata: { asset: 'coin', amount: 25 } }))
  assert.equal(withAmount.title, '🪙 +25 EvoCoins')
  const formatted = renderPushMessage(job('economy_credit', { variant: 1, metadata: { asset: 'coin', amount: 1500 } }))
  assert.match(formatted.body, /1\.500/)
  for (const amount of ['DROP', -5, 0, 1e12, null, undefined, NaN]) {
    const m = renderPushMessage(job('economy_credit', { variant: 0, metadata: { asset: 'coin', amount } }))
    assert.ok(!/\d/.test(m.title + m.body), `número inventado para ${amount}`)
  }
})

test('tom: moderação, segurança, privacidade e finanças ficam sérios (sem emoji de brincadeira)', () => {
  for (const type of ['moderation_notice', 'report_resolved', 'economy_debit', 'admin_moderation_decision', 'admin_restriction', 'admin_deletion_review']) {
    const m = renderPushMessage(job(type))
    assert.ok(!emoji.test(m.title + m.body), `${type} não deve ter emoji`)
    assert.ok(!/😂|😄|🤣|😜/u.test(m.title + m.body))
  }
  for (const pool of [...MESSAGE_POOLS.workout_reminder_before, ...MESSAGE_POOLS.workout_reminder_start]) {
    assert.ok(!/preguiç|fracass|desist|vergonha|culpa|falhou|não treinou|ainda não/i.test(pool.join(' ')), `sem pressão negativa: ${pool[0]}`)
  }
})

test('agrupamento administrativo informa a quantidade sem revelar o conteúdo', () => {
  const m = renderPushMessage(job('admin_report', { group_count: 4 }))
  assert.equal(m.body, '4 novas denúncias aguardando análise.')
  assert.equal(renderPushMessage(job('admin_privacy_request', { group_count: 1 })).title, '🔒 Privacidade')
})

test('broadcast de superadmin respeita os limites e tipos desconhecidos têm texto seguro', () => {
  const m = renderPushMessage(job('admin_broadcast', { metadata: { title: 'T'.repeat(200), body: 'B'.repeat(400) } }))
  assert.ok(Array.from(m.title).length <= LIMITS.title && Array.from(m.body).length <= LIMITS.body)
  assert.deepEqual(renderPushMessage(job('tipo_que_nao_existe')), { title: 'Evolutus', body: 'Você recebeu uma nova notificação.' })
})
