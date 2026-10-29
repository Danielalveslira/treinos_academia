// Synthetic data only. Fixed loopback transport and allowlisted disposable DB.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { jwt } from '../keys.mjs'
const pass = 'Evolutus-Local-Refunds!2026',
  adminKey = jwt({ role: 'service_role' }),
  anon = jwt({ role: 'anon' })
const sql = (s) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'evolutus_refunds_db',
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
    { input: s, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
const manifest = JSON.parse(readFileSync('legal/manifest.json')),
  documents = JSON.parse(readFileSync('legal/documents.json')),
  digests = JSON.parse(readFileSync('legal/approved-digests.json'))
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'"
sql(
  `insert into public.legal_versions(version,manifest,documents,digest) values(${q(manifest.version)},${q(JSON.stringify(manifest))},${q(JSON.stringify(documents))},${q(digests[manifest.version])}) on conflict do nothing;insert into public.legal_policy(id,version,published,digest,minimum_age) values(true,${q(manifest.version)},true,${q(digests[manifest.version])},12) on conflict(id) do update set version=excluded.version,digest=excluded.digest,published=true;notify pgrst,'reload schema';`
)
const users = {}
for (const role of ['buyer', 'admin']) {
  const email = `refunds-${role}-${randomUUID()}@example.invalid`
  const response = await fetch('http://127.0.0.1:55652/admin/users', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + adminKey,
      apikey: adminKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: pass, email_confirm: true }),
  })
  if (!response.ok) throw Error('LOCAL_AUTH_USER_FAILED ' + (await response.text()))
  const u = await response.json()
  sql(
    `update public.users set username='rf_'||left(replace(id::text,'-',''),12),data_nascimento='1990-01-01',sexo='nao_informar',usage_profile='professional',role='${role === 'admin' ? 'superadmin' : 'user'}',legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id),legal_acceptance_accepted_at=now() where id='${u.id}';`
  )
  const auth = await fetch('http://127.0.0.1:55652/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  })
  if (!auth.ok) throw Error('LOCAL_LOGIN_FAILED ' + (await auth.text()))
  users[role] = { id: u.id, email, password: pass, session: await auth.json() }
}
const p = randomUUID(),
  nsu = 'refunds-' + randomUUID()
sql(`begin;update private.refund_settings set financial_requests_enabled=true,settlement_enabled=true,expected_merchant='synthetic-merchant' where id;
 update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','true') where id;
 insert into public.cash_purchases(id,user_id,request_id,package_id,package_label,cash_amount,amount_centavos,payment_provider,provider_order_nsu,checkout_lease_until,checkout_valid_until)
 values('${p}','${users.buyer.id}','${randomUUID()}','historical-fixture','Compra inteiramente sintética de reembolso',25,590,'infinitepay','${nsu}',now()+interval '1 minute',now()+interval '1 day');
 select public.confirm_infinitepay_cash_purchase('${p}','${nsu}','${nsu}-txn','${nsu}-inv',590,'pix',null);commit;`)
mkdirSync('.finance-local/refunds', { recursive: true })
writeFileSync(
  process.argv[2] === 'browser'
    ? '.finance-local/refunds/browser-access.json'
    : '.finance-local/refunds/access.json',
  JSON.stringify({ ...users, purchaseId: p, nsu, anon }, null, 2)
)
writeFileSync(
  '.finance-local/refunds.config.mjs',
  `import { mergeConfig } from 'vite';import base from '../vite.config.js';export default mergeConfig(base,{define:{'import.meta.env.VITE_SUPABASE_URL':'window.location.origin + \"/_refunds\"','import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(${JSON.stringify(anon)})},server:{allowedHosts:['organic-goldfish-r7w5rp9g754vhxp4v-5174.app.github.dev'],host:'0.0.0.0',port:5174,strictPort:true,proxy:{'/_refunds/rest/v1':{target:'http://127.0.0.1:55651',rewrite:p=>p.replace('/_refunds/rest/v1','')},'/_refunds/auth/v1':{target:'http://127.0.0.1:55652',rewrite:p=>p.replace('/_refunds/auth/v1','')}}},plugins:[{name:'refunds-synthetic-banner',transformIndexHtml(html){return html.replace('<body>','<body><div style="background:#fff1aa;color:#242424;padding:12px;text-align:center">Homologação local de reembolsos — valores, compras e estornos inteiramente sintéticos</div>')}}]});`
)
console.log(
  'Synthetic local preview ready; access file is ignored, no real checkout/provider call.'
)
