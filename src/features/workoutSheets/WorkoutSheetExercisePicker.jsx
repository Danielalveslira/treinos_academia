import { lazy, Suspense, useState } from 'react'
import { Button, Spinner } from '@primer/react'
import { useExercises } from '../../contexts/ExercisesContext'
import { canStartExercise } from '../../utils/personalExercises.js'
import { normalizeForSearch } from '../../utils/text.js'
const Catalog = lazy(() =>
  import('../../components/ExerciseCatalog').then((m) => ({ default: m.ExerciseCatalog }))
)
export function WorkoutSheetExercisePicker({ items, onAdd, disabled }) {
  const { exercises, addFromCatalog, loading, error, refresh } = useExercises()
  const [catalog, setCatalog] = useState(false),
    [search, setSearch] = useState('')
  const available = exercises.filter(
    (e) =>
      canStartExercise(e) &&
      !items.some((i) => i.exercise_id === e.id) &&
      normalizeForSearch(e.name).includes(normalizeForSearch(search))
  )
  async function addOfficial(item) {
    const result = await addFromCatalog(item)
    const exercise =
      result.exercise ||
      exercises.find(
        (e) => e.provider === item.provider && e.providerExerciseId === item.providerExerciseId
      )
    if (exercise) onAdd(exercise)
    // Inclusion is committed to the library independently. Sheet save can be retried safely.
    return result
  }
  return (
    <section aria-label="Adicionar exercícios">
      <h2>Exercícios</h2>
      <p>Até 40 exercícios oficiais. Remover da ficha mantém o item na biblioteca.</p>
      <fieldset disabled={disabled}>
        <legend className="sr-only">Selecionar exercícios</legend>
        <Button onClick={() => setCatalog((v) => !v)}>
          {catalog ? 'Voltar à biblioteca' : 'Encontrar no Catálogo Evolutus'}
        </Button>
        {catalog ? (
          <Suspense fallback={<Spinner />}>
            <Catalog
              personalExercises={exercises}
              onAdd={addOfficial}
              onClose={() => setCatalog(false)}
            />
          </Suspense>
        ) : (
          <>
            <label className="sheet-field">
              Buscar na biblioteca
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            {loading && <Spinner />}
            {error && (
              <p role="alert">
                Não foi possível carregar a biblioteca.{' '}
                <Button onClick={refresh}>Tentar novamente</Button>
              </p>
            )}
            <ul className="sheet-picker">
              {available.map((e) => (
                <li key={e.id}>
                  <span>{e.name}</span>
                  <Button aria-label={`Adicionar ${e.name}`} onClick={() => onAdd(e)}>
                    Adicionar
                  </Button>
                </li>
              ))}
            </ul>
            {!loading && !available.length && (
              <p>Nenhum exercício disponível com esta busca. Consulte o catálogo.</p>
            )}
          </>
        )}
      </fieldset>
    </section>
  )
}
