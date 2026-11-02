import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as catalog from '../data/ibgeMunicipalities.js'
import {
  buildMunicipalityIndex,
  findMunicipality,
  formatMunicipality,
  isMunicipalityCodeFormat,
  normalizeSearchText,
  resolveExactMunicipality,
  searchMunicipalities,
} from './municipalities.js'
import { createMunicipalityCatalogLoader } from '../services/municipalityCatalog.js'
import { validateEmail, validateResidenceMunicipality, validateSexo } from './validators.js'
import {
  describeRegistrationError,
  NETWORK_ERROR_MESSAGE,
  residenceCitySaveErrorText,
} from './registrationErrors.js'

const index = buildMunicipalityIndex(catalog)
const labels = (query, options) => searchMunicipalities(index, query, options).map(formatMunicipality)

test('catálogo oficial: 5.571 municípios, 27 UFs, códigos únicos de 7 dígitos', () => {
  assert.equal(index.entries.length, 5571)
  assert.equal(catalog.IBGE_MUNICIPALITIES_COUNT, 5571)
  assert.equal(new Set(index.entries.map((e) => e.uf)).size, 27)
  assert.equal(index.byCode.size, 5571)
  assert.ok(index.entries.every((e) => isMunicipalityCodeFormat(e.code)))
  assert.match(catalog.IBGE_MUNICIPALITIES_VERSION, /^\d{4}-\d{2}-\d{2}$/)
})

test('normalização: sem acento, minúsculas, sem apóstrofo, pontuação vira espaço', () => {
  assert.equal(normalizeSearchText("  São  Miguel D'Oeste "), 'sao miguel doeste')
  assert.equal(normalizeSearchText('Olho-d’Água'), 'olho dagua')
  assert.equal(normalizeSearchText(null), '')
})

test('busca sem distinção de maiúsculas e acentos', () => {
  assert.deepEqual(labels('SAO PAULO').slice(0, 1), ['São Paulo — SP'])
  assert.deepEqual(labels('brasilia').slice(0, 1), ['Brasília — DF'])
  assert.deepEqual(labels('alta floresta d oeste'), ["Alta Floresta D'Oeste — RO"])
})

test('nome exato primeiro, depois quem começa com o texto; exemplo do São Miguel', () => {
  const results = labels('São Miguel')
  assert.equal(results[0], 'São Miguel — RN')
  assert.ok(results.length <= 8, 'sugestões limitadas')
  assert.deepEqual(labels('sao miguel rn'), ['São Miguel — RN', 'São Miguel do Gostoso — RN'])
  assert.deepEqual(labels('São Miguel - RN'), labels('sao miguel/rn'))
})

test('homônimos aparecem um por UF e só são resolvidos com a UF', () => {
  const bomJesus = labels('bom jesus').filter((label) => label.startsWith('Bom Jesus —'))
  assert.deepEqual(bomJesus, [
    'Bom Jesus — PB',
    'Bom Jesus — PI',
    'Bom Jesus — RN',
    'Bom Jesus — RS',
    'Bom Jesus — SC',
  ])
  assert.equal(resolveExactMunicipality(index, 'Bom Jesus'), null, 'ambíguo: nunca escolhido sozinho')
  assert.equal(resolveExactMunicipality(index, 'bom jesus pi').code, 2201903)
  assert.equal(resolveExactMunicipality(index, 'São Miguel').code, 2412500)
  assert.equal(resolveExactMunicipality(index, 'Cidade Que Não Existe'), null)
})

test('consultas curtas e inexistentes não geram ruído', () => {
  assert.deepEqual(labels('s'), [])
  assert.ok(labels('sp').every((label) => /(^| )sp/i.test(normalizeSearchText(label))))
  assert.deepEqual(labels('xyzxyz'), [])
})

test('findMunicipality aceita só códigos do catálogo', () => {
  assert.equal(formatMunicipality(findMunicipality(index, 2412559)), 'São Miguel do Gostoso — RN')
  assert.equal(findMunicipality(index, 1234567), null)
  assert.equal(findMunicipality(index, null), null)
  assert.equal(findMunicipality(null, 2412559), null)
})

test('loader do catálogo: um import por sessão e nova tentativa após falha', async () => {
  let calls = 0
  let fail = true
  const loader = createMunicipalityCatalogLoader(async () => {
    calls += 1
    if (fail) throw new Error('Failed to fetch dynamically imported module')
    return catalog
  })
  await assert.rejects(loader.load())
  assert.equal(loader.peek(), null)
  fail = false
  const [a, b] = await Promise.all([loader.load(), loader.load()])
  assert.equal(a, b)
  await loader.load()
  assert.equal(calls, 2, 'falha não memorizada; sucesso memorizado')
  assert.equal(loader.peek().entries.length, 5571)
})

test('validadores: e-mail e cidade', () => {
  assert.deepEqual(validateEmail('maria@exemplo.com'), {})
  assert.ok(validateEmail('').email)
  assert.ok(validateEmail('maria@exemplo').email)
  assert.ok(validateEmail('maria exemplo.com').email)
  assert.deepEqual(validateResidenceMunicipality(2412500), {})
  for (const invalid of [null, undefined, '2412500', 99, 99999999, 1.5])
    assert.ok(validateResidenceMunicipality(invalid).city, String(invalid))
})

test('erros do cadastro apontam o campo e a mensagem específica', () => {
  assert.deepEqual(describeRegistrationError(new Error('USERNAME_TAKEN')).field, 'username')
  assert.deepEqual(describeRegistrationError(new Error('INVALID_MUNICIPALITY')).field, 'city')
  assert.equal(
    describeRegistrationError(new TypeError('Failed to fetch')).message,
    NETWORK_ERROR_MESSAGE
  )
  const retryable = Object.assign(new Error('x'), { name: 'AuthRetryableFetchError' })
  assert.equal(describeRegistrationError(retryable).message, NETWORK_ERROR_MESSAGE)
  assert.match(describeRegistrationError({ code: 'weak_password' }).message, /8 caracteres/)
  assert.match(describeRegistrationError(new Error('PERMISSION_DENIED')).message, /acesso/)
  assert.match(residenceCitySaveErrorText(new Error('boom')), /anterior foi mantida/)
  assert.match(residenceCitySaveErrorText(new Error('INVALID_MUNICIPALITY')), /lista/)
})

test('validateSexo: obrigatório no cadastro ("Não informar" vale), opcional para contas antigas', () => {
  for (const value of ['', null, undefined, 'outro'])
    assert.equal(validateSexo(value, { required: true }).sexo, 'Selecione uma opção para Sexo')
  for (const value of ['nao_informar', 'masculino', 'feminino'])
    assert.deepEqual(validateSexo(value, { required: true }), {})
  assert.deepEqual(validateSexo(null), {}, 'sem required: ausência aceita (contas antigas)')
  assert.deepEqual(validateSexo(''), {})
  assert.equal(validateSexo('outro').sexo, 'Opção inválida')
  assert.equal(describeRegistrationError(new Error('INVALID_SEXO')).field, 'sexo')
})
