import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHARE_HEIGHT,
  SHARE_WIDTH,
  buildShareSvg,
  escapeXml,
  fitFontSize,
  svgToDataUrl,
} from './shareProgressSvg.js'
import { buildShareOptions } from './shareProgress.js'

const NOW = new Date(2026, 8, 28, 18, 0) // segunda 28/set/2026
const PLAN = {
  plannedTrainingDays: ['monday', 'wednesday', 'friday'],
  effectiveFrom: '2026-06-01',
  timezone: 'America/Sao_Paulo',
}
const day = (dateKey) => ({ dateKey, workoutCount: 1, exerciseStats: [{ exerciseId: 'a' }] })
const progress = [
  '2026-09-21',
  '2026-09-23',
  '2026-09-25',
  '2026-09-28',
  '2026-09-02',
  '2026-09-04',
].map(day)
const options = buildShareOptions({
  progressDays: progress,
  preferences: PLAN,
  consistency: { current: 7, longest: 9 },
  username: 'ana',
  now: NOW,
})
const completedCount = (model) =>
  model.grid.rows.flat().filter((c) => c && c.state === 'completed').length

test('every variant renders a 1080x1350 SVG with title, metrics and brand', () => {
  assert.deepEqual(
    options.map((o) => o.variant),
    ['daily', 'perfect_week', 'week', 'month', 'quarter']
  )
  for (const model of options) {
    const svg = buildShareSvg(model)
    assert.match(svg, new RegExp(`^<svg [^>]*width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}"`))
    assert.match(svg, /<\/svg>$/)
    assert.ok(svg.includes('Evolutus'), model.variant)
    assert.ok(svg.includes(escapeXml(model.title)), model.variant)
    for (const metric of model.metrics)
      assert.ok(svg.includes(escapeXml(metric.value)), `${model.variant}:${metric.value}`)
    assert.equal((svg.match(/<text /g) || []).length, (svg.match(/<\/text>/g) || []).length)
    assert.equal(
      svg.includes('NaN') || svg.includes('undefined') || svg.includes('Infinity'),
      false,
      model.variant
    )
  }
})

test('completed days are drawn as filled blocks: one per completed cell (what you did is what is shown)', () => {
  for (const model of options) {
    const svg = buildShareSvg(model)
    const filledBlocks = (svg.match(/<rect [^>]*fill="#3fb950"\/>/g) || []).length
    assert.equal(filledBlocks, completedCount(model), model.variant)
  }
})

test('planned rest days are not drawn as completed or pending: they get the muted rest style', () => {
  const week = options.find((o) => o.variant === 'week')
  const rest = week.grid.rows[0].filter((c) => c.state === 'rest').length
  assert.equal(rest, 4)
  const svg = buildShareSvg(week)
  assert.equal((svg.match(/opacity="0\.5"\/>/g) || []).length >= rest, true)
})

test('user supplied text (handle) is escaped: no markup injection into the SVG', () => {
  const evil = { ...options[2], handle: '@<script>"&\'</script>' }
  const svg = buildShareSvg(evil)
  assert.equal(svg.includes('<script>'), false)
  assert.match(svg, /@&lt;script&gt;&quot;&amp;&apos;&lt;\/script&gt;/)
  assert.equal(escapeXml(null), '')
})

test('handle is optional and the footer tagline is always there', () => {
  const svg = buildShareSvg({ ...options[2], handle: null })
  assert.equal(svg.includes('@ana'), false)
  assert.ok(svg.includes('Seu diário de evolução'))
  assert.ok(buildShareSvg(options[2]).includes('@ana'))
})

test('long metric labels shrink to fit their column instead of overlapping', () => {
  assert.equal(fitFontSize('MELHOR SEQUÊNCIA', 312 * 0.94, 26, 20, 0.62, 1.5) <= 26, true)
  assert.equal(
    fitFontSize('TREINOS PLANEJADOS EM SEQUÊNCIA LONGA', 312 * 0.94, 26, 20, 0.62, 1.5),
    20
  )
  assert.equal(fitFontSize('7', 300, 96, 52, 0.62, 0), 96)
  assert.equal(fitFontSize('100/100', 300, 96, 52, 0.62, 0) < 96, true)
})

test('data URL round-trips the SVG (what the preview <img> uses)', () => {
  const svg = buildShareSvg(options[2])
  const url = svgToDataUrl(svg)
  assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/)
  assert.equal(decodeURIComponent(url.split(',').slice(1).join(',')), svg)
})

test('an empty period (no workouts at all) still renders a valid card', () => {
  const empty = buildShareOptions({
    progressDays: [],
    preferences: undefined,
    consistency: { current: 0, longest: 0 },
    now: NOW,
  })
  for (const model of empty) {
    const svg = buildShareSvg(model)
    assert.match(svg, /<\/svg>$/)
    assert.equal(svg.includes('NaN'), false)
    assert.equal(completedCount(model), 0)
  }
})
