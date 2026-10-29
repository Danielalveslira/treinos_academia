// A lost RPC response does not mean the database rolled back. Read the current
// record before asking the media endpoint to discard a newly uploaded image.
export async function saveWithImage({ file, upload, save, isLinked, discard, previousMediaId }) {
  const uploaded = file ? await upload(file) : null
  try {
    await save(uploaded)
  } catch (error) {
    if (!uploaded) throw error
    let linked
    try {
      linked = await isLinked(uploaded)
    } catch {
      // The outcome is unknown. Retain the upload for the server orphan sweeper.
      throw error
    }
    if (!linked) {
      await discard(uploaded).catch(() => {})
      throw error
    }
  }
  // Cleanup happens only after a confirmed commit and cannot turn success into failure.
  if (uploaded && previousMediaId && previousMediaId !== uploaded) {
    await discard(previousMediaId).catch(() => {})
  }
}
