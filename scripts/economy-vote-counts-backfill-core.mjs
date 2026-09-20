// "Ver quem votou" -- backfill único de positiveVoteCount/negativeVoteCount para
// publicações que já têm votos gravados ANTES deste campo existir. Sem isso, o
// gatilho onEconomyVoteWritten (autossuficiente, mesmo raciocínio de bumpMemberCount)
// só corrigiria a contagem de um post antigo no PRÓXIMO voto recebido -- até lá, a UI
// mostraria "0" mesmo havendo votos reais. Dry-run por padrão; --apply grava de
// verdade. Idempotente: só recalcula publicações onde algum dos dois campos ainda não
// é number; rodar de novo depois de aplicado não teria mais nada a fazer.
export function parseBackfillArgs(args) {
  let apply = false
  for (const arg of args) {
    if (arg === '--apply' && !apply) {
      apply = true
    } else {
      throw new Error('Use: node scripts/backfill-economy-vote-counts.mjs [--apply]')
    }
  }
  return { apply }
}

export async function runEconomyVoteCountsBackfill({
  apply,
  listStatusIdsMissingCounts,
  countVotesByValue,
  applyCounts,
  log = () => {},
}) {
  const statusIds = await listStatusIdsMissingCounts()
  const mode = apply ? 'APPLY' : 'DRY-RUN'
  log(`${mode}: ${statusIds.length} publicação(ões) sem positiveVoteCount/negativeVoteCount.`)
  if (!apply) return { mode, total: statusIds.length, written: 0, failed: 0 }

  let written = 0
  let failed = 0
  for (const statusId of statusIds) {
    try {
      const counts = await countVotesByValue(statusId)
      await applyCounts(statusId, counts)
      written += 1
    } catch (error) {
      failed += 1
      log(`  falha em ${statusId}: ${error.message}`)
    }
  }
  log(`APPLY concluído: ${written} gravados, ${failed} falhas.`)
  const summary = { mode, total: statusIds.length, written, failed }
  if (failed) {
    const error = new Error(`Backfill incompleto: ${failed} publicação(ões) falharam.`)
    error.result = summary
    throw error
  }
  return summary
}
