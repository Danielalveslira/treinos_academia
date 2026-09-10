import { useEffect, useState } from 'react'
import { getStatusPhotoBlob } from '../services/statusesService'
import { getCachedPhotoUrl, setCachedPhotoUrl } from '../utils/photoBlobCache'

// Link compartilhado = cold start (auth reidratando, sem cache de sessão, muitas vezes
// em navegador embutido de app de mensagem com rede ruim): getBytes() pode nunca
// resolver nem rejeitar. Sem um teto de tempo, o spinner fica preso pra sempre e não
// sobra nenhuma forma de recuperar sem sair da tela e voltar.
const LOAD_TIMEOUT_MS = 15000

// preloadedBlob evita um round-trip ao Storage para a própria foto que o usuário
// acabou de publicar nesta aba (StatusForm já tem os bytes comprimidos em memória) —
// para qualquer outro visitante do feed, busca via getStatusPhotoBlob (getBytes, que
// respeita storage.rules a cada chamada, ao contrário de uma URL de download).
export function useStatusPhoto(photoPath, preloadedBlob) {
  const [state, setState] = useState(() => {
    const cached = getCachedPhotoUrl(photoPath)
    return { url: cached || null, loading: !cached, error: null }
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const cached = getCachedPhotoUrl(photoPath)
    if (cached) {
      setState({ url: cached, loading: false, error: null })
      return
    }
    let active = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const load = preloadedBlob ? Promise.resolve(preloadedBlob) : getStatusPhotoBlob(photoPath)
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)
    })
    Promise.race([load, timeout])
      .then((blob) => {
        if (!active) return
        const url = URL.createObjectURL(blob)
        setCachedPhotoUrl(photoPath, url)
        setState({ url, loading: false, error: null })
      })
      .catch((error) => {
        if (!active) return
        setState({ url: null, loading: false, error })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoPath, attempt])

  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
