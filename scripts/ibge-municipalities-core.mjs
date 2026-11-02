// Núcleo puro (sem rede, sem disco) do catálogo de municípios do IBGE -- usado por
// scripts/update-ibge-municipalities.mjs e testado em ibge-municipalities-core.test.mjs.
//
// Fonte oficial: API de Localidades do IBGE (https://servicodados.ibge.gov.br/api/docs/localidades)
//   /api/v1/localidades/estados     -> 27 UFs ({ id, sigla, nome, regiao })
//   /api/v1/localidades/municipios  -> ~5.571 municípios ({ id, nome, microrregiao, regiao-imediata })
//
// Do payload só guardamos o necessário: código IBGE (7 dígitos), nome e sigla da UF. A UF é
// derivada dos 2 primeiros dígitos do código (é assim que o IBGE monta o código municipal) e
// conferida contra a UF aninhada na resposta quando ela existe. `microrregiao` pode vir null
// (ex.: Boa Esperança do Norte/MT, 5101837, criado em 2024) -- por isso a conferência também
// tenta `regiao-imediata` e nunca exige nenhuma das duas.

export const MIN_EXPECTED_MUNICIPALITIES = 5500
export const MAX_EXPECTED_MUNICIPALITIES = 6000
export const EXPECTED_UF_COUNT = 27
// Uma atualização normal do IBGE cria/renomeia poucos municípios por ano. Uma remoção em massa
// indica resposta truncada/errada -- o script recusa a troca sem --allow-removals.
export const MAX_REMOVALS_WITHOUT_FLAG = 0

export class IbgeCatalogError extends Error {
  constructor(problems) {
    super(`Catálogo do IBGE inválido:\n- ${problems.slice(0, 20).join('\n- ')}`)
    this.name = 'IbgeCatalogError'
    this.problems = problems
  }
}

// Mesma normalização usada na busca do app (src/utils/municipalities.js): sem acento, minúsculas,
// sem apóstrofo. Aqui só serve para detectar nomes repetidos dentro da mesma UF.
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function nestedUf(municipio) {
  return (
    municipio?.microrregiao?.mesorregiao?.UF?.sigla ??
    municipio?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla ??
    null
  )
}

export function normalizeStates(estados) {
  const problems = []
  if (!Array.isArray(estados)) throw new IbgeCatalogError(['resposta de estados não é uma lista'])
  const ufs = {}
  const siglas = new Set()
  for (const estado of estados) {
    const id = Number(estado?.id)
    const sigla = estado?.sigla
    if (!Number.isInteger(id) || id < 11 || id > 53) problems.push(`UF com id inválido: ${estado?.id}`)
    else if (typeof sigla !== 'string' || !/^[A-Z]{2}$/.test(sigla))
      problems.push(`UF ${id} com sigla inválida: ${sigla}`)
    else if (ufs[id] || siglas.has(sigla)) problems.push(`UF duplicada: ${id}/${sigla}`)
    else {
      ufs[id] = sigla
      siglas.add(sigla)
    }
  }
  if (Object.keys(ufs).length !== EXPECTED_UF_COUNT)
    problems.push(`esperadas ${EXPECTED_UF_COUNT} UFs, recebidas ${Object.keys(ufs).length}`)
  if (problems.length) throw new IbgeCatalogError(problems)
  return ufs
}

// Devolve { ufs: { '11': 'RO', ... }, rows: [{ code, name, uf }] } ordenado por código, ou lança
// IbgeCatalogError com TODOS os problemas encontrados (nunca um catálogo parcialmente válido).
export function normalizeMunicipalities(municipios, estados) {
  const ufs = normalizeStates(estados)
  const problems = []
  if (!Array.isArray(municipios))
    throw new IbgeCatalogError(['resposta de municípios não é uma lista'])
  if (
    municipios.length < MIN_EXPECTED_MUNICIPALITIES ||
    municipios.length > MAX_EXPECTED_MUNICIPALITIES
  )
    problems.push(
      `quantidade fora do esperado (${municipios.length}; esperado entre ${MIN_EXPECTED_MUNICIPALITIES} e ${MAX_EXPECTED_MUNICIPALITIES})`
    )

  const byCode = new Map()
  const byName = new Map()
  for (const municipio of municipios) {
    const code = municipio?.id
    const name = typeof municipio?.nome === 'string' ? municipio.nome.trim().replace(/\s+/g, ' ') : ''
    if (!Number.isInteger(code) || code < 1100000 || code > 5399999) {
      problems.push(`código inválido: ${JSON.stringify(code)}`)
      continue
    }
    const uf = ufs[Math.floor(code / 100000)]
    if (!uf) {
      problems.push(`${code}: prefixo de UF desconhecido`)
      continue
    }
    if (!name || name.length > 100 || [...name].some((ch) => ch.charCodeAt(0) < 32 || ch === '<' || ch === '>')) {
      problems.push(`${code}: nome inválido (${JSON.stringify(municipio?.nome)})`)
      continue
    }
    const declared = nestedUf(municipio)
    if (declared && declared !== uf) {
      problems.push(`${code} ${name}: UF aninhada ${declared} difere do prefixo (${uf})`)
      continue
    }
    if (byCode.has(code)) {
      problems.push(`${code}: código duplicado`)
      continue
    }
    const nameKey = `${uf}:${normalizeName(name)}`
    if (byName.has(nameKey)) {
      problems.push(`${name}/${uf}: nome repetido na mesma UF (${byName.get(nameKey)} e ${code})`)
      continue
    }
    byCode.set(code, { code, name, uf })
    byName.set(nameKey, code)
  }
  const presentUfs = new Set([...byCode.values()].map((row) => row.uf))
  for (const sigla of Object.values(ufs))
    if (!presentUfs.has(sigla)) problems.push(`nenhum município para a UF ${sigla}`)
  if (problems.length) throw new IbgeCatalogError(problems)

  const rows = [...byCode.values()].sort((a, b) => a.code - b.code)
  return { ufs, rows }
}

