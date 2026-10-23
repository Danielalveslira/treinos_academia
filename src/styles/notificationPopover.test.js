// Contrato do CSS mobile do sino. A geometria real (320/360/390/430px) é verificada em Chromium;
// aqui travamos as regras que a garantem para ninguém reintroduzir o popover em tela cheia ou
// atrás da navegação inferior.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('./app.css', import.meta.url), 'utf8')
const navigationCss = await readFile(new URL('./navigation.css', import.meta.url), 'utf8')

// Há vários blocos `@media (max-width: 767px)` no arquivo: devolve o que contém o popover.
function mediaBlock(query, mustContain = '.notification-popover {') {
  const header = `@media (${query}) {`
  let from = 0
  for (;;) {
    const start = css.indexOf(header, from)
    assert.notEqual(start, -1, `@media (${query}) com ${mustContain}`)
    let depth = 0
    let end = css.indexOf('{', start)
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1
      if (css[end] === '}') depth -= 1
      if (depth === 0) break
    }
    const block = css.slice(start, end + 1)
    if (block.includes(mustContain)) return block
    from = end
  }
}

function rule(block, selector) {
  const match = block.match(new RegExp(`\\n  ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))
  assert.ok(match, `regra ${selector} no bloco mobile`)
  return match[1]
}

test('mobile (<=767px): card flutuante compacto abaixo do header, nunca em tela cheia', () => {
  const mobile = mediaBlock('max-width: 767px')
  const popover = rule(mobile, '.notification-popover')
  assert.match(popover, /position: absolute/)
  assert.match(popover, /top: calc\(100% \+ 8px\)/)
  assert.match(popover, /width: min\(calc\(100vw - 24px\), 420px\)/)
  assert.match(popover, /68dvh/)
})

test('mobile: a altura reserva a navegação inferior e a safe-area (nunca fica atrás dela)', () => {
  const popover = rule(mediaBlock('max-width: 767px'), '.notification-popover')
  assert.match(popover, /var\(--bottom-navigation-space/)
  assert.match(popover, /env\(safe-area-inset-top/)
  // a variável usada inclui safe-area-inset-bottom
  assert.match(navigationCss, /--bottom-navigation-space: calc\(76px \+ env\(safe-area-inset-bottom\)\)/)
})

test('só a lista rola: título/abas fixos e lista com scroll interno', () => {
  const base = css.slice(css.indexOf('.notification-popover {'))
  assert.match(base.slice(0, 400), /display: flex/)
  assert.match(base.slice(0, 400), /flex-direction: column/)
  assert.match(base.slice(0, 400), /overflow: hidden/)
  const list = css.slice(css.indexOf('.notification-list {'), css.indexOf('.notification-item {'))
  assert.match(list, /overflow-y: auto/)
  assert.match(list, /min-height: 0/)
  const mobile = mediaBlock('max-width: 767px')
  assert.match(rule(mobile, '.notification-header'), /flex: 0 0 auto/)
  assert.match(rule(mobile, '.notification-filter'), /flex: 0 0 auto/)
})

test('itens compactos com boa área de toque e não lida sutil (faixa fina, nunca um fundo cheio)', () => {
  const mobile = mediaBlock('max-width: 767px')
  const item = rule(mobile, '.notification-item')
  assert.match(item, /min-height: 44px/)
  assert.match(item, /padding: 7px 8px/)
  assert.match(rule(mobile, '.notification-icon'), /width: 18px/)
  const unreadMatch = css.match(/\n\.notification-item\.is-unread \{([^}]*)\}/)
  assert.ok(unreadMatch, 'regra .notification-item.is-unread')
  assert.match(unreadMatch[1], /box-shadow: inset 3px 0 0 var\(--borderColor-accent-emphasis\)/)
  assert.doesNotMatch(unreadMatch[1], /background/)
})
