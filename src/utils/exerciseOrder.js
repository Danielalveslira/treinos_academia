// Ordena os exercícios de um mesmo grupo muscular: quem já tem `order`
// definido (Exercises.jsx -> "Reordenar") vem primeiro, crescente; quem não
// tem -- nunca reordenado, recém-criado, ou que acabou de mudar de grupo
// muscular (ver ExercisesContext.edit, que limpa `order` nesse caso) -- vem
// depois, em ordem alfabética. Sem nenhum exercício com `order`, o resultado
// é idêntico ao comportamento de sempre (alfabético), o que cobre contas
// antigas sem precisar de nenhuma migração.
export function sortExercisesInGroup(exercises) {
  return [...exercises].sort((a, b) => {
    const aHasOrder = a.order != null
    const bHasOrder = b.order != null
    if (aHasOrder && bHasOrder) return a.order - b.order
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1
    return a.name.localeCompare(b.name, 'pt-BR')
  })
}

// Troca um exercício de posição com o vizinho adjacente (direction: -1 para
// subir, 1 para descer) dentro de uma lista de ids já na ordem exibida. Sem
// efeito (devolve a mesma lista) nas bordas ou se o id não estiver na lista.
export function moveExerciseOrder(orderedIds, id, direction) {
  const index = orderedIds.indexOf(id)
  if (index === -1) return orderedIds
  const target = index + direction
  if (target < 0 || target >= orderedIds.length) return orderedIds
  const next = [...orderedIds]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
