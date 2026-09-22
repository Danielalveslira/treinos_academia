import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderBadge

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'expiry-badge-tests-'))
  const outfile = join(directory, 'expiry-badge.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ExpiryBadge } from './ExpiryBadge.jsx'

        function textContent(node) {
          if (typeof node === 'string') return node
          if (!node?.children) return ''
          return node.children.map(textContent).join('')
        }

        function snapshot(renderer) {
          const overlay = renderer.root.findAllByProps({ 'data-overlay': true })[0]
          const anchor = renderer.root.findAllByProps({ 'data-anchor': true })[0]
          return {
            open: Boolean(overlay),
            anchorLabel: anchor?.props['aria-label'],
            anchorText: anchor ? textContent(anchor) : '',
            content: overlay ? textContent(overlay) : '',
          }
        }

        export function renderBadgeView(props) {
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ExpiryBadge, props))
          })
          return {
            read: () => snapshot(renderer),
            click() {
              const anchor = renderer.root.findByProps({ 'data-anchor': true })
              act(() => anchor.props.onClick({ button: 0, defaultPrevented: false }))
              return snapshot(renderer)
            },
            pressEnter() {
              const anchor = renderer.root.findByProps({ 'data-anchor': true })
              act(() => anchor.props.onKeyDown({ key: 'Enter', preventDefault() {} }))
              return snapshot(renderer)
            },
            pressEscape() {
              const overlay = renderer.root.findByProps({ 'data-overlay': true })
              act(() => overlay.props.onKeyDown({ key: 'Escape' }))
              return snapshot(renderer)
            },
            clickOutside() {
              const overlay = renderer.root.findByProps({ 'data-overlay': true })
              act(() => overlay.props.onBlur())
              return snapshot(renderer)
            },
            unmount() {
              act(() => renderer.unmount())
            },
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'primer-overlay-test-double',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer-react',
            namespace: 'primer-test',
          }))
          buildApi.onLoad({ filter: /.*/, namespace: 'primer-test' }, () => ({
            loader: 'jsx',
            resolveDir: new URL('../..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
            contents: `
              import React from 'react'
              export function AnchoredOverlay({ open, onOpen, onClose, renderAnchor, children }) {
                const anchor = renderAnchor({
                  'data-anchor': true,
                  'aria-expanded': open,
                  onClick: () => open ? onClose('anchor-click') : onOpen('anchor-click'),
                  onKeyDown: (event) => {
                    if (!open && ['Enter', ' '].includes(event.key)) onOpen('anchor-key-press', event)
                  },
                })
                return <>{anchor}{open && <section
                  data-overlay
                  onKeyDown={(event) => event.key === 'Escape' && onClose('escape')}
                  onBlur={() => onClose('click-outside')}
                >{children}</section>}</>
              }
              export function Box({ as: Tag = 'div', sx, ...props }) { return <Tag {...props} /> }
              export function Text({ as: Tag = 'span', sx, ...props }) { return <Tag {...props} /> }
              export function Button({ leadingVisual, variant, size, sx, ...props }) {
                return <button {...props} />
              }
              export function IconButton({ icon, variant, size, sx, ...props }) {
                return <button {...props} />
              }
            `,
          }))
        },
      },
    ],
  })
  ;({ renderBadgeView: renderBadge } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('post normal opens exact timestamp details by click and closes on second click', () => {
  const now = new Date(2026, 8, 22, 20, 5).getTime()
  const view = renderBadge({
    now,
    status: {
      type: 'text',
      createdAt: new Date(2026, 8, 22, 14, 30),
      expiresAt: new Date(2026, 8, 23, 14, 30),
    },
  })

  assert.equal(view.read().open, false)
  let state = view.click()
  assert.equal(state.open, true)
  assert.match(state.content, /Publicação/)
  assert.match(state.content, /Criada em22\/09\/2026 às 14h30/)
  assert.match(state.content, /Expira em23\/09\/2026 às 14h30/)
  assert.match(state.content, /Tempo restante18h25min restantes/)
  assert.equal(view.click().open, false)
  view.unmount()
})

test('keyboard opens the popover; Escape and outside interaction close it', () => {
  const view = renderBadge({
    now: 1_000,
    status: { type: 'text', createdAt: 500, expiresAt: 3_601_000 },
  })

  assert.equal(view.pressEnter().open, true)
  assert.equal(view.pressEscape().open, false)
  assert.equal(view.click().open, true)
  assert.equal(view.clickOutside().open, false)
  view.unmount()
})

test('active promotion shows total hours and distinguishes the original feed window', () => {
  const now = new Date(2026, 8, 22, 13, 45).getTime()
  const view = renderBadge({
    now,
    status: {
      type: 'text',
      promoted: true,
      createdAt: new Date(2026, 8, 21, 14, 30),
      expiresAt: new Date(2026, 8, 22, 14, 30),
      promotedUntil: new Date(2026, 8, 24, 18, 0),
    },
  })

  assert.equal(view.read().anchorText, '52h15min restantes')
  const state = view.click()
  assert.match(state.content, /Publicação promovida/)
  assert.match(state.content, /Promoção ativa até24\/09\/2026 às 18h00/)
  assert.match(state.content, /Janela original do feed22\/09\/2026 às 14h30/)
  view.unmount()
})

test('workout hides the generic expiry control but keeps an active promotion indicator', () => {
  const now = 1_000
  const hidden = renderBadge({
    now,
    status: { type: 'workout', expiresAt: 3_601_000, promoted: false },
  })
  assert.equal(hidden.read().anchorLabel, undefined)
  hidden.unmount()

  const promoted = renderBadge({
    now,
    status: {
      type: 'workout',
      expiresAt: 3_601_000,
      promoted: true,
      promotedUntil: 7_201_000,
    },
  })
  assert.equal(promoted.read().anchorText, '2h restantes')
  assert.doesNotMatch(promoted.click().content, /Janela original do feed/)
  promoted.unmount()
})

test('ended promotion is not presented as active', () => {
  const view = renderBadge({
    now: 2_000,
    status: {
      type: 'text',
      expiresAt: 3_601_000,
      promoted: true,
      promotedUntil: 2_000,
    },
  })
  const state = view.read()
  assert.equal(state.anchorText, '')
  assert.equal(state.anchorLabel, 'Ver informações de expiração da publicação')
  view.unmount()
})
