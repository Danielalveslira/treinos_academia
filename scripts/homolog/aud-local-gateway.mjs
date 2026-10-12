// Gateway de teste exclusivamente local; sem proxy para serviços remotos.
import { createServer, request as forward } from 'node:http'
export async function startAudGateway() {
  const server = createServer((req, res) => {
    const path = req.url.replace(/^\/old\//, '/')
    const old = req.url.startsWith('/old/')
    const route = ['/auth/v1', '/rest/v1', '/storage/v1'].find((prefix) => path.startsWith(prefix))
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Date')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (!route) return res.writeHead(404).end()
    const port =
      route === '/auth/v1' ? 55432 : route === '/storage/v1' ? 55433 : old ? 55434 : 55431
    const upstream = forward(
      {
        hostname: '127.0.0.1',
        port,
        path: path.slice(route.length) || '/',
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${port}` },
      },
      (response) => {
        const headers = { ...response.headers }
        for (const name of Object.keys(headers))
          if (name.startsWith('access-control-')) delete headers[name]
        res.writeHead(response.statusCode, headers)
        response.pipe(res)
      }
    )
    upstream.on('error', () => res.writeHead(502).end('local upstream unavailable'))
    req.pipe(upstream)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(55439, '127.0.0.1', resolve)
  })
  return server
}
