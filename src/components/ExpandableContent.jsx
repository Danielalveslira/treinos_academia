import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@primer/octicons-react'
import { planCollapse } from '../utils/collapseSnap'
import { observeSize } from '../utils/sizeObserver'
import './ExpandableContent.css'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// Pontos onde é seguro cortar: o fim de cada bloco do markdown (exceto títulos), de cada LINHA de tabela e
// de cada item de lista de primeiro nível (blocos que o markdown rendeiza como filhos diretos do contêiner).
function collectCutPoints(root, top) {
  const points = []
  for (const block of root?.children ?? []) {
    const bottom = (element) => element.getBoundingClientRect().bottom - top
    if (block.matches('[role="region"]')) {
      block.querySelectorAll('tr').forEach((row) => points.push(bottom(row)))
    } else if (block.matches('ul, ol')) {
      block.querySelectorAll(':scope > li').forEach((item) => points.push(bottom(item)))
    }
    // Um título nunca encerra o recorte (ficaria órfão, sem o conteúdo dele logo abaixo).
    if (!/^H[1-6]$/.test(block.tagName)) points.push(bottom(block))
  }
  return points
}

// Conteúdo extenso dentro do próprio card: pequeno e médio aparecem inteiros; só o realmente extenso
// recolhe, numa altura generosa (utils/collapseSnap.js) encaixada em fronteira de bloco/linha/item e com
// "Ver mais"/"Ver menos". Sem barra de rolagem vertical interna (overflow: hidden só quando recolhido).
// A medição só roda para conteúdo candidato (o chamador decide via `enabled`) e reage a mudança de
// tamanho por um ResizeObserver compartilhado (giro de tela, chunk de markdown que chega, card que sai do
// content-visibility).
// `renderFull` (opcional): `children` é só uma PRÉVIA do conteúdo (ver utils/markdownPreview.js); ao expandir, o
// conteúdo completo é renderizado por esta função. Nesse modo o botão aparece sempre, pois sabemos que há mais.
export function ExpandableContent({ children, renderFull = null }) {
  const partial = typeof renderFull === 'function'
  const bodyId = useId()
  const wrapperRef = useRef(null)
  const bodyRef = useRef(null)
  const innerRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  // null = o conteúdo cabe inteiro; número = altura (px) do recorte encaixado
  const [collapsedHeight, setCollapsedHeight] = useState(null)

  const measure = useCallback(() => {
    const inner = innerRef.current
    if (!inner) return
    const natural = inner.offsetHeight
    // 0 = ainda não desenhado (conteúdo fora da tela pulado pelo navegador): mede quando ele aparecer.
    if (natural === 0) return
    // Os pontos de corte são medidos a partir do topo do RECORTE (o corpo), que é de onde max-height conta.
    const top = (bodyRef.current ?? inner).getBoundingClientRect().top
    const points = collectCutPoints(inner.firstElementChild, top)
    setCollapsedHeight(planCollapse(natural, points, window.innerWidth))
  }, [])

  useIsomorphicLayoutEffect(() => {
    measure()
    return observeSize(innerRef.current, measure)
  }, [measure])

  const isCollapsible = partial || collapsedHeight !== null
  const collapsed = collapsedHeight !== null && !expanded

  function toggle() {
    if (!expanded) {
      setExpanded(true)
      return
    }
    setExpanded(false)
    // Ao recolher um texto longo, o topo do card pode ter ficado para cima da tela: traz de volta.
    const card = wrapperRef.current?.closest('.status-card, .comment-publication-summary')
    if (card && card.getBoundingClientRect().top < 0) {
      window.requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }))
    }
  }

  return (
    <div ref={wrapperRef} className={`expandable${collapsed ? ' is-collapsed' : ''}`}>
      <div
        ref={bodyRef}
        id={bodyId}
        className="expandable-body"
        style={collapsed ? { maxHeight: collapsedHeight } : undefined}
      >
        <div ref={innerRef}>{partial && expanded ? renderFull() : children}</div>
      </div>
      {isCollapsible && (
        <button
          type="button"
          className="expandable-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={toggle}
        >
          {expanded ? 'Ver menos' : 'Ver mais'}
          {expanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
        </button>
      )}
    </div>
  )
}
