import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// CommercialAdmin.jsx fala direto com o client Supabase real (../supabase/config) -- fora
// de escopo aqui, trocado por um stub em memória que registra toda chamada em
// globalThis.__supaCalls, mesmo padrão de stub-por-esbuild já usado em
// AdminSponsoredAds.test.js/AccountMenu.test.js. useToast/useConfirmDelete também são
// stubados: o foco destes testes é a origem do crash do Editar (defeito B) e a exigência
// de imagem no cadastro/publicação (defeito A), não o toast em si.
let directory
let mount

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'commercial-admin-tests-'))
  const outfile = join(directory, 'page.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import CommercialAdmin from './CommercialAdmin.jsx'

        function textOf(node) {
          if (node == null) return ''
          if (typeof node === 'string' || typeof node === 'number') return String(node)
          return (node.children || []).map(textOf).join('')
        }

        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(CommercialAdmin)))
            )
          })
          const root = renderer.root
          function findForm() {
            return root.findAll((n) => n.type === 'form')[0]
          }
          function findInput(labelText) {
            const label = root.findAll((n) => n.type === 'label' && textOf(n).startsWith(labelText))[0]
            // FormControl.Label é irmão do input, não seu pai -- sobe na árvore até achar
            // um ancestral comum que contenha exatamente o input/textarea do campo.
            let node = label.parent
            while (node && node.findAll((n) => n.type === 'input' || n.type === 'textarea').length === 0) {
              node = node.parent
            }
            return node.findAll((n) => n.type === 'input' || n.type === 'textarea')[0]
          }
          function findButton(label) {
            return root.findAll((n) => n.type === 'button' && textOf(n).trim() === label)[0]
          }
          return {
            text: () => textOf(renderer.toJSON()),
            editButtons: () => root.findAll((n) => n.type === 'button' && textOf(n).trim() === 'Editar'),
            clickEdit: (index = 0) => act(() => { root.findAll((n) => n.type === 'button' && textOf(n).trim() === 'Editar')[index].props.onClick() }),
            clickCancelEdit: () => act(() => { findButton('Cancelar edição').props.onClick() }),
            nameValue: () => findInput('Nome do produto').props.value,
            imageUrlValue: () => findInput('URL da imagem').props.value,
            setField: (labelText, value) => act(() => {
              findInput(labelText).props.onChange({ target: { value } })
            }),
            setChecked: (labelText, checked) => act(() => {
              findInput(labelText).props.onChange({ target: { checked } })
            }),
            submit: () => act(() => { findForm().props.onSubmit({ preventDefault() {} }) }),
            imageError: () => {
              const matches = root.findAll((n) => n.props && typeof n.props.children === 'string' && /[Ii]magem/.test(n.props.children) && n.props.variant === 'error')
              return matches[0] ? matches[0].props.children : undefined
            },
            unmount: () => act(() => renderer.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'commercial-admin-fixtures',
        setup(pluginBuild) {
          pluginBuild.onResolve({filter:/\/StorefrontManager$/},()=>({path:'manager',namespace:'fixture-manager'}))
          pluginBuild.onLoad({filter:/.*/,namespace:'fixture-manager'},()=>({contents:'export default function StorefrontManager(){return null}'}))
          pluginBuild.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-supabase',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/useToast$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-toast',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/useConfirmDelete$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-confirm-delete',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-supabase' }, () => ({
            contents: `
              function chain(table) {
                const ops = []
                const node = {
                  select(...a) { ops.push(['select', a]); return node },
                  order(...a) { ops.push(['order', a]); return node },
                  limit(...a) { ops.push(['limit', a]); return node },
                  eq(...a) { ops.push(['eq', a]); return node },
                  is(...a) { ops.push(['is', a]); return node },
                  insert(payload) {
                    globalThis.__supaCalls.push({ table, op: 'insert', payload })
                    ops.push(['insert', payload])
                    return node
                  },
                  update(payload) {
                    globalThis.__supaCalls.push({ table, op: 'update', payload })
                    ops.push(['update', payload])
                    return node
                  },
                  delete() {
                    globalThis.__supaCalls.push({ table, op: 'delete' })
                    ops.push(['delete'])
                    return node
                  },
                  then(resolve, reject) {
                    const isWrite = ops.some(([name]) => ['insert', 'update', 'delete'].includes(name))
                    const result = isWrite
                      ? { data: null, error: globalThis.__supaError || null }
                      : { data: globalThis.__supaFixtures[table] || [], error: null }
                    return Promise.resolve(result).then(resolve, reject)
                  },
                }
                return node
              }
              export const supabase = { from: (table) => chain(table) }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-toast' }, () => ({
            contents: `export function useToast() { return { toasts: [], showToast(message, variant) { globalThis.__toasts.push({ message, variant }) } } }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-confirm-delete' }, () => ({
            contents: `export function useConfirmDelete() { return async () => true }`,
          }))
        },
      },
    ],
  })
  ;({ mountPage: mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

function resetFixtures({ products = [], leads = [], error = null } = {}) {
  globalThis.__supaFixtures = { partner_products: products, commercial_leads: leads }
  globalThis.__supaError = error
  globalThis.__supaCalls = []
  globalThis.__toasts = []
}

const PUBLISHED_WITH_IMAGE = {
  id: 'p1',
  name: 'Tênis',
  brand: 'Marca',
  description: 'Descrição válida do produto parceiro.',
  category: 'Calçados',
  image_url: 'https://cdn.example.com/tenis.jpg',
  store_url: 'https://loja.example.com/tenis',
  sponsored: false,
  approved: true,
  starts_at: null,
  ends_at: null,
}

const DRAFT_WITHOUT_IMAGE = {
  id: 'p2',
  name: 'Camiseta',
  brand: 'Marca',
  description: 'Descrição válida do produto parceiro.',
  category: 'Vestuário',
  image_url: null,
  store_url: 'https://loja.example.com/camiseta',
  sponsored: false,
  approved: false,
  starts_at: null,
  ends_at: null,
}

test('abrir "Editar" em um produto legado sem imagem não derruba o formulário (defeito B: TypeError .trim() em null)', async () => {
  resetFixtures({ products: [DRAFT_WITHOUT_IMAGE] })
  const page = mount()
  await tick()
  assert.doesNotThrow(() => page.clickEdit(0))
  assert.equal(page.nameValue(), 'Camiseta')
  assert.equal(page.imageUrlValue(), '', 'image_url null é normalizado para string vazia no formulário')
  page.unmount()
})

test('abrir "Editar" em um produto publicado com imagem também funciona normalmente', async () => {
  resetFixtures({ products: [PUBLISHED_WITH_IMAGE] })
  const page = mount()
  await tick()
  assert.doesNotThrow(() => page.clickEdit(0))
  assert.equal(page.imageUrlValue(), 'https://cdn.example.com/tenis.jpg')
  page.unmount()
})

test('"Editar" seguido de "Cancelar edição" não grava nada (nenhuma chamada de update/insert ao Supabase)', async () => {
  resetFixtures({ products: [DRAFT_WITHOUT_IMAGE] })
  const page = mount()
  await tick()
  page.clickEdit(0)
  page.clickCancelEdit()
  assert.equal(globalThis.__supaCalls.length, 0)
  assert.equal(page.nameValue(), '', 'formulário volta ao estado vazio de novo cadastro')
  page.unmount()
})

test('cadastrar um produto novo sem imagem é rejeitado: nenhum insert ocorre e o erro aparece junto ao campo', async () => {
  resetFixtures({ products: [] })
  const page = mount()
  await tick()
  page.setField('Nome do produto', 'Produto novo')
  page.setField('Marca', 'Marca nova')
  page.setField('Categoria', 'Categoria')
  page.setField('Descrição', 'Descrição suficientemente longa para passar na validação.')
  page.setField('URL da loja', 'https://loja.example.com/produto-novo')
  page.submit()
  assert.equal(globalThis.__supaCalls.filter((c) => c.op === 'insert').length, 0)
  assert.match(page.text(), /[Ii]magem.*obrigat/)
  page.unmount()
})

test('cadastrar um produto novo com imagem válida grava normalmente', async () => {
  resetFixtures({ products: [] })
  const page = mount()
  await tick()
  page.setField('Nome do produto', 'Produto novo')
  page.setField('Marca', 'Marca nova')
  page.setField('Categoria', 'Categoria')
  page.setField('Descrição', 'Descrição suficientemente longa para passar na validação.')
  page.setField('URL da loja', 'https://loja.example.com/produto-novo')
  page.setField('URL da imagem', 'https://cdn.example.com/produto-novo.jpg')
  page.submit()
  const inserts = globalThis.__supaCalls.filter((c) => c.op === 'insert')
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].payload.image_url, 'https://cdn.example.com/produto-novo.jpg')
  page.unmount()
})

test('editar um rascunho legado sem imagem SEM marcar "Aprovado" continua permitido (produto legado permanece editável)', async () => {
  resetFixtures({ products: [DRAFT_WITHOUT_IMAGE] })
  const page = mount()
  await tick()
  page.clickEdit(0)
  page.setField('Descrição', 'Descrição revisada, ainda válida e suficientemente longa.')
  page.submit()
  const updates = globalThis.__supaCalls.filter((c) => c.op === 'update')
  assert.equal(updates.length, 1, 'edição de texto sem publicar não exige imagem')
  assert.equal(updates[0].payload.image_url, null)
  page.unmount()
})

test('marcar "Aprovado" num rascunho legado sem imagem é bloqueado até preencher a imagem', async () => {
  resetFixtures({ products: [DRAFT_WITHOUT_IMAGE] })
  const page = mount()
  await tick()
  page.clickEdit(0)
  page.setChecked('Aprovação legada (não publica)', true)
  page.submit()
  assert.equal(globalThis.__supaCalls.filter((c) => c.op === 'update').length, 0, 'publicar sem imagem é rejeitado')
  page.unmount()
})
