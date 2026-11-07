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
  sheetScope: { id: 'sheet-a', items: [{ exercise_id: 'squat', available: true }] },
  exercises: [
    {
      id: 'squat',
      name: 'Agachamento',
      source: 'catalog',
      provider: 'evolutus_dataset',
      active: true,
    },
  ],
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
  // As duas ações ficam visíveis juntas; remover mantém a confirmação em dois toques.
  assert.match(html, /set-card-quick-actions/)
  assert.match(html, /\+ Adicionar série/)
  assert.doesNotMatch(html, /Ajustar séries/)
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
    assert.equal((html.match(/aria-label="Série \d+, concluída"/g) || []).length, expectedSets)
    assert.match(html, /Série 1 de 2/)
    // Com mais de uma série, "Remover série" fica habilitado.
    assert.match(html, /Remover série 1/)
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

test('without a sheet the form blocks new creation and never opens free selection', () => {
  const html = render({
    exercises: [
      {
        id: 'squat',
        name: 'Agachamento',
        muscleGroup: 'Pernas',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
      },
      {
        id: 'bench',
        name: 'Supino',
        muscleGroup: 'Peito',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
      },
    ],
  })
  assert.match(html, /Escolha uma ficha para iniciar o treino/)
  assert.doesNotMatch(html, /Qual grupo você vai treinar|muscle-group-card/)
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
    exercises: [
      {
        id: 'run',
        name: 'Corrida',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
        type: 'cardio',
      },
    ],
    sheetScope: { id: 'sheet-cardio', items: [{ exercise_id: 'run', available: true }] },
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

test('new sessions hide legacy exercises; historical edits retain their original legacy exercise', () => {
  const legacy = {
    id: 'old',
    name: 'Legado pessoal',
    muscleGroup: 'Peito',
    source: 'custom',
    active: true,
  }
  const official = {
    id: 'official',
    name: 'Oficial',
    muscleGroup: 'Peito',
    source: 'catalog',
    provider: 'evolutus_dataset',
    active: true,
  }
  const fresh = render({ exercises: [legacy, official], defaultExerciseId: 'old' })
  assert.doesNotMatch(fresh, /Legado pessoal/)
  const edit = render({
    exercises: [legacy, official],
    initialValue: {
      id: 'w-old',
      exerciseId: 'old',
      date: '2026-10-05',
      type: 'strength',
      setDetails: [{ weight: 10, reps: 10 }],
    },
  })
  assert.match(edit, /Legado pessoal/)
  assert.match(edit, /Salvar alterações/)
})

// Abrir uma ficha vai direto para o primeiro exercício elegível na ordem planejada — sem a
// tela de escolha solta de grupo/exercício (NewWorkout.jsx passa o primeiro id elegível como
// defaultExerciseId; aqui garantimos que o formulário realmente abre nele).
test('sheet scope: opens straight on the first eligible exercise, with a concise position indicator', () => {
  const sheetScope = {
    id: 'sheet-1',
    name: 'Treino A',
    items: [
      {
        id: 'item-1',
        exercise_id: 'squat',
        exercise: { id: 'squat', name: 'Agachamento' },
        target_sets: 3,
        reps_min: 8,
        reps_max: 12,
        rest_seconds: 90,
        available: true,
      },
      {
        id: 'item-2',
        exercise_id: 'bench',
        exercise: { id: 'bench', name: 'Supino' },
        available: true,
      },
    ],
  }
  const html = render({
    exercises: [
      {
        id: 'squat',
        name: 'Agachamento',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
      },
      {
        id: 'bench',
        name: 'Supino',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
      },
    ],
    sheetScope,
    defaultExerciseId: 'squat',
  })
  // Nada de tela de grupo nem de escolha de exercício: o registro da primeira série já
  // aparece no primeiro render.
  assert.doesNotMatch(html, /Qual grupo você vai treinar\?/)
  assert.doesNotMatch(html, /Escolha o exercício/)
  assert.match(html, /<strong>Agachamento<\/strong>/)
  assert.match(html, /Série 1 de 3/)
  // Indicador textual conciso substitui os blocos "2 Exercício"/"3 Séries" (só usados fora de ficha).
  assert.match(html, />Exercício 1 de 2</)
  assert.doesNotMatch(html, />1 Grupo</)
  assert.doesNotMatch(html, />2 Exercício</)
  assert.doesNotMatch(html, />3 Séries</)
  // Meta do exercício atual em uma linha, sem o rótulo "Meta da ficha" (era do exercício,
  // não da ficha) nem o rótulo "Sem metas definidas".
  assert.doesNotMatch(html, /Meta da ficha/)
  assert.match(html, /Meta do exercício/)
  assert.match(html, /3 séries · 8–12 repetições · 1min30s de descanso/)
  assert.match(html, /exercise-goal-summary/)
  assert.doesNotMatch(html, /Sem metas definidas/)
  assert.doesNotMatch(html, /Sobre as metas da ficha/)
  assert.doesNotMatch(html, /Selecione um exercício para ver as metas/)
})

test('sheet scope: no reference line at all when the current exercise has no goals', () => {
  const sheetScope = {
    id: 'sheet-1',
    name: 'Treino A',
    items: [
      {
        id: 'item-1',
        exercise_id: 'squat',
        exercise: { id: 'squat', name: 'Agachamento' },
        available: true,
      },
    ],
  }
  const html = render({
    exercises: [
      {
        id: 'squat',
        name: 'Agachamento',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
      },
    ],
    sheetScope,
    defaultExerciseId: 'squat',
  })
  assert.doesNotMatch(html, /exercise-goal/)
  assert.match(html, />Exercício 1 de 1</)
})

test('sheet scope: exercise note shows separated from the structured goal summary', () => {
  const sheetScope = {
    id: 'sheet-1',
    name: 'Treino A',
    items: [
      {
        id: 'item-1',
        exercise_id: 'squat',
        exercise: { id: 'squat', name: 'Agachamento' },
        target_sets: 3,
        reps_min: 8,
        reps_max: 12,
        note: 'Conseguir chegar no tanquinho 😜',
        available: true,
      },
    ],
  }
  const html = render({
    exercises: [
      {
        id: 'squat',
        name: 'Agachamento',
        source: 'catalog',
        provider: 'evolutus_dataset',
        active: true,
      },
    ],
    sheetScope,
    defaultExerciseId: 'squat',
  })
  // Sem rest_seconds próprio: o resumo herda o padrão do usuário (90s, sem perfil carregado
  // neste teste) marcado como "(seu padrão)" -- mesma regra de WorkoutSheetItemEditor.
  assert.match(
    html,
    /exercise-goal-summary">3 séries · 8–12 repetições · 1min30s de descanso \(seu padrão\)</
  )
  assert.match(html, /exercise-goal-note"><b>Observação:<\/b> Conseguir chegar no tanquinho/)
  assert.doesNotMatch(html, /exercise-goal-note">&quot;/, 'sem aspas decorativas')
})
