import {
  createCommunityIdFromRequest,
  isValidCommunityCreationInput,
  communityCreationInputMatches,
  isValidCreateCommunityPrivilege,
  createCommunityEligibilityReason,
} from './privilege-core.js'
import { validId } from '../legal-core.js'

// Fase 5 (privilégios com EvoCash) -- primeiro privilégio: criação de comunidade.
//
// Diferente da Fase 4 (compra manual/PIX, com um hiato assíncrono entre pedido e
// confirmação), aqui o EvoCash já está na carteira -- então elegibilidade + criação +
// débito + ledger cabem inteiros numa ÚNICA transação atômica, sem estado intermediário
// e sem necessidade de rollback manual: se qualquer requisito falhar, a função lança
// ANTES de qualquer escrita, e nada é gravado (Firestore descarta a transação inteira).
// Isso é o que torna estruturais as duas regras fundamentais do desenho: EvoCash nunca
// é perdido sem comunidade criada, e toda comunidade criada por este caminho tem
// exatamente um lançamento de débito no ledger.
//
// Reaproveita a MESMA coleção `communities` e o MESMO schema já validado por
// isValidCommunity em firestore.rules -- não é um sistema paralelo, é um segundo
// caminho de escrita (Admin SDK, dentro de uma transação) para os mesmos documentos que
// o painel admin já escreve direto via Rules.
export function createPrivilegeService({ db, FieldValue, wallet, ledger, assertWritableAccount, HttpsError, now = Date.now }) {
  function communityRef(communityId) {
    return db.doc(`communities/${communityId}`)
  }
  function membershipRef(communityId, uid) {
    return db.doc(`communityMembers/${communityId}_${uid}`)
  }

  function eligibilityMessage(reason) {
    return (
      {
        account_disabled: 'Sua conta não está em condições de criar uma comunidade.',
        account_restricted: 'Sua conta está suspensa ou banida.',
        account_too_new: 'Sua conta ainda é muito nova para criar uma comunidade.',
        email_not_verified: 'Confirme seu e-mail antes de criar uma comunidade.',
        insufficient_reputation: 'Você ainda não tem reputação (EvoCoins) suficiente.',
        insufficient_cash: 'Você não tem EvoCash suficiente.',
      }[reason] || 'Você não atende aos requisitos para criar uma comunidade.'
    )
  }

  async function createCommunityWithCash(uid, { name, description, iconName, requestId, emailVerified }) {
    if (!isValidCommunityCreationInput({ name, description, iconName })) {
      throw new HttpsError('invalid-argument', 'Dados da comunidade inválidos.')
    }
    if (!validId(requestId)) throw new HttpsError('invalid-argument', 'Requisição inválida.')
    const communityId = createCommunityIdFromRequest(uid, requestId)
    const ref = communityRef(communityId)

    return db.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      if (existing.exists) {
        const data = existing.data()
        if (data.ownerId !== uid || !communityCreationInputMatches(data, { name, description, iconName })) {
          throw new HttpsError(
            'already-exists',
            'Este requestId já foi usado para criar uma comunidade diferente.'
          )
        }
        return { communityId, alreadyExisted: true }
      }

      await assertWritableAccount(tx, uid)

      const [user, restrictionSnap, walletSnap, configSnap] = await tx.getAll(
        db.doc(`users/${uid}`),
        db.doc(`accountRestrictions/${uid}`),
        wallet.walletRef(uid),
        db.doc('economyConfig/current')
      )
      const naturalKey = `create-community:${communityId}`
      if (await ledger.alreadyRecorded(tx, uid, naturalKey)) {
        throw new HttpsError('failed-precondition', 'Esta comunidade já foi cobrada.')
      }

      // Config sempre lida fresca (tx.get acima, nunca getEconomyConfig() com cache) --
      // ausente/inválida bloqueia, nunca cai num default embutido (dinheiro real).
      const privilege = configSnap.exists ? configSnap.data()?.privileges?.createCommunity : null
      if (!isValidCreateCommunityPrivilege(privilege)) {
        throw new HttpsError('failed-precondition', 'Configuração de privilégios indisponível no momento.')
      }

      const userData = user.exists ? user.data() : {}
      const currentWallet = walletSnap.exists
        ? walletSnap.data()
        : { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
      const restriction = restrictionSnap.exists
        ? { action: restrictionSnap.data().action, until: restrictionSnap.data().until?.toMillis() ?? null }
        : null
      const nowMs = now()

      const reason = createCommunityEligibilityReason({
        accountStatus: userData.accountStatus || 'active',
        restriction,
        accountCreatedAtMs: userData.createdAt?.toMillis ? userData.createdAt.toMillis() : 0,
        emailVerified,
        lifetimeCoinsEarned: currentWallet.lifetimeCoinsEarned,
        cashBalance: currentWallet.cashBalance,
        privilege,
        nowMs,
      })
      if (reason) throw new HttpsError('failed-precondition', eligibilityMessage(reason))

      // ---- escrita -- tudo atômico: se algo acima lançou, nada disto é alcançado ----
      tx.create(ref, {
        name: name.trim(),
        description: description?.trim() || '',
        iconName,
        isActive: true,
        postAccess: 'everyone', // nunca 'admins' -- o criador não tem papel de admin global
        memberCount: 0,
        createdBy: uid,
        ownerId: uid, // fonte autoritativa de permissão (ver Rules); === createdBy até existir transferência de posse
        createdAt: FieldValue.serverTimestamp(),
      })
      tx.create(membershipRef(communityId, uid), {
        communityId,
        userId: uid,
        role: 'owner', // só para UI/representação -- Rules nunca confiam nisto, só em communities.ownerId
        joinedAt: FieldValue.serverTimestamp(),
      })
      wallet.debitCash(tx, uid, currentWallet, privilege.cashCost)
      ledger.record(tx, uid, naturalKey, {
        asset: 'cash',
        direction: 'debit',
        amount: privilege.cashCost,
        reason: 'create_community',
        referenceType: 'community',
        referenceId: communityId,
      })

      return { communityId, alreadyExisted: false }
    })
  }

  return { createCommunityWithCash }
}
