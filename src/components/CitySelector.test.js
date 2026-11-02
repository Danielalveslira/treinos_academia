import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'
import * as catalog from '../data/ibgeMunicipalities.js'
import { buildMunicipalityIndex } from '../utils/municipalities.js'

// CitySelector: combobox acessível sobre o catálogo real do IBGE (sem rede). O hook do catálogo é
// substituído para controlar carregando/erro; a busca e o índice são os reais.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
const index = buildMunicipalityIndex(catalog)
let directory
let CitySelector

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'city-selector-tests-'))
  const outfile = join(directory, 'city.cjs')
  await build({
    stdin: {
      contents: `export { CitySelector } from './CitySelector.jsx'`,
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
        name: 'city-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/^@primer\/octicons-react$/, 'icons'],
            [/\/hooks\/useMunicipalityCatalog$/, 'catalog'],
          ])
            context.onResolve({ filter }, () => ({ path, namespace: 'stub' }))
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `
              import { forwardRef } from 'react'
              export const FormControl = ({ children }) => <div>{children}</div>
              FormControl.Label = ({ children }) => <label>{children}</label>
              FormControl.Caption = ({ children }) => <small>{children}</small>
              const Validation = ({ children }) => <span data-validation="true">{children}</span>
              FormControl.Validation = ({ variant, children }) => <span data-variant={variant}><Validation>{children}</Validation></span>
              export const TextInput = forwardRef(({ leadingVisual, trailingAction, block, size, ...props }, ref) => (
                <span><input ref={ref} {...props} />{trailingAction}</span>
              ))
              TextInput.Action = ({ icon, tooltipDirection, ...props }) => <button type="button" {...props} />
              export const Button = ({ children, size, variant, ...props }) => <button {...props}>{children}</button>
            `,
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            contents: `export const LocationIcon = () => null; export const XCircleFillIcon = () => null`,
          }))
          context.onLoad({ filter: /^catalog$/, namespace: 'stub' }, () => ({
            contents: `export const useMunicipalityCatalog = () => globalThis.__cityCatalog`,
          }))
        },
      },
    ],
  })
  ;({ CitySelector } = require(outfile))
})

after(async () => {
  delete globalThis.__cityCatalog
  if (directory) await rm(directory, { recursive: true, force: true })
})

let retries
beforeEach(() => {
  retries = 0
  globalThis.__cityCatalog = { status: 'ready', index, stale: false, retry: () => (retries += 1) }
})

function render(initial = null, props = {}) {
  const changes = []
  let value = initial
  let renderer
  const element = () =>
    React.createElement(CitySelector, {
      value,
      onChange: (code) => {
        changes.push(code)
        value = code
        renderer.update(element())
      },
      ...props,
    })
  act(() => {
    renderer = TestRenderer.create(element())
  })
  const input = () => renderer.root.findByProps({ role: 'combobox' })
  const options = () => renderer.root.findAllByProps({ role: 'option' })
  const optionText = () =>
    options().map((o) => o.findAllByType('span').map((s) => s.children.join('')).join(''))
  const type = (text) =>
    act(() => {
      input().props.onChange({ target: { value: text } })
    })
  const key = (k) => {
    let prevented = false
    act(() => {
      input().props.onKeyDown({ key: k, preventDefault: () => (prevented = true) })
    })
    return prevented
  }
  const blur = () => act(() => input().props.onBlur())
  const text = () => JSON.stringify(renderer.toJSON())
  return { renderer, changes, input, options, optionText, type, key, blur, text, get value() { return value } }
}

test('ARIA de combobox: rótulo, listbox ligada e lista fechada no início', () => {
  const view = render()
  const input = view.input()
  assert.equal(input.props['aria-autocomplete'], 'list')
  assert.equal(input.props['aria-expanded'], false)
  assert.ok(input.props['aria-controls'])
  assert.match(view.text(), /Cidade onde mora/)
  assert.match(view.text(), /Não precisamos do seu endereço/)
  assert.equal(view.options().length, 0)
})

test('busca sem acento mostra cidade e UF; setas + Enter selecionam o código IBGE', () => {
  const view = render()
  view.type('sao miguel')
  assert.equal(view.input().props['aria-expanded'], true)
  assert.equal(view.optionText()[0], 'São Miguel — RN')
  assert.ok(view.options().length <= 8)
  assert.equal(view.input().props['aria-activedescendant'], view.options()[0].props.id)
  view.key('ArrowDown')
  assert.equal(view.options()[1].props['aria-selected'], true)
  view.key('ArrowUp')
  assert.equal(view.options()[0].props['aria-selected'], true)
  const prevented = view.key('Enter')
  assert.equal(prevented, true, 'Enter com lista aberta não envia o formulário')
  assert.deepEqual(view.changes, [2412500])
  assert.equal(view.input().props.value, 'São Miguel — RN')
  assert.equal(view.options().length, 0)
})

