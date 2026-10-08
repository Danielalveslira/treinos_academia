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
export function useStatusPhoto(photoPath, preloadedBlob, enabled = true) {
  const [state, setState] = useState(() => {
    const cached = getCachedPhotoUrl(photoPath)
    return { url: cached || null, loading: !cached && enabled, error: null }
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const cached = getCachedPhotoUrl(photoPath)
    if (cached) {
      setState({ url: cached, loading: false, error: null })
      return
    }
    // Foto fora da área visível (bem abaixo no feed): não baixa agora; `enabled` vira true quando ela
    // chega perto da tela (PhotoStatus). A foto recém-publicada (preloadedBlob) já está em memória.
    if (!enabled && !preloadedBlob) return undefined
    let active = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const load = preloadedBlob ? Promise.resolve(preloadedBlob) : getStatusPhotoBlob(photoPath)
    // AUD-019: sem guardar o id e limpar no sucesso/erro, este timer seguia vivo até
    // os 15s completarem mesmo quando o carregamento já tinha terminado bem antes --
    // trabalho fantasma, sem efeito visível (Promise.race já ignora o timeout perdedor),
    // mas o timer real do event loop só era liberado no fim do prazo inteiro.
    let timeoutId
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)
    })
    Promise.race([load, timeout])
      .then((blob) => {
        clearTimeout(timeoutId)
        if (!active) return
        const url = URL.createObjectURL(blob)
        setCachedPhotoUrl(photoPath, url)
        setState({ url, loading: false, error: null })
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        if (!active) return
        setState({ url: null, loading: false, error })
      })
    return () => {
      active = false
      clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoPath, attempt, enabled])

  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
