// Fase 5 -- auditoria de compatibilidade de ownerId.
//
// ownerId é opcional em firestore.rules (isValidCommunity) de propósito: uma comunidade
// criada ANTES da Fase 5 não tem esse campo, e continua editável pelo superadmin sem
// migração obrigatória (a checagem de autorização usa .get('ownerId', null), então a
// ausência do campo nunca vira "qualquer uid é dono" nem trava a edição). Este script
// existe só para quem, depois, decidir formalmente atribuir um dono a comunidades
// antigas -- ele NUNCA é executado automaticamente e não faz parte de nenhum fluxo
// de deploy.
//
// createdBy é o melhor proxy disponível para "quem deveria ser o dono" retroativamente
// (é quem de fato criou a comunidade) -- mas atribuir posse é uma decisão de produto,
// não uma inferência técnica automática, por isso o dry-run é o padrão e a escrita real
// exige --apply explícito.
//
// Uso:
//   node scripts/backfill-community-owner-id.mjs             (dry-run, não escreve nada)
//   node scripts/backfill-community-owner-id.mjs --apply      (grava de verdade)
//
// NÃO EXECUTAR EM PRODUÇÃO SEM DECISÃO EXPLÍCITA -- ver auditoria da Fase 5.

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  const snapshot = await db.collection('communities').get()
  const missing = snapshot.docs.filter((doc) => typeof doc.data().ownerId !== 'string')

  console.log(`${snapshot.size} comunidade(s) no total, ${missing.length} sem ownerId.`)
  for (const doc of missing) {
    const createdBy = doc.data().createdBy
    console.log(`  ${doc.id}: ownerId ausente -> proposto ownerId=${createdBy ?? '(createdBy também ausente -- pular)'}`)
  }

  if (!apply) {
    console.log('\nDry-run (padrão). Nenhuma escrita foi feita. Rode com --apply para gravar de verdade.')
    return
  }

  let written = 0
  let skipped = 0
  for (const doc of missing) {
    const createdBy = doc.data().createdBy
    if (typeof createdBy !== 'string') {
      skipped++
      continue
    }
    await doc.ref.update({ ownerId: createdBy })
    written++
  }
  console.log(`\nGravado ownerId em ${written} comunidade(s). ${skipped} pulada(s) por não ter createdBy.`)
}

await main()
