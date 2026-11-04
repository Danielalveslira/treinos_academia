import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Cronômetro de descanso integrado ao registro série a série (WorkoutForm + SetCard + RestTimer),
// renderizado de verdade: início automático, casos em que NÃO inicia, +15s/pular, troca de exercício,
// expiração, restauração após reload e isolamento de falhas.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let WorkoutForm

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rest-timer-tests-'))
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
        name: 'rest-timer-fixtures',
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
              export const Button = ({ as: Component = 'button', leadingVisual, loading, variant, size, children, ...props }) => <Component {...props}>{children}</Component>
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

const REST_KEY = 'evolutus:rest-timer'
const realNow = Date.now
let clock
let session
const mounted = []

function memoryStorage() {
  const store = new Map()
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  // Relógio e timers controlados: Date.now é o `clock`; setTimeout/setInterval só correm com tick().
  clock = 1_000_000
  Date.now = () => clock
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { activeElement: null, body: { classList: { add() {}, remove() {} } } }
  globalThis.localStorage = memoryStorage()
  session = memoryStorage()
  globalThis.sessionStorage = session
})

afterEach(() => {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount())
  mock.timers.reset()
  Date.now = realNow
})

// Avança o relógio e dispara os timers vencidos (intervalo de 1s do RestTimer, expiração do hook).
async function elapse(ms) {
  clock += ms
  await act(async () => mock.timers.tick(ms))
}

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
  muscleGroup: 'Peito',
  source: 'catalog',
  provider: 'evolutus_dataset',
  active: true,
}

function sheet(rest = {}) {
  return {
    id: 'sheet-a',
    items: [squat, bench].map((exercise) => ({
      exercise_id: exercise.id,
      available: true,
      ...(exercise.id in rest ? { rest_seconds: rest[exercise.id] } : {}),
    })),
  }
}

async function mount(props = {}) {
  const calls = { create: [], update: [] }
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(WorkoutForm, {
        exercises: [squat, bench],
        sheetScope: sheet({ squat: 60, bench: 45 }),
        progressScope: 'user-a:sheet-a',
        defaultExerciseId: 'squat',
        backToSheets: '/treinar',
        onCreate: async (payload, options) => {
          calls.create.push({ payload, options })
          return { synced: true, pendingSync: false }
        },
        onUpdate: async (id, payload) => {
          calls.update.push({ id, payload })
          return { synced: true, pendingSync: false }
        },
        ...props,
      })
    )
  })
  mounted.push(renderer)
  const root = renderer.root
  const api = {
    calls,
    root,
    renderer,
    html: () => textOf(renderer.toJSON()),
    timers: () =>
      root.findAll(
        (node) => node.type === 'section' && /rest-timer/.test(node.props.className || '')
      ),
    clock: () =>
      root.findAll((node) => node.props?.role === 'timer')[0] &&
      textOf(root.findAll((node) => node.props?.role === 'timer')[0]),
    stored: () => (session.store.has(REST_KEY) ? JSON.parse(session.store.get(REST_KEY)) : null),
    button: (label) =>
      root.findAll(
        (node) =>
          node.type === 'button' &&
          (textOf(node).includes(label) || node.props['aria-label'] === label) &&
          !node.props.disabled
      )[0],
    input: (id) => root.findAll((node) => node.type === 'input' && node.props.id === id)[0],
    async type(id, value) {
      await act(async () => api.input(id).props.onChange({ target: { value } }))
    },
    async click(label) {
      const target = api.button(label)
      assert.ok(target, `botão habilitado "${label}" não encontrado`)
      await act(async () => target.props.onClick())
    },
    async conclude(weight = '20', reps = '10') {
      await api.type('set-weight', weight)
      await api.type('set-reps', reps)
      clock += 1000
      await api.click('Concluir série')
    },
  }
  return api
}

