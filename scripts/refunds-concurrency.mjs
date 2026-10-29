// Independent committed PostgreSQL transactions; fixed disposable targets only.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { verifyLocalPostgresImage } from './homolog/finance/images.mjs'
const container = process.env.PG_TEST_CONTAINER || 'evolutus_refunds_db'
if (
  !['evolutus_refunds_db', 'supabase_db_treinos_academia', 'evolutus_integrated_db'].includes(
    container
  )
)
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
verifyLocalPostgresImage(
  JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
)
const execute = promisify(execFile),
  q = (v) => "'" + String(v).replaceAll("'", "''") + "'"
async function sql(s) {
  const { stdout } = await execute('docker', [
    'exec',
    '-i',
    container,
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    s,
  ])
  return (
    stdout
      .trim()
      .split('\n')
      .filter((x) => x.startsWith('{'))
      .at(-1) || stdout.trim()
  )
}
const buyer = randomUUID(),
  admin = randomUUID(),
  sessions = new Map([
    [buyer, randomUUID()],
    [admin, randomUUID()],
  ])
const claims = (uid) =>
  `select set_config('request.jwt.claim.sub',${q(uid)},true);select set_config('request.jwt.claims',${q(JSON.stringify({ sub: uid, role: 'authenticated', session_id: sessions.get(uid), amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }))},true);set local role authenticated;`
