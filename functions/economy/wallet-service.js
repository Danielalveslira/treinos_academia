// users/{uid}/wallet/current -- a Admin SDK é a única autoridade (firestore.rules
// bloqueia toda escrita do cliente). O documento nasce só na primeira operação
// econômica do usuário; até lá, saldo é implicitamente zero (mesmo padrão de criação
// preguiçosa já usado em publicProfiles).
export function createWalletService({ db, FieldValue }) {
  function walletRef(uid) {
    return db.doc(`users/${uid}/wallet/current`)
  }

  // Precisa ser chamado dentro de uma transação (tx.get) -- quem credita/debita sempre
  // precisa ler o saldo atual antes de decidir o novo valor, na mesma transação que vai
  // gravar o resultado.
  async function getWallet(tx, uid) {
    const snapshot = await tx.get(walletRef(uid))
    return snapshot.exists
      ? snapshot.data()
      : { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
  }

  // EvoCoins ganhos nunca reduzem lifetimeCoinsEarned (seção 3: "lifetimeCoinsEarned
  // nunca diminui") -- só o débito (ver debitCoins) mexe em coinBalance sem tocar nela.
  function creditCoins(tx, uid, currentWallet, amount) {
    tx.set(
      walletRef(uid),
      {
        coinBalance: currentWallet.coinBalance + amount,
        lifetimeCoinsEarned: currentWallet.lifetimeCoinsEarned + amount,
        cashBalance: currentWallet.cashBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  }

  // Seção 5: "saldo nunca pode ficar negativo" -- não é uma checagem opcional, é
  // estrutural: quem chama isto SEMPRE deveria já ter confirmado saldo suficiente antes
  // (ver vote-service.js), então este throw nunca deveria disparar em uso normal; existe
  // como rede de segurança de última linha, não como o caminho de decisão do voto (que
  // precisa devolver um HttpsError amigável, não uma exceção genérica).
  function debitCoins(tx, uid, currentWallet, amount) {
    const nextBalance = currentWallet.coinBalance - amount
    if (nextBalance < 0) {
      throw new Error('Saldo de EvoCoins insuficiente.')
    }
    tx.set(
      walletRef(uid),
      {
        coinBalance: nextBalance,
        lifetimeCoinsEarned: currentWallet.lifetimeCoinsEarned,
        cashBalance: currentWallet.cashBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  }

  // Fase 4 (EvoCash): só cashBalance muda -- nunca coinBalance/lifetimeCoinsEarned
  // (unidades independentes, seção 4 do prompt de economia: "não converte diretamente
  // de EvoCoins"). Number.isSafeInteger (não só isInteger) e >= 0 checados no resultado
  // FINAL antes de gravar -- dinheiro real, então uma corrupção aritmética silenciosa
  // (NaN, Infinity, overflow) precisa travar a operação, nunca virar um valor gravado.
  function creditCash(tx, uid, currentWallet, amount) {
    const nextCashBalance = currentWallet.cashBalance + amount
    if (!Number.isSafeInteger(nextCashBalance) || nextCashBalance < 0) {
      throw new Error('Saldo de EvoCash inválido após o crédito.')
    }
    tx.set(
      walletRef(uid),
      {
        coinBalance: currentWallet.coinBalance,
        lifetimeCoinsEarned: currentWallet.lifetimeCoinsEarned,
        cashBalance: nextCashBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  }

  // Fase 5 (privilégios): mesmo tratamento defensivo de debitCoins, mas em cashBalance.
  // A checagem "saldo suficiente" já deveria ter acontecido antes, na mesma transação
  // (ver privilege-service.js) -- este throw é rede de segurança de última linha, nunca
  // o caminho de decisão de elegibilidade.
  function debitCash(tx, uid, currentWallet, amount) {
    const nextCashBalance = currentWallet.cashBalance - amount
    if (!Number.isSafeInteger(nextCashBalance) || nextCashBalance < 0) {
      throw new Error('Saldo de EvoCash insuficiente.')
    }
    tx.set(
      walletRef(uid),
      {
        coinBalance: currentWallet.coinBalance,
        lifetimeCoinsEarned: currentWallet.lifetimeCoinsEarned,
        cashBalance: nextCashBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  }

  return { walletRef, getWallet, creditCoins, debitCoins, creditCash, debitCash }
}
