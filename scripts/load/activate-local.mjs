// Ativa somente os usuários sintéticos da fixture local, respeitando a policy legal vigente.
import { readFile } from 'node:fs/promises'
import { jwt } from '../homolog/keys.mjs'

const fixture = JSON.parse(await readFile('/tmp/evolutus-load/fixtures.json', 'utf8'))
if (fixture.rest !== 'http://127.0.0.1:55431' || fixture.auth !== 'http://127.0.0.1:55432') throw new Error('Somente homologação local')
const service = jwt({ role: 'service_role' })
const headers = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
const legalResponse = await fetch(`${fixture.rest}/legal_policy?select=version,digest&id=eq.true`, { headers })
if (!legalResponse.ok) throw new Error(`legal_policy: ${legalResponse.status}`)
const [policy] = await legalResponse.json()
if (!policy) throw new Error('Política legal local ausente')
const ids = fixture.users.map((user) => user.id).join(',')
const response = await fetch(`${fixture.rest}/users?id=in.(${ids})`, {
  method: 'PATCH', headers,
  body: JSON.stringify({ legal_acceptance_version: policy.version, legal_acceptance_digest: policy.digest }),
})
if (!response.ok) throw new Error(`users: ${response.status} ${(await response.text()).slice(0, 250)}`)
const access = await fetch(`${fixture.rest}/rpc/has_app_access`, { method: 'POST', headers: { ...headers, apikey: fixture.anon, Authorization: `Bearer ${fixture.users[0].accessToken}` }, body: '{}' })
if (!access.ok || await access.json() !== true) throw new Error(`Conta sintética não passou no gate: ${access.status}`)
console.log(`${fixture.users.length} contas sintéticas ativas apenas na homologação local`)
