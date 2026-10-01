// EvoCash -- camada de apresentação PURAMENTE visual para os cards de compra
// (/evocash). Nunca é fonte de preço/quantidade: cashAmount/amountCentavos sempre vêm
// de economyConfig/current via cashPurchaseService.getCashPurchaseSettings (ver
// cash-purchase-core.js: isValidCashPackage/requestCashPurchase revalidam tudo de novo
// no servidor). Este módulo só decide ORDEM e COPY de exibição.
//
// Reposicionamento EvoCash como moeda premium/rara: deliberadamente SEM nenhuma
// comparação matemática entre pacotes (preço-por-100, "economize X%", "melhor
// custo-benefício calculado") -- a raridade e o posicionamento premium vêm da própria
// quantidade oferecida e do design, nunca de matemática de desconto. badgeText é sempre
// copy CURADA (nunca inferida do preço), e nunca afirma popularidade sem dado real de
// compras (ver docs/prompts/current/implementar_pacotes_evocash_design_persuasivo.md).
const PACKAGE_PRESENTATION = {
  pack_25: {
    order: 1,
    title: 'Essencial',
    tagline: 'Para uma ação pontual',
    recommended: false,
    highlight: false,
    badgeText: null,
  },
  // pack_50_v2, não pack_50: packageId é um SKU imutável -- o pack_50 antigo era 50
  // EvoCash por R$5,90; reaproveitar o mesmo ID com R$10,90 arriscaria uma aba com cache
  // antigo mostrar um preço e o backend (que revalida fresco por packageId) cobrar outro.
  pack_50_v2: {
    order: 2,
    title: 'Inicial',
    tagline: 'Uma boa forma de começar',
    recommended: false,
    highlight: false,
    badgeText: null,
  },
  pack_120: {
    order: 3,
    title: 'Popular',
    tagline: 'Melhor equilíbrio entre preço e saldo',
    recommended: true,
    highlight: true,
    badgeText: 'Recomendado',
  },
  // pack_300_v2, não pack_300: mesmo motivo do pack_50_v2 -- o pack_300 antigo era 300
  // EvoCash por R$24,90, e o Max agora é 300 EvoCash por R$49,90 (preço bem diferente
  // pra mesma quantidade). 300, não 250: alinha o maior pacote ao custo real de
  // community_boost_30d (promotionPackages), que também é 300 EvoCash -- com 250 como
  // teto, nenhuma compra única cobriria esse destaque.
  pack_300_v2: {
    order: 4,
    title: 'Max',
    tagline: 'Maior pacote disponível',
    recommended: false,
    highlight: false,
    badgeText: 'Melhor valor',
  },
}

const DEFAULT_PRESENTATION = {
  order: Number.MAX_SAFE_INTEGER,
  title: null,
  tagline: null,
  recommended: false,
  highlight: false,
  badgeText: null,
}

function resolvePresentation(packageId) {
  return PACKAGE_PRESENTATION[packageId] || DEFAULT_PRESENTATION
}

// Monta a lista de cards prontos para renderização: filtra pacotes inativos (defesa
// extra -- getCashPurchaseSettings já filtra active===true, mas esta função não deveria
// depender disso pra estar correta sozinha) e ordena de forma determinística (nunca a
// ordem em que o banco devolver as linhas). Um packageId desconhecido (config futura)
// ainda aparece, só sem copy especial, em vez de quebrar a tela.
export function buildCashPackagesPresentation(packages) {
  const active = (packages || []).filter((pkg) => pkg?.active !== false)
  return active
    .map((pkg) => {
      const meta = resolvePresentation(pkg.packageId)
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
      }
    })
    .sort((a, b) => a.order - b.order || a.cashAmount - b.cashAmount)
}
