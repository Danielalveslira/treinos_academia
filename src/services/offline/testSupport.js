// Só para testes (node --test): IndexedDB em memória, um banco NOVO por teste, e leitura "crua"
// do banco para verificar o que realmente foi gravado sem passar pelo código sob teste.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { closeDatabase } from './database.js'
import { DB_NAME } from './schema.js'

export async function freshDatabase() {
  await closeDatabase()
  globalThis.indexedDB = new IDBFactory()
}

export function rawOpen(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function rawAll(storeName) {
  const db = await rawOpen()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export function withoutIndexedDb() {
  const saved = globalThis.indexedDB
  globalThis.indexedDB = undefined
  return () => {
    globalThis.indexedDB = saved
  }
}

export function workoutRow(overrides = {}) {
  return {
    user_id: 'user-a',
    id: 'w-1',
    exercise_id: 'ex-1',
    type: 'strength',
    set_details: [{ weight: 80, reps: 10 }],
    sets: 1,
    duration_minutes: null,
    distance_km: null,
    date: '2026-10-05',
    note: '',
    created_at: '2026-10-05T10:00:00.000000+00:00',
    ...overrides,
  }
}
