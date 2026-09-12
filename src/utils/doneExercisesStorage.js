const KEY_PREFIX = 'evolutus:done-exercises:'
const keyFor = (dateKey) => `${KEY_PREFIX}${dateKey}`

// localStorage pode estar bloqueado (modo privado agressivo, quota cheia) ou nem existir
// (ambiente de teste) -- qualquer falha aqui degrada pra um Set vazio, nunca quebra a
// tela. Sem sync entre aparelhos de propósito: é só uma marcação visual de "já fiz esse
// exercício hoje, neste aparelho", não um dado de treino de verdade (esse continua só no
// Firestore).
export function loadDoneExerciseIds(dateKey) {
  try {
    const raw = localStorage.getItem(keyFor(dateKey))
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

export function saveDoneExerciseIds(dateKey, ids) {
  try {
    localStorage.setItem(keyFor(dateKey), JSON.stringify([...ids]))
  } catch {
    // Sem storage disponível: a marcação fica só em memória para esta sessão.
  }
}

// Best-effort, chamado uma vez ao montar o fluxo de treino -- remove chaves de dias
// anteriores pra não acumular lixo indefinidamente no localStorage do usuário. Falha
// aqui não é crítica (o app funciona igual com lixo acumulado).
export function cleanupStaleDoneExerciseKeys(currentDateKey) {
  try {
    const currentKey = keyFor(currentDateKey)
    // De trás pra frente: remover enquanto itera para frente pula índices, já que
    // localStorage reindexa as chaves restantes a cada removeItem.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(KEY_PREFIX) && key !== currentKey) localStorage.removeItem(key)
    }
  } catch {
    // Limpeza é best-effort -- chaves antigas acumuladas não quebram nada.
  }
}
