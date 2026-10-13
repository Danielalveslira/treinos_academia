import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  exercisePoseBrief,
  buildEndPrompt,
  buildExerciseVisualPrompts,
  buildStartPrompt,
  DEFAULT_PROMPT_PROVIDER,
  hashPromptText,
  PROMPT_PROVIDER_FORMATS,
  PROMPT_PROVIDER_OPTIONS,
  PROMPT_VERSION,
  structuredExerciseInput,
  STYLE_PROFILE_ERROR_MESSAGE,
} from './exerciseVisualPromptBuilder.js'

// Cópia do seed da migration (um teste abaixo confere): o app não tem perfil embutido, sempre recebe o ativo.
const PROFILE_V2 = {
  id: 'profile-v2',
  name: 'EVOLUTUS_FITNESS_V2',
  version: 'v2',
  base_prompt: [
    'Ilustração técnica fitness 3D semi-realista.',
    'Avatar humano adulto neutro, de aparência andrógina: sem traços fortemente masculinos ou femininos.',
    'Anatomia natural e proporcional; sem musculatura exagerada.',
    'Roupa esportiva neutra, lisa e sem marcas (camiseta, shorts e tênis).',
    'Rosto pouco caracterizado, com expressão neutra.',
    'Mesmo avatar em todos os exercícios: mesmo corpo, mesmas proporções, mesma roupa e mesma aparência.',
    'Equipamento proporcional ao corpo, realista e com acabamento consistente.',
    'Fundo transparente.',
    'Prioridade para a biomecânica: articulações, coluna, mãos e pés na posição correta do exercício.',
  ].join('\n'),
  negative_rules: [
    'Sem texto.',
    'Sem números.',
    'Sem logotipos.',
    'Sem setas.',
    'Sem elementos decorativos.',
    'Sem membros extras.',
    'Sem musculatura exagerada.',
  ].join('\n'),
}
const PROFILE_V1 = {
  id: 'profile-v1',
  name: 'EVOLUTUS_FITNESS_V1',
  version: 'v1',
  base_prompt: 'Ilustração técnica fitness.\nMesmo personagem em todos os exercícios.',
  negative_rules: 'Sem texto.',
}

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
  instructions: [
    'Deite no banco, pés apoiados, segure a barra com os braços estendidos. Esta é a posição inicial.',
    ' Desça a barra até o peito. ',
  ],
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
    instructions: [
      'Deite no banco, pés apoiados, segure a barra com os braços estendidos. Esta é a posição inicial.',
      'Desça a barra até o peito.',
    ],
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

test('V2: o texto do EVOLUTUS_FITNESS_V2 e a versão do perfil de prompt (v2)', () => {
  assert.equal(PROMPT_VERSION, 'v2.1')
  assert.equal(PROFILE_V2.name, 'EVOLUTUS_FITNESS_V2')
  assert.equal(PROFILE_V2.version, 'v2')
  const base = PROFILE_V2.base_prompt
  for (const expected of [
    /3D semi-realista/,
    /andrógina/,
    /sem traços fortemente masculinos ou femininos/,
    /sem musculatura exagerada/,
    /Roupa esportiva neutra/,
    /Rosto pouco caracterizado/,
    /Fundo transparente/,
    /biomecânica/,
  ])
    assert.match(base, expected)
  for (const expected of [/texto/, /números/, /logotipos/, /setas/, /decorativos/])
    assert.match(PROFILE_V2.negative_rules, expected)
})

test('a fixture do perfil V2 é idêntica ao seed da migration (fixture realista)', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261021000001_exercise_visuals_v2.sql', import.meta.url),
    'utf8'
  )
  for (const line of [
    ...PROFILE_V2.base_prompt.split('\n'),
    ...PROFILE_V2.negative_rules.split('\n'),
  ])
    assert.ok(sql.includes(line), `a migration não contém: ${line}`)
})

test('START: exige EXATAMENTE UMA imagem e proíbe comparação, duas poses, colagem e antes/depois', () => {
  const { text, role, promptVersion, styleVersion } = buildStartPrompt(row, PROFILE_V2)
  assert.equal(role, 'start')
  assert.equal(promptVersion, PROMPT_VERSION)
  assert.equal(styleVersion, 'EVOLUTUS_FITNESS_V2')
  assert.match(text, /Gerar EXATAMENTE UMA imagem/)
  assert.match(text, /POSIÇÃO INICIAL \(START\)/)
  assert.match(
    text,
    /NÃO gerar comparação, duas poses, colagem, sequência, painel dividido nem "antes e depois"/
  )
  assert.doesNotMatch(text, /POSIÇÃO FINAL/, 'o prompt inicial não pede a posição final')
  assert.doesNotMatch(text, /DUAS imagens/i)
  assert.doesNotMatch(text, /REFERÊNCIA OBRIGATÓRIA/)
})

