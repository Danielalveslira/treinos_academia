import { createHash } from 'node:crypto'

// users/{uid}/economyTransactions/{idempotencyKeyHash} -- o hash da chave natural da
// operação (ex.: "daily-activity:2026-09-17") vira o próprio ID do documento. Isso dá
// idempotência "de graça": duas tentativas da mesma operação (duplo clique, retry,
// reexecução) tentam criar o MESMO documento, e tx.create() falha na segunda -- sem
// precisar de uma query extra pra descobrir se já rodou.
export function ledgerNaturalKeyHash(uid, naturalKey) {
  return createHash('sha256').update(`${uid}:${naturalKey}`).digest('hex')
}

export function createLedgerService({ db, FieldValue }) {
  function ledgerRef(uid, naturalKey) {
    return db.doc(`users/${uid}/economyTransactions/${ledgerNaturalKeyHash(uid, naturalKey)}`)
  }

  // Leitura precisa vir antes de qualquer escrita na transação que chama isto (regra do
  // Firestore: todo tx.get() antes do primeiro tx.set()/create()/update()).
  async function alreadyRecorded(tx, uid, naturalKey) {
    const snapshot = await tx.get(ledgerRef(uid, naturalKey))
    return snapshot.exists
  }

  // append-only (seção 6): nunca update/delete num lançamento já criado.
  function record(tx, uid, naturalKey, entry) {
    tx.create(ledgerRef(uid, naturalKey), {
      ...entry,
      idempotencyKeyHash: ledgerNaturalKeyHash(uid, naturalKey),
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  return { ledgerRef, alreadyRecorded, record }
}
