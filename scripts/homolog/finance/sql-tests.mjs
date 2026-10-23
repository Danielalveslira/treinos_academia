import { execFileSync } from 'node:child_process'
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const container=process.argv[2]||'evolutus_integrated_db'
if(!['evolutus_integrated_db','evolutus_integrated_clean_db'].includes(container))throw new Error('Local test container required')
const only=process.argv[3]
const root=resolve(import.meta.dirname,'../../..')
const logs='/tmp/evolutus-integrated/sql-'+container
mkdirSync(logs,{recursive:true})
const results=[]
for(const name of readdirSync(root+'/supabase/tests').filter(f=>f.endsWith('.sql')&&(!only||f.includes(only))).sort()) {
 try {
  const output=execFileSync('docker',['exec','-w','/workspace/supabase/tests',container,'psql','-U','supabase_admin','-d','postgres','-X','-tA','-v','ON_ERROR_STOP=1','-f',name],{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000})
  const passed=!/^not ok|Looks like you failed|ERROR:/m.test(output)
  results.push({file:name,passed,assertions:output.split('\n').filter(l=>l.startsWith('ok ')).length,output_sha256:createHash('sha256').update(output).digest('hex')})
  writeFileSync(logs+'/'+name+'.log',output)
 } catch(e) {writeFileSync(logs+'/'+name+'.log',String(e.stdout)+String(e.stderr));results.push({file:name,passed:false,error:String(e.stderr).slice(-500)})}
 console.log(JSON.stringify(results.at(-1)))
}
writeFileSync(logs+'/summary.json',JSON.stringify(results,null,2))
process.exitCode=results.every(x=>x.passed)?0:1
