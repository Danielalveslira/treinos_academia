import { attempt, request, withTransaction } from './database.js'
import { STORES } from './schema.js'

// Armazenamento persistente (navigator.storage.persist): sem ele o navegador pode APAGAR o IndexedDB sob
// pressão de espaço, levando junto o bootstrap offline e, pior, a outbox. É um pedido, não uma garantia:
// o navegador decide (Chrome por engajamento/instalação; Safari/Firefox podem perguntar ou negar).
//
// Regras: pede UMA vez por aparelho (a decisão fica guardada), nunca bloqueia o boot, nunca lança, e uma
// recusa/ausência da API não afeta o funcionamento -- só reduz a garantia de durabilidade.
const ASKED_KEY = 'storage:persist-asked'
const LOW_SPACE_RATIO = 0.9

const storageApi = () => globalThis.navigator?.storage ?? null

export async function getStorageHealth() {
  const api = storageApi()
  if (!api)
    return { supported: false, persisted: false, usage: null, quota: null, nearlyFull: false }
  const [persisted, estimate] = await Promise.all([
    api.persisted?.().catch(() => false) ?? false,
    api.estimate?.().catch(() => null) ?? null,
  ])
  const usage = estimate?.usage ?? null
  const quota = estimate?.quota ?? null
  return {
    supported: true,
    persisted: Boolean(persisted),
    usage,
    quota,
    nearlyFull: Boolean(quota && usage != null && usage / quota >= LOW_SPACE_RATIO),
  }
}

// Chamar depois de a conta ser confirmada online (momento em que o aparelho passa a guardar algo que vale
// a pena proteger). Devolve 'granted' | 'denied' | 'already' | 'asked-before' | 'unsupported'.
export async function requestPersistentStorageOnce() {
  const api = storageApi()
  if (!api?.persist) return 'unsupported'
  try {
    if (await api.persisted?.()) return 'already'
    const asked = await attempt(
      'storage:asked',
      () =>
        withTransaction([STORES.syncMeta], 'readonly', ({ syncMeta }) =>
          request(syncMeta.get(ASKED_KEY))
        ),
      undefined
    )
    if (asked) return 'asked-before' // não insiste: o navegador já respondeu antes
    const granted = await api.persist()
    await attempt(
      'storage:mark-asked',
      () =>
        withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) =>
          request(
            syncMeta.put({ key: ASKED_KEY, value: { at: Date.now(), granted: Boolean(granted) } })
          )
        ),
      undefined
    )
    return granted ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}
