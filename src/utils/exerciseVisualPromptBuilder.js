// Prompt padrão para qualquer ferramenta de IA de imagem (geração MANUAL, sem API -- Fase 1/2 de
// docs/promps/Evolutus_arquitetura_imagens_exercicios_V2_auditada.md). Monta tudo a partir dos dados
// REAIS de exercise_catalog + o Style Profile ativo: ninguém digita nome/equipamento/músculo à mão.
// Função pura (sem rede, sem DOM), para o painel admin e para os testes usarem a mesma saída.
export const PROMPT_VERSION = 'v1'
export const VISUAL_VIEW = 'lateral'
export const VISUAL_TYPE = 'start_end'

// Último recurso se o Style Profile ainda não carregou (espelha o seed EVOLUTUS_FITNESS_V1).
export const FALLBACK_STYLE_PROFILE = {
  name: 'EVOLUTUS_FITNESS_V1',
  version: 'v1',
  base_prompt: [
    'Ilustração técnica fitness.',
    'Mesmo personagem em todos os exercícios.',
    'Anatomia proporcional.',
    'Roupa esportiva neutra.',
    'Equipamentos consistentes.',
    'Fundo transparente.',
    'Prioridade para clareza biomecânica.',
    'Posição inicial e final claramente distintas.',
  ].join('\n'),
  negative_rules: [
    'Sem texto.',
    'Sem números.',
    'Sem logotipos externos.',
    'Sem decoração.',
    'Sem membros extras.',
  ].join('\n'),
}

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

export function buildExerciseVisualPrompt(exercise, styleProfile = FALLBACK_STYLE_PROFILE) {
  const input = structuredExerciseInput(exercise)
  if (!input.exercise) throw new Error('EXERCISE_NAME_REQUIRED')
  const profile = styleProfile?.base_prompt ? styleProfile : FALLBACK_STYLE_PROFILE

  const lines = [
    `Estilo visual: ${profile.name} (${profile.version})`,
    clean(profile.base_prompt),
    '',
    'Exercício',
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
    lines.push('', 'Execução do movimento (use como referência biomecânica):')
    input.instructions.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  }

  lines.push(
    '',
    'Entrega',
    '- Gere DUAS imagens separadas, em vista lateral, do mesmo personagem, com o mesmo enquadramento e a mesma escala:',
    '  1. POSIÇÃO INICIAL do movimento;',
    '  2. POSIÇÃO FINAL do movimento.',
    '- As duas posições devem ser claramente diferentes e biomecanicamente corretas.',
    '- Proporção quadrada (1:1), personagem inteiro visível, com margem ao redor.',
    '- Mostre o equipamento exatamente como é usado neste exercício.'
  )

  const negative = clean(profile.negative_rules)
  if (negative)
    lines.push(
      '',
      'Evite',
      ...negative.split('\n').map((rule) => `- ${rule.replace(/^[-\s]+/, '')}`)
    )

  return {
    text: lines.join('\n'),
    structured: input,
    promptVersion: PROMPT_VERSION,
    styleVersion: profile.name,
  }
}
