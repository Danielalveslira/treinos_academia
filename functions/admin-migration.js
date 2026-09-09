// One bounded pass over legacy interactions and community references. Deploy the
// new write rules first, so old-shaped interactions cannot appear behind a cursor.
export async function migrateAdmin({ db, FieldPath, FieldValue, apply = false }) {
  const counts = { interactions: 0, cleanupJobs: 0 }
  async function pages(source, visit) {
    let cursor
    while (true) {
      let query = source.orderBy(FieldPath.documentId()).limit(100)
      if (cursor) query = query.startAfter(cursor)
      const page = await query.get()
      if (page.empty) return
      await visit(page.docs)
      cursor = page.docs.at(-1)
    }
  }
  async function queueMissingParents(batch, kind, parentRefs) {
    const refs = [...new Map(parentRefs.map((ref) => [ref.path, ref])).values()]
    if (!refs.length) return
    const parents = await db.getAll(...refs)
    const missing = parents.filter((parent) => !parent.exists)
    if (!missing.length) return
    const jobs = await db.getAll(
      ...missing.map((parent) => db.doc(`deletionJobs/${kind}_${parent.id}`))
    )
    for (let index = 0; index < missing.length; index++) {
      if (jobs[index].exists) continue
      counts.cleanupJobs++
      if (apply)
        batch.create(jobs[index].ref, {
          kind,
          targetId: missing[index].id,
          state: 'pending',
          stage: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
    }
  }
  for (const group of ['votes', 'participants']) {
    await pages(db.collectionGroup(group), async (records) => {
      const batch = db.batch()
      for (const record of records) {
        if (record.data().userId !== record.id) {
          counts.interactions++
          if (apply) batch.update(record.ref, { userId: record.id })
        }
      }
      await queueMissingParents(
        batch,
        'status',
        records.map((record) => record.ref.parent.parent)
      )
      if (apply) await batch.commit()
    })
  }
  // Older community deletions removed only the parent document.
  for (const group of ['communityMembers', 'communityRestrictions', 'statuses']) {
    await pages(db.collection(group), async (records) => {
      const batch = db.batch()
      const refs = records
        .map((record) => record.data().communityId)
        .filter((id) => typeof id === 'string' && id.length > 0 && !id.includes('/'))
        .map((id) => db.doc(`communities/${id}`))
      await queueMissingParents(batch, 'community', refs)
      if (apply) await batch.commit()
    })
  }
  if (apply)
    await db
      .doc('maintenance/adminV1')
      .set({ interactionsVersion: 1, completedAt: FieldValue.serverTimestamp() }, { merge: true })
  return counts
}
