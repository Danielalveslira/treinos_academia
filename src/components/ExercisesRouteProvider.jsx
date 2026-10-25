import { useLocation } from 'react-router-dom'
import { ExercisesProvider } from '../contexts/ExercisesContext'
// Sheet reads supply their own bounded exercise snapshots. Do not load the entire library
// when listing/opening a sheet or executing an already validated sheet scope.
export function ExercisesRouteProvider({ children }) {
  const { pathname, search, state } = useLocation()
  const params = new URLSearchParams(search)
  const sheetsList =
    pathname === '/exercicios' &&
    !state?.openCatalog &&
    (!params.get('aba') || params.get('aba') === 'fichas')
  const sheetDetail = /^\/fichas\/[^/]+$/.test(pathname) && pathname !== '/fichas/nova'
  const sheetExecution = pathname === '/novo-treino' && Boolean(params.get('ficha'))
  const trainPicker = pathname === '/treinar'
  return (
    <ExercisesProvider enabled={!sheetsList && !sheetDetail && !sheetExecution && !trainPicker}>
      {children}
    </ExercisesProvider>
  )
}
