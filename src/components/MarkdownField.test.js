import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderEditor

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markdown-field-tests-'))
  const outfile = join(directory, 'markdown-field.cjs')
  await build({
    stdin: {
      loader: 'jsx',
      contents: `
        import React, { useState } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MarkdownField } from './MarkdownField.jsx'

        function textContent(node) {
          if (typeof node === 'string') return node
          if (!node?.children) return ''
          return node.children.map(textContent).join('')
        }

        export function renderEditorView(initialValue = '', maxLength = 500) {
          const textareaNode = {
            selectionStart: 0,
            selectionEnd: 0,
            isConnected: true,
            focused: false,
            focus() { this.focused = true },
            setSelectionRange(start, end) {
              this.selectionStart = start
              this.selectionEnd = end
            },
          }
          global.requestAnimationFrame = (callback) => callback()

          function Harness() {
            const [value, setValue] = useState(initialValue)
            return <>
              <MarkdownField label="Mensagem" value={value} onChange={setValue} maxLength={maxLength} />
              <output data-value>{value}</output>
            </>
          }

          let renderer
          act(() => {
            renderer = TestRenderer.create(<Harness />, {
              createNodeMock: (element) => element.type === 'textarea' ? textareaNode : {},
            })
          })

          function button(label) {
            return renderer.root.findAllByType('button').find((item) => textContent(item) === label || item.props['aria-label'] === label)
          }
          function textarea() {
            return renderer.root.findByType('textarea')
          }
          function value() {
            return renderer.root.findByProps({ 'data-value': true }).children.join('')
          }

          return {
            value,
            textareaNode,
            select(start, end) {
              textareaNode.selectionStart = start
              textareaNode.selectionEnd = end
            },
            click(label) {
              act(() => button(label).props.onClick({ preventDefault() {} }))
            },
            shortcut(key) {
              let prevented = false
              act(() => textarea().props.onKeyDown({
                key,
                ctrlKey: true,
                metaKey: false,
                altKey: false,
                preventDefault() { prevented = true },
              }))
              return prevented
            },
            changeInput(placeholder, nextValue) {
              const input = renderer.root.findAllByType('input').find((item) => item.props.placeholder === placeholder)
              act(() => input.props.onChange({ target: { value: nextValue } }))
            },
            content() {
              return textContent(renderer.root)
            },
            buttonLabels() {
              return renderer.root.findAllByType('button').map((item) => item.props['aria-label'] || textContent(item))
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
        name: 'primer-markdown-field-test-double',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer-react',
            namespace: 'primer-test',
          }))
          buildApi.onLoad({ filter: /.*/, namespace: 'primer-test' }, () => ({
            loader: 'jsx',
            resolveDir: new URL('../..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
            contents: `
              import React, { forwardRef } from 'react'
              export function Box({ as: Tag = 'div', sx, ...props }) { return <Tag {...props} /> }
              export function Text({ as: Tag = 'span', sx, ...props }) { return <Tag {...props} /> }
              export function Link(props) { return <a {...props} /> }
              export const Textarea = forwardRef(({ sx, block, resize, validationStatus, ...props }, ref) => <textarea ref={ref} {...props} />)
              export const TextInput = forwardRef(({ block, ...props }, ref) => <input ref={ref} {...props} />)
              export function IconButton({ icon, variant, size, sx, ...props }) { return <button {...props} /> }
              export function FormControl({ children, sx, ...props }) { return <div {...props}>{children}</div> }
              FormControl.Label = ({ visuallyHidden, ...props }) => <label {...props} />
              FormControl.Caption = (props) => <div {...props} />
              FormControl.Validation = ({ variant, ...props }) => <div role="alert" {...props} />
              export function SegmentedControl({ children, onChange, ...props }) {
                return <div {...props}>{React.Children.map(children, (child, index) => React.cloneElement(child, { onClick: () => onChange(index) }))}</div>
              }
              SegmentedControl.Button = ({ leadingIcon, selected, ...props }) => <button aria-pressed={selected} {...props} />
              export function ActionMenu({ children }) { return <div>{children}</div> }
              ActionMenu.Anchor = ({ children }) => children
              ActionMenu.Overlay = ({ children }) => <div>{children}</div>
              export function ActionList({ children }) { return <div>{children}</div> }
              ActionList.Item = ({ onSelect, children }) => <button onClick={onSelect}>{children}</button>
              ActionList.LeadingVisual = ({ children }) => <span>{children}</span>
              export function Dialog({ title, subtitle, children, footerButtons }) {
                return <section role="dialog"><h2>{title}</h2><p>{subtitle}</p>{children}{footerButtons.map((item) => <button key={item.content} onClick={item.onClick}>{item.content}</button>)}</section>
              }
            `,
          }))
        },
      },
    ],
  })
  ;({ renderEditorView: renderEditor } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('toolbar formats selected text and restores selection and focus', () => {
  const view = renderEditor('Meu treino foi excelente')
  view.select(0, 24)
  view.click('Negrito')
  assert.equal(view.value(), '**Meu treino foi excelente**')
  assert.deepEqual([view.textareaNode.selectionStart, view.textareaNode.selectionEnd], [2, 26])
  assert.equal(view.textareaNode.focused, true)
  view.unmount()
})

test('Ctrl/Cmd+B and Ctrl/Cmd+I format locally without intercepting undo shortcuts', () => {
  const view = renderEditor('forte leve')
  view.select(0, 5)
  assert.equal(view.shortcut('b'), true)
  assert.equal(view.value(), '**forte** leve')
  view.select(10, 14)
  assert.equal(view.shortcut('i'), true)
  assert.equal(view.value(), '**forte** _leve_')
  assert.equal(view.shortcut('z'), false)
  view.unmount()
})

test('Ctrl/Cmd+K opens an accessible link form, validates URL and inserts the link', () => {
  const view = renderEditor('Veja treino')
  view.select(5, 11)
  assert.equal(view.shortcut('k'), true)
  assert.match(view.content(), /Inserir link/)
  view.changeInput('https://exemplo.com', 'javascript:alert(1)')
  view.click('Inserir link')
  assert.match(view.content(), /HTTP ou HTTPS válido/)
  assert.equal(view.value(), 'Veja treino')

  view.changeInput('https://exemplo.com', 'evolutus.com/treino')
  view.click('Inserir link')
  assert.equal(view.value(), 'Veja [treino](https://evolutus.com/treino)')
  assert.equal(view.textareaNode.selectionStart, view.value().length)
  view.unmount()
})

test('preview toggle is faithful, keeps the source unchanged and handles empty content', () => {
  const formatted = renderEditor('**Treino** concluído')
  formatted.click('Prévia')
  assert.match(formatted.content(), /Treino concluído/)
  assert.equal(formatted.value(), '**Treino** concluído')
  formatted.unmount()

  const empty = renderEditor('')
  empty.click('Prévia')
  assert.match(empty.content(), /Nada para pré-visualizar ainda/)
  empty.unmount()
})

test('character limit blocks toolbar output beyond the configured maximum', () => {
  const view = renderEditor('x'.repeat(500), 500)
  view.select(0, 500)
  view.click('Negrito')
  assert.equal(view.value(), 'x'.repeat(500))
  assert.match(view.content(), /ultrapassa o limite de 500 caracteres/)
  assert.match(view.content(), /500 \/ 500/)
  view.unmount()
})

test('compact toolbar keeps secondary supported formats under More options', () => {
  const view = renderEditor('')
  const labels = view.buttonLabels()
  for (const label of ['Negrito', 'Itálico', 'Título', 'Link', 'Mais opções de formatação']) {
    assert.ok(labels.includes(label))
  }
  for (const label of [
    'Lista com marcadores',
    'Checklist',
    'Separador horizontal',
    'Tabela simples',
  ]) {
    assert.match(view.content(), new RegExp(label))
  }
  view.unmount()
})
