import { validId } from '../legal-core.js'
import {
  isValidPixMethodFields,
  isValidPixMethodLabel,
  generatePixMethodId,
  buildPublicPixPaymentProjection,
} from './pix-payment-core.js'

// Administração de chaves PIX (aba "Configuração PIX" de /admin/compras-evocash).
// privatePaymentConfig/pix é server-only (ver firestore.rules: allow read, write: if
// false, sem exceção nem para superadmin via client SDK) -- todo o CRUD passa só por
// aqui, via Admin SDK. Cada função verifica role==='superadmin' na própria transação
// (mesmo padrão de confirmCashPurchase/cancelCashPurchase em cash-purchase-service.js),
// nunca confiando num helper externo checado antes.
//
// economyConfig/current.pixPayment é só a PROJEÇÃO PÚBLICA da chave ativa (o formato que
// requestCashPurchase já espera, ver isValidPixPayment em cash-purchase-core.js) --
// republicada sempre que a chave ativa muda, é editada, ou o toggle global muda. Nunca
// expõe label/createdAt/updatedAt nem qualquer outra chave cadastrada além da ativa.
// cashPackages/promotionPackages nunca são lidos nem escritos por este módulo.
//
// CRÍTICO: toda publicação em economyConfig/current usa tx.update({pixPayment: {...}}),
// NUNCA tx.set(..., {merge:true}). pixPayment é um mapa aninhado, e merge:true faz merge
// RECURSIVO em mapas aninhados -- já comprovado com cashPackages (chaves antigas
// sobreviviam a uma escrita que devia removê-las). Aqui o risco é o mesmo na direção
// oposta: ao desativar, publicar só {enabled:false} via merge:true deixaria key/keyType/
// recipientName da chave anterior sobrevivendo em economyConfig/current, vazando o
// destino de PIX mesmo com os pagamentos desligados. update() substitui o campo
// pixPayment inteiro, atomicamente, sem tocar cashPackages/promotionPackages (campos
// irmãos, fora do path atualizado).
export function createPixPaymentAdminService({ db, FieldValue, HttpsError }) {
  function privateConfigRef() {
    return db.doc('privatePaymentConfig/pix')
  }
  function economyConfigRef() {
    return db.doc('economyConfig/current')
  }
  function adminRef(uid) {
    return db.doc(`users/${uid}`)
  }
  function emptyConfig() {
    return { enabled: false, activeMethodId: null, methods: {} }
  }
  function assertSuperAdmin(adminSnapshot) {
    if (adminSnapshot.data()?.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Apenas administradores podem gerenciar pagamentos PIX.')
    }
  }

  async function listPixPaymentMethods(adminId) {
    const admin = await adminRef(adminId).get()
    assertSuperAdmin(admin)
    const snapshot = await privateConfigRef().get()
    const data = snapshot.exists ? snapshot.data() : emptyConfig()
    const methods = Object.entries(data.methods || {})
      .map(([id, method]) => ({ id, ...method }))
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
    return { enabled: data.enabled === true, activeMethodId: data.activeMethodId || null, methods }
  }

  async function savePixPaymentMethod(adminId, { methodId, label, key, keyType, recipientName }) {
    if (!isValidPixMethodLabel(label)) {
      throw new HttpsError('invalid-argument', 'Nome identificador inválido.')
    }
    if (!isValidPixMethodFields({ key, keyType, recipientName })) {
      throw new HttpsError('invalid-argument', 'Dados da chave PIX inválidos.')
    }
    return db.runTransaction(async (tx) => {
      const [admin, configSnapshot, economyConfigSnapshot] = await tx.getAll(
        adminRef(adminId),
        privateConfigRef(),
        economyConfigRef()
      )
      assertSuperAdmin(admin)
      const data = configSnapshot.exists ? configSnapshot.data() : emptyConfig()
      const existing = methodId ? data.methods?.[methodId] : null
      const id = existing ? methodId : generatePixMethodId()
      const now = FieldValue.serverTimestamp()
      const method = {
        label: label.trim(),
        key: key.trim(),
        keyType,
        recipientName: recipientName.trim(),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }
      tx.set(privateConfigRef(), { methods: { [id]: method } }, { merge: true })
      // Editar a chave ATIVA precisa republicar a projeção pública na hora -- senão
      // economyConfig/current.pixPayment ficaria com dados velhos até a próxima ativação.
      if (data.activeMethodId === id) {
        if (!economyConfigSnapshot.exists) {
          throw new HttpsError('failed-precondition', 'economyConfig/current ainda não existe.')
        }
        tx.update(economyConfigRef(), {
          pixPayment: buildPublicPixPaymentProjection(data.enabled === true, method),
        })
      }
      return { id, ...method }
    })
  }

  async function setActivePixPaymentMethod(adminId, { methodId }) {
    if (!validId(methodId)) throw new HttpsError('invalid-argument', 'Chave PIX inválida.')
    return db.runTransaction(async (tx) => {
      const [admin, configSnapshot, economyConfigSnapshot] = await tx.getAll(
        adminRef(adminId),
        privateConfigRef(),
        economyConfigRef()
      )
      assertSuperAdmin(admin)
      const data = configSnapshot.exists ? configSnapshot.data() : emptyConfig()
      const method = data.methods?.[methodId]
      if (!method) throw new HttpsError('not-found', 'Chave PIX não encontrada.')
      if (!economyConfigSnapshot.exists) {
        throw new HttpsError('failed-precondition', 'economyConfig/current ainda não existe.')
      }
      tx.set(
        privateConfigRef(),
        { activeMethodId: methodId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )
      // Pedidos pending já existentes nunca são tocados -- eles têm o próprio
      // pixPaymentSnapshot (ver cash-purchase-service.js), gravado no momento em que
      // foram criados. Só NOVOS pedidos, a partir de agora, leem esta chave.
      tx.update(economyConfigRef(), {
        pixPayment: buildPublicPixPaymentProjection(data.enabled === true, method),
      })
      return { activeMethodId: methodId }
    })
  }

  async function deletePixPaymentMethod(adminId, { methodId }) {
    if (!validId(methodId)) throw new HttpsError('invalid-argument', 'Chave PIX inválida.')
    return db.runTransaction(async (tx) => {
      const [admin, configSnapshot] = await tx.getAll(adminRef(adminId), privateConfigRef())
      assertSuperAdmin(admin)
      const data = configSnapshot.exists ? configSnapshot.data() : emptyConfig()
      if (!data.methods?.[methodId]) throw new HttpsError('not-found', 'Chave PIX não encontrada.')
      // Nunca excluir a chave em uso -- excluir silenciosamente deixaria
      // economyConfig/current.pixPayment apontando para uma chave que não existe mais no
      // cadastro. O admin precisa ativar outra primeiro (setActivePixPaymentMethod).
      if (data.activeMethodId === methodId) {
        throw new HttpsError(
          'failed-precondition',
          'Não é possível excluir a chave ativa. Ative outra chave antes de excluir esta.'
        )
      }
      tx.update(privateConfigRef(), {
        [`methods.${methodId}`]: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { deleted: true }
    })
  }

  async function setPixPaymentsEnabled(adminId, { enabled }) {
    if (typeof enabled !== 'boolean') throw new HttpsError('invalid-argument', 'Valor de habilitação inválido.')
    return db.runTransaction(async (tx) => {
      const [admin, configSnapshot, economyConfigSnapshot] = await tx.getAll(
        adminRef(adminId),
        privateConfigRef(),
        economyConfigRef()
      )
      assertSuperAdmin(admin)
      const data = configSnapshot.exists ? configSnapshot.data() : emptyConfig()
      if (enabled && !data.activeMethodId) {
        throw new HttpsError(
          'failed-precondition',
          'Selecione uma chave PIX ativa antes de habilitar os pagamentos.'
        )
      }
      const activeMethod = data.activeMethodId ? data.methods?.[data.activeMethodId] : null
      if (activeMethod && !economyConfigSnapshot.exists) {
        throw new HttpsError('failed-precondition', 'economyConfig/current ainda não existe.')
      }
      tx.set(privateConfigRef(), { enabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      if (activeMethod) {
        tx.update(economyConfigRef(), { pixPayment: buildPublicPixPaymentProjection(enabled, activeMethod) })
      }
      return { enabled }
    })
  }

  return {
    listPixPaymentMethods,
    savePixPaymentMethod,
    setActivePixPaymentMethod,
    deletePixPaymentMethod,
    setPixPaymentsEnabled,
  }
}
