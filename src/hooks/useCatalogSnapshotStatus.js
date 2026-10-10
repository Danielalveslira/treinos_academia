import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureCatalogSnapshot } from '../services/offline/catalogSnapshot.js'
import { readCatalogSnapshotMeta } from '../services/offline/exerciseCache.js'
import { useSingleFlight } from './useSingleFlight.js'

const REFRESH_KEY = 'catalog-snapshot'

// Status compacto do snapshot completo do catálogo (seção 5 do prompt): nunca dispara nada sozinho
// (preparar/atualizar é sempre ação explícita do usuário) -- só lê o que já existe no aparelho ao
// montar, e expõe `prepare`/`update` para a UI.
//
//   not-prepared  -- nenhum snapshot completo neste aparelho ainda.
//   downloading   -- sincronização em curso (ver `progress`).
//   available     -- snapshot completo disponível (meta.totalActive/completedAt).
//   update-pending -- outra aba já está sincronizando (lock ocupado); esta aba não tentou de novo.
//   storage-error -- armazenamento local indisponível (quota, modo privado, etc).
//   error         -- última tentativa falhou (rede, RPC); o snapshot anterior, se houver, continua valendo.
function deriveKind({ meta, lastResult, busy }) {
  if (busy) return 'downloading'
  if (lastResult?.status === 'unavailable') return 'storage-error'
  if (lastResult?.status === 'error') return 'error'
  if (lastResult?.status === 'locked') return 'update-pending'
  if (meta?.complete) return 'available'
  return 'not-prepared'
}

export function useCatalogSnapshotStatus() {
  const [meta, setMeta] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const { run, isBusy } = useSingleFlight()
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    readCatalogSnapshotMeta().then((value) => {
      if (mounted.current) setMeta(value ?? null)
    })
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(
    (force) =>
      run(REFRESH_KEY, async () => {
        setProgress({ downloaded: 0 })
        try {
          const result = await ensureCatalogSnapshot({
            force,
            onProgress: (value) => {
              if (mounted.current) setProgress(value)
            },
          })
          if (mounted.current) setLastResult(result)
          const nextMeta = await readCatalogSnapshotMeta()
          if (mounted.current) setMeta(nextMeta ?? null)
          return result
        } finally {
          if (mounted.current) setProgress(null)
        }
      }),
    [run]
  )

  const busy = isBusy(REFRESH_KEY)
  return {
    kind: deriveKind({ meta, lastResult, busy }),
    totalActive: meta?.totalActive ?? null,
    lastSuccessfulSyncAt: meta?.lastSuccessfulSyncAt ?? null,
    progress,
    busy,
    prepare: () => refresh(false),
    update: () => refresh(true),
  }
}
