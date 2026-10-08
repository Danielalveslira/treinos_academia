import { Component, Suspense } from 'react'

// Diálogos carregados sob demanda: se o chunk não puder ser baixado (offline sem cache, deploy novo), fecha o
// diálogo em vez de derrubar a Home com a tela de erro global. Enquanto carrega, não mostra nada (sem spinner
// que "pisca" -- o chunk já costuma estar pré-aquecido pelo idle da Home).
class DialogErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[LazyDialog]', error)
    this.props.onFail?.()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function LazyDialogBoundary({ onFail, fallback = null, children }) {
  return (
    <DialogErrorBoundary onFail={onFail}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </DialogErrorBoundary>
  )
}
