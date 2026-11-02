// Catálogo ÚNICO de mensagens de Push do Evolutus (e dos títulos de lembrete na Central).
//
// Por que em código e não em tabela: é versionado/revisado como o resto, não custa consulta por
// mensagem (o worker já recebe tipo, variante e contagem no claim) e o frontend importa o mesmo
// módulo. Cada mensagem é [título, corpo] com marcadores: {actor} "@fulano" (ou "Alguém"),
// {who} "@fulano e mais N pessoas" (grupos) e {amount} (EvoCoins). A essência vem nas primeiras
// palavras (Android/Windows cortam cedo) e tudo passa por `fit`.
//
// Tom: curto, direto e em português brasileiro, sem emojis. Social/treino podem variar a frase para não
// repetir; moderação, segurança, privacidade, dinheiro e administração são OBJETIVOS e genéricos
// (a tela bloqueada nunca mostra motivo, ação detalhada nem valor em EvoCash).

export const LIMITS = { title: 56, body: 110 }

// Corta por pontos de código (não parte emoji) e, quando possível, em limite de palavra.
export function fit(text, max) {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(value)
  if (chars.length <= max) return value
  const window = chars.slice(0, max - 1)
  const lastSpace = window.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(max * 0.6) ? window.slice(0, lastSpace) : window
  return `${cut.join('').replace(/[\s.,;:!?-]+$/, '')}…`
}

// seq cresce 1 ou 2 por Push do mesmo tipo (banco): para qualquer catálogo com >= 3 mensagens o
// índice nunca repete em sequência, e a mesma seq sempre devolve a mesma mensagem (idempotente).
export function pickIndex(seq, size) {
  const n = Number.isInteger(seq) ? seq : 0
  return ((n % size) + size) % size
}

