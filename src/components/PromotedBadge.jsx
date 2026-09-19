import { Label } from '@primer/react'

// Fase 6 -- selo de "conteúdo promovido por um membro", deliberadamente diferente do
// selo "Patrocinado" do sponsoredAds (SponsoredAdCard.jsx): semânticas diferentes (um
// é o próprio membro pagando pra destacar o que ele mesmo publicou; o outro é anúncio
// institucional). Nunca reaproveita o texto/variant do sponsoredAds, pra não confundir
// os dois sistemas visualmente.
export function PromotedBadge() {
  return <Label variant="accent">Em destaque</Label>
}
