import {execFileSync} from 'node:child_process'
// Only the task's disposable DB; real GoTrue runs its own schema migrations.
const result=execFileSync('docker',['run','--rm','--network','container:evolutus_home_public_v2_test_db',
 '-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin@127.0.0.1:5432/postgres',
 '-e','GOTRUE_SITE_URL=http://localhost:5173','-e','API_EXTERNAL_URL=http://localhost:9999',
 '-e','GOTRUE_JWT_SECRET=local-only-public-home-test-secret-at-least-32-characters',
 process.env.PUBLIC_HOME_GOTRUE_IMAGE || 'public.ecr.aws/supabase/gotrue:v2.197.0','gotrue','migrate'],{encoding:'utf8',maxBuffer:4e6})
console.log(result)