const asUser = (uid, s) => sql(`begin;${claims(uid)}${s};commit;`)
const settings = JSON.parse(await sql('select row_to_json(s) from private.refund_settings s'))
const initialReversals = JSON.parse(
  await sql(
    "select jsonb_build_object('enabled',config->'financialControls'->'reversalsEnabled') from public.economy_config where id"
  )
).enabled
const results = []
try {
  for (const uid of [buyer, admin])
    await sql(
      `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(${q(uid)},'authenticated','authenticated',${q(uid + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at) values(${q(sessions.get(uid))},${q(uid)},now(),now());update public.users set legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id),legal_acceptance_accepted_at=now() where id=${q(uid)}`
    )
  await sql(
    `update public.users set role='superadmin' where id=${q(admin)};update private.refund_settings set financial_requests_enabled=true where id`
  )
  async function purchase(amount = 590) {
    const id = randomUUID(),
      nsu = 'refund-race-' + randomUUID()
    await sql(
      `insert into public.cash_purchases(id,user_id,request_id,package_id,package_label,cash_amount,amount_centavos,payment_provider,provider_order_nsu,checkout_lease_until,checkout_valid_until) values(${q(id)},${q(buyer)},${q(randomUUID())},'synthetic','Synthetic refund concurrency',25,${amount},'infinitepay',${q(nsu)},now()+interval '1 minute',now()+interval '1 day');select public.confirm_infinitepay_cash_purchase(${q(id)},${q(nsu)},${q(nsu + '-txn')},${q(nsu + '-inv')},${amount},'pix',null)`
    )
    return id
  }
  const first = await purchase(),
    intent = randomUUID()
  const create = () =>
    asUser(
      buyer,
      `select public.create_refund_request('purchase',${q(first)},'withdrawal','',${q(intent)})`
    )
  const replay = await Promise.all(Array.from({ length: 6 }, create))
  const request = JSON.parse(replay[0])
  assert.equal(new Set(replay.map((s) => JSON.parse(s).id)).size, 1)
  assert.equal(
    JSON.parse(
      await sql(
        `select jsonb_build_object('n',count(*),'held',sum(reserved_units)) from public.refund_requests where purchase_id=${q(first)}`
      )
    ).held,
    25
  )
  results.push({ scenario: 'six concurrent submissions: one protocol and hold', passed: true })
  const decision = randomUUID(),
    reject = () =>
      asUser(
        admin,
        `select public.act_on_refund_request(${q(request.id)},'reject','Decisão sintética fundamentada para teste de liberação',${q(decision)},1)`
      )
  const rejection = await Promise.all(Array.from({ length: 6 }, reject))
  assert.equal(new Set(rejection.map((s) => JSON.parse(s).revision)).size, 1)
  assert.equal(
    JSON.parse(
      await sql(
        `select jsonb_build_object('held',sum(reserved_units)) from public.refund_requests where requester_id=${q(buyer)}`
      )
    ).held,
    0
  )
  results.push({ scenario: 'six repeated rejections: one audited release', passed: true })
  // Exact 25 units remain. Whichever transaction wins, hold + available never
  // exceeds wallet, and an existing debit helper cannot spend reserved credits.
  const second = await purchase(1000)
  await sql(
    `select public._wallet_debit_cash(${q(buyer)},25);select public._ledger_record(${q(buyer)},${q(randomUUID())},'cash','debit',25,'synthetic','fixture','prior-spend')`
  )
  const race = await Promise.allSettled([
    asUser(
      buyer,
      `select public.create_refund_request('purchase',${q(second)},'withdrawal','',${q(randomUUID())})`
    ),
    sql(
      `begin;select public._wallet_debit_cash(${q(buyer)},25);select public._ledger_record(${q(buyer)},${q(randomUUID())},'cash','debit',25,'synthetic','fixture','concurrent-spend');commit;`
    ),
  ])
  assert.equal(race[0].status, 'fulfilled')
  if (race[1].status === 'rejected') assert.match(race[1].reason.stderr, /CASH_RESERVED_FOR_REFUND/)
  const balance = JSON.parse(
    await sql(
      `select jsonb_build_object('balance',cash_balance,'held',(select sum(reserved_units) from public.refund_requests where requester_id=${q(buyer)}),'ledger',(select sum(case direction when 'credit' then amount else -amount end) from public.economy_transactions where user_id=${q(buyer)} and asset='cash')) from public.wallets where user_id=${q(buyer)}`
    )
  )
  assert.ok(balance.balance >= balance.held)
  assert.equal(balance.balance, balance.ledger)
  results.push({ scenario: 'spending concurrent with reservation', passed: true, ...balance })

  const third = await purchase(750)
  const thirdRequest = JSON.parse(
    await asUser(
      buyer,
      `select public.create_refund_request('purchase',${q(third)},'withdrawal','',${q(randomUUID())})`
    )
  )
  const next = async (action, revision, evidence = {}) =>
    JSON.parse(
      await asUser(
        admin,
        `select public.act_on_refund_request(${q(thirdRequest.id)},${q(action)},'Homologação sintética com evidência do provedor simulado',${q(randomUUID())},${revision},${q(JSON.stringify(evidence))}::jsonb)`
      )
    )
  await sql(
    `update private.refund_settings set settlement_enabled=true,expected_merchant='synthetic-merchant' where id;update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','true') where id`
  )
  await next('review', 1)
  await next('approve', 2, {
    legalReview: 'confirmed',
    relatedContractsReview: 'confirmed',
    basis: 'Revisão jurídica sintética sem desconto por consumo e com vínculos conferidos',
    partyClassification: 'individual',
  })
  await next('provider_pending', 3)
  const transaction = JSON.parse(
    await sql(
      `select jsonb_build_object('nsu',provider_transaction_nsu) from public.cash_purchases where id=${q(third)}`
    )
  ).nsu
  const confirmed = await next('confirm_provider', 4, {
    channel: 'infinitepay_original_payment',
    verification: 'administrative_evidence_only',
    externalId: 'race-refund-' + third,
    reference: 'synthetic-provider-evidence-' + third,
    transactionNsu: transaction,
    currency: 'BRL',
    merchant: 'synthetic-merchant',
    amountCentavos: '750',
    occurredAt: new Date().toISOString(),
  })
  const completeIntent = randomUUID()
  const completed = await Promise.all(
    Array.from({ length: 6 }, () =>
      asUser(
        admin,
        `select public.act_on_refund_request(${q(thirdRequest.id)},'complete','Compensação final inteiramente sintética',${q(completeIntent)},${confirmed.revision})`
      )
    )
  )
  assert.ok(completed.every((s) => JSON.parse(s).status === 'completed'))
  const final = JSON.parse(
    await sql(
      `select jsonb_build_object('settlements',(select count(*) from public.refund_settlements where request_id=${q(thirdRequest.id)}),'reversals',(select count(*) from public.cash_purchase_reversals where purchase_id=${q(third)}),'ledger',(select count(*) from public.economy_transactions where reference_type='cash_purchase' and reference_id=${q(third)} and direction='debit'))`
    )
  )
  assert.deepEqual(final, { settlements: 1, reversals: 1, ledger: 1 })
  results.push({
    scenario: 'six simultaneous completions: one existing reversal and ledger debit',
    passed: true,
    ...final,
  })
  mkdirSync('docs/finance-restructure/refunds/evidence', { recursive: true })
  writeFileSync(
    'docs/finance-restructure/refunds/evidence/concurrency.json',
    JSON.stringify(results, null, 2) + '\n'
  )
  console.log(JSON.stringify(results))
} finally {
  await sql(
    `update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}',${q(JSON.stringify(initialReversals))}::jsonb) where id`
  )
  await sql(
    `update private.refund_settings set financial_requests_enabled=${settings.financial_requests_enabled},settlement_enabled=${settings.settlement_enabled},expected_merchant=${settings.expected_merchant === null ? 'null' : q(settings.expected_merchant)},policy_version=${q(settings.policy_version)} where id`
  )
}
