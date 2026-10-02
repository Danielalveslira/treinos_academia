import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from '@primer/octicons-react'
import { handleSheetKeyDown, viewportStyle } from '../utils/modalSheet'

// Folha modal mobile-first (base única do "Compartilhar progresso" na Home e nas Comunidades).
//
// Por que não o <Dialog> do Primer: o app usa viewport-fit=cover e roda como PWA standalone, então um diálogo em
// tela cheia (fixed, top:0) desenhava o cabeçalho -- e o botão de fechar -- por baixo do notch/Dynamic Island, sem
// safe-area, e o rodapé ficava à mercê da barra inferior e do teclado. Aqui a estrutura é fixa e independente do
// conteúdo:
//   [ cabeçalho: título à esquerda · X (44x44) à direita ]  <- fora da área rolável, com safe-area superior
//   [ corpo rolável (min-height: 0)                      ]  <- só ele rola
//   [ rodapé/CTA                                         ]  <- fora da área rolável, com safe-area inferior
// Altura = viewport VISUAL (VisualViewport) quando disponível -- com o teclado aberto a folha encolhe e o rodapé
// continua acima do teclado; sem a API, 100dvh via CSS.

// Marcação pura (sem portal/efeitos): é o que os testes renderizam.
export function ModalSheetFrame({ titleId, title, subtitle, onClose, footer, children }) {
  return (
    <div
      className="modal-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-modal-sheet
    >
      <header className="modal-sheet-header">
        <div className="modal-sheet-heading">
          <h2 id={titleId} className="modal-sheet-title">
            {title}
          </h2>
          {subtitle && <p className="modal-sheet-subtitle">{subtitle}</p>}
        </div>
        <button type="button" className="modal-sheet-close" aria-label="Fechar" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </header>
      <div className="modal-sheet-body">{children}</div>
      {footer && <footer className="modal-sheet-footer">{footer}</footer>}
    </div>
  )
}

export function ModalSheet({ onClose, children }) {
  const rootRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const previousFocus = document.activeElement
    document.body.classList.add('modal-sheet-open')
    // Foco dentro da folha sem abrir o teclado: no próprio container (nunca no textarea).
    root.querySelector('[data-modal-sheet]')?.focus({ preventScroll: true })

    const onKeyDown = (event) => handleSheetKeyDown(event, root, () => onCloseRef.current?.())
    document.addEventListener('keydown', onKeyDown)

    const viewport = window.visualViewport
    const syncViewport = () => {
      const style = viewportStyle(viewport)
      if (!style) return
      for (const [name, value] of Object.entries(style)) root.style.setProperty(name, value)
    }
    syncViewport()
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)

    // Campo focado nunca fica atrás do teclado: rola o corpo até ele depois do teclado abrir.
    const onFocusIn = (event) => {
      if (event.target?.matches?.('textarea, input')) {
        window.setTimeout(
          () => event.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }),
          250
        )
      }
    }
    root.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      root.removeEventListener('focusin', onFocusIn)
      document.body.classList.remove('modal-sheet-open')
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  // Clique no fundo (só aparece no desktop; no celular a folha ocupa tudo) fecha.
  const onBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) onCloseRef.current?.()
  }

  return createPortal(
    <div ref={rootRef} className="modal-sheet-backdrop" onMouseDown={onBackdropMouseDown}>
      {children}
    </div>,
    document.body
  )
}
