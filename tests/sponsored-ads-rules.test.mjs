import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
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
    isGlobal: false,
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

// Mesmo diagnóstico da Fase 5 (ver statuses-rules.test.mjs): sem isto, as conexões
// gRPC com o emulador nunca fecham e o test runner trava indefinidamente esperando
// handles abertos, mesmo com todos os testes já passando -- não relacionado a Rules
// nenhuma, só a este arquivo nunca ter chamado env.cleanup().
after(async () => {
  await env?.cleanup()
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
  // Nem comunidade nem isGlobal: não apareceria em lugar nenhum.
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/ad-invalid2'), baseAd({ communityIds: [], isGlobal: false }))
  )
  // ctaLabel presente sem ctaType/ctaTarget viola a regra condicional.
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/ad-invalid3'), baseAd({ ctaLabel: 'Saiba mais' }))
  )
})

// Extensão da feature de anúncios/parcerias: banner rotativo global na Home, ortogonal ao
// direcionamento por comunidade já existente. Um anúncio pode ser só de comunidade, só
// global, ou os dois.
test('isGlobal and communityIds are independent targeting dimensions on write', async () => {
  // Só global, sem comunidade nenhuma -- o caso novo que este item introduz.
  await assertSucceeds(
    setDoc(
      doc(admin, 'sponsoredAds/global-only'),
      baseAd({ communityIds: [], isGlobal: true, displayMode: ['banner'] })
    )
  )
  // Comunidade e global ao mesmo tempo.
  await assertSucceeds(
    setDoc(
      doc(admin, 'sponsoredAds/global-and-community'),
      baseAd({ communityIds: ['comm1'], isGlobal: true })
    )
  )
  // isGlobal precisa ser bool -- não aceita ausente nem tipo errado.
  const { isGlobal: _isGlobal, ...withoutIsGlobal } = baseAd()
  await assertFails(setDoc(doc(admin, 'sponsoredAds/global-missing'), withoutIsGlobal))
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/global-wrong-type'), baseAd({ isGlobal: 'true' }))
  )
})

// validateSponsoredAd (src/utils/validators.js) só protege quem passa pelo formulário
// admin -- um client malicioso pode chamar setDoc/addDoc direto no SDK do Firestore,
// pulando a UI (e a validação) por completo. Este teste chama a regra do servidor
// diretamente, sem qualquer camada de client no meio, para confirmar que o "nem
// comunidade nem global" continua bloqueado mesmo assim -- não só quando alguém passa
// pelo formulário.
test('the server rejects an ad with neither communityIds nor isGlobal, even bypassing the admin form entirely', async () => {
  await assertFails(
    setDoc(doc(admin, 'sponsoredAds/ad-nowhere'), baseAd({ communityIds: [], isGlobal: false }))
  )
})

// Achado #1 da auditoria de segurança: ctaTarget era texto livre sem checagem de esquema,
// renderizado direto como href no client -- 'javascript:...' executava no clique.
test('create rejects a ctaTarget with an unsafe scheme, even from an admin', async () => {
  const cta = (ctaType, ctaTarget) => baseAd({ ctaLabel: 'Saiba mais', ctaType, ctaTarget })

  await assertSucceeds(
    setDoc(doc(admin, 'sponsoredAds/cta-external-ok'), cta('external', 'https://exemplo.com'))
  )
  for (const malicious of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://exemplo.com',
    '//evil.com',
  ]) {
    await assertFails(
      setDoc(doc(admin, 'sponsoredAds/cta-external-bad'), cta('external', malicious))
    )
  }

  await assertSucceeds(
    setDoc(doc(admin, 'sponsoredAds/cta-internal-ok'), cta('internal', '/comunidades'))
  )
  for (const malicious of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', 'comunidades']) {
    await assertFails(
      setDoc(doc(admin, 'sponsoredAds/cta-internal-bad'), cta('internal', malicious))
    )
  }
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

// O ponto central desta extensão: isGlobal precisa ficar visível pra QUALQUER usuário
// autenticado, mesmo sem nenhuma relação com as comunidades listadas em communityIds --
// diferente do banner por comunidade, que nunca sai do círculo de membros.
test('a global ad is readable by any signed-in user, even a non-member of its communities', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'sponsoredAds/ad-global'),
      baseAd({ communityIds: [], isGlobal: true, displayMode: ['banner'] })
    )
  })

  // outsider não participa de comm1 nem de comunidade nenhuma -- exatamente o cenário
  // que a consulta por comunidade (teste acima) nega por inteiro.
  const snapshot = await assertSucceeds(
    getDocs(query(collection(outsider, 'sponsoredAds'), where('isGlobal', '==', true)))
  )
  assert.ok(snapshot.docs.some((d) => d.id === 'ad-global'))
})

// Cobre o meio-termo entre os dois testes acima (só global, só comunidade): um anúncio
// com isGlobal:true E communityIds apontando pra uma comunidade da qual o leitor NÃO
// participa. isGlobal sozinho já deveria autorizar a leitura -- communityIds não pode
// bloquear nem interferir quando isGlobal é true, exercitando o short-circuit do ||
// justamente no caso em que as duas condições coexistem no mesmo documento (não só
// isoladas, como nos dois testes acima).
test('a global ad targeting a community the reader is not part of is still readable via isGlobal', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'sponsoredAds/ad-global-and-comm1'),
      baseAd({ communityIds: ['comm1'], isGlobal: true, displayMode: ['banner'] })
    )
  })

  // outsider não participa de comm1 -- se o short-circuit não funcionasse, essa consulta
  // cairia no mesmo caminho negado do teste "a non-member is denied outright...".
  const snapshot = await assertSucceeds(
    getDocs(query(collection(outsider, 'sponsoredAds'), where('isGlobal', '==', true)))
  )
  assert.ok(snapshot.docs.some((d) => d.id === 'ad-global-and-comm1'))
})

// Um anúncio isGlobal:false continua tão fechado quanto antes -- a nova checagem de
// isGlobal não pode virar um jeito indireto de ler tudo.
test('a non-global ad is still denied to a non-member, even querying isGlobal == false', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'sponsoredAds/ad-not-global'),
      baseAd({ communityIds: ['comm1'], isGlobal: false })
    )
  })

  await assertFails(
    getDocs(query(collection(outsider, 'sponsoredAds'), where('isGlobal', '==', false)))
  )
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
