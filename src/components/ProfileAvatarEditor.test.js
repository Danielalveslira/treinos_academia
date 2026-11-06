import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mount
let act
let originalBitmap
let originalCreateUrl
let originalRevokeUrl
let originalDocument

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'avatar-editor-test-'))
  const outfile = join(directory, 'editor.cjs')
  const mocks = new Map([
    ['react-easy-crop', `import { useEffect } from 'react'; export default function Cropper(p) { useEffect(() => p.onCropAreaChange(null, { x: 10, y: 5, width: 80, height: 80 }), [p.crop.x, p.crop.y, p.zoom, p.rotation]); return <div data-cropper='true' data-rotation={p.rotation} data-zoom={p.zoom} data-crop-x={p.crop.x}><button data-move='true' onClick={() => p.onCropChange({ x: 42, y: 0 })}>Mover</button></div> }`],
    ['./ModalSheet', `export const ModalSheet = ({ children, onClose }) => <div data-sheet='true' onClose={onClose}>{children}</div>; export const ModalSheetFrame = ({ children, footer, onClose, closeDisabled }) => <div role='dialog'><button disabled={closeDisabled} onClick={onClose}>Fechar</button>{children}{footer}</div>`],
    ['@primer/react', `export const Button = ({ children, loading, variant, ...props }) => <button {...props}>{children}</button>; export const Flash = ({ children, ...props }) => <div {...props}>{children}</div>`],
    ['../utils/avatarCrop', `export const drawAvatarCrop = (...args) => globalThis.__editor.draws.push(args); export const encodeAvatarCrop = async () => globalThis.__editor.blob`],
    ['../utils/imageDimensions', `export const readImageDimensions = async () => ({ width: 100, height: 100 })`],
    ['../services/profileAvatarService', `export const uploadProfileAvatar = (...args) => globalThis.__editor.upload(...args)`],
    ['../utils/accountAccessErrors', `export const describeAccountAccessError = () => null`],
  ])
  await build({ stdin: { contents: `import { createElement } from 'react'; import TestRenderer, { act } from 'react-test-renderer'; import { ProfileAvatarEditor } from './ProfileAvatarEditor.jsx'; export { act }; export const mount = (props) => TestRenderer.create(createElement(ProfileAvatarEditor, props), { createNodeMock: (element) => element.type === 'canvas' ? globalThis.document.createElement('canvas') : null });`, resolveDir: new URL('.', import.meta.url).pathname }, outfile,
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'silent',
    plugins: [{ name: 'editor-stubs', setup(ctx) {
      ctx.onResolve({ filter: /^(react|react\/jsx-runtime|react-test-renderer)$/ }, ({ path }) => ({ path: createRequire(import.meta.url).resolve(path), external: true }))
      ctx.onResolve({ filter: /.*/ }, ({ path }) => mocks.has(path) ? { path, namespace: 'stub' } : undefined)
      ctx.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: mocks.get(path), loader: 'jsx' }))
    } }] })
  ;({ mount, act } = createRequire(import.meta.url)(outfile))
  originalBitmap = globalThis.createImageBitmap
  originalCreateUrl = URL.createObjectURL
  originalRevokeUrl = URL.revokeObjectURL
  originalDocument = globalThis.document
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  globalThis.createImageBitmap = originalBitmap
  URL.createObjectURL = originalCreateUrl
  URL.revokeObjectURL = originalRevokeUrl
  globalThis.document = originalDocument
  delete globalThis.__editor
})

function setup(upload) {
  const state = { draws: [], closed: 0, revoked: [], blob: new Blob(['webp'], { type: 'image/webp' }), upload }
  globalThis.__editor = state
  globalThis.createImageBitmap = async () => ({ width: 100, height: 100, close: () => { state.closed += 1 } })
  URL.createObjectURL = () => 'blob:avatar-preview'
  URL.revokeObjectURL = (url) => state.revoked.push(url)
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (callback) => callback(new Blob(['preview'], { type: 'image/png' })) }) }
  const callbacks = { saved: [], canceled: 0, another: 0 }
  let renderer
  return {
    state, callbacks,
    async open() {
      await act(async () => { renderer = mount({ file: { type: 'image/png' }, onSaved: (...args) => callbacks.saved.push(args), onCancel: () => { callbacks.canceled += 1 }, onChooseAnother: () => { callbacks.another += 1 } }) })
      return renderer
    },
    button(label) { return renderer.root.findAllByType('button').find((node) => node.children.join('') === label) },
    input(max) { return renderer.root.findAllByType('input').find((node) => node.props.max === max) },
    cropper() { return renderer.root.findByProps({ 'data-cropper': 'true' }) },
    unmount() { act(() => renderer.unmount()) },
  }
}

test('prévia e arquivo usam o mesmo recorte após zoom, movimento e rotação; erro mantém ajustes', async () => {
  let attempts = 0
  const view = setup(async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return { path: 'new.webp' } })
  await view.open()
  await act(async () => { view.cropper().findByProps({ 'data-move': 'true' }).props.onClick() })
  await act(async () => { view.input('3').props.onChange({ target: { value: '2' } }) })
  await act(async () => { view.button('Girar à direita').props.onClick() })
  await act(async () => { view.button('Salvar foto').props.onClick() })
  assert.equal(view.callbacks.saved.length, 0)
  assert.equal(view.cropper().props['data-rotation'], 90)
  assert.equal(view.cropper().props['data-zoom'], 2)
  assert.equal(view.cropper().props['data-crop-x'], 42)
  assert.equal(view.state.draws.at(-1)[3], 90)
  assert.deepEqual(view.state.draws.at(-1)[2], view.state.draws.at(-2)[2])
  await act(async () => { view.button('Salvar foto').props.onClick() })
  assert.equal(view.callbacks.saved.length, 1)
  assert.equal(view.callbacks.saved[0][1], view.state.blob)
  assert.equal(view.state.draws.at(-1)[3], 90)
  view.unmount()
  assert.equal(view.state.closed, 1)
  assert.deepEqual(view.state.revoked, ['blob:avatar-preview'])
})

test('envio duplo e fechamento durante confirmação são bloqueados', async () => {
  let resolveUpload
  let uploads = 0
  const view = setup(() => { uploads += 1; return new Promise((resolve) => { resolveUpload = resolve }) })
  await view.open()
  act(() => { view.button('Salvar foto').props.onClick(); view.button('Salvar foto').props.onClick() })
  await act(async () => {})
  assert.equal(uploads, 1)
  act(() => { view.button('Fechar').props.onClick(); view.button('Cancelar').props.onClick() })
  assert.equal(view.callbacks.canceled, 0)
  await act(async () => { resolveUpload({ path: 'new.webp' }) })
  assert.equal(view.callbacks.saved.length, 1)
  view.unmount()
})
