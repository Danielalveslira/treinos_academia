import { buildAutomatedSuspension } from './moderation-core.js'

// Achado #3 da auditoria de segurança: um rate limit embutido nas regras (postLimits/{uid}
// com get() extra em canCreateStatus) reproduz, no pior caso combinado (enquete pesada +
// authorUsername preenchido + o próprio throttle extra), o teto de chamadas get()/exists()
// por avaliação de regra — confirmado no emulador antes desta versão existir. Por isso o
// throttle fica aqui, num gatilho onCreate com Admin SDK (sem esse teto), em vez de nas
// regras.
//
// Extraído em módulo próprio (mesmo padrão de community-members-service.js) pra poder ser
// testado contra o emulador chamando a função direto, sem simular o CloudEvent completo de
// um gatilho Firestore.
//
// Janela deslizante em rateLimitCounters/{uid} em vez de consultar statuses por
// authorId+createdAt: evita precisar de um índice composto novo (não existe hoje em
// firestore.indexes.json) e mantém o custo constante (uma leitura + uma escrita por post),
// independente do tamanho da coleção statuses. O array fica auto-limitado: cada chamada
// descarta as entradas mais antigas que a janela, então nunca cresce além de
// RATE_LIMIT_MAX_POSTS + 1 mesmo que o usuário nunca mais poste depois.
export const RATE_LIMIT_MAX_POSTS = 8
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const RATE_LIMIT_SUSPENSION_MS = 30 * 60 * 1000

// Começa em modo só-log de propósito: o limiar (8 posts/10min) foi calibrado olhando o
// código hoje (toda publicação exige um toque manual, sem fluxo de criação em lote), não
// com dados reais de uso. Trocar para true só depois de observar alguns dias de uso real
// pós-lançamento nos logs ("rate-limit threshold crossed") sem falso positivo.
export const RATE_LIMIT_ENFORCE = false

export function createEnforcePostRateLimit({
  db,
  FieldValue,
  Timestamp,
  enforce = RATE_LIMIT_ENFORCE,
}) {
  return async function enforcePostRateLimit(authorId, postedAtMs = Date.now()) {
    if (!authorId) return
    const counterRef = db.doc(`rateLimitCounters/${authorId}`)
    const decisionRef = db.collection('moderationDecisions').doc()
    let windowCount = 0
    let crossed = false
    // Execução "pelo menos uma vez" de gatilhos Firestore: uma rara reexecução do evento
    // inteiro (não da transação, que já tem sua própria retentativa por contenção)
    // poderia contar o mesmo post duas vezes no pior caso. Aceitável para um heurístico
    // de abuso calibrado em "mais de 8" — um erro de +1 não muda a conclusão.
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(counterRef)
      const previous = snapshot.exists ? snapshot.data().postedAt || [] : []
      const windowStart = postedAtMs - RATE_LIMIT_WINDOW_MS
      const recent = previous.filter((ms) => ms > windowStart)
      recent.push(postedAtMs)
      windowCount = recent.length
      tx.set(counterRef, { postedAt: recent })
      crossed = windowCount > RATE_LIMIT_MAX_POSTS
      if (!crossed || !enforce) return
      const until = Timestamp.fromMillis(postedAtMs + RATE_LIMIT_SUSPENSION_MS)
      const { decision, notice, restriction } = buildAutomatedSuspension({
        authorId,
        decisionId: decisionRef.id,
        windowCount,
        windowMinutes: RATE_LIMIT_WINDOW_MS / 60000,
      })
      tx.create(decisionRef, { ...decision, until, createdAt: FieldValue.serverTimestamp() })
      tx.set(db.doc(`users/${authorId}/notices/${decisionRef.id}`), {
        ...notice,
        until,
        createdAt: FieldValue.serverTimestamp(),
      })
      tx.set(db.doc(`accountRestrictions/${authorId}`), { ...restriction, until })
    })
    if (crossed) {
      // Modo só-log: confirma no Cloud Logging que o limiar teria sido cruzado, sem
      // aplicar a restrição de fato — é isso que permite observar uso real antes de
      // ligar RATE_LIMIT_ENFORCE.
      console.log(
        enforce ? 'rate-limit restriction applied' : 'rate-limit threshold crossed (log-only)',
        { authorId, windowCount }
      )
    }
  }
}