test('concluir uma série inicia o descanso configurado na ficha, dentro do card', async () => {
  const form = await mount()
  assert.equal(form.timers().length, 0, 'nenhum espaço reservado antes de concluir')
  await form.conclude()
  assert.equal(form.timers().length, 1)
  assert.equal(form.clock(), '01:00')
  assert.match(form.html(), /Descansando/)
  assert.match(form.html(), /Descanso: 1min/)
  assert.match(form.html(), /Série 2 de 3/)
  // O registro segue o fluxo normal e o botão principal continua disponível.
  assert.equal(form.calls.create.length, 1)
  assert.ok(form.button('Concluir série'))
  assert.deepEqual(form.stored(), {
    v: 1,
    scope: 'user-a:sheet-a:' + form.stored().scope.split(':')[2],
    exerciseId: 'squat',
    durationSeconds: 60,
    endsAt: clock + 60_000,
  })
})

test('a contagem regride pelo relógio absoluto, inclusive depois de timers suspensos', async () => {
  const form = await mount()
  await form.conclude()
  await elapse(1000)
  assert.equal(form.clock(), '00:59')
  // Aba em segundo plano: o próximo tique chega 39s depois — o valor exibido salta para o correto.
  clock += 39_000
  await act(async () => mock.timers.tick(1000))
  assert.equal(form.clock(), '00:20')
})

test('rest_seconds ausente usa 90s; rest_seconds = 0 não inicia', async () => {
  const fallback = await mount({ sheetScope: sheet({}) })
  await fallback.conclude()
  assert.equal(fallback.clock(), '01:30')
  act(() => fallback.renderer.unmount())
  mounted.length = 0
  session.store.clear()

  const disabled = await mount({ sheetScope: sheet({ squat: 0 }) })
  await disabled.conclude()
  assert.match(disabled.html(), /Série 2 de 3/)
  assert.equal(disabled.timers().length, 0)
  assert.equal(disabled.stored(), null)
})

test('a última série não inicia descanso e encerra o descanso em andamento', async () => {
  const form = await mount()
  await form.conclude()
  await form.conclude()
  assert.equal(form.timers().length, 1)
  await form.conclude()
  assert.match(form.html(), /Exercício concluído/)
  assert.equal(form.timers().length, 0)
  assert.equal(form.stored(), null)
})

test('série inválida (falha na conclusão) não inicia descanso', async () => {
  const form = await mount()
  await form.type('set-reps', '10')
  const button = form.root.findAll(
    (node) => node.type === 'button' && textOf(node).includes('Concluir série')
  )[0]
  await act(async () => button.props.onClick())
  assert.equal(form.calls.create.length, 0)
  assert.equal(form.timers().length, 0)
})

test('duplo toque registra uma série e inicia um único descanso', async () => {
  const form = await mount()
  await form.type('set-weight', '40')
  await form.type('set-reps', '6')
  clock += 1000
  const button = form.button('Concluir série')
  const startedAt = clock
  await act(async () => {
    button.props.onClick()
    button.props.onClick()
  })
  clock += 50
  await act(async () => form.button('Concluir série').props.onClick())
  assert.equal(form.calls.create.length, 1)
  assert.match(form.html(), /Série 2 de 3/)
  assert.equal(form.timers().length, 1)
  assert.equal(form.stored().endsAt, startedAt + 60_000)
})

test('editar uma série concluída não reinicia o descanso', async () => {
  const form = await mount()
  await form.conclude('20', '10')
  const endsAt = form.stored().endsAt
  await elapse(10_000)
  await form.click('Série 1, concluída')
  await form.type('set-weight', '22')
  await form.click('Atualizar série')
  assert.equal(form.stored().endsAt, endsAt)
  assert.equal(form.clock(), '00:50')
})

test('+15s acrescenta tempo e Pular encerra sem afetar o registro', async () => {
  const form = await mount()
  await form.conclude()
  await elapse(5000)
  await form.click('Adicionar 15 segundos ao descanso')
  assert.equal(form.clock(), '01:10')
  assert.match(form.html(), /Descanso: 1min15s/)
  assert.equal(form.stored().durationSeconds, 75)
  await form.click('Pular descanso')
  assert.equal(form.timers().length, 0)
  assert.equal(form.stored(), null)
  assert.equal(form.calls.create.length, 1)
  assert.match(form.html(), /Série 2 de 3/)
})