const POOLS = {
  push_welcome: [
    ['Boas-vindas ao Evolutus!', 'As notificações estão ativas neste dispositivo.'],
  ],
  post_like: {
    single: [
      ['Nova curtida', '{actor} curtiu sua publicação.'],
      ['Seu post recebeu uma curtida', '{actor} curtiu o que você publicou.'],
      ['Curtida na sua publicação', '{actor} curtiu seu post.'],
      ['Alguém gostou do seu post', '{actor} curtiu sua publicação.'],
      ['Mais uma curtida', '{actor} curtiu o seu post.'],
      ['Seu post agradou', '{actor} curtiu sua publicação.'],
    ],
    group: [
      ['Novas curtidas', '{who} curtiram sua publicação.'],
      ['Seu post está em alta', '{who} curtiram seu post.'],
      ['Curtidas na sua publicação', '{who} curtiram o que você publicou.'],
      ['Seu post agradou', '{who} curtiram sua publicação.'],
    ],
  },
  comment_like: {
    single: [
      ['Curtida no seu comentário', '{actor} curtiu seu comentário.'],
      ['Seu comentário agradou', '{actor} curtiu o que você disse.'],
      ['Nova curtida', '{actor} curtiu seu comentário.'],
      ['Alguém concordou com você', '{actor} curtiu o seu comentário.'],
    ],
    group: [
      ['Curtidas no seu comentário', '{who} curtiram seu comentário.'],
      ['Seu comentário agradou', '{who} curtiram o que você disse.'],
      ['Novas curtidas', '{who} curtiram o seu comentário.'],
    ],
  },
  post_reply: [
    ['Novo comentário', '{actor} comentou na sua publicação.'],
    ['Comentaram no seu post', '{actor} deixou um comentário.'],
    ['Seu post tem conversa nova', '{actor} comentou no seu post.'],
    ['Comentário na sua publicação', '{actor} comentou na sua publicação.'],
  ],
  comment_reply: [
    ['Nova resposta', '{actor} respondeu seu comentário.'],
    ['Responderam você', '{actor} respondeu o que você disse.'],
    ['A conversa continua', '{actor} respondeu você.'],
    ['Resposta ao seu comentário', '{actor} respondeu seu comentário.'],
  ],
  comment_mention: [
    ['Você foi mencionado', '{actor} mencionou você em um comentário.'],
    ['Nova menção', '{actor} marcou você em um comentário.'],
    ['Falaram com você', '{actor} citou você em um comentário.'],
  ],
  // Só moedas (EvoCoins) mostram valor; EvoCash e saldo nunca aparecem no Push.
  economy_coin: [
    ['+{amount} EvoCoins', 'Sua recompensa chegou.'],
    ['Recompensa recebida', 'Você ganhou {amount} EvoCoins.'],
    ['EvoCoins na carteira', '{amount} EvoCoins foram creditados.'],
  ],
  economy_coin_generic: [
    ['Recompensa recebida', 'Você ganhou EvoCoins. Toque para conferir.'],
    ['EvoCoins na carteira', 'Sua carteira recebeu EvoCoins.'],
    ['Nova recompensa', 'Abra o Evolutus para conferir.'],
  ],
  economy_payment: [['Pagamento confirmado', 'Sua compra foi processada. Toque para conferir.']],
  economy_cash: [['Crédito na carteira', 'Você recebeu EvoCash. Toque para conferir.']],
  economy_debit: [['Atualização na sua carteira', 'Houve um ajuste. Toque para conferir.']],
  moderation_notice: [
    ['Aviso da conta', 'Você recebeu uma atualização na sua conta. Toque para conferir.'],
  ],
  report_resolved: [['Atendimento', 'Seu caso teve uma atualização. Toque para ver.']],
  // Reembolso: sem valor, motivo nem status na tela bloqueada.
  refund_update: [['Solicitação de reembolso', 'Sua solicitação teve uma atualização. Toque para ver.']],
  admin_refund: [['Reembolsos', 'Há uma solicitação de reembolso para analisar.']],
  admin_report: {
    single: [['Moderação', 'Há uma nova denúncia aguardando análise.']],
    group: [['Moderação', '{n} novas denúncias aguardando análise.']],
  },
  admin_appeal: {
    single: [['Moderação', 'Há um novo recurso aguardando análise.']],
    group: [['Moderação', '{n} novos recursos aguardando análise.']],
  },
  admin_privacy_request: {
    single: [['Privacidade', 'Há um novo pedido aguardando análise.']],
    group: [['Privacidade', '{n} novos pedidos aguardando análise.']],
  },
  admin_moderation_decision: [['Moderação', 'Uma decisão foi registrada.']],
  admin_restriction: [['Moderação', 'Uma restrição foi aplicada.']],
  admin_deletion_review: [['Exclusão de conta', 'Há uma revisão aguardando análise.']],
  admin_broadcast: [['Aviso do Evolutus', 'Você recebeu um aviso importante.']],
  // Treinos: a ficha só aparece quando o banco gravou uma associação confiável (ficha do usuário,
  // ativa, com exercícios válidos e marcada para aquele dia da semana). Sem ela, texto genérico.
  workout_reminder_before: [
    ['Treino daqui a 1 hora', 'Seu treino de hoje começa em 1 hora.'],
    ['Seu treino começa em 1 hora', 'Dá tempo de se organizar com calma.'],
    ['Treino de hoje em 1 hora', 'Seu planejamento da semana está em dia.'],
    ['Falta 1 hora para o treino', 'Separe o que precisa e bom treino.'],
  ],
  workout_reminder_start: [
    ['Hora de treinar!', 'Seu treino de hoje está esperando por você.'],
    ['Seu horário de treino chegou', 'Escolha uma ficha e comece quando quiser.'],
    ['Hora do treino', 'O treino planejado para hoje começa agora.'],
    ['É hora de treinar', 'Abra o Evolutus para começar.'],
  ],
  workout_reminder_before_sheet: [
    ['Treino daqui a 1 hora!', 'Sua ficha {sheet} está programada para hoje.'],
  ],
  workout_reminder_start_sheet: [
    ['Hora de treinar!', 'Sua ficha {sheet} está esperando por você.'],
  ],
  workout_reminder_before_sheets: [
    ['Treino daqui a 1 hora!', 'Você tem {count} fichas programadas para hoje.'],
  ],
  workout_reminder_start_sheets: [
    ['Hora de treinar!', 'Escolha uma das {count} fichas programadas para hoje.'],
  ],
}

export const MESSAGE_POOLS = POOLS

const FALLBACK = ['Evolutus', 'Você recebeu uma nova notificação.']
const ASSET_COIN = 'coin'

function isGroup(job) {
  return Number.isInteger(job.group_count) && job.group_count > 1
}

function actorLabel(job) {
  const name = typeof job.actor_username === 'string' ? job.actor_username.trim() : ''
  return /^[A-Za-z0-9_.-]{1,40}$/.test(name) ? `@${name}` : 'Alguém'
}

function whoLabel(job) {
  const others = job.group_count - 1
  return `${actorLabel(job)} e mais ${others} ${others === 1 ? 'pessoa' : 'pessoas'}`
}

function formatAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 && amount <= 1e9
    ? amount.toLocaleString('pt-BR')
    : null
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in values ? String(values[key]) : ''))
}

