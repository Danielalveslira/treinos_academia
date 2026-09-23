import { after, before, test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, setDoc, Timestamp } from 'firebase/firestore'
import { getBytes, ref, uploadBytes } from 'firebase/storage'

const PROJECT_ID = 'demo-treinos'
const COMMUNITY_ID = 'AAAAAAAAAAAAAAAAAAAA'
const randomId = () => randomBytes(10).toString('hex')
const PHOTO_ID = randomId()
const PHOTO_PATH = `statusPhotos/${COMMUNITY_ID}/${PHOTO_ID}.webp`

let firestoreEnv
let storageEnv
let memberStorage
let outsiderStorage
let anonymousStorage

async function seed(path, data) {
  await firestoreEnv.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), path), data)
  )
}

// Usado só para preparar cenários de leitura inválida (status malformado/expirado) sem
// passar pelas regras de create — agora que não há mais caminho legado, a única forma de
// colocar bytes num caminho cujo status ainda não existe (ou nunca vai bater com
// validPhotoStatus) é com as regras desligadas, igual já fazemos para o Firestore.
async function seedPhoto(path, bytes = new Uint8Array([1])) {
  await storageEnv.withSecurityRulesDisabled((context) =>
    uploadBytes(ref(context.storage(), path), bytes, { contentType: 'image/webp' })
  )
}

function photoStatus(overrides = {}) {
  return {
    type: 'photo',
    communityId: COMMUNITY_ID,
    authorId: 'member',
    photoPath: PHOTO_PATH,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    ...overrides,
  }
}

before(async () => {
  firestoreEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8080 },
  })
  storageEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8'),
    },
  })
  await firestoreEnv.clearFirestore()
  await storageEnv.clearStorage()
  memberStorage = storageEnv.authenticatedContext('member').storage()
  outsiderStorage = storageEnv.authenticatedContext('outsider').storage()
  anonymousStorage = storageEnv.unauthenticatedContext().storage()
  await seed('users/member', { role: 'user' })
  await seed(`communityMembers/${COMMUNITY_ID}_member`, {
    communityId: COMMUNITY_ID,
    userId: 'member',
  })
})

test('catalog images are publicly readable only in the versioned catalog namespace', async () => {
  const catalogPath = 'exercise-catalog/v1/Barbell_Deadlift/thumb.webp'
  await seedPhoto(catalogPath)
  await assertSucceeds(getBytes(ref(anonymousStorage, catalogPath)))
  await assertFails(
    uploadBytes(ref(memberStorage, catalogPath), new Uint8Array([2]), {
      contentType: 'image/webp',
    })
  )

  const invalidPaths = [
    'exercise-catalog/current/Barbell_Deadlift/thumb.webp',
    'exercise-catalog/v1/../thumb.webp',
    'exercise-catalog/v1/Barbell_Deadlift/0.jpg',
    'private-catalog/v1/Barbell_Deadlift/thumb.webp',
  ]
  for (const path of invalidPaths) {
    await seedPhoto(path)
    await assertFails(getBytes(ref(anonymousStorage, path)))
  }
})

after(async () => {
  await storageEnv?.cleanup()
  await firestoreEnv?.cleanup()
})

test('author uploads after an authorized photo status exists', async () => {
  await seed(`statuses/${PHOTO_ID}`, photoStatus())
  await assertSucceeds(
    uploadBytes(ref(memberStorage, PHOTO_PATH), new Uint8Array([1]), {
      contentType: 'image/webp',
    })
  )
  await assertFails(
    uploadBytes(ref(memberStorage, PHOTO_PATH), new Uint8Array([2]), {
      contentType: 'image/webp',
    })
  )
})

test('uploading before creating the status is rejected now that the legacy path is gone', async () => {
  const legacyId = randomId()
  const legacyPath = `statusPhotos/${COMMUNITY_ID}/${legacyId}.webp`
  await assertFails(
    uploadBytes(ref(memberStorage, legacyPath), new Uint8Array([1]), {
      contentType: 'image/webp',
    })
  )
})

test('community member reads the valid photo and an outsider cannot', async () => {
  await assertSucceeds(getBytes(ref(memberStorage, PHOTO_PATH)))
  await assertFails(getBytes(ref(outsiderStorage, PHOTO_PATH)))
})

test('reading rejects a mismatched path, type or expired status', async () => {
  const cases = [
    [randomId(), { photoPath: PHOTO_PATH }],
    [randomId(), { type: 'text' }],
    [
      randomId(),
      {
        createdAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
        expiresAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      },
    ],
  ]
  for (const [id, overrides] of cases) {
    const path = `statusPhotos/${COMMUNITY_ID}/${id}.webp`
    await seedPhoto(path)
    await seed(`statuses/${id}`, photoStatus({ photoPath: path, ...overrides }))
    await assertFails(getBytes(ref(memberStorage, path)))
  }
})

