import { lazy, Suspense } from 'react'
import { useAuth } from '../hooks/useAuth'
import { needsProfileCompletion } from '../utils/profileCompletion'
import { PageFallback } from './PageFallback'

// O formulário (seletor de cidade, validações, RPCs de perfil) só é baixado por quem de fato tem um
// cadastro incompleto -- este gate envolve TODAS as rotas protegidas, então fica mínimo no boot.
const ProfileCompletionForm = lazy(() => import('./ProfileCompletionForm'))

// Guarda, dentro de ProtectedRoute (depois das guardas de conta bloqueada/exclusão),
// contas com sessão válida mas que nunca completaram o cadastro -- rede de segurança para
// qualquer interrupção entre confirmar o e-mail e completeUserProfile (aba fechada, recarga,
// queda de rede). ProtectedRoute só chega aqui com profile já carregado (loading/!profile
// tratados antes) -- needsProfileCompletion(null) devolvendo false é defensivo, não o
// mecanismo real de distinguir carregando de vazio. Contas antigas COM username (mesmo sem
// cidade/sexo) nunca são bloqueadas.
export function ProfileCompletionGate({ children }) {
  const { profile } = useAuth()
  if (!needsProfileCompletion(profile)) return children
  return (
    <Suspense
      fallback={
        <div
          className="profile-completion-loading"
          aria-busy="true"
          aria-label="Carregando cadastro"
        >
          <PageFallback />
        </div>
      }
    >
      <ProfileCompletionForm />
    </Suspense>
  )
}
