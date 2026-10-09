import crypto from 'node:crypto'
export const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
export function jwt(payload, expSeconds = 10 * 365 * 86400) {
  const h = b({ alg: 'HS256', typ: 'JWT' })
  const p = b({ iss: 'supabase-local', ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expSeconds })
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
if (process.argv[2] === 'print') {
  console.log(JSON.stringify({ anon: jwt({ role: 'anon' }), service: jwt({ role: 'service_role' }) }))
}
