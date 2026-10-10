// Prompts para qualquer ferramenta de IA de imagem (geração MANUAL, sem API). V2: dois prompts SEPARADOS --
// buildStartPrompt (uma única imagem, posição inicial) e buildEndPrompt (uma única imagem, posição final, com a
// imagem START como referência obrigatória). Monta tudo a partir dos dados REAIS de exercise_catalog + o Style
// Profile ativo: ninguém digita nome/equipamento/músculo à mão. Funções puras (sem rede, sem DOM).
//
// O texto é independente de fornecedor. `provider` só ajusta o formato (uma linha de abertura e como a
// referência é citada); 'generic' é o padrão e funciona em qualquer ferramenta. Novo provider = uma entrada em
// PROMPT_PROVIDER_FORMATS, sem tocar em componentes.
export const PROMPT_VERSION = 'v2'
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

function exerciseBlock(input) {
  const lines = [
    'EXERCÍCIO',
    `- Nome: ${input.exercise}`,
    `- Equipamento: ${input.equipment || 'peso do corpo / sem equipamento'}`,
    `- Músculo principal: ${input.primaryMuscle || 'não informado'}`,
  ]
  if (input.secondaryMuscles.length)
    lines.push(`- Músculos secundários: ${input.secondaryMuscles.join(', ')}`)
  if (input.category) lines.push(`- Categoria: ${input.category}`)
  if (input.difficulty) lines.push(`- Nível: ${input.difficulty}`)
  if (input.force) lines.push(`- Tipo de força: ${input.force}`)
  if (input.mechanic) lines.push(`- Mecânica: ${input.mechanic}`)
  if (input.instructions.length) {
    lines.push('', 'EXECUÇÃO DO MOVIMENTO (referência biomecânica)')
    input.instructions.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  }
  return lines
}

function negativeBlock(profile) {
  const negative = clean(profile.negative_rules)
  if (!negative) return []
  return ['', 'EVITE', ...negative.split('\n').map((rule) => `- ${rule.replace(/^[-\s]+/, '')}`)]
}

const SINGLE_IMAGE_RULES = [
  '- Uma única imagem, com uma única pose do personagem.',
  '- NÃO gerar comparação, duas poses, colagem, sequência, painel dividido nem "antes e depois".',
]

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
    clean(profile.base_prompt),
    '',
    'TAREFA',
    'Gerar EXATAMENTE UMA imagem: a POSIÇÃO INICIAL (START) do exercício abaixo.',
    ...SINGLE_IMAGE_RULES,
    '',
    ...exerciseBlock(input),
    '',
    'POSIÇÃO INICIAL',
    '- Mostre o personagem no começo da repetição, antes do movimento principal, com o equipamento posicionado exatamente como é usado neste exercício.',
    '',
    'ENQUADRAMENTO',
    '- Vista lateral, proporção quadrada (1:1), personagem inteiro visível, com margem ao redor.',
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
    clean(profile.base_prompt),
    '',
    'TAREFA',
    'Gerar EXATAMENTE UMA imagem: a POSIÇÃO FINAL (END) do exercício abaixo.',
    ...SINGLE_IMAGE_RULES,
    '',
    'REFERÊNCIA OBRIGATÓRIA',
    `- A imagem da POSIÇÃO INICIAL (START), ${format.referenceDelivery}, deve ser utilizada como referência.`,
    '- Mantenha IGUAL ao START: o personagem (corpo, rosto e proporções), a roupa, o equipamento (modelo, tamanho e acabamento), a câmera, a escala, o enquadramento e a iluminação.',
    '- Altere SOMENTE a biomecânica da pose: a posição do corpo e das articulações no ponto final do movimento (e do equipamento, quando o movimento o desloca).',
    '- Se a imagem START não estiver disponível, avise em vez de inventar outro personagem.',
    '',
    ...exerciseBlock(input),
    '',
    'POSIÇÃO FINAL',
    '- Mostre o ponto final da fase principal do movimento (fim da repetição), claramente diferente da posição inicial e biomecanicamente correto.',
    '',
    'ENQUADRAMENTO',
    '- Idêntico ao da imagem START: vista lateral, proporção quadrada (1:1), personagem inteiro visível, com margem ao redor.',
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
