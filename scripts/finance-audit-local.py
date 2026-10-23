#!/usr/bin/env python3
"""Synthetic financial checks. Fixed local Docker targets only; never accepts a DB URL."""
import argparse
import hashlib
import concurrent.futures
import json
import pathlib
import statistics
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['sql', 'concurrency', 'performance'])
parser.add_argument('--container', choices=['evolutus_finance_audit', 'evolutus_finance_clean'], default='evolutus_finance_audit')
parser.add_argument('--baseline', action='store_true', help='Run historical HEAD tests before candidate migrations')
args = parser.parse_args()
container = args.container
info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
if info['HostConfig'].get('PortBindings') or info['Config'].get('Image') not in [
    'public.ecr.aws/supabase/postgres:17.6.1.166', 'supabase/postgres:17.6.1.166']:
    raise SystemExit('Only isolated synthetic PostgreSQL containers without published ports are allowed')

def sql(source):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'supabase_admin',
                             '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1'],
                            input=source, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stdout.strip()

def loadtest(name, statements, allow_errors=()):
    start = time.monotonic()
    def request(statement):
        begin = time.monotonic()
        try:
            sql(statement)
            status = 'ok'
        except RuntimeError as error:
            if not any(code in str(error) for code in allow_errors):
                raise
            status = 'expected_rejection'
        return (time.monotonic() - begin) * 1000, status
    # Bounded concurrency protects Codespace CPU; 100 business attempts per case.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(request, statements))
    elapsed = time.monotonic() - start
    values = sorted(x[0] for x in results)
    return dict(name=name, requests=len(results), concurrency=4, p50_ms=round(statistics.median(values), 2),
                p95_ms=round(values[int(len(values)*.95)-1], 2), p99_ms=round(values[int(len(values)*.99)-1], 2),
                requests_per_second=round(len(results)/elapsed, 2),
                expected_rejections=sum(s != 'ok' for _, s in results), unexpected_errors=0)

if args.action == 'sql':
    logs = pathlib.Path('/tmp/evolutus-finance-sql-baseline' if args.baseline else '/tmp/evolutus-finance-sql')
    logs.mkdir(exist_ok=True)
    results = []
    for file in sorted((ROOT/'supabase/tests').glob('*.sql')):
        if args.baseline and file.name.startswith('finance_'): continue
        # Performance-only script has no pgTAP plan, but is safe and transactional.
        try:
            source = subprocess.check_output(['git','show','HEAD:'+str(file.relative_to(ROOT))],cwd=ROOT,text=True) if args.baseline else file.read_text()
            output = sql(source)
            (logs/(file.stem+'.log')).write_text(output)
            failed = 'not ok ' in output or 'Looks like you failed' in output
            results.append(dict(file=file.name, passed=not failed,
                                assertions=sum(line.startswith('ok ') for line in output.splitlines()),
                                source_sha256=hashlib.sha256(source.encode()).hexdigest()))
        except RuntimeError as error:
            (logs/(file.stem+'.log')).write_text(str(error))
            results.append(dict(file=file.name, passed=False, error=str(error)[-300:]))
        print(json.dumps(results[-1]), flush=True)
    (logs/'summary.json').write_text(json.dumps(results, indent=2))
    raise SystemExit(0 if all(r['passed'] for r in results) else 1)

uid = str(uuid.uuid4())
admin = str(uuid.uuid4())
community = str(uuid.uuid4())
other_community = str(uuid.uuid4())
setup = f"""
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('{uid}','authenticated','authenticated','{uid}@example.invalid','x',now(),'{{}}','{{}}',now(),now()),
('{admin}','authenticated','authenticated','{admin}@example.invalid','x',now(),'{{}}','{{}}',now(),now());
update public.users set role='superadmin' where id='{admin}';
"""
if args.action == 'performance':
    # Same transaction, data, calls and timing boundary. Each run rolls back.
    base = setup + f"select public._wallet_ensure_row('{uid}');"
    loop = f"""do $$ declare t timestamptz := clock_timestamp(); begin
    for i in 1..1000 loop
      perform public._wallet_credit_cash('{uid}',1);
      perform public._wallet_debit_cash('{uid}',1);
    end loop;
    raise notice 'FINANCE_PERF_MS=%',extract(epoch from clock_timestamp()-t)*1000;
    end $$; rollback;"""
    # Original definitions from historical migrations, untouched.
    text = (ROOT/'supabase/migrations/20261004000001_account_deletion_financial_case.sql').read_text()
    original = ''
    for name in ['_wallet_credit_cash', '_wallet_debit_cash']:
        start = text.index('create or replace function public.'+name+'(')
        original += text[start:text.index('$$;', start)+3]+'\n'
    observations = {}
    for name, definitions in [('before', original), ('after', '')]:
        values = []
        for _ in range(5):
            command = ['docker','exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1']
            run = subprocess.run(command, input='begin;'+definitions+base+loop, text=True,capture_output=True,check=True)
            import re
            values.append(float(re.search(r'FINANCE_PERF_MS=([\d.]+)',run.stderr).group(1)))
        observations[name] = {'calls_per_sample':2000, 'samples_ms':values,'median_ms':statistics.median(values)}
    print(json.dumps(observations,indent=2))
    raise SystemExit(0)

