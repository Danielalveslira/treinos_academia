import { before, after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  Timestamp,
} from 'firebase/firestore'

// Fase 5 (privilégios com EvoCash): ownerId em communities/{id} é a fonte autoritativa
// de permissão dentro de UMA comunidade específica -- estritamente menor que
// isSuperAdmin() (nunca alcança outra comunidade, nunca funções globais). role:'owner'
// em communityMembers é só para UI/representação; estes testes existem exatamente para
// provar que as Rules nunca confiam nele.

let env
let owner1
let owner2
let stranger
let admin

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
  owner1 = env.authenticatedContext('owner1').firestore()
  owner2 = env.authenticatedContext('owner2').firestore()
  stranger = env.authenticatedContext('stranger').firestore()
  admin = env.authenticatedContext('admin').firestore()

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    for (const uid of ['owner1', 'owner2', 'stranger']) {
      await setDoc(doc(db, `users/${uid}`), { role: 'user' })
    }
    await setDoc(doc(db, 'users/admin'), { role: 'superadmin' })

    await setDoc(doc(db, 'communities/comm-owner1'), {
      name: 'Comunidade do owner1',
      description: '',
      iconName: 'flame',
      isActive: true,
      postAccess: 'everyone',
      memberCount: 1,
      createdBy: 'owner1',
      ownerId: 'owner1',
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communityMembers/comm-owner1_owner1'), {
      communityId: 'comm-owner1',
      userId: 'owner1',
      role: 'owner',
      joinedAt: Timestamp.now(),
    })

    await setDoc(doc(db, 'communities/comm-owner2'), {
      name: 'Comunidade do owner2',
      description: '',
      iconName: 'star',
      isActive: true,
      postAccess: 'everyone',
      memberCount: 1,
      createdBy: 'owner2',
      ownerId: 'owner2',
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communityMembers/comm-owner2_owner2'), {
      communityId: 'comm-owner2',
      userId: 'owner2',
      role: 'owner',
      joinedAt: Timestamp.now(),
    })

    // Publicação dentro da comunidade do owner1, de autoria de OUTRA pessoa (não do
    // owner1) -- prova que o owner pode moderar conteúdo alheio, não só o próprio.
    await setDoc(doc(db, 'statuses/status-in-comm1'), {
      communityId: 'comm-owner1',
      authorId: 'stranger',
      type: 'text',
      text: 'oi',
      createdAt: Timestamp.now(),
    })

    // Comunidade de ANTES da Fase 5 -- sem ownerId, exatamente como uma comunidade real
    // já existente no banco (ver auditoria de compatibilidade: ownerId é opcional em
    // isValidCommunity de propósito, nunca assumido presente).
    await setDoc(doc(db, 'communities/comm-legacy'), {
      name: 'Comunidade antiga',
      description: '',
      iconName: 'users',
      isActive: true,
      postAccess: 'everyone',
      memberCount: 0,
      createdBy: 'owner1',
      createdAt: Timestamp.now(),
    })

    // Restrição de comunidade (Fase 5: setCommunityMemberBan) -- simulado aqui via
    // Admin SDK, já que o cliente nunca escreve isto diretamente.
    await setDoc(doc(db, 'communityRestrictions/comm-owner1_stranger'), {
      userId: 'stranger',
      communityId: 'comm-owner1',
      bannedBy: 'owner1',
      reason: 'teste de leitura',
      createdAt: Timestamp.now(),
    })
  })
})

after(async () => {
  await env?.cleanup()
})

function updatedCommunity(base, overrides = {}) {
  return {
    name: base.name,
    description: base.description,
    iconName: base.iconName,
    isActive: base.isActive,
    postAccess: base.postAccess,
    memberCount: base.memberCount,
    createdBy: base.createdBy,
    ownerId: base.ownerId,
    createdAt: base.createdAt,
    ...overrides,
  }
}

test('owner administra a própria comunidade (edição de configurações)', async () => {
  const snapshot = await getDoc(doc(owner1, 'communities/comm-owner1'))
  await assertSucceeds(
    updateDoc(
      doc(owner1, 'communities/comm-owner1'),
      updatedCommunity(snapshot.data(), { description: 'Atualizada pelo próprio dono' })
    )
  )
})

