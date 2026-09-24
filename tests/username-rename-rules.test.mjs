import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'

// AUD-010: reproduz explicitamente o bypass que a Cloud Function renameUsername
// (functions/index.js) foi criada para fechar -- o cliente reconstruindo o fluxo
// antigo (reservar usernames/{novo} num write, depois trocar users/publicProfiles
// noutro) sem passar pela transação atômica. Suíte própria (seed mínimo) para não
// herdar o custo de avaliação de regra das publicações de tests/profile-rules.test.mjs.
let env
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-treinos',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users/owner'), { role: 'user', username: 'owner' })
    await setDoc(doc(db, 'publicProfiles/owner'), {
      username: 'owner',
      bio: null,
      shareStatistics: false,
    })
    await setDoc(doc(db, 'usernames/owner'), { uid: 'owner', createdAt: Timestamp.now() })
  })
})
after(async () => {
  await env?.cleanup()
})

// A única transição que o cliente ainda faz direto é a reivindicação inicial (@
// ausente -> primeiro @), exatamente o que Register.jsx faz uma vez só (ver
// ensureUserProfile + setUsername em usersService.js). Prova que a correção do
// AUD-010 não quebrou o cadastro.
test('initial username claim (registration) still works entirely with direct client writes', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/newbie'), { role: 'user' })
    await setDoc(doc(context.firestore(), 'publicProfiles/newbie'), {
      username: null,
      bio: null,
      shareStatistics: false,
    })
  })
  const newbie = env.authenticatedContext('newbie').firestore()
  await assertSucceeds(
    setDoc(doc(newbie, 'usernames/newbiehandle'), { uid: 'newbie', createdAt: serverTimestamp() })
  )
  await assertSucceeds(updateDoc(doc(newbie, 'users/newbie'), { username: 'newbiehandle' }))
  await assertSucceeds(
    setDoc(
      doc(newbie, 'publicProfiles/newbie'),
      { username: 'newbiehandle', bio: null, shareStatistics: false },
      { merge: true }
    )
  )
  // E, a partir daqui, "newbie" também já não consegue mais trocar de @ sozinho --
  // agora que já tem um definido (newbiehandle), vira o mesmo caso de "owner" testado
  // abaixo: nem a reserva de um nome novo, nem o update em si, passam mais direto.
  await assertFails(
    setDoc(doc(newbie, 'usernames/newbiesecond'), { uid: 'newbie', createdAt: serverTimestamp() })
  )
  await assertFails(updateDoc(doc(newbie, 'users/newbie'), { username: 'newbiesecond' }))
})

// "owner" já tem um @ definido desde o setup (não é cadastro inicial), então toda
// tentativa de troca feita por escrita direta precisa falhar, mesmo quando a reserva
// do nome novo é legítima e aponta para o próprio uid. A reserva em si é seedada com
// as regras desligadas (simula o estado que uma reserva pré-existente deixaria) em vez
// de criada pelo próprio "owner" -- reservar um novo @ enquanto já se tem um também é
// bloqueado (ver o teste seguinte), então testar essa parte aqui só adicionaria uma
// segunda causa possível de falha à mesma asserção.
test('a client cannot rename an existing @ with direct writes, even holding a valid reservation', async () => {
  const owner = env.authenticatedContext('owner').firestore()
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'usernames/ownernew'), {
      uid: 'owner',
      createdAt: Timestamp.now(),
    })
  })
  // O que o AUD-010 original explorava: usar uma reserva válida para sobrescrever o
  // @ já existente direto em users/publicProfiles, sem passar pela Cloud Function.
  await assertFails(updateDoc(doc(owner, 'users/owner'), { username: 'ownernew' }))
  await assertFails(updateDoc(doc(owner, 'publicProfiles/owner'), { username: 'ownernew' }))
  // Tentar zerar o @ existente direto (para depois reclamar um novo como se fosse a
  // primeira vez) também precisa falhar -- não é só a troca direta que é bloqueada,
  // é qualquer mudança a partir de um @ já definido.
  await assertFails(updateDoc(doc(owner, 'users/owner'), { username: null }))
  await assertFails(updateDoc(doc(owner, 'publicProfiles/owner'), { username: null }))
  // O estado no banco continua intocado depois de todas as tentativas.
  await env.withSecurityRulesDisabled(async (context) => {
    const snap = await getDoc(doc(context.firestore(), 'users/owner'))
    assert.equal(snap.data().username, 'owner')
  })
})

// Fecha a outra ponta do mesmo bypass: mesmo a RESERVA (usernames/{novo}), sozinha,
// só é aceita direto do cliente enquanto o próprio usuário ainda não tem @ nenhum.
// Sem isso, dava para acumular reservas de nomes arbitrários mesmo sem conseguir
// usá-las (squatting) -- inofensivo para outros usuários, mas não deveria ser
// possível pelas regras já que não serve a nenhum fluxo legítimo.
test('a client who already has a @ cannot reserve a new username directly either', async () => {
  const owner = env.authenticatedContext('owner').firestore()
  await assertFails(
    setDoc(doc(owner, 'usernames/somethingelse'), { uid: 'owner', createdAt: serverTimestamp() })
  )
})

// A Cloud Function (Admin SDK, fora do alcance destas regras) continua sendo o único
// jeito de trocar um @ já existente -- exercida de fato em admin-rules.test.mjs
// ('renameUsername moves the reservation atomically...'), não simulada aqui.

// Auditoria de backend: usernames/{username} tinha allow delete sem o mesmo teto de 10
// minutos que users/{uid} e publicProfiles/{uid} já usam (ver deleteFreshProfile em
// src/services/usersService.js) -- sem ele, o dono podia liberar a própria reserva a
// qualquer momento da vida da conta enquanto users/publicProfiles continuavam
// apontando pro mesmo @ (eles não são apagados junto), abrindo brecha para outra conta
// reivindicar o MESMO nome de usuário já exibido em outro lugar.
test('a fresh (registration-window) username reservation can self-delete for rollback, an old one cannot', async () => {
  // uid próprio (não "newbie") -- o teste de cadastro acima já reivindica
  // "newbiehandle" para "newbie" e nunca desfaz isso; reusar o mesmo uid faria este
  // create falhar por "já tem @" (isInitialUsernameClaim), não pelo motivo que este
  // teste investiga.
  const freshUid = 'newbie-rollback'
  const fresh = env.authenticatedContext(freshUid).firestore()
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${freshUid}`), { role: 'user' })
  })
  await assertSucceeds(
    setDoc(doc(fresh, 'usernames/freshrollbackhandle'), { uid: freshUid, createdAt: serverTimestamp() })
  )
  // Ainda dentro da janela de cadastro (createdAt acabou de ser gravado): rollback
  // continua funcionando normalmente.
  await assertSucceeds(deleteDoc(doc(fresh, 'usernames/freshrollbackhandle')))

  // "owner" já existe desde antes, mas o seed em before() grava createdAt bem recente
  // (Timestamp.now() na hora em que a suíte sobe) -- reseedado aqui com um createdAt
  // de verdade fora da janela de 10 minutos para representar uma conta estabelecida.
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'usernames/owner'), {
      uid: 'owner',
      createdAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
    })
  })
  await assertFails(deleteDoc(doc(env.authenticatedContext('owner').firestore(), 'usernames/owner')))
  await env.withSecurityRulesDisabled(async (context) => {
    assert.equal((await getDoc(doc(context.firestore(), 'usernames/owner'))).exists(), true)
  })
})