original_config = sql("select config from public.economy_config where id;")
sql(setup)
reservation = json.loads(sql(f"select public.reserve_infinitepay_cash_purchase('{uid}','pack_25');"))
pid, order = reservation['id'], reservation['orderNsu']
confirm = f"select public.confirm_infinitepay_cash_purchase('{pid}','{order}','txn-{pid}','inv-{pid}',590,'pix',null);"
results = [loadtest('100 confirmations / one payment', [confirm]*100)]
assert sql(f"select cash_balance from public.wallets where user_id='{uid}';") == '25'
assert sql(f"select count(*) from public.economy_transactions where user_id='{uid}';") == '1'
sql(f"""insert into public.communities(id,name,created_by,owner_id) values
('{community}','Synthetic finance one','{uid}','{uid}'),('{other_community}','Synthetic finance two','{uid}','{uid}');
insert into public.community_members(community_id,user_id) values('{community}','{uid}'),('{other_community}','{uid}');
update public.economy_config set config=jsonb_set(config,'{{promotionPackages,community_boost_7d,cashAmount}}','25') where id;
""")
def promote(target, key):
    return f"begin;select set_config('request.jwt.claim.sub','{uid}',true);select public.create_promotion('community','{target}','community_boost_7d','{key}');commit;"
results.append(loadtest('100 promotion replays / one debit', [promote(community, 'same-event')]*100))
assert sql(f"select cash_balance from public.wallets where user_id='{uid}';") == '0'
assert sql(f"select count(*) from public.promotions where owner_id='{uid}';") == '1'
results.append(loadtest('100 insufficient balance spends', [promote(other_community, f'low-{i}') for i in range(100)], ('INSUFFICIENT_CASH',)))
assert sql(f"select count(*) from public.promotions where owner_id='{uid}';") == '1'
# Another payment, then race 50 duplicate reversals with 50 spends of the same balance.
reservation = json.loads(sql(f"select public.reserve_infinitepay_cash_purchase('{uid}','pack_25');"))
pid, order = reservation['id'], reservation['orderNsu']
sql(f"select public.confirm_infinitepay_cash_purchase('{pid}','{order}','txn-{pid}','inv-{pid}',590,'pix',null);")
sql("update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','true') where id;")
reverse = f"begin;select set_config('request.jwt.claim.sub','{admin}',true);select public.admin_record_cash_reversal('{pid}','event-{pid}','chargeback',590,'provider-synthetic-proof','Synthetic concurrent verification');commit;"
statements = [item for i in range(50) for item in (reverse, promote(other_community, 'race-spend'))]
results.append(loadtest('100 reversal/spend races', statements, ('INSUFFICIENT_CASH',)))
assert sql(f"select cash_balance from public.wallets where user_id='{uid}';") == '0'
assert sql(f"select count(*) from public.cash_purchase_reversals where purchase_id='{pid}';") == '1'
assert sql(f"select sum(case direction when 'credit' then amount else -amount end) from public.economy_transactions where user_id='{uid}' and asset='cash';") == '0'
assert int(sql(f"select private.cash_debt('{uid}');")) in (0,25)
# 100 attempts against the daily cap, using the existing central award engine.
actions = ['daily_activity','workout_completed','post_published','comment_posted','support_received']
results.append(loadtest('100 EvoCoin awards / daily cap', [f"select private.award_evocoins('{uid}','{actions[i%5]}','stress:{i}','test','synthetic');" for i in range(100)]))
assert sql(f"select earned_total from public.economy_daily where user_id='{uid}' and day=private.sp_today();") == '10'
assert sql(f"select coin_balance=lifetime_coins_earned and coin_balance=10 from public.wallets where user_id='{uid}';") == 't'
sql("update public.economy_config set config='"+original_config.replace("'","''")+"'::jsonb where id;")
print(json.dumps({'results': results, 'invariants': 'passed', 'fixturesRetainedInDisposableContainer': True},indent=2))
