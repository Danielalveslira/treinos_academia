// Depois de finalizar um exercício dentro do fluxo de sessão (grupo -> exercício ->
// séries, ver WorkoutForm.jsx): se ainda sobra exercício não concluído no mesmo grupo,
// volta pra aba "2 Exercício" pra escolher o próximo; se não sobra nenhum, volta pra
// aba "1 Grupo" pra escolher outro grupo muscular. Nunca navega pra fora do fluxo de
// treino (ex.: Histórico) -- isso é o que corrige o bug original.
export function nextStepAfterFinishing({ allExercisesInGroup, doneExerciseIds, finishedExerciseId }) {
  const nextDone = new Set(doneExerciseIds)
  nextDone.add(finishedExerciseId)
  const hasRemaining = allExercisesInGroup.some((exercise) => !nextDone.has(exercise.id))
  return { doneExerciseIds: nextDone, step: hasRemaining ? 'exercise' : 'group' }
}

// Estado do formulário depois de finalizar um exercício, antes de o usuário escolher o
// próximo. Bug corrigido aqui: antes desta mudança, values (inclusive note) continuava
// "pertencendo" ao exercício recém-finalizado até a próxima seleção -- e o fallback de
// chooseExercise() (usado quando não há rascunho salvo pro novo exercício) copia
// note/date de `values` de propósito, pra não perder uma observação em digitação ao
// TROCAR de exercício antes de finalizar (esse caso não muda aqui). Isso nunca vazava
// antes de existir o retorno automático pra "2 Exercício", porque finalizar sempre
// navegava pra fora da página (WorkoutForm desmontava). date fica de fora do reset de
// propósito -- é a mesma data pra todo exercício da sessão, inclusive se o usuário
// registrou algo retroativo. setDetails/exerciseId sempre voltam limpos: o próximo
// exercício nunca deveria abrir com peso/reps ou seleção residual do anterior.
export function valuesForNextExercise(previousValues) {
  return {
    exerciseId: '',
    setDetails: [{ weight: '', reps: '' }],
    durationMinutes: '',
    distanceKm: '',
    date: previousValues.date,
    note: '',
  }
}
