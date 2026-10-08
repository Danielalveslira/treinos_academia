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
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { WorkoutForm } from './WorkoutForm.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null,
            createElement(WorkoutForm, props)))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    // WorkoutForm.jsx -> WorkoutExerciseGuide.jsx -> useExerciseCatalogDetail.js puxa a
    // cadeia real até supabase/config.js (precisa de VITE_SUPABASE_URL, que não existe
    // fora do Vite) -- nenhum destes testes passa exercício com providerExerciseId, então
    // o hook nunca seria chamado de verdade; só o import em si já quebrava o bundle.
    plugins: [
      {
        name: 'exercise-catalog-detail-stub',
        setup(context) {
          context.onResolve({ filter: /\/hooks\/useExerciseCatalogDetail\.js$/ }, () => ({
            path: 'detail-hook',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^detail-hook$/, namespace: 'stub' }, () => ({
            contents: `export const useExerciseCatalogDetail = () => ({ data: null, loading: false, stale: false, unavailable: true })`,
          }))
        },
      },
    ],
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

// Text inputs with numeric inputMode accept the Portuguese decimal separator.
test('new form without history: empty fields, three pending sets and one main action', () => {
  const html = render(props)
  assert.equal((html.match(/type="number"/g) || []).length, 0)
  assert.match(html, /Série 1 de 3/)
  assert.match(html, /aria-label="Série 1, pendente"/)
  assert.match(html, /aria-label="Série 3, pendente"/)
  assert.match(html, /inputMode="decimal"/)
  assert.match(html, /inputMode="numeric"/)
  // Sem histórico nem planejamento: nada de valores inventados — só placeholders.
  assert.match(html, /id="set-weight"[^>]*placeholder="Ex\.: 20"[^>]*value=""/)
  assert.match(html, /id="set-reps"[^>]*placeholder="Ex\.: 10"[^>]*value=""/)
  assert.match(html, /Primeira vez\?/)
  assert.doesNotMatch(html, /Sugerido do último treino|Igual à série anterior|Registrada/)
  // Set vazio não passa em isValidSet -- "Concluir série" nasce desabilitado.
  assert.match(html, /class="set-card-complete" disabled=""/)
  assert.match(html, /Concluir série/)
  // Sem navegação duplicada, contadores repetidos, volume estimado nem texto de herança.
  assert.doesNotMatch(html, /Série anterior|Próxima série|set-card-nav|session-summary/)
  assert.doesNotMatch(html, /Volume estimado|Séries válidas|concluídas</)
  assert.doesNotMatch(html, /Trocar exercício|Trocar grupo|Repetir última sessão/)
  assert.doesNotMatch(html, /Finalizar exercício/)
  // Configuração de séries fica recolhida; com várias séries remover está habilitado.
  assert.match(html, /<details class="set-card-adjust"><summary>Ajustar séries<\/summary>/)
  assert.match(html, /Remover série 1/)
})

test('editing legacy and individual sets preserves every set (not just the visible one) and inactive exercise selection', () => {
  for (const { initialValue, expectedSets } of [
    {
      initialValue: {
        exerciseId: 'squat',
        weight: 30,
        sets: 2,
        reps: 12,
        date: '2025-01-01',
        note: '',
      },
      expectedSets: 2, // 30x12 duas vezes -- forma legada, mesmo peso/reps pras duas séries.
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
      expectedSets: 2, // a SEGUNDA série (fora de vista) precisa sobreviver intacta.
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
    assert.match(html, /aria-label="Série 1, concluída"/)
    assert.match(html, /aria-label="Série 2, concluída"/)
    assert.match(html, /Série 1 de 2/)
    // Com mais de uma série, "Remover série" fica habilitado.
    assert.match(html, /Remover série 1<\/button>/)
    assert.doesNotMatch(html, /Remover série 1<\/button>.*disabled/)
    // Card abre na primeira série (30kg x 12).
    assert.match(html, /id="set-weight"[^>]*value="30"/)
    assert.match(html, /id="set-reps"[^>]*value="12"/)
    // Editar um registro não oferece "Concluir série" (todas já foram registradas) e salva tudo de uma vez.
    assert.doesNotMatch(html, /Concluir série/)
    assert.match(html, /Salvar alterações/)
  }
})

test('history opens with suggested values and an enabled one-touch completion', () => {
  const html = render({
    ...props,
    history: [
      {
        exerciseId: 'squat',
        date: new Date(2026, 8, 14, 12),
        setDetails: [
          { weight: 17.5, reps: 8 },
          { weight: 20, reps: 6 },
        ],
      },
    ],
  })
  assert.match(html, /Série 1 de 2/)
  assert.match(html, /id="set-weight"[^>]*value="17,5"/)
  assert.match(html, /id="set-reps"[^>]*value="8"/)
  // Sugestão do histórico é identificada como tal e nunca como série registrada.
  assert.match(html, /Sugerido do último treino/)
  assert.doesNotMatch(html, /Registrada|aria-label="Série \d, concluída"/)
  assert.match(html, /class="set-card-complete"><svg/)
  assert.doesNotMatch(html, /Último treino</)
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

test('previous sessions are collapsed, exercise-scoped and show dates, sets, volume and notes', () => {
  const html = render({
    ...props,
    history: [
      {
        id: 'recent',
        exerciseId: 'squat',
        date: new Date(2026, 8, 14, 12),
        setDetails: [{ weight: 12.5, reps: 10 }],
        note: 'Boa execução',
      },
      {
        id: 'legacy',
        exerciseId: 'squat',
        date: { toDate: () => new Date(2026, 8, 10, 12) },
        weight: 10,
        reps: 8,
        sets: 2,
      },
      {
        id: 'outside-window',
        exerciseId: 'squat',
        date: new Date(2026, 8, 7, 12),
        setDetails: [{ weight: 99, reps: 1 }],
        note: 'Fora da janela',
      },
      { id: 'other', exerciseId: 'bench', note: 'Não mostrar' },
    ],
  })
  assert.doesNotMatch(html, /Última sessão:|Melhor nos registros carregados:|workout-reference/)
  assert.match(html, /<details class="workout-past-sessions"><summary>Sessões anteriores \(2\)/)
  assert.match(html, /14\/09\/2026/)
  assert.match(html, /10\/09\/2026/)
  assert.match(html, /Volume total: 125 kg/)
  assert.match(html, /Volume total: 160 kg/)
  assert.match(html, /12,5kg × 10/)
  assert.match(html, /Boa execução/)
  assert.doesNotMatch(html, /Fora da janela|99kg/)
  assert.doesNotMatch(html, /Não mostrar/)
  assert.match(html, /href="\/historico\?exercicio=squat"/)
  assert.match(html, /Ver histórico completo/)
  assert.ok(html.indexOf('14/09/2026') < html.indexOf('10/09/2026'))
  assert.ok(html.indexOf('workout-past-sessions') > html.indexOf('Data e observações'))
})

test('previous sessions provide an empty state and support cardio history', () => {
  assert.match(render(props), /Nenhuma sessão anterior deste exercício nos registros carregados/)
  const html = render({
    exercises: [{ id: 'run', name: 'Corrida', active: true, type: 'cardio' }],
    defaultExerciseId: 'run',
    history: [
      {
        exerciseId: 'run',
        type: 'cardio',
        date: new Date(2026, 8, 14, 12),
        durationMinutes: 20,
        distanceKm: 3,
      },
    ],
  })
  assert.match(html, /Sessões anteriores \(1\)/)
  assert.match(html, /20 min/)
  assert.match(html, /3 km/)
  assert.doesNotMatch(html, /Volume total:/)
})
