// Prompts para qualquer ferramenta de IA de imagem (geração MANUAL, sem API). V2: dois prompts SEPARADOS --
// buildStartPrompt (uma única imagem, posição inicial) e buildEndPrompt (uma única imagem, posição final, com a
// imagem START como referência obrigatória). Monta tudo a partir dos dados REAIS de exercise_catalog + o Style
// Profile ativo: ninguém digita nome/equipamento/músculo à mão. Funções puras (sem rede, sem DOM).
//
// O texto é independente de fornecedor. `provider` só ajusta o formato (uma linha de abertura e como a
// referência é citada); 'generic' é o padrão e funciona em qualquer ferramenta. Novo provider = uma entrada em
// PROMPT_PROVIDER_FORMATS, sem tocar em componentes.
export const PROMPT_VERSION = 'v2.1'
export const VISUAL_VIEW = 'lateral'
export const VISUAL_TYPE = 'start_end'
export const DEFAULT_PROMPT_PROVIDER = 'generic'

export const PROMPT_PROVIDER_FORMATS = {
  generic: {
    label: 'Genérico',
    opening: null,
    referenceDelivery: 'fornecida junto com este prompt (anexada ou enviada na mesma conversa)',
    attachHint: 'Anexe a imagem inicial ao gerar a posição final.',
  },
  gemini: {
    label: 'Gemini',
    opening: 'Gere a imagem descrita neste briefing.',
    referenceDelivery: 'anexada a esta mensagem',
    attachHint: 'Anexe a imagem inicial na mesma conversa do Gemini ao gerar a posição final.',
  },
  openai: {
    label: 'ChatGPT',
    opening: 'Crie a imagem descrita neste briefing.',
    referenceDelivery: 'anexada a esta mensagem (ou gerada logo acima nesta conversa)',
    attachHint:
      'Anexe a imagem inicial (ou continue a conversa em que ela foi gerada) ao gerar a posição final.',
  },
}

export const PROMPT_PROVIDER_OPTIONS = Object.entries(PROMPT_PROVIDER_FORMATS).map(
  ([value, format]) => ({ value, label: format.label })
)

// NÃO existe perfil de reserva: o prompt só é montado a partir do Style Profile ATIVO carregado do servidor
// (com id). Um texto de estilo embutido poderia divergir do perfil que o servidor registra no conjunto visual.
export const STYLE_PROFILE_ERROR_MESSAGE =
  'Não foi possível carregar o padrão visual. Tente novamente.'

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanList(values) {
  return (Array.isArray(values) ? values : []).map(clean).filter(Boolean)
}

// Aceita tanto a linha crua do banco (primary_muscle/muscles/difficulty) quanto o formato mapeado da
// UI (primaryMuscles/secondaryMuscles/level), que é o que o catálogo do app já usa.
export function structuredExerciseInput(exercise) {
  const primaryMuscle =
    clean(exercise?.primary_muscle) || cleanList(exercise?.primaryMuscles)[0] || ''
  const allMuscles = cleanList(exercise?.muscles)
  const secondaryMuscles = allMuscles.length
    ? allMuscles.filter((muscle) => muscle !== primaryMuscle)
    : cleanList(exercise?.secondaryMuscles)
  return {
    catalogId: clean(exercise?.id),
    exercise: clean(exercise?.name),
    equipment: clean(exercise?.equipment) || null,
    primaryMuscle,
    secondaryMuscles,
    category: clean(exercise?.category) || null,
    difficulty: clean(exercise?.difficulty) || clean(exercise?.level) || null,
    force: clean(exercise?.force) || null,
    mechanic: clean(exercise?.mechanic) || null,
    instructions: cleanList(exercise?.instructions),
    view: VISUAL_VIEW,
    visualType: VISUAL_TYPE,
  }
}

function resolveProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROMPT_PROVIDER_FORMATS, provider)
    ? provider
    : DEFAULT_PROMPT_PROVIDER
}

