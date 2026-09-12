import { after, before, test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, Timestamp } from 'firebase/firestore'
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
  await seed('users/member', { role: 'user' })
  await seed(`communityMembers/${COMMUNITY_ID}_member`, {
    communityId: COMMUNITY_ID,
    userId: 'member',
  })
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
