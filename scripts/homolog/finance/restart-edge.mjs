import { waitReady } from './wait-ready.mjs'
// Disposable local Edge runtime only; leave Auth, Storage, PostgreSQL and Vite intact.
import { execFileSync } from 'node:child_process'
import { prepareRuntime, runtime } from './prepare-runtime.mjs'
import { resolve } from 'node:path'
import { SECRET } from '../keys.mjs'
const root=resolve(import.meta.dirname,'../../..')
const {anon,service}=prepareRuntime()
const run=(...args)=>execFileSync('docker',args,{stdio:'pipe'})
if(run('ps','-a','--format','{{.Names}}').toString().split('\n').includes('evolutus_integrated_edge')) {
 run('stop','evolutus_integrated_edge');run('rm','evolutus_integrated_edge')
}
const env={JWT_SECRET:SECRET,SUPABASE_URL:'https://local-supabase.invalid',SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,INFINITEPAY_HANDLE:'local-fixture',APP_PUBLIC_URL:'https://local-fixture.invalid'}
run('run','-d','--name','evolutus_integrated_edge','--network','container:evolutus_integrated_db','--cpus','0.25','--memory','450m','--memory-swap','600m',
 ...Object.entries(env).flatMap(([k,v])=>['-e',k+'='+v]),'-v',root+'/supabase/functions:/home/deno/functions:ro',
 '-v',root+'/scripts/homolog/finance:/home/deno/main:ro','-v',runtime+':/home/deno/wrappers:ro',
 'public.ecr.aws/supabase/edge-runtime:v1.77.1','start','--main-service','/home/deno/main','-p','9000')
await waitReady()
console.log('Local Edge runtime restarted; provider interceptor enabled')
