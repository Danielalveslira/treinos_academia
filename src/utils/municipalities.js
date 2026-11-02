// Busca local de municípios do IBGE -- pura, sem React e sem rede. O catálogo (código, nome, UF)
// vem de src/data/ibgeMunicipalities.js, carregado sob demanda por services/municipalityCatalog.js.
// Reutilizável fora do cadastro (diretórios, filtros regionais): nada aqui sabe de onde a cidade
// será usada.

export const MUNICIPALITY_SUGGESTION_LIMIT = 8
export const MUNICIPALITY_MIN_QUERY_LENGTH = 2

// Sem acento, minúsculas, sem apóstrofo, qualquer pontuação vira espaço único: "São Miguel D'Oeste"
// e "sao miguel doeste" geram a mesma chave.
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function formatMunicipality(municipality) {
  return municipality ? `${municipality.name} — ${municipality.uf}` : ''
}

// Só o FORMATO (7 dígitos, prefixo de UF plausível). A existência é decidida pelo catálogo aqui
// no cliente e, de verdade, pelo servidor (FK + set_residence_municipality).
export function isMunicipalityCodeFormat(code) {
  return Number.isInteger(code) && code >= 1100000 && code <= 5399999
}

// Recebe o módulo gerado ({ IBGE_UFS, IBGE_MUNICIPALITIES, IBGE_MUNICIPALITIES_VERSION }) e devolve o
// índice usado pela busca. Construído uma vez por sessão (memoizado em municipalityCatalog.js).
export function buildMunicipalityIndex(source) {
  const ufs = source.IBGE_UFS
  const entries = []
  const byCode = new Map()
  for (const [code, name] of source.IBGE_MUNICIPALITIES) {
    const uf = ufs[Math.floor(code / 100000)]
    if (!uf || byCode.has(code)) continue
    const key = normalizeSearchText(name)
    const entry = { code, name, uf, key, compact: key.replace(/ /g, '') }
    entries.push(entry)
    byCode.set(code, entry)
  }
  return {
    version: source.IBGE_MUNICIPALITIES_VERSION,
    entries,
    byCode,
    ufs: new Set(Object.values(ufs).map((uf) => uf.toLowerCase())),
  }
}

export function findMunicipality(index, code) {
  if (!index || code == null) return null
  return index.byCode.get(Number(code)) ?? null
}

// "sao miguel rn", "São Miguel - RN", "São Miguel/RN" -> { text: 'sao miguel', uf: 'RN' }. Só
// separa a UF quando sobra texto antes dela e a sigla existe.
function splitQuery(index, rawQuery) {
  const normalized = normalizeSearchText(rawQuery)
  const match = /^(.+) ([a-z]{2})$/.exec(normalized)
  if (match && index.ufs.has(match[2]))
    return { text: match[1], uf: match[2].toUpperCase(), normalized }
  return { text: normalized, uf: null, normalized }
}

function rankEntry(entry, text, compactText) {
  if (entry.key === text) return 0
  if (entry.key.startsWith(text)) return 1
  if (entry.key.includes(` ${text}`)) return 2
  // 2 letras no meio de uma palavra ("sp" em "Boa Esperança") só geram ruído.
  if (text.length < 3) return -1
  if (entry.key.includes(text)) return 3
  if (compactText.length >= 3 && entry.compact.includes(compactText)) return 4
  return -1
}

function collect(index, text, uf) {
  const compactText = text.replace(/ /g, '')
  const results = []
  for (const entry of index.entries) {
    if (uf && entry.uf !== uf) continue
    const rank = rankEntry(entry, text, compactText)
    if (rank >= 0) results.push({ entry, rank })
  }
  return results
}

// Sugestões ordenadas: nome idêntico > começa com > palavra começa com > contém > contém sem
// espaços; empate por nome e depois UF. Limitada para não renderizar centenas de opções no celular.
export function searchMunicipalities(
  index,
  rawQuery,
  { limit = MUNICIPALITY_SUGGESTION_LIMIT } = {}
) {
  if (!index) return []
  const query = splitQuery(index, rawQuery)
  if (query.normalized.length < MUNICIPALITY_MIN_QUERY_LENGTH) return []
  let results = query.uf ? collect(index, query.text, query.uf) : []
  // A "UF" pode ser só o fim de um nome (ex.: "... do pa"): sem resultado filtrado, busca o texto inteiro.
  if (!results.length) results = collect(index, query.normalized, null)
  results.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.key.localeCompare(b.entry.key) ||
      a.entry.uf.localeCompare(b.entry.uf)
  )
  return results.slice(0, limit).map((result) => result.entry)
}

// Seleção implícita só quando não há NENHUMA ambiguidade: o texto digitado é o nome completo de um
// único município (ou nome + UF). "Bom Jesus" (5 UFs) nunca é escolhido sozinho.
export function resolveExactMunicipality(index, rawQuery) {
  if (!index) return null
  const query = splitQuery(index, rawQuery)
  if (!query.normalized) return null
  const sameName = (text, uf) =>
    index.entries.filter((entry) => entry.key === text && (!uf || entry.uf === uf))
  let matches = query.uf ? sameName(query.text, query.uf) : []
  if (!matches.length) matches = sameName(query.normalized, null)
  return matches.length === 1 ? matches[0] : null
}