// Usa os limites descritos pelo catálogo, não uma execução inferida pelo nome.
// END é o primeiro deslocamento após START; não a instrução de retorno/repetição.
export function exercisePoseBrief(exercise) {
  const { instructions } = structuredExerciseInput(exercise)
  const movement =
    /des[çc]a|abaixe|eleve|levante|puxe|empurre|flexion|estend|estique|afaste|aproxime|gire|curve|junte|lower|raise|pull|push|press|extend|bend|curl/i
  const isReturn = (step) =>
    /^(repita|repeat|ao terminar|return|retorne|volte)|de volta [àa] posi[çc][ãa]o inicial/i.test(
      step
    )
  let initial = instructions.findIndex((step) =>
    /(?:esta|essa|this).{0,35}(?:posi[çc][ãa]o inicial|starting position)/i.test(step)
  )
  // A postura pode estar escrita sem o rótulo START (ex.: flexão). Só usar o preparo
  // literalmente descrito antes do primeiro deslocamento; não inferir uma pose do nome.
  if (
    initial < 0 &&
    /^(deite|fique|sente|apoie|posicione|comece|lie|stand|sit|place)/i.test(instructions[0] || '')
  ) {
    const next = instructions.findIndex(
      (step, index) => index > 0 && !isReturn(step) && movement.test(step)
    )
    if (next > 0) initial = next - 1
  }
  const end =
    initial >= 0
      ? instructions.slice(initial + 1).find((step) => !isReturn(step) && movement.test(step))
      : null
  return {
    start: initial >= 0 ? instructions.slice(0, initial + 1).join(' ') : null,
    end: end || null,
    camera: /lateral|lados|side|afaste|juntas|together/i.test(end || '')
      ? 'vista frontal em três quartos'
      : 'vista lateral em três quartos',
    complete: initial >= 0 && Boolean(end),
  }
}

function exerciseBlock(input) {
  return [
    'EXERCÍCIO',
    `- Nome: ${input.exercise}`,
    `- Equipamento: ${input.equipment || 'não informado; não invente equipamento'}`,
    `- Músculo principal: ${input.primaryMuscle || 'não informado'}`,
  ]
}

function negativeBlock(profile) {
  const negative = clean(profile.negative_rules)
  return [
    '',
    'EVITE',
    ...new Set([
      'Sem cenário ou paisagem, texto, marca-d’água, logotipo ou membros extras.',
      ...negative
        .split('\n')
        .map((rule) => rule.replace(/^[-\s]+/, ''))
        .filter(
          (rule) =>
            rule && !/^Sem (texto|logotipos|membros extras|elementos decorativos)\./.test(rule)
        ),
    ]),
  ].map((line, index) => (index > 1 ? `- ${line}` : line))
}

const SINGLE_IMAGE_RULES = [
  '- Uma única imagem, com uma única pose do personagem; corpo e equipamento completos, sem cortes.',
  '- NÃO gerar comparação, duas poses, colagem, sequência, painel dividido nem "antes e depois".',
]

function styleBlock(profile) {
  if (profile.name !== 'EVOLUTUS_FITNESS_V2') return clean(profile.base_prompt)
  return clean(profile.base_prompt)
    .split('\n')
    .filter(
      (line) =>
        ![
          /^Avatar humano adulto neutro/,
          /^Anatomia natural e proporcional/,
          /^Roupa esportiva neutra/,
          /^Rosto pouco caracterizado/,
          /^Mesmo avatar em todos os exercícios/,
          /^Fundo transparente/,
          /^Prioridade para a biomecânica/,
        ].some((rule) => rule.test(line))
    )
    .join('\n')
}

function identityBlock(profile) {
  // Complementa o V2; não modifica o perfil persistido nem os visuais publicados.
  return profile.name === 'EVOLUTUS_FITNESS_V2'
    ? [
        'IDENTIDADE FIXA DO AVATAR',
        '- Um único adulto andrógino: rosto oval pouco caracterizado e neutro, cabelo castanho curto, tom de pele médio uniforme, tronco e quadris de proporções médias, ombros proporcionais, musculatura natural; sem traços masculinos ou femininos acentuados.',
        '- Camiseta esportiva cinza-clara lisa de corte reto, shorts grafite discretos e tênis cinza sem marcas; mesma modelagem, cores, rosto e proporções em cada exercício. Não substituir por um modelo feminino ou masculino estereotipado.',
      ]
    : []
}

function poseBlock(input, role) {
  const brief = exercisePoseBrief(input)
  if (!brief.complete)
    return [
      'CATÁLOGO INSUFICIENTE',
      '- Não gere a imagem ainda. Peça a descrição da postura inicial e do ponto distinto do movimento; não invente execução, equipamento nem amplitude.',
    ]
  return [
    role === 'start' ? 'POSIÇÃO INICIAL' : 'POSIÇÃO FINAL',
    ...(role === 'start' ? [`- Postura START do catálogo: ${brief.start}`] : []),
    ...(role === 'end'
      ? [
          `- Deslocamento e ponto END do catálogo: ${brief.end}`,
          '- Retrate o limite deste deslocamento, antes do retorno a START; não ilustre a repetição inteira.',
        ]
      : []),
    '- Pés, pegada e mãos, coluna, ângulos articulares e amplitude devem seguir esta descrição. Preserve os apoios na mudança de pose. Se algum detalhe necessário faltar ou for contraditório, peça esclarecimento antes de gerar.',
    '- Mostre a diferença real do movimento, inclusive quando sutil; não force amplitude nem anatomia para aumentar a diferença.',
  ]
}

