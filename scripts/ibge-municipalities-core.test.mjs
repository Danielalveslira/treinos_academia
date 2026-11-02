import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  diffCatalogs,
  IbgeCatalogError,
  normalizeMunicipalities,
  parseSqlUpsertRows,
  renderFrontendCatalog,
  renderSqlUpsert,
  rowsFromFrontendModule,
} from './ibge-municipalities-core.mjs'
import * as frontendCatalog from '../src/data/ibgeMunicipalities.js'

const SIGLAS = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI',
  23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES',
  33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
}
const estados = Object.entries(SIGLAS).map(([id, sigla]) => ({ id: Number(id), sigla, nome: sigla }))

// Payload no formato real da API (inclusive com microrregiao null), a partir do catálogo publicado.
function apiPayload(rows = rowsFromFrontendModule(frontendCatalog)) {
  return rows.map((row) => ({
    id: row.code,
    nome: row.name,
    microrregiao:
      row.code === 5101837 ? null : { mesorregiao: { UF: { sigla: row.uf } } },
    'regiao-imediata': { 'regiao-intermediaria': { UF: { sigla: row.uf } } },
  }))
}

function problemsOf(fn) {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof IbgeCatalogError)
    return error.problems
  }
  assert.fail('esperava IbgeCatalogError')
}

test('normaliza o payload real: só código, nome e UF, ordenado, inclusive sem microrregião', () => {
  const { rows, ufs } = normalizeMunicipalities(apiPayload(), estados)
  assert.equal(rows.length, 5571)
  assert.equal(Object.keys(ufs).length, 27)
  assert.deepEqual(rows.find((row) => row.code === 5101837), {
    code: 5101837,
    name: 'Boa Esperança do Norte',
    uf: 'MT',
  })
  assert.deepEqual(Object.keys(rows[0]).sort(), ['code', 'name', 'uf'])
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].code < row.code))
})

test('recusa código duplicado, nome repetido na UF, UF divergente e código inválido', () => {
  const payload = apiPayload()
  payload.push({ ...payload[0] })
  payload.push({ id: 2412599, nome: 'São Miguel', microrregiao: null })
  payload.push({ id: 3550308, nome: 'Outra', microrregiao: { mesorregiao: { UF: { sigla: 'RJ' } } } })
  payload.push({ id: '123', nome: 'Texto' })
  const problems = problemsOf(() => normalizeMunicipalities(payload, estados))
  assert.ok(problems.some((p) => p.includes('código duplicado')))
  assert.ok(problems.some((p) => p.includes('nome repetido na mesma UF')))
  assert.ok(problems.some((p) => p.includes('difere do prefixo')))
  assert.ok(problems.some((p) => p.includes('código inválido')))
})

test('recusa resposta truncada ou estados incompletos (nunca grava catálogo parcial)', () => {
  assert.ok(problemsOf(() => normalizeMunicipalities(apiPayload().slice(0, 100), estados))
    .some((p) => p.includes('quantidade fora do esperado')))
  assert.ok(problemsOf(() => normalizeMunicipalities(apiPayload(), estados.slice(1)))
    .some((p) => p.includes('27 UFs')))
  assert.ok(problemsOf(() => normalizeMunicipalities({ erro: true }, estados)).length)
})

test('diff relata adicionados, renomeados e removidos', () => {
  const base = [{ code: 1, name: 'A', uf: 'RO' }, { code: 2, name: 'B', uf: 'RO' }]
  const next = [{ code: 1, name: 'A2', uf: 'RO' }, { code: 3, name: 'C', uf: 'RO' }]
  const diff = diffCatalogs(base, next)
  assert.deepEqual(diff.added.map((r) => r.code), [3])
  assert.deepEqual(diff.changed.map((r) => r.code), [1])
  assert.deepEqual(diff.removed.map((r) => r.code), [2])
})

test('SQL gerado é reversível (aspas escapadas) e idempotente', () => {
  const rows = [{ code: 1100015, name: "Alta Floresta D'Oeste", uf: 'RO' }]
  const sql = renderSqlUpsert({ rows }, '2026-11-01')
  assert.match(sql, /'Alta Floresta D''Oeste'/)
  assert.match(sql, /on conflict \(code\) do update/)
  assert.deepEqual(parseSqlUpsertRows(sql), rows)
  assert.throws(() => renderFrontendCatalog({ ufs: {}, rows }, 'ontem'))
})

test('catálogo do frontend e catálogo do servidor (migration) são o MESMO conjunto', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261209000001_residence_municipality.sql', import.meta.url),
    'utf8'
  )
  const server = parseSqlUpsertRows(migration)
  const client = rowsFromFrontendModule(frontendCatalog)
  assert.equal(server.length, client.length)
  assert.deepEqual(server, client)
  assert.match(migration, new RegExp(`versão ${frontendCatalog.IBGE_MUNICIPALITIES_VERSION}`))
})

test('o arquivo do frontend é exatamente o que o gerador produz (não foi editado à mão)', () => {
  const rows = rowsFromFrontendModule(frontendCatalog)
  const regenerated = renderFrontendCatalog(
    { ufs: frontendCatalog.IBGE_UFS, rows },
    frontendCatalog.IBGE_MUNICIPALITIES_VERSION
  )
  const onDisk = readFileSync(new URL('../src/data/ibgeMunicipalities.js', import.meta.url), 'utf8')
  assert.equal(onDisk, regenerated)
})
