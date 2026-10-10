import { useEffect } from 'react'
import { Heading } from '@primer/react'

// Cabeçalho da Home. Texto puro (nunca HTML) e SEM aria-live: a frase pode mudar à meia-noite ou ao trocar de
// período e isso não deve interromper um leitor de tela. `onShown` só dispara com a frase de boas-vindas
// realmente montada E a aba visível -- é o que autoriza o ACK (nada de confirmar o que ninguém viu).
export function DashboardGreeting({ greeting, onShown, dynamic = true }) {
  const isWelcome = greeting.isWelcome

  useEffect(() => {
    if (!isWelcome || !onShown) return undefined
    const doc = globalThis.document
    if (!doc || doc.visibilityState !== 'hidden') {
      onShown()
      return undefined
    }
    const onVisible = () => {
      if (doc.visibilityState !== 'visible') return
      doc.removeEventListener('visibilitychange', onVisible)
      onShown()
    }
    doc.addEventListener('visibilitychange', onVisible)
    return () => doc.removeEventListener('visibilitychange', onVisible)
  }, [isWelcome, onShown])

  return (
    <header
      className={dynamic ? 'dashboard-greeting dashboard-greeting--dynamic' : 'dashboard-greeting'}
    >
      <div>
        <span className="eyebrow">{greeting.eyebrow}</span>
        <Heading as="h1">{greeting.heading}</Heading>
      </div>
    </header>
  )
}
