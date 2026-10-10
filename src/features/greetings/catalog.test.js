import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATALOG_VERSION,
  CATEGORIES,
  DAILY_CATEGORIES,
  MESSAGES,
  VOICES,
  getPool,
} from './catalog.js'
import { formatGreetingText } from './format.js'

const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim()
const MAX_HEADING = 95
const EMOJI = /\p{Extended_Pictographic}/gu

// Lint editorial: termos que não pertencem ao tom "parceiro de treino". Lista de apoio à revisão humana, não
// substitui a leitura do texto.
const FORBIDDEN = [
  /gord[oa]/i,
  /magr[oa]/i,
  /emagrec/i,
  /barriga/i,
  /\bpeso\b/i,
  /calori/i,
  /dieta/i,
  /culpa/i,
  /vergonha/i,
  /fracass/i,
  /desist/i,
  /atrasad/i,
  /perd(eu|er|ido)/i,
  /preguiços/i,
  /vagabund/i,
  /sedentári/i,
  /bronca/i,
  /castigo/i,
  /puni[çc]/i,
  /sem desculpa/i,
  /última chance/i,
  /milagr/i,
  /garantid/i,
  /sofrimento/i,
  /sem dor/i,
]
// Palavras que flexionam em gênero PARA A PESSOA (não vale "plano pronto"/"série pronta": o adjetivo é de
// outra coisa) e não podem aparecer nas frases neutras.
const GENDERED =
  /(?<!\p{L})(bem-vind[oa]|campe(ã|ão|a)|guerreir[oa]|parceir[oa]|orgulhos[oa]|motivad[oa]|animad[oa]|descansad[oa]|dispost[oa]|novat[oa])(?!\p{L})/iu

test('versão do catálogo e vozes/categorias esperadas', () => {
  assert.equal(CATALOG_VERSION, 1)
  assert.deepEqual(VOICES, ['masculino', 'feminino', 'neutro'])
  assert.equal(DAILY_CATEGORIES.length, 9)
  assert.equal(CATEGORIES.length, 10)
})

test('IDs únicos, imutáveis no formato e campos válidos', () => {
  const ids = new Set()
  for (const message of MESSAGES) {
    assert.match(message.id, /^[a-z_]+\.(neutro|masc|fem)\.\d{3}$/)
    assert.ok(!ids.has(message.id), `ID duplicado: ${message.id}`)
    ids.add(message.id)
    assert.ok(CATEGORIES.includes(message.category), message.id)
    assert.ok(VOICES.includes(message.voice), message.id)
    assert.ok(message.text.trim().length > 0, message.id)
    assert.ok(message.eyebrow.length > 0, message.id)
    assert.equal(message.enabled, true)
  }
})

test('cobertura mínima: 12 neutras + 4 masculinas + 4 femininas por categoria diária; 10/10/10 de boas-vindas', () => {
  const count = (category, voice) =>
    MESSAGES.filter((message) => message.category === category && message.voice === voice).length
  for (const category of DAILY_CATEGORIES) {
    assert.equal(count(category, 'neutro'), 12, `${category} neutro`)
    assert.equal(count(category, 'masculino'), 4, `${category} masculino`)
    assert.equal(count(category, 'feminino'), 4, `${category} feminino`)
  }
  for (const voice of VOICES) assert.equal(count('welcome', voice), 10, `welcome ${voice}`)
  assert.equal(MESSAGES.length, 210)
})

test('pool efetiva das categorias diárias tem >= 12 frases em qualquer voz, sem IDs repetidos', () => {
  for (const category of DAILY_CATEGORIES) {
    for (const voice of VOICES) {
      const pool = getPool(category, voice)
      assert.ok(pool.length >= 12, `${category}/${voice}: ${pool.length}`)
      assert.equal(new Set(pool.map((message) => message.id)).size, pool.length)
    }
  }
  assert.equal(getPool('rest', 'masculino').length, 16)
  assert.equal(getPool('rest', 'neutro').length, 12)
})

test('a pool de uma voz só mistura frases dela com as neutras', () => {
  for (const category of CATEGORIES) {
    for (const voice of ['masculino', 'feminino']) {
      for (const message of getPool(category, voice))
        assert.ok(['neutro', voice].includes(message.voice), message.id)
    }
    for (const message of getPool(category, 'neutro')) assert.equal(message.voice, 'neutro')
  }
})

test('nenhuma frase duplicada (nem entre categorias) após normalizar caixa e espaços', () => {
  const seen = new Map()
  for (const message of MESSAGES) {
    const key = normalize(message.text)
    assert.ok(!seen.has(key), `${message.id} repete ${seen.get(key)}`)
    seen.set(key, message.id)
  }
})

test('template {nome} bem formado: só o marcador {nome}, sem chaves soltas', () => {
  for (const message of MESSAGES) {
    const without = message.text.split('{nome}').join('')
    assert.ok(!/[{}]/.test(without), `${message.id}: chave solta`)
  }
})

test('no máximo um emoji por frase e nenhuma quebra de linha ou HTML', () => {
  for (const message of MESSAGES) {
    assert.ok((message.text.match(EMOJI) ?? []).length <= 1, message.id)
    assert.ok(!/[\n\r<>]/.test(message.text), message.id)
  }
})

test('comprimento: até ~95 caracteres mesmo com um nome de 20 caracteres', () => {
  for (const message of MESSAGES) {
    const heading = formatGreetingText(message.text, 'N'.repeat(20))
    assert.ok(heading.length <= MAX_HEADING, `${message.id} (${heading.length}): ${heading}`)
  }
})

test('lint editorial: sem culpa, pressão, corpo/peso ou promessas de resultado', () => {
  for (const message of MESSAGES)
    for (const pattern of FORBIDDEN)
      assert.doesNotMatch(message.text, pattern, `${message.id} contém ${pattern}`)
})

test('frases neutras não carregam marcação de gênero', () => {
  for (const message of MESSAGES.filter((item) => item.voice === 'neutro'))
    assert.doesNotMatch(message.text, GENDERED, message.id)
})

test('masculinas e femininas usam o gênero correspondente quando há flexão', () => {
  const feminineMarks =
    /(?<!\p{L})(bem-vinda|campeã|guerreira|parceira|orgulhosa|tranquila|motivada|animada|curiosa|descansada|disposta|pronta)(?!\p{L})/iu
  const masculineMarks =
    /(?<!\p{L})(bem-vindo|campeão|guerreiro|parceiro|orgulhoso|tranquilo|motivado|animado|curioso|descansado|disposto|pronto)(?!\p{L})/iu
  // Adjetivos que concordam com outra coisa (consciência, treino, plano), não com a pessoa.
  const ofPerson = (message) =>
    message.text.replace(/consciência tranquila|treino está pronto|plano pronto|prontinho/gi, '')
  for (const message of MESSAGES.filter((item) => item.voice === 'masculino'))
    assert.doesNotMatch(ofPerson(message), feminineMarks, message.id)
  for (const message of MESSAGES.filter((item) => item.voice === 'feminino'))
    assert.doesNotMatch(ofPerson(message), masculineMarks, message.id)
})

test('boas-vindas só aparecem na categoria welcome e têm eyebrow próprio', () => {
  for (const message of MESSAGES)
    assert.equal(message.eyebrow === 'BOAS-VINDAS AO EVOLUTUS', message.category === 'welcome')
})
