// Zera somente a quota dos autores da fixture sintética na homologação local.
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const fixture = JSON.parse(await readFile('/tmp/evolutus-load/fixtures.json', 'utf8'))
if (fixture.rest !== 'http://127.0.0.1:55431' || !/^[0-9a-f]{8}$/.test(fixture.runId)) throw new Error('Fixture local inválida')
const sql = `with deleted as (
  delete from private.status_publication_limits l using auth.users u
  where l.user_id = u.id and u.email like 'load-${fixture.runId}-%@example.invalid'
  returning l.user_id
) select count(*) from deleted;`
const count = execFileSync('docker', ['exec', 'evolutus_homolog_db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
console.log(`Quotas locais de ${count} autores sintéticos zeradas`)
