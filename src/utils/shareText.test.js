import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShareText } from './shareText.js'

const URL = 'https://evolutus.example'

test('every variant has its own opening line, the pitch and the app link at the end', () => {
  const intros = {
    daily: 'Treino concluído no Evolutus 💪',
    week: 'Minha semana no Evolutus 💪',
    month: 'Meu progresso do mês no Evolutus 💪',
    quarter: 'Minha evolução no Evolutus 💪',
  }
  for (const [variant, intro] of Object.entries(intros)) {
    const text = buildShareText(variant, URL)
    assert.ok(text.startsWith(`${intro}\n\n`), variant)
    assert.match(text, /de um jeito simples e gratuito\./)
    assert.ok(text.endsWith(`participe da comunidade também:\n${URL}`), variant)
  }
})

test('the full message matches the approved copy', () => {
  assert.equal(
    buildShareText('quarter', URL),
    `Minha evolução no Evolutus 💪

Estou acompanhando meus treinos, consistência e progresso de um jeito simples e gratuito.

Treine, acompanhe sua evolução e participe da comunidade também:
${URL}`
  )
})

test('unknown variants fall back to the generic opening; a missing URL never prints "null"', () => {
  assert.ok(buildShareText('perfect_week', URL).startsWith('Minha semana perfeita no Evolutus'))
  assert.ok(buildShareText('whatever', URL).startsWith('Minha evolução no Evolutus 💪'))
  const noUrl = buildShareText('week', null)
  assert.doesNotMatch(noUrl, /null|undefined|:$/)
})
