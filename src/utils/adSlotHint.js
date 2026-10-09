import { onPageCacheClear } from './pageCache.js'

// Dica local, por usuário e comunidade, do que os anúncios ocuparam na última visita: se havia banner e
// quantos pixels tinha o bloco de cards de feed do topo. Serve APENAS para reservar espaço enquanto a
// consulta de anúncios ainda não voltou, evitando que o conteúdo já visível seja empurrado quando eles
// chegam. Nunca decide o que é exibido: sem a dica (primeira visita, storage indisponível) nada é reservado;
// com a dica errada o espaço some/ajusta assim que a lista real chega. Comunidade sem patrocínio nunca
// reserva espaço. Só guarda números/booleano -- nenhum dado da campanha.
const PREFIX = 'adSlotHint:'
const NONE = Object.freeze({ banner: false, feedTop: 0, feedOnly: false })

function storage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

const key = (uid, communityId) => `${PREFIX}${uid}:${communityId}`

// A altura de um card depende da largura (imagem 16:9): a dica só vale na mesma faixa de largura.
export function widthBucket(viewportWidth = globalThis.innerWidth) {
  return viewportWidth >= 640 ? 'd' : 'm'
}

// Formato: "<banner 0|1>|<altura do topo em px | -1>|<faixa de largura>". Altura -1 = há cards só de feed no topo mas a
// altura não foi medida (eles entraram tarde, dentro do feed). `feedOnly` diz que esses cards existem; `feedTop` só é
// > 0 quando a altura é conhecida e vale para a faixa de largura atual.
export function readAdHint(uid, communityId, bucket = widthBucket()) {
  try {
    const raw = storage()?.getItem(key(uid, communityId))
    if (!raw) return NONE
    const [banner, top, savedBucket] = raw.split('|')
    const feedTop = Number(top)
    return {
      banner: banner === '1',
      feedTop:
        savedBucket === bucket && Number.isFinite(feedTop) && feedTop > 0
          ? Math.min(feedTop, 1200)
          : 0,
      feedOnly: Number.isFinite(feedTop) && feedTop !== 0,
    }
  } catch {
    return NONE
  }
}

export function writeAdHint(uid, communityId, { banner, feedTop = 0 }, bucket = widthBucket()) {
  try {
    const store = storage()
    if (!store) return
    const top = Math.round(Number(feedTop) || 0)
    if (!banner && top === 0) store.removeItem(key(uid, communityId))
    else store.setItem(key(uid, communityId), `${banner ? 1 : 0}|${top}|${bucket}`)
  } catch {
    // quota/privado: a dica é opcional
  }
}

// Troca de conta/logout: some junto com a cache de páginas (ver AuthContext -> clearPageCache).
onPageCacheClear(() => {
  try {
    const store = storage()
    if (!store) return
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const name = store.key(i)
      if (name?.startsWith(PREFIX)) store.removeItem(name)
    }
  } catch {
    // ignora
  }
})
