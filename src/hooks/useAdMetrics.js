import { useCallback, useEffect } from 'react'

// Chave mestra de build da coleta de métricas de patrocinados. Ausente/diferente de 'true' = DESLIGADA (padrão em
// produção): os hooks viram no-ops e o coletor (services/adMetrics/runtime.js, com IntersectionObserver, envio e
// supabase.auth) nunca é baixado nem executado. Ligar exige antes: aprovação jurídica, migration publicada, chave
// do servidor (sponsored_ad_metrics_settings.collection_enabled) e homologação -- ver docs/SPONSORED_AD_METRICS.md.
export const AD_METRICS_ENABLED = import.meta.env?.VITE_AD_METRICS_ENABLED === 'true'

// Observa o elemento do anúncio para contar a impressão visível (>= 50% da área por 1 s contínuo). Sem consulta,
// sem estado React, sem render extra: tudo acontece no coletor compartilhado. Troca de campanha (carrossel)
// re-registra o mesmo elemento com o novo id e a contagem de 1 s recomeça.
export function useAdImpression(ref, adId, placement, communityId = null) {
  useEffect(() => {
    if (!AD_METRICS_ENABLED || !adId) return undefined
    const element = ref.current
    if (!element) return undefined
    let stop = null
    let cancelled = false
    import('../services/adMetrics/runtime')
      .then(({ observeAd }) => {
        if (!cancelled) stop = observeAd(element, { adId, placement, communityId })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (stop) stop()
    }
  }, [ref, adId, placement, communityId])
}

// Handler para o CTA. Só enfileira: não espera nada, não chama preventDefault e ignora cliques sintéticos
// (element.click() de script), de modo que a navegação interna/externa/WhatsApp segue exatamente como antes.
export function useAdClick(adId, placement, communityId = null) {
  return useCallback(
    (event) => {
      if (!AD_METRICS_ENABLED || !adId || event?.isTrusted === false) return
      if (event?.type === 'auxclick' && event.button !== 1) return // só o botão do meio abre o link
      import('../services/adMetrics/runtime')
        .then(({ trackAdClick }) => trackAdClick({ adId, placement, communityId }))
        .catch(() => {})
    },
    [adId, placement, communityId]
  )
}