test('ao terminar mostra "Descanso concluído" e o indicador sai sozinho', async () => {
  const form = await mount()
  await form.conclude()
  await elapse(60_000)
  assert.match(form.html(), /Descanso concluído/)
  assert.equal(form.clock(), '00:00')
  assert.equal(form.button('Pular descanso'), undefined)
  const status = form.root.findAll(
    (node) => node.props?.role === 'status' && textOf(node) === 'Descanso concluído'
  )
  assert.equal(status.length, 1, 'anúncio único e discreto para leitor de tela')
  await elapse(4000)
  assert.equal(form.timers().length, 0)
  assert.equal(form.stored(), null)
})

test('trocar de exercício preserva a contagem e identifica a origem; nova série substitui o descanso', async () => {
  const form = await mount()
  await form.conclude()
  await elapse(5000)
  await form.click('Exercícios da ficha')
  assert.equal(form.timers().length, 1)
  assert.match(form.timers()[0].props.className, /is-compact/)
  assert.match(textOf(form.timers()[0]), /Agachamento/)
  assert.equal(form.clock(), '00:55')

  await form.click('Supino')
  assert.match(form.html(), /Série 1 de 3/)
  assert.equal(form.timers().length, 1, 'um só indicador, compacto, fora do card de Supino')
  assert.match(form.timers()[0].props.className, /is-compact/)

  await form.conclude()
  assert.equal(form.timers().length, 1)
  assert.doesNotMatch(form.timers()[0].props.className, /is-compact/)
  assert.equal(form.clock(), '00:45')
  assert.equal(form.stored().exerciseId, 'bench')
})

test('reload restaura o descanso ativo do mesmo treino, mas não de outra ficha/usuário', async () => {
  const first = await mount()
  await first.conclude()
  act(() => first.renderer.unmount())
  mounted.length = 0
  clock += 20_000

  const reloaded = await mount()
  assert.equal(reloaded.timers().length, 1)
  assert.equal(reloaded.clock(), '00:40')
  act(() => reloaded.renderer.unmount())
  mounted.length = 0

  const otherUser = await mount({ progressScope: 'user-b:sheet-a' })
  assert.equal(otherUser.timers().length, 0)
  assert.equal(session.store.has(REST_KEY), false, 'registro de outro escopo é descartado')
})

test('dados corrompidos no storage são ignorados', async () => {
  session.setItem(REST_KEY, '{"v":1,"scope":"user-a:sheet-a')
  const form = await mount()
  assert.equal(form.timers().length, 0)
  await form.conclude()
  assert.equal(form.timers().length, 1)
})

test('desfazer a série que originou o descanso encerra a contagem', async () => {
  const form = await mount()
  await form.conclude()
  await form.conclude()
  assert.equal(form.timers().length, 1)
  await form.click('Série 2, concluída')
  await form.click('Remover série 2')
  await form.click('Toque para confirmar')
  assert.equal(form.timers().length, 0)
  assert.equal(form.stored(), null)
})

test('"Finalizar com N séries" encerra o descanso do exercício', async () => {
  const form = await mount()
  await form.conclude()
  assert.equal(form.timers().length, 1)
  await form.click('Finalizar com 1 série')
  assert.equal(form.timers().length, 0)
})

test('offline e gravação lenta: o descanso inicia sem esperar o servidor', async () => {
  let release
  const form = await mount({
    onCreate: () =>
      new Promise((resolve) => {
        release = () => resolve({ synced: false, pendingSync: true })
      }),
  })
  await form.conclude()
  assert.equal(form.timers().length, 1, 'iniciado com a gravação ainda em andamento')
  await act(async () => release())
  assert.equal(form.timers().length, 1)
  assert.match(form.html(), /Salvo no aparelho/)
})

