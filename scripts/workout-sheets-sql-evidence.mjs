// Runs only against the disposable CI container. Never accepts a remote connection string.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const helper = readFileSync('supabase/tests/_helpers/auth_session.sql', 'utf8')
const suite = readFileSync('supabase/tests/workout_sheets_test.sql', 'utf8').replace(
  /^\\ir[^\n]*\n/,
  ''
)
const output = execFileSync(
  'docker',
  [
    'exec',
    '-i',
    'supabase_db_treinos_academia',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  {
    input:
      'create extension if not exists pgtap with schema extensions; set search_path=public,extensions;\n' +
      helper +
      '\n' +
      suite,
    encoding: 'utf8',
    maxBuffer: 4e6,
  }
)
console.log(output)
if (/^not ok|Bail out!|Looks like you failed/m.test(output) || !/^1\.\.\d+/m.test(output))
  throw new Error('Incomplete or failed workout-sheet SQL evidence')
