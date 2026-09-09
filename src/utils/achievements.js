export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function validateAchievement(achievement, today = localDayKey()) {
  if (!achievement || achievement.day !== today)
    return 'O dia mudou. Atualize a prévia antes de publicar.'
  if (typeof achievement.text !== 'string' || achievement.text.trim().length > 300)
    return 'Use até 300 caracteres.'
  if (
    !Number.isInteger(achievement.entries) ||
    achievement.entries < 0 ||
    !Number.isFinite(achievement.sets) ||
    achievement.sets < 0
  )
    return 'Não foi possível calcular os totais do dia.'
  if (!achievement.entries && !achievement.text.trim())
    return 'Conte sua conquista ou registre um exercício hoje.'
  return null
}
