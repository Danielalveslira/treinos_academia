// Transport redirects only: every HTTP response and WebSocket frame comes from the
// real allowlisted local Auth/REST/Storage/Realtime services. No campaign mocks.
export async function advertisingContext(browser, session, width = 390, mode = 'light') {
  const origin = 'http://127.0.0.1:5173'
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode })
  await context.addInitScript(
    ({ s, m }) => {
      if (location.origin !== 'http://127.0.0.1:5173') return
      localStorage.setItem(
        'sb-organic-goldfish-r7w5rp9g754vhxp4v-5173-auth-token',
        JSON.stringify(s)
      )
      localStorage.setItem('colorMode', m)
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url, protocols) {
          const u = new URL(url, location.href)
          if (
            u.hostname.endsWith('.app.github.dev') &&
            u.pathname.startsWith('/_finance_local/realtime/')
          ) {
            u.protocol = 'ws:'
            u.host = '127.0.0.1:5173'
          }
          super(u.toString(), protocols)
        }
      }
    },
    { s: session, m: mode }
  )
  await context.route('**/*', async (route) => {
    try {
      const u = new URL(route.request().url())
      if (
        u.hostname === 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev' &&
        u.pathname.startsWith('/_finance_local/')
      )
        return await route.fulfill({
          response: await route.fetch({ url: origin + u.pathname + u.search }),
        })
      if (
        ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
        ['data:', 'blob:'].includes(u.protocol)
      )
        return await route.continue()
      return await route.abort()
    } catch (error) {
      // Cancellation on navigation/teardown is expected. Other transport errors
      // still fail the harness, without exposing headers/session tokens in logs.
      if (route.request().failure() || context.pages().every((p) => p.isClosed())) return
      throw new Error('LOCAL_TRANSPORT_FAILED: ' + String(error.message).split('\n')[0])
    }
  })
  return context
}