test('storage indisponível não impede o registro nem o descanso em memória', async () => {
  globalThis.sessionStorage = {
    getItem() {
      throw new Error('SecurityError')
    },
    setItem() {
      throw new Error('QuotaExceededError')
    },
    removeItem() {
      throw new Error('SecurityError')
    },
  }
  const form = await mount()
  await form.conclude()
  assert.equal(form.calls.create.length, 1)
  assert.match(form.html(), /Série 2 de 3/)
  assert.equal(form.timers().length, 1)
})

test('edição de registro do histórico nunca mostra descanso', async () => {
  const form = await mount({
    initialValue: {
      id: 'row-1',
      exerciseId: 'squat',
      type: 'strength',
      date: '2026-10-30',
      note: '',
      setDetails: [
        { weight: 20, reps: 10 },
        { weight: 20, reps: 10 },
      ],
    },
    onSubmit: async () => {},
  })
  assert.equal(form.timers().length, 0)
  assert.equal(form.stored(), null)
})

// --- Descanso padrão do usuário ------------------------------------------------------------------------

test('exercício sem tempo próprio usa o padrão do usuário', async () => {
  const form = await mount({ sheetScope: sheet({ bench: 45 }), defaultRestSeconds: 120 })
  await form.conclude()
  assert.equal(form.clock(), '02:00')
  assert.match(form.html(), /Descanso: 2min/)
})

test('exercício com tempo próprio vence o padrão do usuário', async () => {
  const form = await mount({ sheetScope: sheet({ squat: 45 }), defaultRestSeconds: 120 })
  await form.conclude()
  assert.equal(form.clock(), '00:45')
})

test('0 no exercício desativa mesmo com padrão do usuário; padrão 0 desativa os que herdam', async () => {
  const own = await mount({ sheetScope: sheet({ squat: 0 }), defaultRestSeconds: 120 })
  await own.conclude()
  assert.equal(own.timers().length, 0)
  act(() => own.renderer.unmount())
  mounted.length = 0

  const inherited = await mount({ sheetScope: sheet({}), defaultRestSeconds: 0 })
  await inherited.conclude()
  assert.match(inherited.html(), /Série 2 de 3/)
  assert.equal(inherited.timers().length, 0)
  assert.equal(inherited.calls.create.length, 1, 'o registro segue normalmente')
})

test('ficha antiga (sem rest_seconds) e usuário sem preferência: 90s', async () => {
  const form = await mount({ sheetScope: sheet({}), defaultRestSeconds: null })
  await form.conclude()
  assert.equal(form.clock(), '01:30')
})

test('mudar a preferência não altera a contagem em andamento, só a próxima', async () => {
  const props = { sheetScope: sheet({}), defaultRestSeconds: 60 }
  const form = await mount(props)
  await form.conclude()
  const endsAt = form.stored().endsAt
  await elapse(10_000)
  // Preferência alterada (outro aparelho via Realtime, ou no Perfil) durante o descanso.
  const element = (next) =>
    React.createElement(WorkoutForm, {
      exercises: [squat, bench],
      progressScope: 'user-a:sheet-a',
      defaultExerciseId: 'squat',
      backToSheets: '/treinar',
      onCreate: async () => ({ synced: true }),
      onUpdate: async () => ({ synced: true }),
      ...props,
      ...next,
    })
  await act(async () => form.renderer.update(element({ defaultRestSeconds: 30 })))
  assert.equal(form.stored().endsAt, endsAt)
  assert.equal(form.clock(), '00:50')
  await form.conclude()
  assert.equal(form.clock(), '00:30')
})

test('offline: o padrão do usuário (do snapshot local) vale sem rede', async () => {
  let release
  const form = await mount({
    sheetScope: sheet({}),
    defaultRestSeconds: 75,
    onCreate: () =>
      new Promise((resolve) => {
        release = () => resolve({ synced: false, pendingSync: true })
      }),
  })
  await form.conclude()
  assert.equal(form.clock(), '01:15')
  await act(async () => release())
  assert.match(form.html(), /Salvo no aparelho/)
})
