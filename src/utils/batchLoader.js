// Junta várias chamadas load(chave) feitas na mesma janela de tempo (tipicamente os efeitos
// dos cards de uma mesma renderização do feed) em UMA chamada a batchFn, em vez de uma por
// card (padrão N+1). Chaves repetidas na janela ou ainda em voo dividem o mesmo resultado.
// batchFn(keys) devolve um Map (ou objeto) chave -> valor; uma chave ausente resolve como
// undefined. Se batchFn rejeitar, todas as chamadas daquele lote rejeitam (cada card trata o
// próprio erro e oferece "Tentar novamente", que cria um lote novo).
export function createBatchLoader(batchFn, { maxBatch = 50, delayMs = 0 } = {}) {
  let queue = new Map()
  const inFlight = new Map()
  let timer = null

  async function run(chunk) {
    const keys = chunk.map(([key]) => key)
    try {
      const result = await batchFn(keys)
      for (const [key, entry] of chunk)
        entry.resolve(result instanceof Map ? result.get(key) : result?.[key])
    } catch (error) {
      for (const [, entry] of chunk) entry.reject(error)
    } finally {
      for (const key of keys) inFlight.delete(key)
    }
  }

  function flush() {
    timer = null
    const entries = [...queue.entries()]
    queue = new Map()
    for (let i = 0; i < entries.length; i += maxBatch) run(entries.slice(i, i + maxBatch))
  }

  return {
    load(key) {
      const pending = queue.get(key) ?? inFlight.get(key)
      if (pending) return pending.promise
      const entry = {}
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve
        entry.reject = reject
      })
      queue.set(key, entry)
      inFlight.set(key, entry)
      if (timer === null) timer = setTimeout(flush, delayMs)
      return entry.promise
    },
  }
}