test('upload still validates file name, content type and size', async () => {
  const invalidName = 'short'
  const invalidPath = `statusPhotos/${COMMUNITY_ID}/${invalidName}.webp`
  await seed(`statuses/${invalidName}`, photoStatus({ photoPath: invalidPath }))
  await assertFails(
    uploadBytes(ref(memberStorage, invalidPath), new Uint8Array([1]), {
      contentType: 'image/webp',
    })
  )

  const wrongTypeId = 'GGGGGGGGGGGGGGGGGGGG'
  const wrongTypePath = `statusPhotos/${COMMUNITY_ID}/${wrongTypeId}.webp`
  await seed(`statuses/${wrongTypeId}`, photoStatus({ photoPath: wrongTypePath }))
  await assertFails(
    uploadBytes(ref(memberStorage, wrongTypePath), new Uint8Array([1]), {
      contentType: 'image/png',
    })
  )

  const oversizedId = 'HHHHHHHHHHHHHHHHHHHH'
  const oversizedPath = `statusPhotos/${COMMUNITY_ID}/${oversizedId}.webp`
  await seed(`statuses/${oversizedId}`, photoStatus({ photoPath: oversizedPath }))
  await assertFails(
    uploadBytes(ref(memberStorage, oversizedPath), new Uint8Array(4 * 1024 * 1024 + 1), {
      contentType: 'image/webp',
    })
  )
})

// AUD-007: só a moderação (superadmin) lê a cópia de evidência -- nenhum cliente
// escreve nela (só a Cloud Function, via Admin SDK, fora do alcance destas regras).
test('only a superadmin can read moderation evidence; nobody can write it from the client', async () => {
  await seed('users/moderator', { role: 'superadmin' })
  const moderatorStorage = storageEnv.authenticatedContext('moderator').storage()
  const evidenceId = 'IIIIIIIIIIIIIIIIIIII'
  const evidencePath = `moderationEvidence/${evidenceId}.webp`
  await storageEnv.withSecurityRulesDisabled((context) =>
    uploadBytes(ref(context.storage(), evidencePath), new Uint8Array([1]), {
      contentType: 'image/webp',
    })
  )
  await assertSucceeds(getBytes(ref(moderatorStorage, evidencePath)))
  await assertFails(getBytes(ref(memberStorage, evidencePath)))
  await assertFails(
    uploadBytes(ref(moderatorStorage, evidencePath), new Uint8Array([2]), {
      contentType: 'image/webp',
    })
  )
})

test('profile avatars require an allocated owner manifest and are readable only as the active member avatar', async () => {
  const mediaId = randomId()
  const avatarPath = `profileAvatars/member/${mediaId}.webp`
  await seed(`profileAvatarMedia/${mediaId}`, {
    ownerId: 'member',
    storagePath: avatarPath,
    state: 'allocated',
  })
  await assertSucceeds(
    uploadBytes(ref(memberStorage, avatarPath), new Uint8Array([1]), { contentType: 'image/webp' })
  )
  await assertFails(
    uploadBytes(
      ref(outsiderStorage, `profileAvatars/outsider/${mediaId}.webp`),
      new Uint8Array([1]),
      { contentType: 'image/webp' }
    )
  )
  await seed('publicProfiles/member', {
    username: 'member',
    bio: null,
    shareStatistics: false,
    avatarPath,
  })
  await assertSucceeds(getBytes(ref(memberStorage, avatarPath)))
  await assertSucceeds(getBytes(ref(outsiderStorage, avatarPath)))
  await assertFails(getBytes(ref(anonymousStorage, avatarPath)))
})

test('approved storefront avatar is anonymously readable only while referenced by a published projection', async () => {
  const listingId = 'listingStorageRules'
  const mediaId = 'KKKKKKKKKKKKKKKKKKKK'
  const avatarPath = `professionalListingMedia/${listingId}/approved/${mediaId}.webp`
  await seedPhoto(avatarPath)
  await seed(`publishedProfessionalListings/${listingId}`, {
    publicationStatus: 'published',
    avatarPath,
  })
  await assertSucceeds(getBytes(ref(anonymousStorage, avatarPath)))
  await firestoreEnv.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), `publishedProfessionalListings/${listingId}`))
  })
  await assertFails(getBytes(ref(anonymousStorage, avatarPath)))
})
