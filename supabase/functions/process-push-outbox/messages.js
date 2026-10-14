// Catálogo ÚNICO de mensagens de Push do Evolutus (e dos títulos de lembrete na Central).
//
// Por que em código e não em tabela: é versionado/revisado como o resto, não custa consulta por
// mensagem (o worker já recebe tipo, variante e contagem no claim) e o frontend importa o mesmo
// módulo. Cada mensagem é [título, corpo] com marcadores: {actor} "@fulano" (ou "Alguém"),
// {who} "@fulano e mais N pessoas" (grupos) e {amount} (EvoCoins). A essência vem nas primeiras
// palavras (Android/Windows cortam cedo) e tudo passa por `fit`.
//
// Tom: social/recompensas/treino têm personalidade (curto, caloroso, sem pressão negativa);
// moderação, segurança, privacidade, dinheiro e administração são OBJETIVOS e genéricos
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
    [
      '💚 Boas-vindas ao Evolutus!',
      'Obrigado por usar o Evolutus! As notificações estão ativadas neste dispositivo.',
    ],
  ],
  post_like: {
    single: [
      ['🔥 Seu post chamou atenção', '{actor} curtiu sua publicação.'],
      ['👀 Alguém gostou disso', '{actor} deixou uma curtida no seu post.'],
      ['💚 Mandou bem!', '{actor} curtiu sua publicação.'],
      ['⚡ Mais uma curtida', '{actor} curtiu o que você publicou.'],
      ['🙌 Boa!', '{actor} curtiu seu post.'],
      ['✨ Seu post brilhou', '{actor} curtiu sua publicação.'],
      ['👏 Post aprovado', '{actor} curtiu sua publicação.'],
      ['💪 Reconhecimento chegando', '{actor} curtiu o seu post.'],
    ],
    group: [
      ['🔥 Seu post está em alta', '{who} curtiram sua publicação.'],
      ['👀 Chuva de curtidas', '{who} curtiram seu post.'],
      ['💚 Seu post fez sucesso', '{who} curtiram o que você publicou.'],
      ['⚡ Curtida em dobro (e mais)', '{who} curtiram sua publicação.'],
      ['🙌 A galera aprovou', '{who} curtiram seu post.'],
    ],
  },
  comment_like: {
    single: [
      ['💬 Esse comentário bateu bem', '{actor} curtiu o que você disse.'],
      ['👏 Concordância detectada', '{actor} curtiu seu comentário.'],
      ['🔥 Você disse tudo', '{actor} curtiu seu comentário.'],
      ['💚 Comentário aprovado', '{actor} curtiu o que você comentou.'],
      ['👀 Alguém concordou', '{actor} curtiu seu comentário.'],
      ['✨ Boa colocação', '{actor} curtiu o seu comentário.'],
    ],
    group: [
      ['💬 Seu comentário fez sucesso', '{who} curtiram o que você disse.'],
      ['👏 Todo mundo concordou', '{who} curtiram seu comentário.'],
      ['🔥 Comentário em alta', '{who} curtiram seu comentário.'],
      ['💚 Aprovação em grupo', '{who} curtiram o que você comentou.'],
    ],
  },
  post_reply: [
    ['💬 Tem conversa nova', '{actor} comentou na sua publicação.'],
    ['👀 Chegou comentário', '{actor} comentou no seu post.'],
    ['🗣️ Seu post gerou papo', '{actor} comentou na sua publicação.'],
    ['✍️ Alguém falou sobre o seu post', '{actor} deixou um comentário.'],
    ['🔔 Novo comentário', '{actor} comentou na sua publicação.'],
    ['💭 Opinião chegando', '{actor} comentou no seu post.'],
  ],
  comment_reply: [
    ['👀 Você recebeu uma resposta', '{actor} respondeu seu comentário.'],
    ['🗣️ A conversa continua', '{actor} respondeu você.'],
    ['🔔 Chamaram você de volta', 'Tem uma nova resposta esperando por você.'],
    ['💬 Resposta na área', '{actor} respondeu o que você disse.'],
    ['✍️ Alguém te respondeu', '{actor} respondeu você por aqui.'],
    ['📬 Resposta nova', '{actor} respondeu seu comentário.'],
  ],
  comment_mention: [
    ['📣 Você foi mencionado', '{actor} mencionou você em um comentário.'],
    ['👀 Falaram de você', '{actor} citou você em um comentário.'],
    ['🔔 Chamaram seu nome', '{actor} mencionou você.'],
    ['💬 Tem menção nova', '{actor} marcou você em um comentário.'],
  ],
  // Só moedas (EvoCoins) mostram valor; EvoCash e saldo nunca aparecem no Push.
  economy_coin: [
    ['🪙 +{amount} EvoCoins', 'Sua recompensa acabou de chegar.'],
    ['💰 Recompensa desbloqueada', 'Você ganhou {amount} EvoCoins.'],
    ['✨ Caiu recompensa', '{amount} EvoCoins novos na sua carteira.'],
    ['🪙 EvoCoins chegando!', 'Sua carteira acabou de ganhar {amount}.'],
    ['🎉 Mais moedas pra você', '{amount} EvoCoins foram creditados.'],
  ],
  economy_coin_generic: [
    ['🪙 EvoCoins chegando!', 'Sua carteira acabou de ganhar um reforço.'],
    ['💰 Recompensa desbloqueada', 'Tem EvoCoins novos esperando por você.'],
    ['✨ Caiu recompensa', 'Abra o Evolutus para conferir.'],
  ],
  economy_payment: [['✅ Pagamento confirmado', 'Sua compra foi processada. Toque para conferir.']],
  economy_cash: [['🪙 Você recebeu EvoCash', 'Abra o Evolutus para conferir.']],
  economy_debit: [['Atualização na sua carteira', 'Houve um ajuste. Toque para conferir.']],
  moderation_notice: [
    ['Aviso da conta', 'Você recebeu uma atualização na sua conta. Toque para conferir.'],
  ],
  report_resolved: [['Atendimento', 'Seu caso teve uma atualização. Toque para ver.']],
  admin_report: {
    single: [['🛡️ Moderação', 'Há uma nova denúncia aguardando análise.']],
    group: [['🛡️ Moderação', '{n} novas denúncias aguardando análise.']],
  },
  admin_appeal: {
    single: [['🛡️ Moderação', 'Há um novo recurso aguardando análise.']],
    group: [['🛡️ Moderação', '{n} novos recursos aguardando análise.']],
  },
  admin_privacy_request: {
    single: [['🔒 Privacidade', 'Há um novo pedido aguardando análise.']],
    group: [['🔒 Privacidade', '{n} novos pedidos aguardando análise.']],
  },
  admin_moderation_decision: [['Moderação', 'Uma decisão foi registrada.']],
  admin_restriction: [['Moderação', 'Uma restrição foi aplicada.']],
  admin_deletion_review: [['Exclusão de conta', 'Há uma revisão aguardando análise.']],
  admin_broadcast: [['Aviso do Evolutus', 'Você recebeu um aviso importante.']],
  // Treinos: famílias motivacional, divertida, desafiadora (sem pressão negativa), contextual e leve.
  // O plano semanal não guarda grupo muscular, então o "contextual" fala de horário, não de exercício.
  workout_reminder_before: [
    ['🏋️ Treino daqui a 1 hora', 'Seu plano está pronto. Bora se preparar?'],
    ['🔥 Hoje tem treino', 'Falta 1 hora. Seu plano está pronto.'],
    ['👀 Seu treino está chegando', 'Daqui a 1 hora o plano entra em ação.'],
    ['⏰ Contagem regressiva', '1 hora para o seu treino. Hora de se organizar.'],
    ['⚡ Já já é hora', 'Seu treino começa em 1 hora.'],
    ['🎯 Missão do dia a caminho', 'Em 1 hora: completar o treino que você planejou.'],
    ['👟 Separe o tênis', 'O treino começa em 1 hora.'],
    ['💧 Hidratação ligada', 'Garrafinha na mão: o treino começa em 1 hora.'],
    ['🫡 Seu treino já se apresentou', 'Começa em 1 hora. Falta você.'],
    ['🔔 Faltando pouco', 'Seu treino de hoje começa em 1 hora.'],
    ['💪 O plano está de pé', '1 hora para colocá-lo em prática.'],
    ['🏃 Aquecendo os motores', 'Seu treino começa em 1 hora. Vamos?'],
  ],
  workout_reminder_start: [
    ['⏰ Seu treino começa agora', 'Tudo pronto para você começar.'],
    ['🏋️ Hora de treinar!', 'Seu treino de hoje está esperando.'],
    ['🔥 Bora?', 'Você marcou este horário por um motivo.'],
    ['👀 Seu treino percebeu que você sumiu', 'Ele está te esperando.'],
    ['🏋️ Alô, músculos?', 'Tem treino marcado por aqui.'],
    ['⚡ Hora de colocar o plano em prática', 'Seu treino está pronto.'],
    ['🎯 Missão do dia', 'Completar o treino que você planejou.'],
    ['👟 Roupa de treino: opcional.', 'Aparecer: recomendado 😄'],
    ['🫡 Seu treino se apresentou para o serviço', 'Agora falta você.'],
    ['💪 É agora', 'O plano está feito. Falta só começar.'],
    ['🚀 Decolagem autorizada', 'Seu treino de hoje já pode começar.'],
    ['✅ Tudo no lugar', 'Seu plano está pronto. Pode começar quando quiser.'],
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

// Título de lembrete de treino (Central e Push usam o mesmo): a variante vem de metadata.variant,
// que o banco grava SEM módulo; aqui reduzimos pelo tamanho do catálogo.
export function workoutReminderMessage(type, variant) {
  const pool = POOLS[type]
  if (!Array.isArray(pool)) return null
  return pool[pickIndex(variant, pool.length)]
}

// Texto final do Push. Sempre devolve título/corpo dentro de LIMITS.
export function renderPushMessage(job) {
  const type = job.notification_type
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {}
  let pair

  if (type === 'post_like' || type === 'comment_like') {
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
  } else if (type === 'workout_reminder_before' || type === 'workout_reminder_start') {
    const variant = Number.isInteger(metadata.variant) ? metadata.variant : job.variant
    pair = workoutReminderMessage(type, variant)
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
