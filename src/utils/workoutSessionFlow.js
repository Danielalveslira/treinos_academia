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
