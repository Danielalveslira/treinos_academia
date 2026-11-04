import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React, { createRef } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let AuthCaptcha

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'auth-captcha-widget-'))
  const outfile = join(directory, 'widget.cjs')
  await build({
    entryPoints: [new URL('./AuthCaptcha.jsx', import.meta.url).pathname],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: {
      'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_HCAPTCHA_ENABLED': '"true"',
      'import.meta.env.VITE_HCAPTCHA_SITE_KEY': '"public-test-key"',
    },
    plugins: [
      {
        name: 'widget-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          context.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /^@hcaptcha\/react-hcaptcha$/ }, () => ({
            path: 'hcaptcha',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `export const useTheme = () => ({resolvedColorMode:'day'});
            export const Button = ({children,...props}) => <button {...props}>{children}</button>;
            export const Flash = ({children,...props}) => <div {...props}>{children}</div>`,
          }))
          context.onLoad({ filter: /^hcaptcha$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `import { forwardRef, useImperativeHandle } from 'react';
            export default forwardRef(function Widget(props, ref) {
              useImperativeHandle(ref, () => ({resetCaptcha: () => globalThis.__captchaResets++}));
              return <div data-widget="true" data-sitekey={props.sitekey} data-theme={props.theme} />;
            })`,
          }))
        },
      },
    ],
  })
  AuthCaptcha = require(outfile).AuthCaptcha
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('token é consumido uma vez; expiração e erro permitem nova tentativa', async () => {
  const ref = createRef()
  const verified = []
  globalThis.__captchaResets = 0
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(AuthCaptcha, {
        ref,
        onVerifiedChange: (value) => verified.push(value),
      })
    )
  })
  const widget = () => renderer.root.findByProps({ 'data-widget': 'true' })
  assert.equal(widget().props['data-sitekey'], 'public-test-key')
  assert.throws(() => ref.current.takeToken(), { code: 'CAPTCHA_REQUIRED' })

  await act(async () => widget().parent.props.onReady())
  await act(async () => widget().parent.props.onVerify('first-token'))
  assert.equal(ref.current.takeToken(), 'first-token')
  assert.throws(() => ref.current.takeToken(), { code: 'CAPTCHA_REQUIRED' })

  await act(async () => ref.current.reset())
  assert.equal(globalThis.__captchaResets, 1)
  await act(async () => widget().parent.props.onVerify('second-token'))
  await act(async () => widget().parent.props.onExpire())
  assert.throws(() => ref.current.takeToken(), { code: 'CAPTCHA_REQUIRED' })
  await act(async () => widget().parent.props.onError())
  assert.ok(
    renderer.root
      .findAllByType('button')
      .some((button) => button.children.join('') === 'Tentar novamente')
  )
  await act(async () => renderer.root.findByType('button').props.onClick())
  assert.ok(verified.includes(true))
  assert.equal(verified.at(-1), false)
  await act(async () => renderer.unmount())
})

test('onReady evita o falso erro de carregamento quando o script já estava em window.hcaptcha', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ref = createRef()
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AuthCaptcha, { ref }))
  })
  const widget = () => renderer.root.findByProps({ 'data-widget': 'true' })
  // Caminho "script já carregado" de @hcaptcha/react-hcaptcha: só onReady dispara, nunca onLoad.
  await act(async () => widget().parent.props.onReady())
  await act(async () => t.mock.timers.tick(15_000))
  assert.equal(
    renderer.root.findByType('p').children.join(''),
    'Conclua a verificação de segurança para continuar.'
  )
  assert.equal(
    renderer.root
      .findAllByType('button')
      .some((button) => button.children.join('') === 'Tentar novamente'),
    false
  )
  await act(async () => renderer.unmount())
})

test('timeout de carregamento ainda marca erro quando o widget nunca fica pronto', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ref = createRef()
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AuthCaptcha, { ref }))
  })
  await act(async () => t.mock.timers.tick(15_000))
  assert.equal(
    renderer.root.findByType('p').children.join(''),
    'Não foi possível carregar a verificação. Verifique sua conexão e tente novamente.'
  )
  await act(async () => renderer.unmount())
})