// Diferença entre o catálogo publicado e o novo -- removidos bloqueiam a troca (ver
// MAX_REMOVALS_WITHOUT_FLAG); renomeados/adicionados só são relatados.
export function diffCatalogs(previousRows, nextRows) {
  const previous = new Map(previousRows.map((row) => [row.code, row]))
  const next = new Map(nextRows.map((row) => [row.code, row]))
  const added = nextRows.filter((row) => !previous.has(row.code))
  const removed = previousRows.filter((row) => !next.has(row.code))
  const changed = nextRows.filter((row) => {
    const old = previous.get(row.code)
    return old && (old.name !== row.name || old.uf !== row.uf)
  })
  return { added, removed, changed }
}

// ---------------------------------------------------------------------------------------------
// Saída do frontend: módulo JS (não .json) para ser importável tanto pelo Vite (chunk sob demanda
// via import() dinâmico) quanto pelo Node nos testes, sem import attributes.
// ---------------------------------------------------------------------------------------------
export function renderFrontendCatalog({ ufs, rows }, version) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) throw new Error('INVALID_VERSION')
  const lines = rows.map((row) => `  [${row.code},${JSON.stringify(row.name)}],`)
  return [
    '// GERADO por scripts/update-ibge-municipalities.mjs -- não editar à mão.',
    '// Fonte: API de Localidades do IBGE (servicodados.ibge.gov.br/api/v1/localidades).',
    '// Cada linha: [código IBGE, nome]. A UF sai dos 2 primeiros dígitos do código (IBGE_UFS).',
    '// Carregado só sob demanda (import() dinâmico em src/services/municipalityCatalog.js).',
    `export const IBGE_MUNICIPALITIES_VERSION = ${JSON.stringify(version)}`,
    `export const IBGE_MUNICIPALITIES_COUNT = ${rows.length}`,
    `export const IBGE_UFS = ${JSON.stringify(ufs)}`,
    'export const IBGE_MUNICIPALITIES = [',
    ...lines,
    ']',
    '',
  ].join('\n')
}

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

// Upsert idempotente do catálogo do servidor (public.ibge_municipalities). Nunca apaga: códigos
// já referenciados por public.users ficam protegidos pela FK (on delete restrict) e uma remoção
// real do IBGE exige revisão manual (ver docs/CADASTRO_CIDADE_IBGE.md).
export function renderSqlUpsert({ rows }, version) {
  const values = rows.map((row) => `  (${row.code}, ${sqlText(row.name)}, ${sqlText(row.uf)})`)
  return [
    `-- Catálogo IBGE versão ${version}: ${rows.length} municípios. Gerado por scripts/update-ibge-municipalities.mjs.`,
    'insert into public.ibge_municipalities (code, name, uf) values',
    values.join(',\n'),
    'on conflict (code) do update',
    '  set name = excluded.name, uf = excluded.uf',
    '  where (public.ibge_municipalities.name, public.ibge_municipalities.uf)',
    '    is distinct from (excluded.name, excluded.uf);',
    '',
  ].join('\n')
}

// Lê de volta as linhas de um SQL gerado por renderSqlUpsert (usado para conferir que o catálogo
// do servidor e o do frontend são o mesmo conjunto -- ver o teste de consistência).
export function parseSqlUpsertRows(sql) {
  const rows = []
  const pattern = /^\s*\((\d{7}), '((?:[^']|'')*)', '([A-Z]{2})'\),?$/gm
  for (const match of sql.matchAll(pattern))
    rows.push({ code: Number(match[1]), name: match[2].replace(/''/g, "'"), uf: match[3] })
  return rows
}

export function rowsFromFrontendModule(module) {
  return module.IBGE_MUNICIPALITIES.map(([code, name]) => ({
    code,
    name,
    uf: module.IBGE_UFS[Math.floor(code / 100000)],
  }))
}
