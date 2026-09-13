import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'workout-form-tests-'))
  const outfile = join(directory, 'form.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { WorkoutForm } from './WorkoutForm.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(WorkoutForm, props))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const props = {
  exercises: [{ id: 'squat', name: 'Agachamento', active: true }],
  defaultExerciseId: 'squat',
}

// Séries agora são um card por vez (SetCard.jsx), não uma tabela com um <input
// type="number"> por campo -- o peso/reps mudam por steppers +/-. Sem input nenhum,
// "0 ocorrências de type=number" passa a ser o sinal de que a etapa "Séries" está de
// pé (contra a etapa "Data" logo abaixo, que ainda usa <input type="date">).
test('new form creates one set card with accessible steppers, disabled at the empty/zero boundary', () => {
  const html = render(props)
  assert.equal((html.match(/type="number"/g) || []).length, 0)
  assert.match(html, /aria-label="Série 1"/)
  // Único controle de "criar nova série" é a seta › (que, na última, assume esse papel)
  // -- o segmento "+" redundante na barra de progresso foi removido.
  assert.match(html, /aria-label="Adicionar nova série"/)
  assert.doesNotMatch(html, /set-card-segment-add/)
  // Peso e reps nascem em 0 (set vazio) -- os botões "diminuir" ficam desabilitados no
  // piso, os "aumentar" não.
  assert.match(html, /aria-label="Diminuir peso em 2,5 kg" disabled=""/)
  assert.match(html, /aria-label="Aumentar peso em 2,5 kg"(?! disabled)/)
  assert.match(html, /aria-label="Diminuir repetições" disabled=""/)
  // Granularidade padrão continua 2,5kg (chip ativo), agora com ±1 como opção extra
  // pra pesos livres não-olímpicos, chips em ordem crescente.
  assert.match(html, /set-card-chip is-active"[^>]*>±2,5/)
  assert.match(html, />±1</)
  const order = ['±1<', '±1,25<', '±2,5<', '±5<'].map((chip) => html.indexOf(chip))
  assert.ok(
    order.every((index, i) => i === 0 || index > order[i - 1]),
    'chips de granularidade devem aparecer em ordem crescente'
  )
  // Set vazio não passa em isValidSet -- "concluir série" nasce desabilitado.
  assert.match(html, /class="set-card-complete" disabled=""/)
  assert.doesNotMatch(html, /Adicionar série</)
  assert.doesNotMatch(html, /Repetir série</)
  // Com uma única série, "Remover série" existe mas nasce desabilitado -- nunca dá pra
  // ficar sem nenhuma série (mesma regra do antigo botão de remover na tabela).
  assert.match(html, /aria-label="Remover série 1" disabled=""/)
})

test('editing legacy and individual sets preserves every set (not just the visible one) and inactive exercise selection', () => {
  for (const { initialValue, expectedVolume } of [
    {
      initialValue: { exerciseId: 'squat', weight: 30, sets: 2, reps: 12, date: '2025-01-01', note: '' },
      expectedVolume: '720 kg', // 30x12 duas vezes -- forma legada, mesmo peso/reps pras duas séries.
    },
    {
      initialValue: {
        exerciseId: 'squat',
        setDetails: [
          { weight: 30, reps: 12 },
          { weight: 40, reps: 8 },
        ],
        date: '2025-01-01',
        note: '',
      },
      expectedVolume: '680 kg', // 30x12 + 40x8 -- só dá pra bater esse número se a SEGUNDA
      // série (não visível, já que o card mostra uma de cada vez) sobreviveu intacta.
    },
  ]) {
    const html = render({
      ...props,
      exercises: [{ ...props.exercises[0], active: false }],
      initialValue,
    })
    assert.equal((html.match(/type="number"/g) || []).length, 0)
    // Um exercício inativo só continua selecionável quando é o próprio initialValue
    // (edição de um registro existente) — o passo de registro abre direto nele, sem
    // passar pelos passos de grupo/exercício, mostrando o nome no cabeçalho da etapa.
    assert.match(html, /<strong>Agachamento<\/strong>/)
    // As duas séries geram dois segmentos clicáveis na barra de progresso do card --
    // nunca um terceiro segmento "+" (removido, ver primeiro teste) inflando a contagem.
    assert.match(html, /aria-label="Série 1"/)
    assert.match(html, /aria-label="Série 2"/)
    assert.doesNotMatch(html, /set-card-segment-add/)
    assert.match(html, /Série 1 de 2/)
    // Com mais de uma série, "Remover série" fica habilitado.
    assert.match(html, /aria-label="Remover série 1"(?! disabled)/)
    // Card abre na primeira série (30kg x 12).
    assert.match(html, /class="set-card-value">30</)
    assert.match(html, /class="set-card-value">12</)
    // "Séries válidas: 2" e o volume batendo só provam que a SEGUNDA série (fora de
    // vista) preservou seu próprio peso/reps -- não dá pra ver isso direto na página
    // renderizada, já que só a série ativa aparece.
    assert.match(html, /Séries válidas<\/span><strong>2<\/strong>/)
    assert.match(html, new RegExp(`Volume estimado</span><strong>${expectedVolume}`))
  }
})

test('with no exercise pre-selected, the form opens on the muscle group step, not the set fields', () => {
  const html = render({
    exercises: [
      { id: 'squat', name: 'Agachamento', muscleGroup: 'Pernas', active: true },
      { id: 'bench', name: 'Supino', muscleGroup: 'Peito', active: true },
    ],
  })
  assert.match(html, /Qual grupo você vai treinar\?/)
  assert.match(html, /Pernas/)
  assert.match(html, /Peito/)
  assert.equal((html.match(/type="number"/g) || []).length, 0)
  assert.doesNotMatch(html, /Adicionar série/)
})
