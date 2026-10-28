import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const evidence = 'docs/finance-restructure/consolidation/evidence'
const clean = JSON.parse(readFileSync(evidence + '/clean-install.json')).container
if (!/^evolutus_consolidation_clean_[0-9]{14}$/.test(clean))
  throw Error('LOCAL_CLEAN_CONTAINER_REQUIRED')
const sql = `begin read only; set local statement_timeout='20s';
select jsonb_build_object(
 'functions',(select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',(select jsonb_agg(x order by x::text) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))x))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f'),
 'tables',(select jsonb_object_agg(c.oid::regclass::text,jsonb_build_object('rls',c.relrowsecurity,'acl',(select jsonb_agg(x order by x::text) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x),'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated) order by k.conname) from pg_constraint k where k.conrelid=c.oid),'policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind in('r','p')),
 'views',(select jsonb_object_agg(c.oid::regclass::text,jsonb_build_object('definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='v')
);rollback;`
const read = (container) => {
  const out = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-XtA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8', maxBuffer: 16e6 }
  )
  return JSON.parse(out.split('\n').find((line) => line.startsWith('{')))
}
execFileSync('docker', ['start', clean], { stdio: 'ignore' })
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync(
        'docker',
        ['exec', clean, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'],
        { stdio: 'ignore' }
      )
      ready = true
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (!ready) throw Error('CLEAN_NOT_READY')
  const upgrade = execFileSync(
    process.execPath,
    ['scripts/homolog/finance/migrate.mjs', 'all', clean],
    { encoding: 'utf8', maxBuffer: 8e6 }
  )
  writeFileSync(evidence + '/clean-upgrade.log', upgrade)
  const installed = read('evolutus_price_phase1_db'),
    fresh = read(clean),
    differences = []
  for (const kind of Object.keys(fresh))
    for (const key of new Set([...Object.keys(installed[kind]), ...Object.keys(fresh[kind])])) {
      if (JSON.stringify(installed[kind][key]) !== JSON.stringify(fresh[kind][key]))
        differences.push({ kind, key, installed: installed[kind][key], fresh: fresh[kind][key] })
    }
  writeFileSync(
    evidence + '/schema-comparison.json',
    JSON.stringify(
      {
        localOnly: true,
        clean,
        differences,
        counts: Object.fromEntries(
          Object.entries(fresh).map(([k, v]) => [k, Object.keys(v).length])
        ),
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    'SCHEMA_DIFFERENCES',
    differences.map(({ kind, key }) => ({ kind, key }))
  )
  if (differences.length) throw Error('SCHEMA_PARITY_FAILED')
} finally {
  execFileSync('docker', ['stop', clean], { stdio: 'ignore' })
}
