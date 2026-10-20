import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mount
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-icon-picker-'))
  const outfile = join(directory, 'picker.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { CommunityIconPicker } from './CommunityIconPicker.jsx'
        export function mount(props) {
          let tree
          act(() => { tree = TestRenderer.create(createElement(CommunityIconPicker, props)) })
          return {
            tree,
            update(next) { act(() => tree.update(createElement(CommunityIconPicker, next))) },
            click(button) { act(() => button.props.onClick()) },
            search(value) {
              const input = tree.root.findByType('input')
              act(() => input.props.onChange({ target: { value } }))
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
  })
  ;({ mount } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function optionButtons(tree) {
  return tree.root.findAll(
    (node) => node.type === 'button' && node.props.className?.includes('community-icon-option')
  )
}

function buttonByLabel(tree, label) {
  return tree.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label']?.startsWith(label)
  )[0]
}

function filterByText(tree, label) {
  return tree.root.findAll(
    (node) =>
      node.type === 'button' &&
      node.props.className?.includes('community-icon-filter') &&
      node.children.includes(label)
  )[0]
}

function textContent(node) {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

test('filtra categorias e atualiza a escolha controlada com prévia e seleção acessível', () => {
  const changes = []
  const props = { value: 'users', name: 'Grupo', onChange: (value) => changes.push(value) }
  const picker = mount(props)
  assert.equal(optionButtons(picker.tree).length, 8, 'a categoria da seleção inicial fica visível')
  picker.click(filterByText(picker.tree, 'Alimentação'))
  assert.equal(optionButtons(picker.tree).length, 12)
  picker.click(buttonByLabel(picker.tree, 'Maçã'))
  assert.deepEqual(changes, ['apple'])
  picker.update({ ...props, value: 'apple' })
  assert.equal(buttonByLabel(picker.tree, 'Maçã').props['aria-pressed'], true)
  const preview = picker.tree.root.findByProps({ className: 'community-icon-picker-preview' })
  assert.match(textContent(preview), /Alimentação saudável/)
})

test('busca encontra opções com acento e mantém a escolha até salvar', () => {
  const picker = mount({ value: 'dumbbell', onChange() {} })
  picker.search('cafe')
  assert.equal(optionButtons(picker.tree).length, 1)
  assert.ok(buttonByLabel(picker.tree, 'Café'))
  assert.ok(picker.tree.root.findByProps({ className: 'community-icon-picker-preview' }))
})

test('marca só aparece no seletor administrativo e usa o SVG da marca', () => {
  const changes = []
  const ordinary = mount({ value: 'users', onChange: (value) => changes.push(value) })
  ordinary.search('Evolutus')
  assert.equal(optionButtons(ordinary.tree).length, 0)

  const admin = mount({
    value: 'users',
    allowOfficialIcon: true,
    onChange: (value) => changes.push(value),
  })
  admin.search('Evolutus')
  const button = buttonByLabel(admin.tree, 'Evolutus')
  assert.ok(button)
  assert.equal(button.findAllByType('svg').length, 1)
  assert.equal(button.findAllByType('path').length, 2)
  admin.click(button)
  assert.deepEqual(changes, ['evolutus'])
  admin.update({ value: 'evolutus', allowOfficialIcon: true, onChange: () => {} })
  assert.equal(buttonByLabel(admin.tree, 'Evolutus').props['aria-pressed'], true)
  const preview = admin.tree.root.findByProps({ className: 'community-icon-picker-preview' })
  assert.equal(preview.findAllByType('path').length, 2)
})
