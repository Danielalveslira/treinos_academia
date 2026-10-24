import { lazy, Suspense } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Spinner } from '@primer/react'
import '../features/workoutSheets/workoutSheets.css'
const Library = lazy(() => import('./Exercises'))
const Sheets = lazy(() => import('../features/workoutSheets/WorkoutSheetsPage'))
export default function ExercisesArea() {
  const location = useLocation()
  const [params] = useSearchParams()
  const tab = params.get('aba') || (location.state?.openCatalog ? 'catalogo' : 'fichas')
  return (
    <>
      <nav className="exercise-area-nav" aria-label="Área de exercícios">
        {[
          ['fichas', 'Minhas fichas'],
          ['biblioteca', 'Biblioteca'],
          ['catalogo', 'Catálogo Evolutus'],
        ].map(([id, label]) => (
          <Link
            key={id}
            to={`/exercicios?aba=${id}`}
            state={id === 'catalogo' ? { openCatalog: true } : null}
            aria-current={tab === id ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<Spinner aria-label="Carregando área" />}>
        {tab === 'fichas' ? <Sheets /> : <Library key={tab} />}
      </Suspense>
    </>
  )
}
