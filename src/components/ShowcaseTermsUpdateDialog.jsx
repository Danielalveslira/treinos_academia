import { Button, Dialog } from '@primer/react'
import { Link } from 'react-router-dom'

// "Ler o que mudou" -- mostra o resumo antes de qualquer decisão. Fechar este diálogo de
// qualquer jeito que não seja "OK, entendi" (X do Dialog, Escape, clique fora) nunca
// registra ciência -- onClose só fecha, quem chama ciência é onAcknowledge.
export function ShowcaseTermsUpdateDialog({
  version,
  changes,
  loading,
  onClose,
  onAcknowledge,
  acknowledging,
}) {
  return (
    <Dialog title="Os Termos da Vitrine foram atualizados" onClose={onClose} width="medium">
      <div className="showcase-terms-dialog">
        {loading ? (
          <p>Carregando o resumo...</p>
        ) : changes?.length ? (
          <>
            <p>Resumo das mudanças na versão {version}:</p>
            <ul>
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>Resumo não disponível no momento. Você pode ler os termos completos abaixo.</p>
        )}
        <div className="showcase-terms-dialog-actions">
          <Button as={Link} to="/termos-publicacao-vitrine" target="_blank" rel="noopener">
            Ler termos completos
          </Button>
          <Button variant="primary" onClick={onAcknowledge} loading={acknowledging}>
            OK, entendi
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
