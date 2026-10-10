import { businessDayKey } from '../../utils/businessDate.js'
import { DEFAULT_NAME, sanitizeName } from './format.js'
import { selectGreetingCategory } from './select.js'
import { isWelcomeEligible } from './welcome.js'

export const GREETING_VOICES = ['auto', 'masculino', 'feminino', 'neutro']

// Voz do TEXTO (gramática). `auto` usa o sexo do cadastro só quando ele foi escolhido explicitamente;
// qualquer outra coisa (nao_informar, ausente, valor inesperado) vira neutro. Preferência explícita vence.
export function resolveGreetingVoice(greetingVoice, sexo) {
  if (greetingVoice === 'masculino' || greetingVoice === 'feminino' || greetingVoice === 'neutro')
    return greetingVoice
  return sexo === 'masculino' || sexo === 'feminino' ? sexo : 'neutro'
}

// Saudação por período pelo relógio LOCAL do aparelho (a mesma convenção do greeting.js legado):
// madrugada e noite = "night"; o dia de negócio (rotação) usa outro relógio, o de São Paulo.
export function getTimePeriod(now = new Date()) {
  const hours = now.getHours()
  if (hours < 5) return 'night'
  if (hours < 12) return 'morning'
  if (hours < 18) return 'afternoon'
  return 'night'
}

// Só campos que o app JÁ tem em memória; nenhuma busca extra pelo nome. Texto cru (a sanitização acontece
// ao montar o contexto).
export function resolveFirstName({ profile, user } = {}) {
  return (
    profile?.displayName?.trim().split(/\s+/)[0] ||
    profile?.username ||
    user?.user_metadata?.display_name?.trim().split(/\s+/)[0] ||
    user?.displayName?.trim().split(/\s+/)[0] ||
    DEFAULT_NAME
  )
}

// Interpreta os dados reais da Home. Puro: `now` é injetável e nada aqui faz I/O.
export function buildGreetingContext({
  username,
  firstName,
  sexo,
  greetingVoice = 'auto',
  createdAt,
  accountStatus,
  welcomeSeenAt,
  welcomeLatched = false,
  welcomeCutoffMs,
  todayState,
  reminderDue = false,
  daysSinceLastActivity = null,
  hasActivityData = true,
  offlineLocal = false,
  now = new Date(),
  businessDay,
}) {
  const timePeriod = getTimePeriod(now)
  const welcomeActive =
    welcomeLatched ||
    isWelcomeEligible({
      createdAt,
      username,
      accountStatus,
      welcomeSeenAt,
      offlineLocal,
      ...(welcomeCutoffMs !== undefined && { cutoffMs: welcomeCutoffMs }),
    })
  const category = selectGreetingCategory({
    welcomeActive,
    todayState,
    reminderDue,
    daysSinceLastActivity,
    hasActivityData,
    timePeriod,
  })
  return {
    dayKey: businessDay ?? businessDayKey(now),
    timePeriod,
    category,
    voice: resolveGreetingVoice(greetingVoice, sexo),
    firstName: sanitizeName(firstName ?? username) || DEFAULT_NAME,
    canAcknowledgeWelcome: category === 'welcome' && !offlineLocal && welcomeSeenAt === null,
  }
}