function prepare(exercise, styleProfile, options) {
  const input = structuredExerciseInput(exercise)
  if (!input.exercise) throw new Error('EXERCISE_NAME_REQUIRED')
  // Sem perfil ativo carregado (com id) não há prompt: nunca se usa outro perfil no lugar.
  if (!styleProfile?.id || !clean(styleProfile.base_prompt))
    throw new Error('STYLE_PROFILE_REQUIRED')
  const profile = styleProfile
  const provider = resolveProvider(options?.provider)
  return { input, profile, provider, format: PROMPT_PROVIDER_FORMATS[provider] }
}

function result(role, text, { input, profile, provider }) {
  return {
    role,
    text,
    structured: input,
    provider,
    promptVersion: PROMPT_VERSION,
    needsClarification: !exercisePoseBrief(input).complete,
    styleVersion: profile.name,
    styleProfileId: profile.id,
  }
}

// Posição INICIAL: exatamente uma imagem, sem comparação nem duas poses.
export function buildStartPrompt(exercise, styleProfile, options = {}) {
  const prepared = prepare(exercise, styleProfile, options)
  const { input, profile, format } = prepared
  const lines = [
    ...(format.opening ? [format.opening, ''] : []),
    `Estilo visual: ${profile.name} (${profile.version})`,
    styleBlock(profile),
    ...identityBlock(profile),
    '',
    'TAREFA',
    'Gerar EXATAMENTE UMA imagem: a POSIÇÃO INICIAL (START) do exercício abaixo.',
    ...SINGLE_IMAGE_RULES,
    '',
    ...exerciseBlock(input),
    '',
    ...poseBlock(input, 'start'),
    '',
    'ENQUADRAMENTO',
    `- ${exercisePoseBrief(input).camera}, proporção quadrada (1:1), corpo e equipamento inteiros, com margem. Mostre as articulações que se movem sem sobreposição.`,
    '- Câmera fixa, mesma escala em todos os exercícios, iluminação suave e uniforme.',
    '- Fundo transparente.',
    ...negativeBlock(profile),
  ]
  return result('start', lines.join('\n'), prepared)
}

// Posição FINAL: exatamente uma imagem, usando a imagem START como referência obrigatória. Só a biomecânica
// da pose muda.
export function buildEndPrompt(exercise, styleProfile, options = {}) {
  const prepared = prepare(exercise, styleProfile, options)
  const { input, profile, format } = prepared
  const lines = [
    ...(format.opening ? [format.opening, ''] : []),
    `Estilo visual: ${profile.name} (${profile.version})`,
    styleBlock(profile),
    ...identityBlock(profile),
    '',
    'TAREFA',
    'Gerar EXATAMENTE UMA imagem: a POSIÇÃO FINAL (END) do exercício abaixo.',
    ...SINGLE_IMAGE_RULES,
    '',
    'REFERÊNCIA OBRIGATÓRIA',
    `- A imagem da POSIÇÃO INICIAL (START), ${format.referenceDelivery}, deve ser utilizada como referência.`,
    '- Mantenha IGUAL ao START: personagem (corpo, rosto e proporções), roupa, equipamento, câmera, escala, enquadramento e iluminação.',
    '- Altere SOMENTE a biomecânica da pose e a posição do equipamento que se move.',
    '- Se a imagem START não estiver disponível, avise em vez de inventar outro personagem.',
    '',
    ...exerciseBlock(input),
    '',
    ...poseBlock(input, 'end'),
    '',
    'ENQUADRAMENTO',
    '- Idêntico ao da imagem START (não trocar a câmera): proporção quadrada (1:1), personagem inteiro visível, com margem ao redor.',
    '- Fundo transparente.',
    ...negativeBlock(profile),
  ]
  return result('end', lines.join('\n'), prepared)
}

// Os dois prompts de uma vez (mesmo perfil e mesmo provider), para a tela.
export function buildExerciseVisualPrompts(exercise, styleProfile, options) {
  return {
    start: buildStartPrompt(exercise, styleProfile, options),
    end: buildEndPrompt(exercise, styleProfile, options),
  }
}

// SHA-256 (hex) do texto exato copiado, para registrar a proveniência no conjunto visual. null se o navegador
// não oferece crypto.subtle (contexto não seguro): a proveniência é opcional e nunca bloqueia o envio.
export async function hashPromptText(text) {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle || typeof text !== 'string') return null
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
