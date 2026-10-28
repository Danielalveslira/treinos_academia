// Regenerate disposable files lost when Codespace /tmp is reset. No real keys.
import { mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { SECRET, jwt } from '../keys.mjs'
export const runtime = resolve(import.meta.dirname, '../../../.finance-local/runtime')
export function prepareRuntime() {
  mkdirSync(runtime, { recursive: true })
  const config = { url: 'http://127.0.0.1:55454', anon: jwt({ role: 'anon' }), service: jwt({ role: 'service_role' }) }
  cpSync(new URL('../../../supabase/functions/', import.meta.url), runtime+'/functions', { recursive: true })
  writeFileSync(runtime+'/functions/provider-mock.ts', readFileSync(new URL('./provider-mock.ts', import.meta.url)))
  for (const name of ['infinitepay-create-checkout','infinitepay-check-payment','infinitepay-webhook','infinitepay-admin-reconcile']) {
    const path = runtime+'/functions/'+name+'/index.ts'
    writeFileSync(path, "import '../provider-mock.ts';\n" + readFileSync(path, 'utf8').replace("const url = Deno.env.get('SUPABASE_URL')!", "const url = 'https://local-supabase.invalid'"))
  }
  writeFileSync(runtime+'/local.json', JSON.stringify(config))
  return { ...config, secret: SECRET }
}
