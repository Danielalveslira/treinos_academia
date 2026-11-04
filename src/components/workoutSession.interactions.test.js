import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Fluxo de registro série a série (WorkoutForm + SetCard + rowSaver), renderizado de verdade com
// react-test-renderer: avanço automático, conclusão do exercício, edição, toque repetido e falhas de gravação.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let WorkoutForm

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'workout-session-tests-'))
  const outfile = join(directory, 'form.cjs')
  await build({
    stdin: {
      contents: `export { WorkoutForm } from './WorkoutForm.jsx'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'workout-session-fixtures',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/^@primer\/octicons-react$/, 'icons'],
            [/^react-router-dom$/, 'router'],
            [/\/hooks\/useExerciseCatalogDetail\.js$/, 'detail-hook'],
          ])
            context.onResolve({ filter }, () => ({ path, namespace: 'stub' }))
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `
              import React from 'react'
              export const Box = React.forwardRef(({ as: Tag = 'div', sx, children, ...props }, ref) => <Tag {...props}>{children}</Tag>)
              export const Text = ({ children, ...props }) => <span {...props}>{children}</span>
              export const Button = ({ as: Component = 'button', leadingVisual, loading, variant, children, ...props }) => <Component {...props}>{children}</Component>
              export const TextInput = ({ block, size, ...props }) => <input {...props} />
              export const Textarea = ({ block, ...props }) => <textarea {...props} />
              export const FormControl = ({ children }) => <div>{children}</div>
              FormControl.Label = ({ children }) => <label>{children}</label>
              FormControl.Caption = ({ children }) => <span>{children}</span>
              FormControl.Validation = ({ children }) => <span>{children}</span>
            `,
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `
              const icon = () => null
              export const AlertIcon = icon, CheckCircleFillIcon = icon, CheckIcon = icon,
                ChevronLeftIcon = icon, ChevronRightIcon = icon, ClockIcon = icon, ListUnorderedIcon = icon, SearchIcon = icon,
                SyncIcon = icon, TrashIcon = icon
            `,
          }))
          context.onLoad({ filter: /^router$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `export const Link = ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>`,
          }))
          context.onLoad({ filter: /^detail-hook$/, namespace: 'stub' }, () => ({
            contents: `export const useExerciseCatalogDetail = () => ({ data: null, loading: false, stale: false, unavailable: true })`,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  ;({ WorkoutForm } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// O DOM não existe aqui: só o que o formulário toca (eventos de janela, localStorage, body).
const listeners = []
let clock
beforeEach(() => {
  listeners.length = 0
  globalThis.window = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const index = listeners.findIndex((item) => item.type === type && item.fn === fn)
      if (index !== -1) listeners.splice(index, 1)
    },
  }
  globalThis.document = { activeElement: null, body: { classList: { add() {}, remove() {} } } }
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  clock = 1_000_000
  Date.now = () => clock
})

const textOf = (node) =>
  typeof node === 'string' ? node : (node.children || []).map((child) => textOf(child)).join('')

const squat = {
  id: 'squat',
  name: 'Agachamento',
  muscleGroup: 'Pernas',
  source: 'catalog',
  provider: 'evolutus_dataset',
  active: true,
}
const bench = {
  id: 'bench',
  name: 'Supino',
  muscleGroup: 'Pernas',
  source: 'catalog',
  provider: 'evolutus_dataset',
  active: true,
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function mount(props = {}) {
  const calls = { create: [], update: [] }
  const handlers = {
    onCreate: async (payload, options) => {
      calls.create.push({ payload, options })
      return { synced: true, pendingSync: false, workout: { id: options?.id } }
    },
    onUpdate: async (id, payload) => {
      calls.update.push({ id, payload })
      return { synced: true, pendingSync: false }
    },
  }
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(WorkoutForm, {
        exercises: [squat, bench],
        sheetScope: {
          id: 'sheet-a',
          items: [squat, bench].map((exercise) => ({ exercise_id: exercise.id, available: true })),
        },
        progressScope: 'user-a:sheet-a',
        defaultExerciseId: 'squat',
        ...handlers,
        ...props,
      })
    )
  })
  const root = renderer.root
  const api = {
    calls,
    root,
    html: () => textOf(renderer.toJSON()),
    button: (label) =>
      root.findAll(
        (node) => node.type === 'button' && textOf(node).includes(label) && !node.props.disabled
      )[0],
    anyButton: (label) =>
      root.findAll((node) => node.type === 'button' && textOf(node).includes(label))[0],
    input: (id) => root.findAll((node) => node.type === 'input' && node.props.id === id)[0],
    async type(id, value) {
      await act(async () => api.input(id).props.onChange({ target: { value } }))
    },
    async click(label) {
      const target = api.button(label)
      assert.ok(target, `botão habilitado "${label}" não encontrado`)
      await act(async () => target.props.onClick())
    },
    async conclude(weight, reps) {
      if (weight != null) await api.type('set-weight', weight)
      if (reps != null) await api.type('set-reps', reps)
      clock += 1000
      await api.click('Concluir série')
    },
    value: (id) => api.input(id).props.value,
  }
  return api
}

test('first workout: empty fields, completing a set saves it and advances with values carried over', async () => {
  const form = await mount()
  assert.match(form.html(), /Série 1 de 3/)
  assert.equal(form.value('set-weight'), '')
  assert.equal(form.value('set-reps'), '')
  assert.equal(form.anyButton('Concluir série').props.disabled, true)

  await form.conclude('20,5', '10')

  assert.match(form.html(), /Série 2 de 3/)
  assert.equal(form.value('set-weight'), '20,5')
  assert.equal(form.value('set-reps'), '10')
  assert.match(form.html(), /Igual à série anterior/)
  // A série seguinte é só sugestão: continua pendente, não registrada.
  assert.equal(form.root.findAll((n) => n.props?.['aria-label'] === 'Série 1, concluída').length, 1)
  assert.equal(form.root.findAll((n) => n.props?.['aria-label'] === 'Série 2, pendente').length, 1)
  assert.equal(form.calls.create.length, 1)
  assert.deepEqual(
    form.calls.create[0].payload.setDetails.map(({ weight, reps }) => ({ weight, reps })),
    [{ weight: '20.5', reps: '10' }]
  )
  assert.ok(form.calls.create[0].options.id)
})

test('reload restores confirmed sets and continues on the same row without creating a second one', async () => {
  const row = {
    id: 'existing-row',
    exerciseId: 'squat',
    sheetId: 'sheet-a',
    type: 'strength',
    setDetails: [{ weight: 32, reps: 8 }],
    note: 'Controle de movimento',
    pendingSync: true,
  }
  const form = await mount({ sessionRows: [row] })
  assert.match(form.html(), /Série 2 de 3/)
  assert.match(form.html(), /Salvo no aparelho/)
  assert.equal(
    form.root.findAll((node) => node.props?.['aria-label'] === 'Série 1, concluída').length,
    1
  )
  await form.conclude('34', '8')
  assert.equal(form.calls.create.length, 0)
  assert.equal(form.calls.update.length, 1)
  assert.equal(form.calls.update[0].id, 'existing-row')
  assert.deepEqual(
    form.calls.update[0].payload.setDetails.map((set) => set.weight),
    ['32', '34']
  )
  assert.equal(form.calls.update[0].payload.note, 'Controle de movimento')
})

test('reload keeps an explicitly completed partial exercise completed', async () => {
  const form = await mount({
    sessionRows: [
      {
        id: 'partial-row',
        exerciseId: 'squat',
        sheetId: 'sheet-a',
        type: 'strength',
        setDetails: [{ weight: 20, reps: 10 }],
        exerciseCompleted: true,
        pendingSync: false,
      },
    ],
  })
  assert.match(form.html(), /Exercício concluído/)
  assert.match(form.html(), /1 série · 20 kg × 10/)
  assert.equal(form.calls.create.length, 0)
  assert.equal(form.calls.update.length, 0)
})

test('navigation separates leaving the sheet from returning to its exercise list', async () => {
  const form = await mount({ backToSheets: '/treinar' })
  assert.equal(
    form.root.findAll((node) => node.type === 'a' && node.props.href === '/treinar').length,
    1
  )
  assert.equal(form.anyButton('Exercício 1 de 2'), undefined)
  await form.click('Exercícios da ficha')
  assert.match(form.html(), /Escolha o exercício/)
  await form.click('Voltar ao exercício')
  assert.match(form.html(), /Série 1 de 3/)
  assert.equal(form.calls.create.length, 0)
})

test('every set after the first updates the same row; the last set finishes the exercise without navigating', async () => {
  const form = await mount()
  await form.conclude('20', '10')
  await form.conclude(null, null)
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.update.length, 1)
  assert.equal(form.calls.update[0].id, form.calls.create[0].options.id)
  assert.equal(form.calls.update[0].payload.setDetails.length, 2)

  await form.conclude(null, null)
  assert.equal(form.calls.update.length, 2)
  assert.equal(form.calls.update[1].payload.setDetails.length, 3)
  const html = form.html()
  assert.match(html, /Exercício concluído/)
  assert.match(html, /3 séries · 20 kg × 10/)
  assert.match(html, /Próximo exercício/)
  assert.match(html, /Revisar séries/)
  assert.doesNotMatch(html, /Concluir série/)
  // Continua no mesmo exercício: o usuário decide quando seguir.
  assert.match(html, /Agachamento/)
  assert.equal(form.calls.create.length, 1)
})

test('"Próximo exercício" opens the next unfinished exercise only when tapped; "Revisar séries" shows the card again', async () => {
  const form = await mount()
  for (let index = 0; index < 3; index += 1)
    await form.conclude(index === 0 ? '30' : null, index === 0 ? '8' : null)
  await form.click('Revisar séries')
  assert.match(form.html(), /Série 1 de 3/)
  assert.match(form.html(), /Registrada/)
  assert.equal(form.value('set-weight'), '30')

  await form.click('Próximo exercício')
  assert.match(form.html(), /Supino/)
  assert.equal(form.value('set-weight'), '')
  assert.match(form.html(), /Série 1 de 3/)
})

test('double tap on "Concluir série" records a single set', async () => {
  const form = await mount()
  await form.type('set-weight', '40')
  await form.type('set-reps', '6')
  clock += 1000
  const button = form.button('Concluir série')
  await act(async () => {
    button.props.onClick()
    button.props.onClick()
  })
  // Mesmo depois do re-render, um segundo toque logo em seguida cai na janela de proteção.
  clock += 50
  await act(async () => form.button('Concluir série').props.onClick())

  assert.match(form.html(), /Série 2 de 3/)
  assert.equal(
    form.root.findAll((n) => /, concluída$/.test(n.props?.['aria-label'] || '')).length,
    1
  )
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.update.length, 0)
})

test('editing a recorded set updates only that set and keeps the others', async () => {
  const form = await mount()
  await form.conclude('20', '10')
  await form.conclude('25', '8')
  const segment = form.root.findAll((n) => n.props?.['aria-label'] === 'Série 1, concluída')[0]
  await act(async () => segment.props.onClick())
  assert.equal(form.value('set-weight'), '20')
  assert.equal(form.anyButton('Atualizar série'), undefined)

  await form.type('set-weight', '22,5')
  assert.match(form.html(), /Alterada/)
  const updatesBefore = form.calls.update.length
  assert.equal(form.calls.update.length, updatesBefore) // digitar nunca grava
  await form.click('Atualizar série')

  const last = form.calls.update.at(-1).payload.setDetails.map(({ weight, reps }) => [weight, reps])
  assert.deepEqual(last, [
    ['22.5', '10'],
    ['25', '8'],
  ])
})

test('history suggestions are labelled, keep per-set progression and are not recorded', async () => {
  const history = [
    {
      exerciseId: 'squat',
      date: '2026-10-01T12:00:00',
      setDetails: [
        { weight: 20, reps: 10 },
        { weight: 22.5, reps: 8 },
        { weight: 25, reps: 6 },
      ],
    },
  ]
  const form = await mount({ history })
  assert.match(form.html(), /Sugerido do último treino/)
  assert.equal(form.value('set-weight'), '20')
  assert.equal(form.calls.create.length, 0)

  // Confirmando a sugestão, as próximas continuam com a progressão do histórico.
  await form.conclude(null, null)
  assert.equal(form.value('set-weight'), '22.5'.replace('.', ','))
  assert.match(form.html(), /Sugerido do último treino/)

  // Se o usuário se afasta da sugestão, as séries seguintes seguem o que ele fez.
  await form.conclude('30', '12')
  assert.equal(form.value('set-weight'), '30')
  assert.equal(form.value('set-reps'), '12')
  assert.match(form.html(), /Igual à série anterior/)
})

test('zero load is accepted; an empty weight is not', async () => {
  const form = await mount()
  await form.type('set-reps', '15')
  assert.equal(form.anyButton('Concluir série').props.disabled, true)
  await form.conclude('0', null)
  assert.equal(form.calls.create[0].payload.setDetails[0].weight, '0')
})

test('a failed save keeps the set, shows an error and retries the SAME row without duplicating it', async () => {
  let attempt = 0
  const form = await mount({
    onCreate: async (payload, options) => {
      form.calls.create.push({ payload, options })
      attempt += 1
      if (attempt === 1) throw new Error('network down')
      return { synced: true, pendingSync: false }
    },
  })
  await form.conclude('20', '10')
  assert.match(form.html(), /Não foi possível salvar|Sem conexão/)
  assert.match(form.html(), /Tentar novamente/)
  // A série segue concluída e a tela avançou: nada se perde.
  assert.match(form.html(), /Série 2 de 3/)

  await form.click('Tentar novamente')
  assert.equal(form.calls.create.length, 2)
  assert.equal(form.calls.create[1].options.id, form.calls.create[0].options.id)
  assert.doesNotMatch(form.html(), /Tentar novamente/)

  await form.conclude(null, null)
  assert.equal(form.calls.update.length, 1)
  assert.equal(form.calls.update[0].id, form.calls.create[0].options.id)
})

test('a set saved only on this device is shown as pending, never as synced', async () => {
  const form = await mount({
    onCreate: async (payload, options) => {
      form.calls.create.push({ payload, options })
      return { persisted: true, synced: false, pendingSync: true }
    },
  })
  await form.conclude('20', '10')
  assert.match(form.html(), /Salvo no aparelho/)
  assert.equal(
    form.root.findAll((n) => /is-local/.test(n.props?.className || '') && n.type === 'button')
      .length,
    1
  )
})

test('connection coming back retries what failed', async () => {
  let attempt = 0
  const form = await mount({
    onCreate: async (payload, options) => {
      form.calls.create.push({ payload, options })
      attempt += 1
      if (attempt === 1) throw new Error('offline')
      return { synced: true, pendingSync: false }
    },
  })
  await form.conclude('20', '10')
  assert.match(form.html(), /Tentar novamente/)
  await act(async () => listeners.filter((item) => item.type === 'online').forEach((i) => i.fn()))
  assert.equal(form.calls.create.length, 2)
  assert.doesNotMatch(form.html(), /Tentar novamente/)
})

test('"Finalizar com N séries" drops the untouched ones and finishes the exercise', async () => {
  const form = await mount()
  await form.conclude('20', '10')
  await form.click('Finalizar com 1 série')
  assert.match(form.html(), /Exercício concluído/)
  assert.match(form.html(), /1 série · 20 kg × 10/)
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.create[0].payload.exerciseCompleted, false)
  assert.equal(form.calls.update.length, 1)
  assert.equal(form.calls.update[0].payload.exerciseCompleted, true)
  assert.deepEqual(
    form.calls.update[0].payload.setDetails.map(({ weight, reps }) => ({ weight, reps })),
    [{ weight: '20', reps: '10' }]
  )
})

test('removing the final pending sets persists partial completion on the same row', async () => {
  const form = await mount()
  await form.conclude('20', '10')
  await form.click('Remover série 2')
  await form.click('Toque para confirmar')
  await form.click('Remover série 2')
  await form.click('Toque para confirmar')
  assert.match(form.html(), /Exercício concluído/)
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.update.length, 1)
  assert.equal(form.calls.update[0].payload.exerciseCompleted, true)
})

test('cardio: one action records the session and finishes the exercise', async () => {
  const form = await mount({
    exercises: [
      {
        id: 'run',
        name: 'Corrida',
        muscleGroup: 'Cardio',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
        type: 'cardio',
      },
    ],
    sheetScope: { id: 'sheet-a', items: [{ exercise_id: 'run', available: true }] },
    defaultExerciseId: 'run',
  })
  const duration = form.root.findAll(
    (n) => n.type === 'input' && n.props.placeholder === 'Ex.: 30'
  )[0]
  await act(async () => duration.props.onChange({ target: { value: '30' } }))
  clock += 1000
  await form.click('Concluir exercício')
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.create[0].payload.durationMinutes, '30')
  assert.match(form.html(), /Exercício concluído/)
  assert.match(form.html(), /30 min/)
})

test('editing an existing workout keeps the old contract: all sets, one save', async () => {
  const submitted = []
  const form = await mount({
    defaultExerciseId: undefined,
    initialValue: {
      exerciseId: 'squat',
      setDetails: [
        { weight: 30, reps: 12 },
        { weight: 40, reps: 8 },
      ],
      date: '2025-01-01',
      note: '',
    },
    onSubmit: async (payload) => submitted.push(payload),
  })
  assert.equal(form.anyButton('Concluir série'), undefined)
  await form.type('set-weight', '32,5')
  const formNode = form.root.findAll((n) => n.type === 'form')[0]
  await act(async () => formNode.props.onSubmit({ preventDefault() {} }))
  assert.equal(submitted.length, 1)
  assert.deepEqual(
    submitted[0].setDetails.map(({ weight, reps }) => [weight, reps]),
    [
      ['32.5', '12'],
      ['40', '8'],
    ]
  )
  assert.equal(form.calls.create.length, 0)
})

test('pressing Enter inside a field never records a set', async () => {
  const form = await mount()
  await form.type('set-weight', '20')
  await form.type('set-reps', '10')
  const formNode = form.root.findAll((n) => n.type === 'form')[0]
  await act(async () => formNode.props.onSubmit({ preventDefault() {} }))
  assert.equal(form.calls.create.length, 0)
  assert.match(form.html(), /Série 1 de 3/)
})

test('a slow first save never produces a duplicate create: the next set waits and goes as one update', async () => {
  const gate = deferred()
  const form = await mount({
    onCreate: async (payload, options) => {
      form.calls.create.push({ payload, options })
      await gate.promise
      return { synced: true, pendingSync: false }
    },
  })
  await form.conclude('20', '10')
  await form.conclude(null, null)
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.update.length, 0)
  await act(async () => gate.resolve())
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.update.length, 1)
  assert.equal(form.calls.update[0].payload.setDetails.length, 2)
})

test('after the last sheet exercise, review stays within the sheet and never opens groups', async () => {
  const form = await mount({
    exercises: [squat],
    sheetScope: { id: 'sheet-a', items: [{ exercise_id: squat.id, available: true }] },
  })
  await form.conclude('20', '10')
  await form.conclude('20', '10')
  await form.conclude('20', '10')
  await form.click('Ver exercícios da ficha')
  assert.match(form.html(), /Escolha o exercício/)
  assert.doesNotMatch(form.html(), /Qual grupo|Escolher outro grupo/)
  assert.equal(form.calls.create[0].payload.sheetId, 'sheet-a')
  assert.equal(form.calls.create.length, 1)
  assert.equal(form.calls.update.length, 2)
})