test('clique (mousedown) em homônimo escolhe a UF certa', () => {
  const view = render()
  view.type('bom jesus')
  const pi = view.options()[view.optionText().indexOf('Bom Jesus — PI')]
  act(() => pi.props.onMouseDown({ preventDefault() {} }))
  assert.deepEqual(view.changes, [2201903])
})

test('texto digitado sem escolher sugestão nunca vira valor e mostra orientação', () => {
  const view = render()
  view.type('Bom Jesus')
  view.blur()
  assert.deepEqual(view.changes, [], 'ambíguo: nada é escolhido')
  assert.match(view.text(), /Escolha uma cidade da lista/)
  assert.equal(view.input().props['aria-invalid'], true)
})

test('nome completo e único é aceito ao sair do campo; cidade inexistente não', () => {
  const view = render()
  view.type('brasília')
  view.blur()
  assert.deepEqual(view.changes, [5300108])
  const other = render()
  other.type('Cidade Inventada')
  assert.match(other.text(), /Nenhuma cidade encontrada/)
  other.blur()
  assert.deepEqual(other.changes, [])
})

test('editar uma cidade já escolhida desfaz a seleção; Escape volta para a escolhida', () => {
  const view = render(2412500)
  assert.equal(view.input().props.value, 'São Miguel — RN')
  view.type('São Paulo')
  assert.deepEqual(view.changes, [null])
  const closed = render(3550308)
  closed.type('xx')
  closed.key('Escape')
  closed.key('Escape')
  assert.equal(closed.input().props.value, '', 'seleção já tinha sido desfeita pela edição')
})

test('limpar remove a seleção', () => {
  const view = render(2412559)
  const clear = view.renderer.root.findByProps({ 'aria-label': 'Limpar cidade' })
  act(() => clear.props.onClick())
  assert.deepEqual(view.changes, [null])
  assert.equal(view.input().props.value, '')
})

test('menos de 2 letras pede mais texto, sem lista', () => {
  const view = render()
  view.type('s')
  assert.equal(view.options().length, 0)
  assert.match(view.text(), /pelo menos 2 letras/)
})

test('carregando: campo somente leitura com aviso; erro oferece nova tentativa', () => {
  globalThis.__cityCatalog = { status: 'loading', index: null, stale: false, retry() {} }
  const loading = render(2412500)
  assert.equal(loading.input().props.readOnly, true)
  assert.match(loading.text(), /Carregando a lista de cidades/)

  globalThis.__cityCatalog = { status: 'error', index: null, stale: false, retry: () => (retries += 1) }
  const failed = render()
  assert.match(failed.text(), /Não foi possível carregar a lista de cidades/)
  const button = failed.renderer.root
    .findAllByType('button')
    .find((b) => b.children.includes('Tentar novamente'))
  act(() => button.props.onClick())
  assert.equal(retries, 1)

  globalThis.__cityCatalog = { status: 'error', index: null, stale: true, retry() {} }
  assert.match(render().text(), /Recarregue a página/)
})

test('erro vindo do formulário aparece no campo', () => {
  const view = render(null, { error: 'Selecione a cidade onde você mora na lista de sugestões' })
  assert.match(view.text(), /Selecione a cidade onde você mora/)
  assert.equal(view.input().props['aria-invalid'], true)
})

test('cidade válida selecionada mostra o indicador de sucesso (texto + ícone), que some ao apagar', () => {
  const view = render()
  const success = () => view.renderer.root.findAllByProps({ 'data-variant': 'success' })
  view.type('sao miguel')
  assert.equal(success().length, 0, 'texto sem seleção não é sucesso')
  view.key('Enter')
  assert.equal(success().length, 1)
  assert.match(view.text(), /Cidade selecionada: São Miguel — RN/)
  view.type('sao')
  assert.equal(success().length, 0, 'editar invalida a seleção')
  const selected = render(2412559)
  assert.match(selected.text(), /Cidade selecionada: São Miguel do Gostoso — RN/)
  const clear = selected.renderer.root.findByProps({ 'aria-label': 'Limpar cidade' })
  act(() => clear.props.onClick())
  assert.doesNotMatch(selected.text(), /Cidade selecionada/)
})
