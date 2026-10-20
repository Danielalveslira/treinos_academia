import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Migração de domínio (treinosacademia-ten.vercel.app -> evolutus.com.br): o alias antigo é
// um domínio vercel.app fora do nosso DNS, então o redirect 301 só pode ser expresso aqui,
// em vercel.json, condicionado ao Host da requisição (sintaxe `has: [{type:"host",...}]`
// confirmada em vercel.com/docs/project-configuration/vercel-json#redirects). Este teste NÃO
// valida o roteamento real da Vercel (não há como, fora de um deploy) -- só prova que a regex
// que escrevi em `source` classifica os paths como eu pretendia: navegação (redireciona) vs.
// arquivo estático em uso por uma aba já aberta no domínio antigo (nunca redireciona, para não
// quebrar um import() same-origin em voo -- ver relatório). A MESMA regra de classificação já
// existe no rewrite do SPA (abaixo), não é nova.
const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
const redirect = config.redirects.find((r) => r.destination.includes('evolutus.com.br'))

function sourceRegex(source) {
  const match = source.match(/^\/:path\((.*)\)$/)
  assert.ok(match, `source não está no formato /:path(...) esperado: ${source}`)
  return new RegExp(`^${match[1]}$`)
}

test('existe exatamente um redirect para o domínio novo, condicionado ao Host antigo, 301', () => {
  assert.ok(redirect, 'nenhum redirect para evolutus.com.br encontrado em vercel.json')
  assert.deepEqual(redirect.has, [{ type: 'host', value: 'treinosacademia-ten.vercel.app' }])
  assert.equal(redirect.statusCode, 301)
  assert.equal(redirect.destination, 'https://www.evolutus.com.br/:path*')
})

test('a condição `has` de Host nunca permite o redirect no domínio novo (sem loop) -- é a única porta de entrada da regra', () => {
  // A própria Vercel só aplica a regra quando o Host da requisição bate com `has`; uma
  // requisição ao domínio novo nunca chega com Host=treinosacademia-ten.vercel.app, então a
  // regra nunca a alcança. Aqui só confirmamos que a regra DEPENDE desse `has` (não existe
  // nenhum caminho dela se aplicar sem ele).
  assert.equal(redirect.has.length, 1)
  assert.equal(redirect.has[0].type, 'host')
  assert.notEqual(redirect.has[0].value, 'evolutus.com.br')
})

test('paths de navegação (os mesmos que o rewrite do SPA aceita) são redirecionados', () => {
  const regex = sourceRegex(redirect.source)
  for (const path of ['', 'perfil', 'evocash', 'admin/compras-evocash', 'comunidades/123']) {
    assert.ok(regex.test(path), `"${path}" deveria casar com a regra de redirect`)
  }
})

test('assets e arquivos estáticos em uso por uma aba já aberta NUNCA são redirecionados (evita quebrar import() same-origin em voo)', () => {
  const regex = sourceRegex(redirect.source)
  for (const path of [
    'assets/Admin-x1y2z3.js', 'assets/index-abc.css', 'icons/icon-192.png',
    'manifest.webmanifest', 'sw.js', 'boot-theme.js', 'boot-fallback.js', 'img/capa.avif',
  ]) {
    assert.ok(!regex.test(path), `"${path}" NÃO deveria casar com a regra de redirect`)
  }
})

test('fallback do app só cobre rotas conhecidas; páginas públicas ausentes ficam com 404', () => {
  const rewrite = config.rewrites.find((r) => r.destination === '/app-shell.html')
  const regex = sourceRegex(rewrite.source)
  for (const path of ['app', 'login', 'admin/parcerias', 'comunidades/123', 'exercicios/123'])
    assert.ok(regex.test(path), `${path} deve chegar ao app`)
  for (const path of ['pagina-inexistente', 'vitrine/produto-removido', 'assets/x.js'])
    assert.ok(!regex.test(path), `${path} deve retornar 404`)
})