test('owner NÃO administra a comunidade de outro owner', async () => {
  const snapshot = await getDoc(doc(owner2, 'communities/comm-owner2'))
  await assertFails(
    updateDoc(
      doc(owner1, 'communities/comm-owner2'),
      updatedCommunity(snapshot.data(), { description: 'Tentativa de invasão' })
    )
  )
})

test('superadmin administra qualquer comunidade', async () => {
  const snapshot = await getDoc(doc(admin, 'communities/comm-owner2'))
  await assertSucceeds(
    updateDoc(
      doc(admin, 'communities/comm-owner2'),
      updatedCommunity(snapshot.data(), { description: 'Editado pelo superadmin' })
    )
  )
})

test('usuário comum sem relação nenhuma não administra nenhuma comunidade', async () => {
  const snapshot = await getDoc(doc(stranger, 'communities/comm-owner1'))
  await assertFails(
    updateDoc(
      doc(stranger, 'communities/comm-owner1'),
      updatedCommunity(snapshot.data(), { description: 'Tentativa de estranho' })
    )
  )
})

test('ownerId não pode ser alterado pelo cliente, nem pelo próprio dono atual', async () => {
  const snapshot = await getDoc(doc(owner1, 'communities/comm-owner1'))
  await assertFails(
    updateDoc(
      doc(owner1, 'communities/comm-owner1'),
      updatedCommunity(snapshot.data(), { ownerId: 'stranger' })
    )
  )
  // Confirma que o campo realmente não mudou no servidor.
  const after = await getDoc(doc(owner1, 'communities/comm-owner1'))
  assert.equal(after.data().ownerId, 'owner1')
})

test('criar uma comunidade exige ownerId == createdBy == uid de quem cria (mesmo sendo superadmin)', async () => {
  await assertFails(
    setDoc(doc(admin, 'communities/forged'), {
      name: 'Forjada',
      description: '',
      iconName: 'star',
      isActive: true,
      postAccess: 'everyone',
      memberCount: 0,
      createdBy: 'admin',
      ownerId: 'stranger', // divergente do próprio criador
      createdAt: Timestamp.now(),
    })
  )
})

test('remover ou alterar o próprio membership nunca concede ownership', async () => {
  // stranger fabrica um membership próprio com role:"owner" na comunidade do owner1 --
  // isto é só um campo de UI; as Rules nunca deveriam lê-lo para decidir permissão.
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'communityMembers/comm-owner1_stranger'), {
      communityId: 'comm-owner1',
      userId: 'stranger',
      role: 'owner',
      joinedAt: Timestamp.now(),
    })
  })
  const snapshot = await getDoc(doc(stranger, 'communities/comm-owner1'))
  await assertFails(
    updateDoc(
      doc(stranger, 'communities/comm-owner1'),
      updatedCommunity(snapshot.data(), { description: 'Deveria falhar mesmo com role:owner fabricado' })
    )
  )

  // O dono de verdade removendo a PRÓPRIA filiação (saindo da comunidade que criou)
  // também não transfere nem revoga a posse -- ownerId continua intacto.
  await assertSucceeds(deleteDoc(doc(owner1, 'communityMembers/comm-owner1_owner1')))
  const communityAfter = await getDoc(doc(admin, 'communities/comm-owner1'))
  assert.equal(communityAfter.data().ownerId, 'owner1', 'sair da própria comunidade não revoga a posse')
  await assertSucceeds(
    updateDoc(
      doc(owner1, 'communities/comm-owner1'),
      updatedCommunity(communityAfter.data(), { description: 'Ainda dono mesmo sem ser membro' })
    )
  )
})

test('owner pode listar os membros da própria comunidade; não os de outra', async () => {
  await assertSucceeds(
    getDocs(query(collection(owner2, 'communityMembers'), where('communityId', '==', 'comm-owner2')))
  )
  await assertFails(
    getDocs(query(collection(owner1, 'communityMembers'), where('communityId', '==', 'comm-owner2')))
  )
})

