// Bound readiness checks; never accepts a remote URL.
export async function waitReady() {
  for (const path of ['/__health', '/auth/v1/health', '/storage/v1/status']) {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:55454'+path, { signal: AbortSignal.timeout(1000) })
        if (response.ok) { ready = true; break }
      } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error('LOCAL_SERVICE_NOT_READY: '+path)
  }
}
