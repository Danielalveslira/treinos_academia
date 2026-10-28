// Bound readiness checks; never accepts a remote URL.
export async function waitReady(base = 'http://127.0.0.1:55454') {
  if (!['http://127.0.0.1:55454','http://127.0.0.1:55554'].includes(base)) throw Error('LOCAL_SERVICE_REQUIRED')
  for (const path of ['/__health', '/auth/v1/health', '/storage/v1/status']) {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(base+path, { signal: AbortSignal.timeout(1000) })
        if (response.ok) { ready = true; break }
      } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error('LOCAL_SERVICE_NOT_READY: '+path)
  }
}
