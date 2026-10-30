import { lazy, Suspense } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Spinner } from '@primer/react'
import { RocketIcon } from '@primer/octicons-react'
import '../features/workoutSheets/workoutSheets.css'
const Library = lazy(() => import('./Exercises'))
const Sheets = lazy(() => import('../features/workoutSheets/WorkoutSheetsPage'))
export default function ExercisesArea() {
  const location = useLocation()
  const [params] = useSearchParams()
  const tab = params.get('aba') || (location.state?.openCatalog ? 'catalogo' : 'fichas')
  return (
    <>
      {/* Fichas é a entrada principal (gestão de planejamento) e já é o que a página mostra —
          sem link redundante para ela mesma. Biblioteca e Catálogo Evolutus continuam
          acessíveis como navegação secundária e compacta; voltando dali, um link de volta
          para Fichas aparece no lugar. */}
      <nav className="exercise-area-nav workout-sheets" aria-label="Área de exercícios">
        <span className="exercise-area-nav-secondary">
          {tab !== 'fichas' && <Link to="/exercicios?aba=fichas">← Minhas fichas</Link>}
          <Link
            to="/exercicios?aba=biblioteca"
            aria-current={tab === 'biblioteca' ? 'page' : undefined}
          >
            Biblioteca
          </Link>
          <Link
            to="/exercicios?aba=catalogo"
            state={{ openCatalog: true }}
            aria-current={tab === 'catalogo' ? 'page' : undefined}
            className="exercise-area-nav-catalog"
          >
            <RocketIcon size={16} aria-hidden="true" /> Catálogo Evolutus
          </Link>
        </span>
      </nav>
      <Suspense fallback={<Spinner aria-label="Carregando área" />}>
        {tab === 'fichas' ? <Sheets /> : <Library key={tab} />}
      </Suspense>
    </>
  )
}
