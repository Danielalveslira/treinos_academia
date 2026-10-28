import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
// Reuse Auth/REST/Storage, with this worktree's own Edge mount. No provider change.
process.env.FINANCE_PREVIEW_EDGE = 'evolutus_advertising_phase6_edge'
await import('./phase5-preview.mjs')
await import('./phase6-realtime.mjs')
const file = '.finance-local/preview.config.mjs'
const db = JSON.parse(
  execFileSync('docker', ['inspect', 'evolutus_price_phase1_db'], { encoding: 'utf8' })
)[0]
const host = db.NetworkSettings.IPAddress || Object.values(db.NetworkSettings.Networks)[0].IPAddress
if (!/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) throw Error('LOCAL_DOCKER_ADDRESS_REQUIRED')
const direct = [
  ['rest', 3000],
  ['auth', 9999],
  ['storage', 5000],
]
  .map(
    ([name, port]) =>
      ` '/_finance_local/${name}/v1':{target:'http://${host}:${port}',changeOrigin:true,rewrite:p=>p.replace(/^\\/_finance_local\\/${name}\\/v1/,'')},`
  )
  .join('')
const source = readFileSync(file, 'utf8').replace(
  "proxy:{'/_finance_local':",
  'proxy:{' +
    direct +
    "'/_finance_local/realtime/v1':{target:'http://127.0.0.1:55556',ws:true,changeOrigin:false,headers:{host:'realtime-dev.localhost','x-forwarded-host':'realtime-dev.localhost'},rewrite:p=>p.replace(/^\\/_finance_local\\/realtime\\/v1/,'/socket')},'/_finance_local':"
)
writeFileSync(file, source)
console.log(
  'Phase 6 preview configured with real local Realtime. Start npm run dev -- --config .finance-local/preview.config.mjs'
)
