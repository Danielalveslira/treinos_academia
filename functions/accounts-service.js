import { accountView } from './admin-core.js'

export function createAccountsService({ db, auth, FieldPath, HttpsError }) {
  return async ({ search = '', cursor = null, pageSize = 50 } = {}) => {
    if (
      typeof search !== 'string' ||
      search.length > 128 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50 ||
      (cursor !== null &&
        (typeof cursor !== 'string' || cursor.includes('/') || cursor.length > 128))
    )
      throw new HttpsError('invalid-argument', 'Consulta inválida.')
    const term = search.trim()
    let source = db.collection('users')
    if (term) {
      // Exact email/UID lookups do not require copying email addresses into Firestore.
      let user
      if (!term.startsWith('@')) {
        try {
          user = term.includes('@') ? await auth.getUserByEmail(term) : await auth.getUser(term)
        } catch (error) {
          if (
            !['auth/user-not-found', 'auth/invalid-uid', 'auth/invalid-email'].includes(error.code)
          )
            throw error
          if (term.includes('@')) return { accounts: [], nextCursor: null }
        }
      }
      if (user) {
        const profile = await source.doc(user.uid).get()
        return {
          accounts: [accountView(user.uid, profile.data(), user.email || null)],
          nextCursor: null,
        }
      }
      const prefix = term.replace(/^@/, '').toLowerCase()
      source = source
        .where('username', '>=', prefix)
        .where('username', '<=', prefix + '\uf8ff')
        .orderBy('username')
        .orderBy(FieldPath.documentId())
    } else {
      // Document IDs also include old profiles missing createdAt.
      source = source.orderBy(FieldPath.documentId())
    }
    if (cursor) {
      const previous = await db.doc(`users/${cursor}`).get()
      if (term && previous.exists) source = source.startAfter(previous)
      else if (!term) source = source.startAfter(cursor)
      else throw new HttpsError('failed-precondition', 'A lista mudou. Atualize a busca.')
    }
    const page = await source.limit(pageSize + 1).get()
    const visible = page.docs.slice(0, pageSize)
    const users = visible.length
      ? await auth.getUsers(visible.map((item) => ({ uid: item.id })))
      : { users: [] }
    const emails = new Map(users.users.map((user) => [user.uid, user.email || null]))
    return {
      accounts: visible.map((item) =>
        accountView(item.id, item.data(), emails.get(item.id) || null)
      ),
      nextCursor: page.size > pageSize ? visible.at(-1).id : null,
    }
  }
}