test('START: junta Style Profile + dados reais do exercício + enquadramento + regras negativas, nessa ordem', () => {
  const { text } = buildStartPrompt(row, PROFILE_V2)
  assert.match(text, /Estilo visual: EVOLUTUS_FITNESS_V2 \(v2\)/)
  assert.match(text, /- Nome: Supino reto com barra/)
  assert.match(text, /- Equipamento: barra/)
  assert.match(text, /pés apoiados/)
  assert.match(text, /Postura START do catálogo: Deite no banco/)
  assert.match(text, /Sem cenário ou paisagem, texto/)
  const order = [
    'Estilo visual',
    'TAREFA',
    'EXERCÍCIO',
    'POSIÇÃO INICIAL\n',
    'ENQUADRAMENTO',
    'EVITE',
  ]
  const positions = order.map((marker) => text.indexOf(marker))
  assert.ok(
    positions.every((p) => p >= 0),
    JSON.stringify(positions)
  )
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions
  )
})

test('END: exige UMA imagem, manda usar a imagem START como referência e mudar só a biomecânica', () => {
  const { text, role } = buildEndPrompt(row, PROFILE_V2)
  assert.equal(role, 'end')
  assert.match(text, /Gerar EXATAMENTE UMA imagem/)
  assert.match(text, /POSIÇÃO FINAL \(END\)/)
  assert.match(text, /NÃO gerar comparação, duas poses, colagem/)
  assert.match(text, /REFERÊNCIA OBRIGATÓRIA/)
  assert.match(text, /imagem da POSIÇÃO INICIAL \(START\).*deve ser utilizada como referência/)
  for (const kept of [
    'personagem',
    'roupa',
    'equipamento',
    'câmera',
    'escala',
    'enquadramento',
    'iluminação',
  ])
    assert.match(text, new RegExp(`Mantenha IGUAL ao START:.*${kept}`), kept)
  assert.match(text, /Altere SOMENTE a biomecânica da pose/)
  assert.match(text, /Se a imagem START não estiver disponível, avise/)
  assert.match(text, /- Nome: Supino reto com barra/, 'mesmos dados reais do exercício')
  assert.doesNotMatch(
    text,
    /POSIÇÃO INICIAL \(START\) do exercício/,
    'não pede a imagem inicial como entrega'
  )
})

test('START e END compartilham perfil e dados, mas são textos diferentes (nunca um prompt único para as duas poses)', () => {
  const { start, end } = buildExerciseVisualPrompts(row, PROFILE_V2)
  assert.notEqual(start.text, end.text)
  assert.equal(start.styleVersion, end.styleVersion)
  assert.deepEqual(start.structured, end.structured)
  assert.equal(start.provider, DEFAULT_PROMPT_PROVIDER)
})

test('providers: genérico é o padrão; Gemini/ChatGPT só mudam o formato (abertura e como a referência é citada)', () => {
  assert.equal(DEFAULT_PROMPT_PROVIDER, 'generic')
  assert.deepEqual(
    PROMPT_PROVIDER_OPTIONS.map((o) => o.label),
    ['Genérico', 'Gemini', 'ChatGPT']
  )
  const generic = buildEndPrompt(row, PROFILE_V2)
  assert.equal(generic.provider, 'generic')
  assert.ok(!generic.text.startsWith('Gere a imagem') && !generic.text.startsWith('Crie a imagem'))
  for (const provider of ['gemini', 'openai']) {
    const start = buildStartPrompt(row, PROFILE_V2, { provider })
    const end = buildEndPrompt(row, PROFILE_V2, { provider })
    assert.equal(end.provider, provider)
    assert.ok(start.text.startsWith(PROMPT_PROVIDER_FORMATS[provider].opening))
    assert.match(
      end.text,
      new RegExp(PROMPT_PROVIDER_FORMATS[provider].referenceDelivery.replace(/[()]/g, '\\$&'))
    )
    // as regras de conteúdo são idênticas em qualquer provider
    for (const rule of [/EXATAMENTE UMA imagem/, /NÃO gerar comparação/, /Fundo transparente/])
      assert.match(start.text, rule)
    assert.match(end.text, /Altere SOMENTE a biomecânica/)
    assert.notEqual(end.text, generic.text)
  }
  assert.equal(
    buildStartPrompt(row, PROFILE_V2, { provider: 'inexistente' }).provider,
    'generic',
    'provider desconhecido cai no genérico'
  )
})

test('exercício sem equipamento não inventa peso corporal; campos ausentes não viram "null" no texto', () => {
  for (const build of [buildStartPrompt, buildEndPrompt]) {
    const { text } = build(
      {
        id: 'x',
        name: 'Prancha',
        primary_muscle: 'abdomen',
        muscles: ['abdomen'],
        instructions: [],
      },
      PROFILE_V2
    )
    assert.match(text, /- Equipamento: não informado; não invente equipamento/)
    assert.doesNotMatch(text, /null|undefined/)
    assert.doesNotMatch(text, /EXECUÇÃO DO MOVIMENTO/)
    assert.doesNotMatch(text, /Músculos secundários/)
  }
})

