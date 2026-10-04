import { Button, Flash } from '@primer/react'
import { useLogout } from '../hooks/useLogout'

// "Sair da conta" das telas de bloqueio (gates): mesmo fluxo e mesmos estados do menu da conta.
export function LogoutButton({ disabled = false }) {
  const { logout, signingOut, error } = useLogout()
  return (
    <>
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      <Button onClick={logout} disabled={disabled || signingOut} loading={signingOut}>
        {signingOut ? 'Saindo…' : 'Sair da conta'}
      </Button>
    </>
  )
}
