import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getProfileHeroImage } from '../../constants/profileHeroImage.js'
import { getDashboardBannerSequence, getDashboardBannerFallbacks } from './dashboardBanners.js'
import { pickDailyItem } from './dailyRotation.js'
const dates = ['26', '27', '28', '29'].map((day) => new Date(`2026-10-${day}T12:00:00-03:00`))
for (const [sexo, names] of [
  ['masculino', ['capa', 'home-banner-anilhas', 'capa', 'home-banner-equipe']],
  ['feminino', ['sexo_mulher', 'home-banner-anilhas', 'sexo_mulher', 'home-banner-equipe']],
  [
    'nao_informar',
    ['home-banner-anilhas', 'home-banner-equipe', 'home-banner-anilhas', 'home-banner-equipe'],
  ],
])
  test(`sequência completa de ${sexo}, repetição e objetos estáveis`, () => {
    const sequence = getDashboardBannerSequence(sexo)
    assert.deepEqual(
      sequence.map((p) => p.name),
      names
    )
    assert.deepEqual(
      dates.map((date) => pickDailyItem(sequence, date).name),
      names
    )
    assert.equal(pickDailyItem(sequence, new Date('2026-10-30T12:00:00-03:00')).name, names[0])
    assert.equal(getDashboardBannerSequence(sexo), sequence)
  })
test('valores ausentes/desconhecidos são neutros, nunca masculino implícito', () => {
  for (const sexo of [
    undefined,
    null,
    '',
    'nao_informar',
    'unknown',
    'Masculino',
    'feminino ',
    42,
    {},
    'toString',
  ]) {
    assert.equal(getProfileHeroImage(sexo).name, 'home-banner-anilhas')
    assert.equal(getDashboardBannerSequence(sexo), getDashboardBannerSequence(null))
  }
})
test('contrato legado dos assets pessoais e fallback restrito às fotos neutras', () => {
  for (const sexo of ['masculino', 'feminino']) {
    const selected = getProfileHeroImage(sexo)
    assert.ok(selected.width > 0 && selected.height > selected.width && selected.alt)
    assert.deepEqual(
      getDashboardBannerFallbacks(selected).map((p) => p.name),
      [selected.name, 'home-banner-anilhas', 'home-banner-equipe']
    )
  }
  assert.deepEqual(
    getDashboardBannerFallbacks(getProfileHeroImage(null)).map((p) => p.name),
    ['home-banner-anilhas', 'home-banner-equipe']
  )
})
