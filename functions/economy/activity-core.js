// Lógica pura da recompensa diária de atividade (seções 8/9 do prompt de economia):
// nunca confia em minutos enviados pelo cliente -- cada checkpoint só carrega "agora"
// (relógio do servidor) e o servidor deriva minutos reais a partir do intervalo entre
// checkpoints consecutivos. Um único checkpoint isolado nunca gera minutos (não há
// checkpoint anterior pra tirar a diferença), então é preciso pelo menos dois
// checkpoints de verdade, espaçados no tempo, pra completar o requisito.
//
// IMPORTANTE (natureza da métrica): `activeMinutes` é uma APROXIMAÇÃO server-authoritative
// de engajamento, derivada do intervalo entre interações qualificadas (cada checkpoint
// disparado por uma navegação/ação real do usuário -- ver useQualifiedActivity.js),
// nunca uma medição contínua e exata de presença. O servidor não sabe o que aconteceu
// *dentro* de cada intervalo (só o tamanho dele, com teto em MAX_CHECKPOINT_GAP_MS) --
// é deliberadamente grosseiro o bastante pra não exigir telemetria contínua (heartbeat),
// e preciso o bastante pra impedir que um único checkpoint isolado (ou um intervalo
// gigante) simule um dia inteiro de uso.
export const MIN_CHECKPOINT_GAP_MS = 60 * 1000
// Teto por intervalo: sem isso, deixar a aba aberta (ou minimizada) por horas e mandar
// um único checkpoint depois creditaria o dia inteiro de uma vez só.
export const MAX_CHECKPOINT_GAP_MS = 20 * 60 * 1000
// Rede de segurança de custo (seção 9: "2-3 checkpoints relevantes por dia, checkpoint
// extra somente se necessário") -- não é o limite esperado no uso normal, é o teto
// contra um cliente malicioso que ignore o throttle do próprio app.
export const MAX_CHECKPOINTS_PER_DAY = 6

// Mesma técnica de progress-daily-core.js (workoutDateKey): o dia econômico é sempre
// calculado a partir do relógio do servidor, no fuso do público-alvo -- nunca do
// relógio do cliente, que o usuário controla.
const SAO_PAULO_DATE_FORMAT = new Intl.DateTimeFormat('en', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function todayKey(nowMs) {
  const parts = Object.fromEntries(
    SAO_PAULO_DATE_FORMAT.formatToParts(new Date(nowMs)).map(({ type, value }) => [type, value])
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

const EMPTY_DAILY = {
  activeMinutes: 0,
  checkpointsCount: 0,
  lastQualifiedActivityAt: null,
  activityRewardGranted: false,
}

// daily: dado atual de economyDaily/{date} (ou null, se ainda não existe hoje).
// nowMs: horário do servidor no momento desta chamada.
// requiredMinutes: economyConfig.dailyActivity.requiredMinutes.
//
// Retorna { apply: false, reason } quando nada deve ser escrito (checkpoint ignorado),
// ou { apply: true, rewardEligible, nextDaily } com o novo estado de economyDaily.
export function evaluateCheckpoint({ daily, nowMs, requiredMinutes }) {
  // economyDaily/{date} é compartilhado com vote-service.js (Fase 2): o documento pode
  // já existir com só votesCharged/voteCoinsSpent (usuário votou antes de qualquer
  // checkpoint de atividade no dia) -- `daily || EMPTY_DAILY` sozinho não bastaria
  // (substituiria o objeto inteiro só quando ausente), então cada campo de ATIVIDADE
  // precisa do próprio default aqui, campo a campo, mesmo com o documento existindo.
  const current = { ...EMPTY_DAILY, ...daily }

  if (current.activityRewardGranted) {
    return { apply: false, reason: 'already_granted' }
  }
  if (current.checkpointsCount >= MAX_CHECKPOINTS_PER_DAY) {
    return { apply: false, reason: 'checkpoint_cap_reached' }
  }

  let addedMinutes = 0
  if (current.lastQualifiedActivityAt != null) {
    const gapMs = nowMs - current.lastQualifiedActivityAt
    // Um gap não-positivo (relógio do servidor não deveria andar pra trás, mas retries
    // fora de ordem podem chegar assim) é tratado como "cedo demais", nunca como erro.
    if (gapMs < MIN_CHECKPOINT_GAP_MS) {
      return { apply: false, reason: 'too_soon' }
    }
    addedMinutes = Math.min(gapMs, MAX_CHECKPOINT_GAP_MS) / 60000
  }

  const activeMinutes = current.activeMinutes + addedMinutes
  const rewardEligible = activeMinutes >= requiredMinutes

  return {
    apply: true,
    rewardEligible,
    nextDaily: {
      activeMinutes,
      checkpointsCount: current.checkpointsCount + 1,
      lastQualifiedActivityAt: nowMs,
      activityRewardGranted: rewardEligible,
    },
  }
}
