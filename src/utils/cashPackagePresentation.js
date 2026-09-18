// EvoCash -- camada de apresentação PURAMENTE visual para os cards de compra
// (/evocash). Nunca é fonte de preço/quantidade: cashAmount/amountCentavos sempre vêm
// de economyConfig/current via cashPurchaseService.getCashPurchaseSettings (ver
// cash-purchase-core.js: isValidCashPackage/requestCashPurchase revalidam tudo de novo
// no servidor). Este módulo só decide ORDEM e COPY de exibição, e calcula valor-por-100/
// economia a partir dos números reais recebidos -- nunca hardcoda um percentual
// comercial que pudesse ficar inconsistente com a config (ver prompt de persuasão
// ética, princípio 1).
//
// Metadados por packageId (order/title/tagline/badge) são deliberadamente separados de
// preço/quantidade: um pacote desconhecido (config futura com um packageId novo) ainda
// aparece, só sem copy especial, em vez de quebrar a tela.
const PACKAGE_PRESENTATION = {
  pack_50: { order: 1, title: 'Essencial', tagline: 'Comece com pouco', recommended: false, highlight: false, badgeText: null },
  pack_100: { order: 2, title: 'Inicial', tagline: 'Uma boa forma de começar', recommended: false, highlight: false, badgeText: null },
  pack_300: { order: 3, title: 'Popular', tagline: 'Melhor equilíbrio entre preço e saldo', recommended: true, highlight: true, badgeText: 'Recomendado' },
  pack_700: { order: 4, title: 'Max', tagline: 'Melhor custo-benefício', recommended: false, highlight: false, badgeText: null },
}

const DEFAULT_PRESENTATION = {
  order: Number.MAX_SAFE_INTEGER,
  title: null,
  tagline: null,
  recommended: false,
  highlight: false,
  badgeText: null,
}

// Pacote de referência para "economize comparado a N compras de 100 EvoCash" (princípio
// 1 -- ancoragem). 100 EvoCash é a menor unidade "redonda" da config aprovada; se ela não
// existir (config diferente em algum ambiente), simplesmente não há comparação a
// mostrar, em vez de inventar uma base.
export const BASE_PACKAGE_ID = 'pack_100'

function resolvePresentation(packageId) {
  return PACKAGE_PRESENTATION[packageId] || DEFAULT_PRESENTATION
}

// Preço por 100 EvoCash, em centavos -- mesma unidade de amountCentavos (formatação BRL
// fica a cargo de quem renderiza, ver formatCentavosBRL). Arredonda pro centavo mais
// próximo (dinheiro sempre inteiro na exibição, mesmo quando o cálculo intermediário não
// é exato -- ex.: 4990/7 = 712,857...).
export function computeUnitPriceCentavosPer100(pkg) {
  if (!pkg || !(pkg.cashAmount > 0) || !(pkg.amountCentavos >= 0)) return null
  return Math.round(pkg.amountCentavos / (pkg.cashAmount / 100))
}

// Economia de um pacote maior comparado a comprar o mesmo total em várias unidades do
// pacote-base (princípio 1). Só retorna algo quando a economia é POSITIVA e o pacote
// vale um número inteiro de unidades-base (senão "comparado a 2,5 compras de 100
// EvoCash" seria uma comparação estranha) -- nunca mostra uma "economia" negativa (caso
// do Essencial, que tem o pior valor unitário: não existe frase no código que o envergonhe
// por isso, ver princípio 3/restrições éticas).
export function computeSavingsVsBase(pkg, basePackage) {
  if (
    !pkg ||
    !basePackage ||
    !(basePackage.cashAmount > 0) ||
    pkg.packageId === basePackage.packageId
  ) {
    return null
  }
  const multiplier = pkg.cashAmount / basePackage.cashAmount
  if (!Number.isInteger(multiplier) || multiplier < 2) return null
  const equivalentCostCentavos = multiplier * basePackage.amountCentavos
  const savingsCentavos = Math.round(equivalentCostCentavos - pkg.amountCentavos)
  if (savingsCentavos <= 0) return null
  const savingsPercent = Math.round((savingsCentavos / equivalentCostCentavos) * 100)
  return { savingsCentavos, savingsPercent, comparisonCount: multiplier }
}

// Princípio 5 (concretude): quantas vezes o saldo do pacote cobre o custo REAL de criar
// uma comunidade paga (economyConfig.current.privileges.createCommunity.cashCost, ver
// config-service.js). null quando o custo não está configurado ou o pacote nem cobre uma
// vez -- nunca inventa um exemplo que não se sustenta.
export function computeCommunityCreationCoverage(pkg, cashCost) {
  if (!pkg || !(cashCost > 0) || !(pkg.cashAmount >= cashCost)) return null
  return Math.floor(pkg.cashAmount / cashCost)
}

// Monta a lista de cards prontos para renderização: filtra pacotes inativos (defesa
// extra -- getCashPurchaseSettings já filtra active===true, mas esta função não deveria
// depender disso pra estar correta sozinha), ordena de forma determinística (nunca a
// ordem de campos que o Firestore devolver) e calcula valor-por-100/economia/concretude
// a partir dos números reais recebidos.
export function buildCashPackagesPresentation(
  packages,
  { basePackageId = BASE_PACKAGE_ID, communityCreationCashCost = null } = {}
) {
  const active = (packages || []).filter((pkg) => pkg?.active !== false)
  const basePackage = active.find((pkg) => pkg.packageId === basePackageId) || null

  const views = active.map((pkg) => {
    const meta = resolvePresentation(pkg.packageId)
    const savings = computeSavingsVsBase(pkg, basePackage)
    return {
      packageId: pkg.packageId,
      cashAmount: pkg.cashAmount,
      amountCentavos: pkg.amountCentavos,
      title: meta.title || pkg.label,
      tagline: meta.tagline,
      recommended: meta.recommended,
      highlight: meta.highlight,
      badgeText: meta.badgeText,
      order: meta.order,
      unitPriceCentavosPer100: computeUnitPriceCentavosPer100(pkg),
      savingsCentavos: savings?.savingsCentavos ?? null,
      savingsPercent: savings?.savingsPercent ?? null,
      savingsComparisonCount: savings?.comparisonCount ?? null,
      communityCreationCount: computeCommunityCreationCoverage(pkg, communityCreationCashCost),
    }
  })

  // "Melhor valor" é sempre CALCULADO a partir do preço-por-100 real, nunca fixado num
  // packageId -- se a config mudar (ex.: um pacote novo mais barato por unidade), o
  // badge acompanha. Só entra em quem ainda não tem um badge curado (ex.: "Recomendado"),
  // pra nunca empilhar dois selos no mesmo card.
  const withUnitPrice = views.filter((view) => view.unitPriceCentavosPer100 != null)
  if (withUnitPrice.length > 1) {
    const best = withUnitPrice.reduce((min, view) =>
      view.unitPriceCentavosPer100 < min.unitPriceCentavosPer100 ? view : min
    )
    if (!best.badgeText) best.badgeText = 'Melhor valor'
  }

  return views.sort((a, b) => a.order - b.order || a.cashAmount - b.cashAmount)
}
