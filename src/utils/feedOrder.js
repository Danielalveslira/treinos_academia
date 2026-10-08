// Ordem do feed = (created_at desc, id desc), a mesma do banco. Para mesclar uma página nova com as já
// carregadas é preciso comparar posições com a MESMA precisão do banco (microssegundos): o PostgREST devolve
// created_at como "2026-10-08T18:26:06.287298+00:00" (fração com zeros finais omitidos) e um Date do JS só
// tem milissegundos. Publicações otimistas locais têm createdAt como Date.
const FRACTION = /\.(\d+)/

function parsePosition(status) {
  const raw = status?.createdAt
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw)
  const fraction = typeof raw === 'string' ? FRACTION.exec(raw)?.[1] : null
  // microssegundos como string de 6 dígitos (a fração do banco, sem os ms que o Date já contou)
  const micros = fraction ? fraction.padEnd(6, '0').slice(3, 6) : '000'
  return { ms: Number.isFinite(ms) ? ms : 0, micros, id: String(status?.id ?? '') }
}

// <0 se `a` vem ANTES de `b` no feed (é mais novo); >0 se vem depois (é mais antigo); 0 se mesma posição.
export function compareFeedOrder(a, b) {
  const x = parsePosition(a)
  const y = parsePosition(b)
  if (x.ms !== y.ms) return x.ms > y.ms ? -1 : 1
  if (x.micros !== y.micros) return x.micros > y.micros ? -1 : 1
  if (x.id !== y.id) return x.id > y.id ? -1 : 1
  return 0
}

// Atualiza a lista já carregada com a PRIMEIRA PÁGINA nova do servidor, sem derrubar as páginas de baixo:
//  - o que está dentro da janela da página nova vem dela (contadores/estado atuais; o que sumiu foi removido
//    ou expirou);
//  - o que é mais antigo que o último item da página nova permanece como estava;
//  - publicações otimistas locais (createdAt Date) ainda mais novas que tudo da página nova são mantidas;
//  - campos só locais (foto recém-publicada em memória) são preservados.
export function mergeFirstPage(current, fresh) {
  const byId = new Map(current.items.map((item) => [item.id, item]))
  const freshItems = fresh.items.map((item) => {
    const previous = byId.get(item.id)
    return previous?._localPhotoBlob ? { ...item, _localPhotoBlob: previous._localPhotoBlob } : item
  })
  if (!fresh.hasMore || freshItems.length === 0)
    return { items: freshItems, hasMore: fresh.hasMore }

  const boundary = freshItems.at(-1)
  const newest = freshItems[0]
  const older = current.items.filter((item) => compareFeedOrder(item, boundary) > 0)
  const localNewer = current.items.filter(
    (item) => item.createdAt instanceof Date && compareFeedOrder(item, newest) < 0
  )
  return {
    items: [...localNewer, ...freshItems, ...older],
    // Se já havíamos carregado páginas abaixo, o "tem mais" é o da última página carregada; senão, o da nova.
    hasMore: older.length > 0 ? current.hasMore : fresh.hasMore,
  }
}
