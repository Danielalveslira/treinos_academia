import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// renderToStaticMarkup só (nunca act()/TestRenderer -- ver o aviso em PostSupportersDialog.test.js). O corpo do
// dialog é testado sem o <Dialog>/Portal; a lógica de PNG/compartilhamento está em utils/shareImage.test.js.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'share-progress-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { ShareProgressDialogBody } from './ShareProgressDialog.jsx'
        import { ShareProgressCard } from './ShareProgressCard.jsx'
        import { StreakCard } from './StreakCard.jsx'
        import { buildShareOptions } from '../utils/shareProgress.js'
        const wrap = (child) => renderToStaticMarkup(createElement(ThemeProvider, null, createElement(BaseStyles, null, child)))
        export const renderBody = (props) => wrap(createElement(ShareProgressDialogBody, props))
        export const renderCard = (model) => wrap(createElement(ShareProgressCard, { model }))
        export const renderStreak = (props) => wrap(createElement(StreakCard, props))
        export { buildShareOptions }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
}

const { renderBody, renderCard, renderStreak, buildShareOptions } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const NOW = new Date(2026, 9, 2, 18, 0)
const PLAN = {
  plannedTrainingDays: ['monday', 'wednesday', 'friday'],
  effectiveFrom: '2026-06-01',
  timezone: 'America/Sao_Paulo',
}
const day = (dateKey) => ({ dateKey, workoutCount: 1, exerciseStats: [{ exerciseId: 'a' }] })
const optionsWith = (progressDays) =>
  buildShareOptions({
    progressDays,
    preferences: PLAN,
    consistency: { current: 3, longest: 5 },
    username: 'ana',
    now: NOW,
  })

test('dialog body shows one tab per AVAILABLE variant, in order, with the first selected', () => {
  const html = renderBody({ options: optionsWith([day('2026-10-02')]), env: { navigator: {} } })
  const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(tabs, ['Dia', 'Semana', 'Mês', 'Trimestre'])
  assert.match(html, /aria-selected="true"[^>]*>Dia</)
})

test('"Semana perfeita" tab only exists when the week is 100% done', () => {
  const none = renderBody({ options: optionsWith([day('2026-09-28')]), env: { navigator: {} } })
  assert.doesNotMatch(none, />Semana perfeita</)
  const perfect = renderBody({
    options: optionsWith([day('2026-09-28'), day('2026-09-30'), day('2026-10-02')]),
    env: { navigator: {} },
  })
  assert.match(perfect, />Semana perfeita</)
})

test('preview is the same SVG that becomes the PNG: an <img> with the data URL and a descriptive alt', () => {
  const html = renderBody({ options: optionsWith([day('2026-10-02')]), env: { navigator: {} } })
  assert.match(html, /<img[^>]*src="data:image\/svg\+xml;charset=utf-8,/)
  assert.match(html, /alt="Conquista do dia: treino concluído/)
  assert.match(html, /width="1080"/)
  assert.match(html, /height="1350"/)
})

test('share button only appears when the browser can share; download is always there', () => {
  const options = optionsWith([day('2026-10-02')])
  const withShare = renderBody({ options, env: { navigator: { share() {} } } })
  assert.match(withShare, />Compartilhar</)
  assert.match(withShare, />Baixar imagem</)
  const withoutShare = renderBody({ options, env: { navigator: {} } })
  assert.doesNotMatch(withoutShare, />Compartilhar</)
  assert.match(withoutShare, />Baixar imagem</)
})

test('the status line is a polite live region and starts empty (no stale message)', () => {
  const html = renderBody({ options: optionsWith([]), env: { navigator: {} } })
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*><\/p>/)
})

test('ShareProgressCard renders each variant with its own class', () => {
  for (const model of optionsWith([day('2026-10-02')])) {
    assert.match(renderCard(model), new RegExp(`share-progress-card is-${model.variant}`))
  }
})

const consistency = {
  current: 3,
  longest: 5,
  trainedToday: false,
  recent: [],
  today: { dateKey: '2026-10-02', state: 'none' },
}
test('consistency card: "Compartilhar" only when the handler exists, alongside the calendar/plan actions', () => {
  const without = renderStreak({
    consistency,
    hasTrainingPlan: true,
    onConfigurePlan() {},
    onOpenCalendar() {},
  })
  assert.doesNotMatch(without, /Compartilhar/)
  const withShare = renderStreak({
    consistency,
    hasTrainingPlan: true,
    onConfigurePlan() {},
    onOpenCalendar() {},
    onShare() {},
  })
  assert.match(withShare, /Compartilhar/)
  assert.match(withShare, /Ver calendário/)
  assert.match(withShare, /Ajustar planejamento/)
})
