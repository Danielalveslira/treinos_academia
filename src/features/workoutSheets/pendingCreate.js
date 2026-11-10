// Retomada de criação pendente -- P0, continuação da auditoria 2026-11-10.
//
// Uma tentativa anterior de criação (lost ACK, reload, duplo clique) NUNCA pode ser resolvida
// adivinhando pelo tempo: nenhum intervalo fixo prova que uma transação em outro lugar terminou.
// A versão anterior desta correção consultava o servidor ("existe?") com algumas retentativas
// distribuídas em ~1,3s antes de desistir -- uma mitigação por estimativa de tempo, não uma
// garantia. Substituída por uma abordagem determinística: o cliente nunca tenta adivinhar se a
// tentativa original já comitou; ele guarda o PRÓPRIO payload validado (o mesmo que enviaria de
// novo) sob a MESMA identidade (create_request_id) e, na próxima ação do usuário (salvar ou
// cancelar), reenvia por essa identidade através de create_workout_sheet -- cuja serialização
// (lock por conta, já existente desde 20261122000001) resolve a ordem de qualquer concorrência
// no próprio Postgres, não no cliente:
//   - se a tentativa original ainda estiver em execução, a nova chamada espera o MESMO lock que
//     ela já segura e só prossegue depois que a transação dela terminar;
//   - se ela já comitou, create_workout_sheet encontra a linha pelo request_id e reconcilia
//     (20261215000002) -- nunca cria uma segunda;
//   - se ela nunca chegou ao banco, esta chamada cria a ficha pela primeira (e única) vez.
// Nenhuma pergunta "existe?" precisa de resposta antes disso -- por isso não há mais janela de
// corrida nenhuma para adivinhar.
const pendingCreateKey = (uid) => `evolutus:sheet:pendingCreate:${uid}`
const SNAPSHOT_VERSION = 1

// Estrutura mínima pra identificar e refazer a tentativa: a identidade (request_id) e o payload
// validado da ficha (nome/objetivo/dias/itens -- os mesmos campos que create_workout_sheet já
// recebe). Nunca um token, nunca uma credencial. Validação de formato/versão/integridade na
// leitura: um valor corrompido ou de um formato antigo nunca é interpretado -- é tratado como
// "nada pendente", nunca como prova de qualquer coisa sobre o servidor.
export function readPendingCreateSnapshot(uid) {
  try {
    const raw = sessionStorage.getItem(pendingCreateKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed?.version !== SNAPSHOT_VERSION ||
      typeof parsed.requestId !== 'string' ||
      !parsed.requestId ||
      typeof parsed.sheet !== 'object' ||
      parsed.sheet === null ||
      typeof parsed.sheet.name !== 'string' ||
      !Array.isArray(parsed.sheet.items)
    )
      return null
    return { requestId: parsed.requestId, sheet: parsed.sheet }
  } catch {
    return null
  }
}
export function writePendingCreateSnapshot(uid, requestId, sheet) {
  try {
    if (requestId && sheet) {
      sessionStorage.setItem(
        pendingCreateKey(uid),
        JSON.stringify({ version: SNAPSHOT_VERSION, requestId, sheet })
      )
    } else {
      sessionStorage.removeItem(pendingCreateKey(uid))
    }
  } catch {
    /* Best-effort only: perder isto nunca duplica nem sobrescreve -- só perde a retomada. */
  }
}
