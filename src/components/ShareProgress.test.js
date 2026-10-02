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
  assert.match(html, /alt="Treino do dia: treino concluído/)
  assert.match(html, /width="1080"/)
  assert.match(html, /height="1350"/)
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

// --- Comunidades: o MESMO seletor, em modo "Publicar na comunidade" ---------------------------------------------
test('publish mode: same tabs and preview, optional message and "Publicar na comunidade" as the main action (no share/download)', () => {
  const options = optionsWith([day('2026-10-02')])
  const html = renderBody({
    options,
    onPublish: async () => {},
    env: { navigator: { share() {} } },
  })
  const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(tabs, ['Dia', 'Semana', 'Mês', 'Trimestre'])
  assert.match(html, />Publicar na comunidade</)
  assert.match(html, /Mensagem \(opcional\)/)
  assert.match(html, /<textarea[^>]*maxLength="280"|<textarea[^>]*maxlength="280"/i)
  assert.match(html, /<img[^>]*src="data:image\/svg\+xml/)
  assert.doesNotMatch(html, />Compartilhar</)
  assert.doesNotMatch(html, />Baixar imagem</)
  assert.doesNotMatch(html, /Conquista do dia|Sua conquista de hoje/)
})

test('publish mode never offers a variant the user has not earned (no "Dia" without a workout, no invalid perfect week)', () => {
  const html = renderBody({
    options: optionsWith([]),
    onPublish: async () => {},
    env: { navigator: {} },
  })
  const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(tabs, ['Semana', 'Mês', 'Trimestre'])
})

test('publish mode custom label is supported and the Home mode is unchanged without onPublish', () => {
  const options = optionsWith([day('2026-10-02')])
  assert.match(
    renderBody({
      options,
      onPublish: async () => {},
      publishLabel: 'Postar',
      env: { navigator: {} },
    }),
    />Postar</
  )
  const home = renderBody({ options, env: { navigator: { share() {} } } })
  assert.match(home, />Compartilhar</)
  assert.doesNotMatch(home, /Publicar na comunidade/)
})

// --- Folha modal mobile-first ---------------------------------------------------------------------------------
const frameHtml = (props) =>
  renderBody({
    options: optionsWith([day('2026-10-02')]),
    env: { navigator: {} },
    onClose() {},
    ...props,
  })

test('the sheet ALWAYS renders a close button in the header (title left, X right), outside the scrollable body, in Home and community modes', () => {
  for (const html of [frameHtml({}), frameHtml({ onPublish: async () => {} })]) {
    assert.match(html, /role="dialog"[^>]*aria-modal="true"/)
    assert.match(html, /aria-labelledby="sheet-title-/)
    const header = html.indexOf('modal-sheet-header')
    const title = html.indexOf('>Compartilhar progresso<')
    const close = html.indexOf('modal-sheet-close')
    const body = html.indexOf('modal-sheet-body')
    const footer = html.indexOf('modal-sheet-footer')
    assert.ok(
      header >= 0 && title > header && close > title,
      'título antes do X, ambos no cabeçalho'
    )
    assert.ok(body > close, 'o corpo rolável vem depois do cabeçalho (o X não está dentro dele)')
    assert.ok(footer > body, 'rodapé fora e depois do corpo rolável')
    assert.match(html, /<button[^>]*class="modal-sheet-close"[^>]*aria-label="Fechar"/)
  }
})

test('the primary actions live in the FOOTER (always reachable), not inside the scrolling body', () => {
  const home = frameHtml({})
  const footerOnly = home.slice(home.indexOf('modal-sheet-footer'))
  assert.match(footerOnly, />Compartilhar</)
  assert.match(footerOnly, />Baixar imagem</)
  assert.doesNotMatch(
    home.slice(home.indexOf('modal-sheet-body'), home.indexOf('modal-sheet-footer')),
    />Compartilhar<|>Baixar imagem</
  )
  const publish = frameHtml({ onPublish: async () => {} })
  assert.match(publish.slice(publish.indexOf('modal-sheet-footer')), />Publicar na comunidade</)
  const caption = publish.indexOf('Mensagem (opcional)')
  assert.ok(
    caption > publish.indexOf('modal-sheet-body') &&
      caption < publish.indexOf('modal-sheet-footer'),
    'mensagem no corpo, CTA no rodapé'
  )
})

test('Home mode always offers BOTH "Compartilhar" and "Baixar imagem", even without Web Share (no silent download fallback)', () => {
  for (const env of [{ navigator: {} }, { navigator: { share() {} } }, {}]) {
    const html = renderBody({ options: optionsWith([day('2026-10-02')]), env, onClose() {} })
    assert.match(html, />Compartilhar</)
    assert.match(html, />Baixar imagem</)
  }
})

test('source contract: "Compartilhar" never downloads, "Baixar imagem" never shares, publishing is separate', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('./ShareProgressDialog.jsx', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const share = code.slice(code.indexOf('const share ='), code.indexOf('const download ='))
  const download = code.slice(code.indexOf('const download ='), code.indexOf('const copyLink ='))
  const publish = code.slice(code.indexOf('const publish ='), code.indexOf('if (!model)'))
  assert.match(share, /nativeShare\(/)
  assert.doesNotMatch(share, /downloadFile|renderSvgToPublishBlob|onPublish/)
  assert.match(download, /downloadFile\(/)
  assert.doesNotMatch(download, /nativeShare|copyAppLink|onPublish/)
  assert.match(publish, /onPublish\(/)
  assert.doesNotMatch(publish, /nativeShare|downloadFile/)
})

test('Home and community use the SAME sheet base (no Primer Dialog, no divergent implementation)', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const file of ['./ShareProgressDialog.jsx', './CommunityProgressShare.jsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /from '\.\/ModalSheet'/, file)
    assert.doesNotMatch(
      source,
      /\bDialog\b[^;]*from '@primer\/react'|import \{[^}]*\bDialog\b[^}]*\} from '@primer\/react'/,
      file
    )
  }
  const home = await readFile(new URL('./ShareProgressDialog.jsx', import.meta.url), 'utf8')
  const community = await readFile(new URL('./CommunityProgressShare.jsx', import.meta.url), 'utf8')
  assert.match(community, /ShareProgressDialog/)
  assert.match(home, /export function ShareProgressDialog/)
})

test('mobile CSS contract: safe-area top/bottom, 100dvh, header/footer outside the scroll area, 44px touch targets, above the app chrome', async () => {
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../styles/app.css', import.meta.url), 'utf8')
  const rule = (selector) =>
    css.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    )?.[1] || ''
  // altura: viewport visual quando conhecida, 100dvh como base (nunca só 100vh)
  assert.match(rule('.modal-sheet'), /height:\s*var\(--sheet-height,\s*100dvh\)/)
  assert.match(rule('.modal-sheet'), /flex-direction:\s*column/)
  // cabeçalho com safe-area superior (notch/Dynamic Island) e fora da rolagem
  assert.match(rule('.modal-sheet-header'), /env\(safe-area-inset-top/)
  assert.match(rule('.modal-sheet-header'), /flex:\s*0 0 auto/)
  // corpo: único que rola
  assert.match(rule('.modal-sheet-body'), /overflow-y:\s*auto/)
  assert.match(rule('.modal-sheet-body'), /min-height:\s*0/)
  assert.match(rule('.modal-sheet-body'), /overscroll-behavior:\s*contain/)
  // rodapé com safe-area inferior e fora da rolagem
  assert.match(rule('.modal-sheet-footer'), /env\(safe-area-inset-bottom/)
  assert.match(rule('.modal-sheet-footer'), /flex:\s*0 0 auto/)
  // X com 44x44 e abas com 44px
  assert.match(rule('.modal-sheet-close'), /width:\s*44px/)
  assert.match(rule('.modal-sheet-close'), /height:\s*44px/)
  assert.match(rule('.share-progress-tab'), /min-height:\s*44px/)
  // por cima de header/navegação (z-index 100) e fundo travado
  assert.ok(Number(rule('.modal-sheet-backdrop').match(/z-index:\s*(\d+)/)?.[1]) > 100)
  assert.match(css, /body\.modal-sheet-open\s*\{[^}]*overflow:\s*hidden/)
  // textarea sem zoom no iOS, preview limitado pela viewport dinâmica, abas roláveis
  assert.match(css, /\.share-progress textarea\s*\{\s*font-size:\s*16px/)
  assert.match(rule('.share-progress-card'), /max-width:\s*100%/)
  assert.match(rule('.share-progress-card'), /max-height:\s*min\(52dvh/)
  assert.match(rule('.share-progress-tabs'), /overflow-x:\s*auto/)
  // desktop: vira cartão centralizado
  assert.match(
    css,
    /@media \(min-width: 768px\)\s*\{\s*\.modal-sheet-backdrop\s*\{[^}]*align-items:\s*center/
  )
})
