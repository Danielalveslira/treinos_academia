import { useCallback, useEffect, useRef, useState } from 'react'
import { readCachedCatalogEntry } from '../services/offline/exerciseCache.js'
import { countAvailableRoutineImages, prepareRoutineImages } from '../services/offline/exerciseImagePrep.js'
import { useSingleFlight } from './useSingleFlight.js'

const PREPARE_KEY = 'routine-images'

// Exercícios PESSOAIS (public.exercises) só guardam a referência ao catálogo (provider/
// providerExerciseId/catalogId) -- as imagens/thumbnail vêm do catálogo já cacheado localmente
// (readCachedCatalogEntry). Nunca dispara rede aqui: só lê o que já está no aparelho: se o
// snapshot completo (ou o cache oportunista) ainda não tem o exercício, ele simplesmente não entra
// na lista desta vez (comportamento honesto -- "não contar fotos inexistentes").
async function resolveRoutineCatalogExercises(personalExercises) {
  const resolved = await Promise.all(
    (personalExercises || []).map((exercise) =>
      readCachedCatalogEntry({
        catalogId: exercise?.catalogId,
        provider: exercise?.provider,
        providerExerciseId: exercise?.providerExerciseId,
      })
    )
  )
  return resolved.filter(Boolean)
}

// "X de Y arquivos disponíveis" (seção 5 do prompt) para os exercícios PESSOAIS informados
// (tipicamente a rotina do usuário) -- `available`/`total` são sempre recalculados contra o Cache
// Storage de verdade (ver exerciseImagePrep.countAvailableRoutineImages), nunca um flag lembrado.
// `prepare()` é sempre ação explícita (botão "Preparar imagens"); `cancel()` aborta um preparo em curso.
export function useExerciseImagePrep(personalExercises) {
  const [availability, setAvailability] = useState({ available: 0, total: 0 })
  const [progress, setProgress] = useState(null)
  const [failed, setFailed] = useState(0)
  const { run, isBusy } = useSingleFlight()
  const abortRef = useRef(null)
  const mounted = useRef(true)

  const refreshAvailability = useCallback(async () => {
    const catalogExercises = await resolveRoutineCatalogExercises(personalExercises)
    const result = await countAvailableRoutineImages(catalogExercises)
    if (mounted.current) setAvailability(result)
    return result
  }, [personalExercises])

  useEffect(() => {
    mounted.current = true
    refreshAvailability()
    return () => {
      mounted.current = false
      abortRef.current?.abort()
    }
  }, [refreshAvailability])

  const prepare = useCallback(
    () =>
      run(PREPARE_KEY, async () => {
        const controller = new AbortController()
        abortRef.current = controller
        setProgress({ done: 0, failed: 0, total: 0 })
        try {
          const catalogExercises = await resolveRoutineCatalogExercises(personalExercises)
          const result = await prepareRoutineImages(catalogExercises, {
            signal: controller.signal,
            onProgress: (value) => {
              if (mounted.current) setProgress(value)
            },
          })
          if (mounted.current) setFailed(result.failed)
          await refreshAvailability()
          return result
        } finally {
          abortRef.current = null
          if (mounted.current) setProgress(null)
        }
      }),
    [run, personalExercises, refreshAvailability]
  )

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  return {
    available: availability.available,
    total: availability.total,
    progress,
    preparing: isBusy(PREPARE_KEY),
    failed,
    prepare,
    cancel,
  }
}