test('owner pode remover (moderar) uma publicação de outra pessoa dentro da própria comunidade', async () => {
  await assertSucceeds(deleteDoc(doc(owner1, 'statuses/status-in-comm1')))
})

test('owner NÃO pode remover uma publicação de outra comunidade', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'statuses/status-in-comm2'), {
      communityId: 'comm-owner2',
      authorId: 'stranger',
      type: 'text',
      text: 'oi',
      createdAt: Timestamp.now(),
    })
  })
  await assertFails(deleteDoc(doc(owner1, 'statuses/status-in-comm2')))
})

// Auditoria de compatibilidade de ownerId (Fase 5): comunidades de antes deste campo
// existir não podem virar inadministráveis nem ganhar um "dono" por acidente.
function legacyCommunityPayload(overrides = {}) {
  // Deliberadamente SEM a chave ownerId (nem sequer `undefined`, que o SDK do
  // Firestore rejeitaria) -- é exatamente a forma de uma comunidade real anterior à
  // Fase 5, nunca uma simulação com o campo presente e vazio.
  return {
    name: 'Comunidade antiga',
    description: '',
    iconName: 'users',
    isActive: true,
    postAccess: 'everyone',
    memberCount: 0,
    createdBy: 'owner1',
    createdAt: Timestamp.now(),
    ...overrides,
  }
}

test('comunidade antiga sem ownerId continua editável pelo superadmin, sem precisar de backfill', async () => {
  const snapshot = await getDoc(doc(admin, 'communities/comm-legacy'))
  assert.equal('ownerId' in snapshot.data(), false)
  await assertSucceeds(
    updateDoc(
      doc(admin, 'communities/comm-legacy'),
      legacyCommunityPayload({ createdAt: snapshot.data().createdAt, description: 'Editado pelo superadmin' })
    )
  )
})

test('comunidade antiga sem ownerId NÃO pode ser administrada por ninguém que não seja superadmin', async () => {
  const snapshot = await getDoc(doc(owner1, 'communities/comm-legacy'))
  await assertFails(
    updateDoc(
      doc(owner1, 'communities/comm-legacy'),
      legacyCommunityPayload({ createdAt: snapshot.data().createdAt, description: 'Tentativa indevida' })
    )
  )
})

test('uma edição não pode atribuir ownerId a uma comunidade antiga que nunca teve um', async () => {
  const snapshot = await getDoc(doc(admin, 'communities/comm-legacy'))
  await assertFails(
    updateDoc(
      doc(admin, 'communities/comm-legacy'),
      legacyCommunityPayload({ createdAt: snapshot.data().createdAt, ownerId: 'admin' })
    )
  )
  const after = await getDoc(doc(admin, 'communities/comm-legacy'))
  assert.equal('ownerId' in after.data(), false, 'ownerId continua ausente -- imutabilidade vale mesmo partindo de ausente')
})

// setCommunityMemberBan (Fase 5) -- a restrição em si só é escrita pela Cloud Function
// (Admin SDK); estes testes cobrem só a visibilidade de leitura pelas Rules.
test('owner pode ver quem está banido na própria comunidade', async () => {
  await assertSucceeds(getDoc(doc(owner1, 'communityRestrictions/comm-owner1_stranger')))
})

test('owner NÃO pode ver banimentos de outra comunidade', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'communityRestrictions/comm-owner2_someone'), {
      userId: 'someone',
      communityId: 'comm-owner2',
      bannedBy: 'owner2',
      reason: 'teste',
      createdAt: Timestamp.now(),
    })
  })
  await assertFails(getDoc(doc(owner1, 'communityRestrictions/comm-owner2_someone')))
})

test('o cliente nunca escreve communityRestrictions diretamente, nem o owner nem o superadmin', async () => {
  const payload = { userId: 'stranger', communityId: 'comm-owner1', bannedBy: 'owner1', reason: 'x', createdAt: Timestamp.now() }
  await assertFails(setDoc(doc(owner1, 'communityRestrictions/comm-owner1_forged'), payload))
  await assertFails(setDoc(doc(admin, 'communityRestrictions/comm-owner1_forged'), payload))
  await assertFails(deleteDoc(doc(owner1, 'communityRestrictions/comm-owner1_stranger')))
})
