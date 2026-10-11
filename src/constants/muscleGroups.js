export const MUSCLE_GROUPS = [
  'Peito',
  'Costas',
  'Pernas',
  'Ombros',
  'Bíceps',
  'Tríceps',
  'Abdômen',
  'Glúteos',
  'Panturrilha',
  'Antebraços',
  'Pescoço',
  'Cardio',
  'Outros',
]

// Nenhum grupo personalizado é "salvo" à parte — ele só existe enquanto algum exercício
// do usuário usa esse texto em muscleGroup (sempre foi campo livre no banco e nas regras,
// só o formulário travava nas opções fixas). A lista de opções do formulário nasce daqui:
// os grupos fixos, sempre disponíveis, mais os que o usuário já usa e não são nenhum dos
// fixos (comparação sem diferenciar maiúsculas, pra não duplicar "Cardio" e "cardio" como
// grupos diferentes na mesma lista).
export function mergeCustomGroups(exercises = []) {
  const seen = new Map()
  for (const exercise of exercises) {
    const group = exercise.muscleGroup?.trim()
    if (!group) continue
    const key = group.toLowerCase()
    if (MUSCLE_GROUPS.some((fixed) => fixed.toLowerCase() === key)) continue
    if (!seen.has(key)) seen.set(key, group)
  }
  return [...MUSCLE_GROUPS, ...[...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))]
}

// Digitar "peito" em "+ Criar novo grupo…" quando "Peito" já existe não pode virar um
// grupo novo, só por causa da caixa — isso fragmentaria a biblioteca em dois grupos sem
// o usuário perceber. Casa (sem diferenciar maiúsculas) com um grupo já existente e
// devolve a grafia canônica dele; sem correspondência, devolve o texto digitado como veio.
export function resolveMuscleGroup(typed, availableGroups) {
  const trimmed = typed.trim()
  const canonical = availableGroups.find(
    (group) => group.toLowerCase() === trimmed.toLowerCase()
  )
  return canonical || trimmed
}
