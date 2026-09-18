// Schema inicial da seção 7 do prompt de economia. Usado como fallback quando
// economyConfig/current ainda não existe -- assim a feature funciona em qualquer
// ambiente (inclusive um projeto novo) sem precisar de um passo de seed antes do
// primeiro deploy. Escrever economyConfig/current (via Admin SDK/console) passa a
// sobrepor estes valores; nenhum outro lugar do código deveria hardcodar estes números.
export const DEFAULT_ECONOMY_CONFIG = {
  dailyActivity: {
    requiredMinutes: 30,
    rewardCoins: 3,
  },
  voting: {
    costCoins: 3,
    maxVotesPerUserDay: 10,
    rewardCoinsPerPositiveVote: 1,
    maxRewardCoinsPerPostDay: 10,
    maxRewardCoinsPerAuthorDay: 30,
    maxRewardedVotesSameAuthorPerVoterDay: 3,
    // Teto agregado por votante/dia, cruzando TODOS os autores -- sem isto, um votante
    // podia reativar (ineligible -> pending) muitos votos antigos já pagos em dias
    // anteriores, espalhados entre autores diferentes, cada um individualmente sob o
    // teto por-autor mas sem nenhum teto agregado (ver auditoria de Fase 3, ponto 1).
    maxRewardedVotesPerVoterDay: 20,
  },
  // Fase 5: só uma referência de documentação -- isValidCreateCommunityPrivilege
  // (privilege-core.js) nunca cai neste default (dinheiro real + reputação, fail-closed
  // igual a cashPackages na Fase 4). economyConfig/current precisa ter este bloco
  // preenchido de verdade antes que alguém consiga criar uma comunidade paga.
  privileges: {
    createCommunity: {
      minimumLifetimeCoins: 200,
      minimumAccountAgeDays: 7,
      requireEmailVerified: true,
      cashCost: 50,
    },
  },
  version: 1,
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

// EvoCoins e minutos são sempre unidades inteiras (seção 3 do prompt: coinBalance é uma
// contagem, não um valor fracionário) -- Number.isInteger, não só Number.isFinite,
// então 30.5min ou 3.5 EvoCoins são tratados como inválidos, não arredondados.
function isPositiveIntegerWithinRange(value, max) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
}

// Limites de sanidade (só EvoCoins, sem valor monetário real): existem só pra um
// documento ausente, corrompido ou editado à mão de forma errada (campo faltando, NaN,
// negativo, decimal, string, um valor absurdamente grande) nunca virar um crédito/débito
// absurdo/fracionário na carteira nem derrubar a Function com uma exceção de
// desestruturação -- não são regra de negócio (não travam um ajuste razoável de
// configuração). Só valida os campos que algum código realmente lê e usa hoje
// (dailyActivity inteiro; voting inteiro, agora que a Fase 3 lê os 5 campos de
// antifarming além de costCoins/maxVotesPerUserDay da Fase 2). privileges segue sem
// validação -- ainda não consumido por nenhum código. Fase 4+ (preço de EvoCash) precisa
// de validação própria e mais rígida, que FALHA a operação em vez de cair num default --
// ver o comentário sobre isso logo abaixo, em getEconomyConfig.
function isValidDailyActivityConfig(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    isPositiveIntegerWithinRange(value.requiredMinutes, 24 * 60) &&
    isPositiveIntegerWithinRange(value.rewardCoins, 1000)
  )
}

function isValidVotingConfig(value) {
  if (
    value == null ||
    typeof value !== 'object' ||
    !isPositiveIntegerWithinRange(value.costCoins, 1000) ||
    !isPositiveIntegerWithinRange(value.maxVotesPerUserDay, 1000) ||
    !isPositiveIntegerWithinRange(value.rewardCoinsPerPositiveVote, 1000) ||
    !isPositiveIntegerWithinRange(value.maxRewardCoinsPerPostDay, 100000) ||
    !isPositiveIntegerWithinRange(value.maxRewardCoinsPerAuthorDay, 100000) ||
    !isPositiveIntegerWithinRange(value.maxRewardedVotesSameAuthorPerVoterDay, 10000) ||
    !isPositiveIntegerWithinRange(value.maxRewardedVotesPerVoterDay, 10000)
  ) {
    return false
  }
  // Validação CRUZADA (auditoria de Fase 3, ponto adicional): validar cada campo
  // isoladamente não basta -- uma combinação individualmente "válida" ainda pode ser
  // economicamente absurda. Se um único voto premiado já vale mais que o teto diário do
  // post/autor, o settlement nunca creditaria nenhum voto (capped desde o primeiro).
  if (value.rewardCoinsPerPositiveVote > value.maxRewardCoinsPerPostDay) return false
  if (value.rewardCoinsPerPositiveVote > value.maxRewardCoinsPerAuthorDay) return false
  // O teto por par (votante,autor) nunca deveria exceder o teto agregado do votante --
  // senão o limite por-autor nunca é o que efetivamente restringe nada.
  if (value.maxRewardedVotesSameAuthorPerVoterDay > value.maxRewardedVotesPerVoterDay) return false
  return true
}

// Cache em memória por instância da Cloud Function (seção 7: "usar cache em memória
// com TTL para evitar leitura da config em toda ação"). Cada instância fria começa sem
// cache; instâncias quentes reaproveitam o mesmo valor por até `ttlMs`.
//
// IMPORTANTE para quem for estender isto: o fallback silencioso (documento ausente, ou
// dailyActivity ausente/inválido) só é aceitável para EvoCoins (participação/reputação,
// sem nenhum valor monetário real). Quando esta função passar a servir preço de EvoCash
// ou qualquer operação de compra (Fase 4+), um documento ausente ou com formato inválido
// deve FALHAR a operação (nunca aplicar um preço "padrão" a dinheiro real) -- não
// reaproveitar este mesmo caminho de fallback para isso sem revisitar essa decisão.
export function createConfigService({ db, ttlMs = DEFAULT_TTL_MS, now = Date.now, log = console }) {
  let cached = null
  let cachedAtMs = 0

  return async function getEconomyConfig() {
    if (cached && now() - cachedAtMs < ttlMs) return cached
    const snapshot = await db.doc('economyConfig/current').get()
    if (!snapshot.exists) {
      log.warn('economyConfig/current ausente -- usando DEFAULT_ECONOMY_CONFIG embutido')
      cached = DEFAULT_ECONOMY_CONFIG
    } else {
      const data = snapshot.data()
      let result = data
      if (!isValidDailyActivityConfig(data?.dailyActivity)) {
        log.warn(
          'economyConfig/current.dailyActivity ausente ou fora dos limites de sanidade -- usando o default embutido só para este bloco'
        )
        result = { ...result, dailyActivity: DEFAULT_ECONOMY_CONFIG.dailyActivity }
      }
      if (!isValidVotingConfig(data?.voting)) {
        log.warn(
          'economyConfig/current.voting ausente ou fora dos limites de sanidade -- usando o default embutido só para este bloco'
        )
        result = { ...result, voting: DEFAULT_ECONOMY_CONFIG.voting }
      }
      cached = result
    }
    cachedAtMs = now()
    return cached
  }
}
