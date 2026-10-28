// Same eligible synthetic rows, same SQL connection, paired measurement; always rollback.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const n = Number(process.argv[2] || 1000)
if (![100, 1000].includes(n)) throw Error('SYNTHETIC_VOLUME_REQUIRED')
const args = ['psql', '-U', 'supabase_admin', '-d', 'postgres', '-XtA', '-v', 'ON_ERROR_STOP=1']
const migration = readFileSync(
    'supabase/migrations/20261203000001_professional_commercial_publication.sql',
    'utf8'
  ),
  after = migration.match(
    /create or replace function public.public_list_professionals[\s\S]*?\$\$;/
  )[0]
const optimized = migration
  .match(/create view private.live_professional_listings[\s\S]*?;/)[0]
  .replace('create view', 'create or replace view')
const baseline = optimized.replace(
  / -- Keep[\s\S]*?where l.lifecycle_state/,
  ' join private.live_commercial_resources r on r.id=l.id and r.offering_code=l.offering_code\n where l.lifecycle_state'
)
const source = `begin;set local statement_timeout='120s';load 'auto_explain';set local auto_explain.log_level='notice';set local auto_explain.log_analyze=on;set local auto_explain.log_buffers=on;set local auto_explain.log_timing=off;set local auto_explain.log_nested_statements=on;
update private.commercial_resources set moderation_state='draft' where offering_code in('professional_profile','establishment_profile');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) select md5('phase5-perf-owner:'||i)::uuid,'authenticated','authenticated','p5perf-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,${n * 2})i;
insert into public.professional_listings(id,owner_id,kind,lifecycle_state) select md5('phase5-perf:'||i)::uuid,md5('phase5-perf-owner:'||i)::uuid,case when i<=${n} then 'professional' else 'space' end,'published' from generate_series(1,${n * 2})i;
insert into public.published_professional_listings(listing_id,kind,display_name,sort_key,category_key,modality_keys,specialties,bio,city,city_key,uf,service_mode,public_contacts,published_version)select l.id,l.kind,'Synthetic profile '||i,'synthetic '||lpad(i::text,8,'0'),case when kind='space' then 'academia' else 'personal_trainer' end,array['musculacao'],'{}','Synthetic useful approved profile for paired measurement',case when i%3=0 then 'São Paulo' else 'Campinas' end,case when i%3=0 then 'sao paulo' else 'campinas' end,'SP','online','[]',1 from generate_series(1,${n * 2})i join public.professional_listings l on l.id=md5('phase5-perf:'||i)::uuid;
insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)select md5('phase5-perf-price:'||code)::uuid,code,1000000,1,1,30,clock_timestamp()-interval '1 second',md5('phase5-perf-owner:1')::uuid,'Synthetic rollback-only performance fixture' from public.commercial_offerings where code in('professional_profile','establishment_profile');
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,quote_expires_at,status,fulfilled_at,period_start,period_end)select l.id,l.owner_id,gen_random_uuid(),l.id,l.offering_code,md5('phase5-perf-price:'||l.offering_code)::uuid,1,1,1,1,clock_timestamp()+interval '5 minutes','fulfilled',clock_timestamp(),statement_timestamp(),statement_timestamp()+interval '24 hours' from public.professional_listings l where l.id in(select md5('phase5-perf:'||i)::uuid from generate_series(1,${n * 2})i);
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at)select id,id,period_start,period_end from public.commercial_orders where id in(select md5('phase5-perf:'||i)::uuid from generate_series(1,${n * 2})i);
update private.commercial_resources set content_revision=1,approved_revision=1,moderation_state='approved' where id in(select md5('phase5-perf:'||i)::uuid from generate_series(1,${n * 2})i);
update public.commercial_offerings set integration_ready=true where code in('professional_profile','establishment_profile');
analyze public.professional_listings;analyze public.published_professional_listings;analyze public.users;analyze private.commercial_resources;analyze public.visibility_entitlements;
`
function bench(label) {
  return `create temp table bench_${label}(operation text,ms numeric);do $$declare op text;t timestamptz;i int;begin foreach op in array array['professional','space','filter','page'] loop for i in 1..8 loop t:=clock_timestamp();perform public.public_list_professionals(case when op='space' then 'space' else 'professional' end,case when op='filter' then 'musculacao' end,case when op='filter' then 'SP' end,case when op='filter' then 'São Paulo' end,null,case when op='page' then 80 else 0 end,20);insert into bench_${label} values(op,extract(epoch from clock_timestamp()-t)*1000);end loop;end loop;end$$;
select '${label}' stage,operation,round(percentile_cont(0.5)within group(order by ms)::numeric,3)p50_ms,round(percentile_cont(0.95)within group(order by ms)::numeric,3)p95_ms from bench_${label} group by operation order by operation;
set local auto_explain.log_min_duration='1ms';do $$begin raise notice 'STAGE ${label}';end$$;explain(analyze,buffers)select public.public_list_professionals('professional');explain(analyze,buffers)select public.public_list_professionals('space');explain(analyze,buffers)select public.public_list_professionals('professional','musculacao','SP','São Paulo',null,80,20);set local auto_explain.log_min_duration=-1;`
}
const run = spawnSync('docker', ['exec', '-i', 'evolutus_price_phase1_db', ...args], {
  input:
    source +
    baseline +
    after +
    bench('before') +
    optimized +
    bench('after') +
    `explain(analyze,buffers)select p.listing_id from private.live_professional_listings p where p.kind='professional' and p.uf='SP' and p.city_key='sao paulo' order by p.sort_key,p.listing_id limit 21;rollback;`,
  encoding: 'utf8',
  maxBuffer: 20000000,
})
const evidence = 'docs/finance-restructure/phase5/evidence'
mkdirSync(evidence, { recursive: true })
writeFileSync(evidence + '/performance-paired-' + n + '.log', run.stdout)
writeFileSync(evidence + '/performance-plans-' + n + '.log', run.stderr)
if (run.status !== 0) throw Error(run.stderr)
console.log(
  run.stdout
    .split('\n')
    .filter((s) => /before\||after\||Execution Time/.test(s))
    .join('\n')
)