test('usa SEMPRE o Style Profile recebido (com id): o prompt, a versão e o id registrados são do mesmo perfil', () => {
  const custom = {
    id: 'profile-9',
    name: 'OUTRO',
    version: 'v9',
    base_prompt: 'Estilo X.',
    negative_rules: 'Sem Y.',
  }
  for (const build of [buildStartPrompt, buildEndPrompt]) {
    const withCustom = build(row, custom)
    assert.match(withCustom.text, /Estilo visual: OUTRO \(v9\)/)
    assert.match(withCustom.text, /- Sem Y\./)
    assert.equal(withCustom.styleVersion, 'OUTRO')
    assert.equal(withCustom.styleProfileId, 'profile-9')
  }
})

test('o prompt SEMPRE corresponde ao perfil recebido: V1 gera texto V1, V2 gera texto V2 (nunca o outro)', () => {
  for (const profile of [PROFILE_V1, PROFILE_V2]) {
    for (const build of [buildStartPrompt, buildEndPrompt]) {
      const prompt = build(row, profile)
      assert.match(
        prompt.text,
        new RegExp(`Estilo visual: ${profile.name} \\(${profile.version}\\)`)
      )
      assert.equal(prompt.styleProfileId, profile.id)
      assert.equal(prompt.styleVersion, profile.name)
      const other = profile === PROFILE_V1 ? PROFILE_V2 : PROFILE_V1
      assert.ok(
        !prompt.text.includes(other.name),
        `o texto do ${profile.name} não cita ${other.name}`
      )
    }
  }
})

test('sem Style Profile ativo carregado NÃO existe prompt (nenhum perfil de reserva silencioso)', () => {
  for (const build of [buildStartPrompt, buildEndPrompt]) {
    for (const bad of [
      undefined,
      null,
      {},
      { ...PROFILE_V2, id: null },
      { ...PROFILE_V2, id: '' },
      { ...PROFILE_V2, base_prompt: '  ' },
    ])
      assert.throws(() => build(row, bad), /STYLE_PROFILE_REQUIRED/)
  }
  assert.throws(() => buildExerciseVisualPrompts(row, null), /STYLE_PROFILE_REQUIRED/)
  assert.equal(
    STYLE_PROFILE_ERROR_MESSAGE,
    'Não foi possível carregar o padrão visual. Tente novamente.'
  )
})

test('sem nome do exercício não gera prompt', () => {
  assert.throws(
    () => buildStartPrompt({ id: 'x', name: '  ' }, PROFILE_V2),
    /EXERCISE_NAME_REQUIRED/
  )
  assert.throws(() => buildEndPrompt({ id: 'x', name: '  ' }, PROFILE_V2), /EXERCISE_NAME_REQUIRED/)
})

test('hashPromptText: SHA-256 hex estável do texto exato; muda se o texto muda; null sem crypto.subtle', async () => {
  const { start, end } = buildExerciseVisualPrompts(row, PROFILE_V2)
  const a = await hashPromptText(start.text)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(a, await hashPromptText(start.text))
  assert.notEqual(a, await hashPromptText(end.text))
  assert.equal(
    await hashPromptText('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
  assert.equal(await hashPromptText(null), null)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
  try {
    assert.equal(await hashPromptText('x'), null)
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor)
  }
})

test('amostra real: peso corporal, máquina, barra, halteres e tornozelos sutis usam poses do catálogo', () => {
  const catalog = JSON.parse(
    readFileSync(new URL('../../imports/exercicios_ptbr.json', import.meta.url), 'utf8')
  )
  const cases = [
    ['Pushups', /peito quase tocar o chão/],
    ['Butterfly', /alças juntas/],
    ['Barbell_Bench_Press_-_Medium_Grip', /barra tocar o meio do seu peito/],
    ['Alternate_Hammer_Curl', /halter na altura do ombro/],
    ['Calf_Press_On_The_Leg_Press_Machine', /Mantenha os joelhos imóveis/],
  ]
  for (const [id, endpoint] of cases) {
    const exercise = catalog.find((row) => row.id === id)
    assert.ok(exercise)
    const brief = exercisePoseBrief(exercise)
    assert.equal(brief.complete, true, id)
    assert.match(brief.end, endpoint)
    assert.notEqual(brief.start, brief.end)
    const { start, end } = buildExerciseVisualPrompts(exercise, PROFILE_V2)
    assert.equal(start.needsClarification, false)
    assert.match(end.text, endpoint)
    assert.match(start.text, /IDENTIDADE FIXA DO AVATAR/)
    assert.match(start.text, /cinza-clara/)
    assert.match(start.text, /corpo e equipamento completos/)
    assert.match(start.text, /Sem cenário ou paisagem/)
    assert.match(end.text, /REFERÊNCIA OBRIGATÓRIA/)
    assert.ok(!brief.end.startsWith('Repita') && !brief.end.startsWith('Volte'), id)
  }
})

test('catálogo incompleto e menção ao retorno não inventam START nem END', () => {
  for (const instructions of [
    [],
    ['Empurre.'],
    ['Repita na posição inicial.'],
    ['Esta é a posição inicial.', 'Repita.'],
  ]) {
    const prompt = buildStartPrompt({ name: 'Exercício incompleto', instructions }, PROFILE_V2)
    assert.equal(prompt.needsClarification, true)
    assert.match(prompt.text, /Não gere a imagem ainda/)
    assert.match(prompt.text, /não invente execução/)
  }
})
