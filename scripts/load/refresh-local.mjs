// Cria novas sessões sintéticas antes de novos ensaios; somente Auth em loopback.
import { readFile, writeFile, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { jwt } from '../homolog/keys.mjs'

const path = '/tmp/evolutus-load/fixtures.json'
const fixture = JSON.parse(await readFile(path, 'utf8'))
if (fixture.auth !== 'http://127.0.0.1:55432') throw new Error('Somente Auth local')
const service = jwt({ role: 'service_role' })
const password = `Load!${randomUUID()}aA1`
for (let start = 0; start < fixture.users.length; start += 5) {
  await Promise.all(fixture.users.slice(start, start + 5).map(async (user) => {
    const updated = await fetch(`${fixture.auth}/admin/users/${user.id}`, {
      method: 'PUT', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!updated.ok) throw new Error(`Atualização local HTTP ${updated.status}`)
    const response = await fetch(`${fixture.auth}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: fixture.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    if (!response.ok) throw new Error(`Refresh local HTTP ${response.status}`)
    const session = await response.json()
    user.accessToken = session.access_token
    user.refreshToken = session.refresh_token
  }))
}
fixture.refreshedAt = new Date().toISOString()
await writeFile(path, JSON.stringify(fixture), { mode: 0o600 })
await chmod(path, 0o600)
console.log(`${fixture.users.length} sessões sintéticas recriadas localmente`)
