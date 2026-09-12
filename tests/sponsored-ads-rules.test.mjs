import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, Timestamp } from 'firebase/firestore'

let env
let admin
let member
let outsider

function baseAd(overrides = {}) {
  return {
    partnerName: 'Academia Parceira',
    title: 'Desconto de 20% no plano anual',
    description: '',
    imageUrl: null,
    ctaLabel: null,
    ctaType: null,
    ctaTarget: null,
    expiresAt: null,
    communityIds: ['comm1'],
    displayMode: ['feed'],
    createdBy: 'admin',
    createdAt: Timestamp.now(),
    ...overrides,
  }
}

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
  admin = env.authenticatedContext('admin').firestore()
  member = env.authenticatedContext('member').firestore()
  outsider = env.authenticatedContext('outsider').firestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users/admin'), { role: 'superadmin' })
    // communityIds espelha o que user-communities-sync.js manteria via gatilho — este
    // teste seed direto porque emuladores de regras não rodam Cloud Functions.
    await setDoc(doc(db, 'users/member'), { role: 'user', communityIds: ['comm1'] })
    await setDoc(doc(db, 'users/outsider'), { role: 'user', communityIds: ['comm2'] })
  })
})

test('admin can create a sponsored ad', async () => {
  await assertSucceeds(
    setDoc(doc(admin, 'sponsoredAds/ad1'), baseAd({ createdBy: 'admin' }))
  )
})

test('a regular user cannot create a sponsored ad, even with an otherwise valid shape', async () => {
  await assertFails(
    setDoc(doc(member, 'sponsoredAds/ad-member'), baseAd({ createdBy: 'member' }))
  )
})

test('create rejects a malformed ad even from an admin', async () => {
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/ad-invalid'), baseAd({ partnerName: '' }))
  )
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/ad-invalid2'), baseAd({ communityIds: [] }))
  )
  // ctaLabel presente sem ctaType/ctaTarget viola a regra condicional.
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/ad-invalid3'), baseAd({ ctaLabel: 'Saiba mais' }))
  )
})

test('a member reads ads targeting their own community', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'sponsoredAds/ad-comm1'),
      baseAd({ communityIds: ['comm1'] })
    )
  })

  await assertSucceeds(
    getDocs(query(collection(member, 'sponsoredAds'), where('communityIds', 'array-contains', 'comm1')))
  )
})

// A regra de leitura depende de um get() (myCommunityIds()) que não faz parte do filtro
// da própria query -- por design do Firestore, isso faz a consulta INTEIRA ser negada
// (não filtrada documento a documento) sempre que algum resultado possível não bateria
// com a regra para quem está perguntando. Isso é seguro: no app real, essa consulta só é
// feita depois de confirmar isMember() == true para a comunidade em questão (mesmo
// padrão de CommunityDetail.jsx), então o filtro array-contains já garante a interseção
// com myCommunityIds() e a consulta legítima nunca cai nesse caminho. Este teste cobre
// exatamente o caso que não deveria acontecer no app real: consultar uma comunidade da
// qual não se participa.
test('a non-member is denied outright when querying a community they do not belong to', async () => {
  await assertFails(
    getDocs(query(collection(outsider, 'sponsoredAds'), where('communityIds', 'array-contains', 'comm1')))
  )
})

test('admin reads every ad regardless of their own community membership', async () => {
  await assertSucceeds(getDocs(collection(admin, 'sponsoredAds')))
})

test('only admin can update or delete', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'sponsoredAds/ad-edit'), baseAd())
  })
  await assertFails(updateDoc(doc(member, 'sponsoredAds/ad-edit'), { title: 'Hackeado' }))
  await assertSucceeds(updateDoc(doc(admin, 'sponsoredAds/ad-edit'), { title: 'Novo título' }))
  await assertFails(deleteDoc(doc(member, 'sponsoredAds/ad-edit')))
  await assertSucceeds(deleteDoc(doc(admin, 'sponsoredAds/ad-edit')))
})
