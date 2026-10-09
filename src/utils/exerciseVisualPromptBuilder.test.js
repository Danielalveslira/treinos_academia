import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExerciseVisualPrompt,
  structuredExerciseInput,
  FALLBACK_STYLE_PROFILE,
  PROMPT_VERSION,
} from './exerciseVisualPromptBuilder.js'

const row = {
  id: 'cat-1',
  name: 'Supino reto com barra',
  primary_muscle: 'peito',
  muscles: ['peito', 'triceps', 'ombros'],
  equipment: 'barra',
  category: 'forca',
  difficulty: 'iniciante',
  force: 'push',
  mechanic: 'composto',
  instructions: ['Deite no banco.', ' Empurre a barra. '],
}

test('estrutura os dados reais do catálogo (linha crua do banco)', () => {
  assert.deepEqual(structuredExerciseInput(row), {
    catalogId: 'cat-1',
    exercise: 'Supino reto com barra',
    equipment: 'barra',
    primaryMuscle: 'peito',
    secondaryMuscles: ['triceps', 'ombros'],
    category: 'forca',
    difficulty: 'iniciante',
    force: 'push',
    mechanic: 'composto',
    instructions: ['Deite no banco.', 'Empurre a barra.'],
    view: 'lateral',
    visualType: 'start_end',
  })
})

test('aceita também o formato mapeado da UI (primaryMuscles/secondaryMuscles/level)', () => {
  const input = structuredExerciseInput({
    id: 'cat-2',
    name: 'Agachamento',
    primaryMuscles: ['pernas'],
    secondaryMuscles: ['gluteos'],
    level: 'intermediario',
    equipment: null,
    instructions: ['Agache.'],
  })
  assert.equal(input.primaryMuscle, 'pernas')
  assert.deepEqual(input.secondaryMuscles, ['gluteos'])
  assert.equal(input.difficulty, 'intermediario')
  assert.equal(input.equipment, null)
})

test('o prompt junta Style Profile + dados do exercício + entrega + regras negativas', () => {
  const { text, promptVersion, styleVersion } = buildExerciseVisualPrompt(row)
  assert.equal(promptVersion, PROMPT_VERSION)
  assert.equal(styleVersion, 'EVOLUTUS_FITNESS_V1')
  assert.match(text, /Estilo visual: EVOLUTUS_FITNESS_V1 \(v1\)/)
  assert.match(text, /Fundo transparente\./)
  assert.match(text, /- Nome: Supino reto com barra/)
  assert.match(text, /- Equipamento: barra/)
  assert.match(text, /- Músculos secundários: triceps, ombros/)
  assert.match(text, /1\. Deite no banco\./)
  assert.match(text, /POSIÇÃO INICIAL/)
  assert.match(text, /POSIÇÃO FINAL/)
  assert.match(text, /Evite\n- Sem texto\./)
  assert.ok(text.indexOf('Estilo visual') < text.indexOf('Exercício'))
  assert.ok(text.indexOf('Exercício') < text.indexOf('Entrega'))
  assert.ok(text.indexOf('Entrega') < text.indexOf('Evite'))
})

test('exercício sem equipamento vira peso do corpo; campos ausentes não viram "null" no texto', () => {
  const { text } = buildExerciseVisualPrompt({
    id: 'x',
    name: 'Prancha',
    primary_muscle: 'abdomen',
    muscles: ['abdomen'],
    instructions: [],
  })
  assert.match(text, /- Equipamento: peso do corpo \/ sem equipamento/)
  assert.doesNotMatch(text, /null|undefined/)
  assert.doesNotMatch(text, /Execução do movimento/)
  assert.doesNotMatch(text, /Músculos secundários/)
})

test('usa o Style Profile recebido e cai no padrão se ele não carregou', () => {
  const custom = {
    name: 'OUTRO',
    version: 'v9',
    base_prompt: 'Estilo X.',
    negative_rules: 'Sem Y.',
  }
  const withCustom = buildExerciseVisualPrompt(row, custom)
  assert.match(withCustom.text, /Estilo visual: OUTRO \(v9\)/)
  assert.match(withCustom.text, /- Sem Y\./)
  assert.equal(withCustom.styleVersion, 'OUTRO')
  const fallback = buildExerciseVisualPrompt(row, null)
  assert.equal(fallback.styleVersion, FALLBACK_STYLE_PROFILE.name)
})

test('sem nome do exercício não gera prompt', () => {
  assert.throws(() => buildExerciseVisualPrompt({ id: 'x', name: '  ' }), /EXERCISE_NAME_REQUIRED/)
})