function select(pool, seq) {
  return pool[pickIndex(seq, pool.length)]
}

// Frase base de lembrete de treino: a variante vem de metadata.variant, que o banco grava SEM
// módulo; aqui reduzimos pelo tamanho do catálogo.
export function workoutReminderMessage(type, variant) {
  const pool = POOLS[type]
  if (!Array.isArray(pool)) return null
  return pool[pickIndex(variant, pool.length)]
}

// Nome de ficha vindo do banco (texto do próprio usuário): sem controles, espaço normalizado e curto o
// bastante para o corpo continuar legível ("Sua ficha … está programada para hoje.").
export function safeSheetName(value) {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? fit(clean, 40) : null
}

// [título, corpo] do lembrete (Push e Central usam o mesmo texto). Ficha nomeada só quando o banco
// gravou `sheetName` (associação única e válida); várias fichas no dia viram a contagem; nada
// disso = frase genérica rotativa.
export function workoutReminderText(type, metadata = {}, fallbackVariant = 0) {
  if (type !== 'workout_reminder_before' && type !== 'workout_reminder_start') return null
  const sheet = safeSheetName(metadata.sheetName)
  const count = Number(metadata.sheetCount)
  if (sheet) {
    const [title, body] = POOLS[`${type}_sheet`][0]
    return [title, fill(body, { sheet })]
  }
  if (Number.isInteger(count) && count > 1 && count <= 7) {
    const [title, body] = POOLS[`${type}_sheets`][0]
    return [title, fill(body, { count })]
  }
  const variant = Number.isInteger(metadata.variant) ? metadata.variant : fallbackVariant
  return workoutReminderMessage(type, variant)
}

// Reembolsos reutilizam report_resolved/admin_appeal com metadata vazia (nada financeiro no aviso):
// são reconhecidos pelo destino, fixado pelo banco.
const REFUND_URL = /^\/(evocash\?solicitacoes=|admin\/compras-evocash\?tab=refunds)/
export function isRefundNotification(actionUrl) {
  return typeof actionUrl === 'string' && REFUND_URL.test(actionUrl)
}

// Texto final do Push. Sempre devolve título/corpo dentro de LIMITS.
export function renderPushMessage(job) {
  const type = job.notification_type
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {}
  let pair

  if (type === 'workout_reminder_before' || type === 'workout_reminder_start') {
    // Já preenchido: o nome da ficha é texto do usuário e não passa por outros marcadores.
    const [title, body] = workoutReminderText(type, metadata, job.variant)
    return { title: fit(title, LIMITS.title), body: fit(body, LIMITS.body) }
  }
  if (type === 'admin_appeal' && isRefundNotification(job.action_url)) {
    pair = POOLS.admin_refund[0]
  } else if (type === 'post_like' || type === 'comment_like') {
    const pool = POOLS[type]
    pair = isGroup(job) ? select(pool.group, job.variant) : select(pool.single, job.variant)
  } else if (
    type === 'admin_report' ||
    type === 'admin_appeal' ||
    type === 'admin_privacy_request'
  ) {
    const pool = POOLS[type]
    pair = isGroup(job) ? pool.group[0] : pool.single[0]
  } else if (type === 'economy_credit') {
    const amount = formatAmount(metadata.amount)
    if (metadata.asset === ASSET_COIN) {
      pair = amount
        ? select(POOLS.economy_coin, job.variant)
        : select(POOLS.economy_coin_generic, job.variant)
    } else if (metadata.reason === 'cash_purchase_confirmed') {
      pair = POOLS.economy_payment[0]
    } else {
      pair = POOLS.economy_cash[0]
    }
  } else if (type === 'report_resolved' && isRefundNotification(job.action_url)) {
    pair = POOLS.refund_update[0]
  } else if (
    type === 'admin_broadcast' &&
    typeof metadata.title === 'string' &&
    typeof metadata.body === 'string'
  ) {
    pair = [metadata.title, metadata.body]
  } else if (Array.isArray(POOLS[type])) {
    pair = select(POOLS[type], job.variant)
  }

  const [title, body] = pair || FALLBACK
  const values = {
    actor: actorLabel(job),
    who: isGroup(job) ? whoLabel(job) : actorLabel(job),
    n: Number.isInteger(job.group_count) ? job.group_count : 1,
    amount: formatAmount(metadata.amount) ?? '',
  }
  return {
    title: fit(fill(title, values), LIMITS.title),
    body: fit(fill(body, values), LIMITS.body),
  }
}
