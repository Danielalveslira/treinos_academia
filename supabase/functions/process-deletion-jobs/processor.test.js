import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAuthUserAlreadyGone, processDeletionJobs } from './processor.js'

const silent = { log() {}, error() {} }

// Fake do client Supabase: `rpcs` mapeia nome -> função(args) => { data, error }; registra chamadas.
function makeAdmin({ jobs = [], rpcs = {}, deleteUser = async () => ({ error: null }), files = [] } = {}) {
  const calls = []
  const removed = []
  const admin = {
    calls,
    removed,
    async rpc(name, args) {
      calls.push([name, args])
      if (name === 'list_pending_deletion_jobs') return { data: jobs, error: null }
      const handler = rpcs[name]
      return handler ? handler(args) : { data: null, error: null }
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          removed.push([bucket, paths])
          return { error: null }
        },
        list: async () => ({ data: files, error: null }),
      }),
    },
    auth: { admin: { deleteUser: async (id) => (calls.push(['deleteUser', id]), deleteUser(id)) } },
  }
  return admin
}
const names = (admin) => admin.calls.map(([name]) => name)
const authPending = (extra = {}) => ({
  data: { authPending: true, kind: 'account', targetId: 'u1', photoPaths: [], deleteAuthUser: true, ...extra },
  error: null,
})

test('happy path: banco limpo, Auth removido, só então o job é confirmado', async () => {
  const admin = makeAdmin({ jobs: [{ id: 'j1' }], rpcs: { run_deletion_job: () => authPending() } })
  const summary = await processDeletionJobs(admin, silent)
  assert.deepEqual(names(admin), ['list_pending_deletion_jobs', 'run_deletion_job', 'deleteUser', 'confirm_auth_deletion'])
  assert.equal(summary.processed, 1)
  assert.equal(summary.errored, 0)
})

test('falha temporária do Auth: não confirma, grava o diagnóstico e conta como erro (job segue em auth_cleanup)', async () => {
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }],
    rpcs: { run_deletion_job: () => authPending() },
    deleteUser: async () => ({ error: { status: 503, message: 'service unavailable' } }),
  })
  const summary = await processDeletionJobs(admin, silent)
  assert.equal(names(admin).includes('confirm_auth_deletion'), false)
  const [, args] = admin.calls.find(([name]) => name === 'record_deletion_job_error')
  assert.equal(args.p_job_id, 'j1')
  assert.match(args.p_error, /503/)
  assert.equal(summary.errored, 1)
  assert.equal(summary.processed, 0)
})

test('retry: job em auth_cleanup é reentregue (retry:true), sem exclusão de dados, e converge', async () => {
  let attempt = 0
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }],
    rpcs: { run_deletion_job: () => authPending({ retry: true }) },
    deleteUser: async () => (++attempt === 1 ? { error: { status: 500, message: 'boom' } } : { error: null }),
  })
  const first = await processDeletionJobs(admin, silent)
  const second = await processDeletionJobs(admin, silent)
  assert.equal(first.errored, 1)
  assert.equal(second.processed, 1)
  assert.equal(admin.calls.filter(([name]) => name === 'confirm_auth_deletion').length, 1)
})

test('Auth já removido (404 / user_not_found) conta como sucesso e confirma o job', async () => {
  for (const error of [{ status: 404, message: 'not found' }, { code: 'user_not_found', message: 'User not found' }]) {
    const admin = makeAdmin({ jobs: [{ id: 'j1' }], rpcs: { run_deletion_job: () => authPending() }, deleteUser: async () => ({ error }) })
    const summary = await processDeletionJobs(admin, silent)
    assert.equal(summary.processed, 1)
    assert.equal(summary.errored, 0)
    assert.ok(names(admin).includes('confirm_auth_deletion'))
    assert.equal(names(admin).includes('record_deletion_job_error'), false)
  }
  assert.equal(isAuthUserAlreadyGone({ status: 500 }), false)
  assert.equal(isAuthUserAlreadyGone(null), false)
})

test('falha ao confirmar no banco depois de o Auth sair: erro, e o próximo ciclo repete (404 = sucesso)', async () => {
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }],
    rpcs: { run_deletion_job: () => authPending(), confirm_auth_deletion: () => ({ data: null, error: { message: 'db down' } }) },
  })
  const summary = await processDeletionJobs(admin, silent)
  assert.equal(summary.errored, 1)
  assert.equal(summary.processed, 0)
})

test('falha do corpo da exclusão (result.error) não toca em Storage nem Auth', async () => {
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }],
    rpcs: { run_deletion_job: () => ({ data: { error: true, message: 'P0001: falha' }, error: null }) },
  })
  const summary = await processDeletionJobs(admin, silent)
  assert.deepEqual(names(admin), ['list_pending_deletion_jobs', 'run_deletion_job'])
  assert.equal(summary.errored, 1)
})

test('bloqueio financeiro e job ignorado nunca chamam Auth', async () => {
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }, { id: 'j2' }],
    rpcs: {
      run_deletion_job: ({ p_job_id }) =>
        p_job_id === 'j1' ? { data: { blocked: true, reason: 'positive_cash_balance' }, error: null } : { data: { skipped: true }, error: null },
    },
  })
  const summary = await processDeletionJobs(admin, silent)
  assert.equal(summary.blocked, 1)
  assert.equal(names(admin).includes('deleteUser'), false)
})

test('job que não é de conta (status/comunidade) conclui direto e só limpa o Storage', async () => {
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }],
    rpcs: { run_deletion_job: () => ({ data: { complete: true, kind: 'status', targetId: 's1', photoPaths: ['a.webp'], deleteAuthUser: false }, error: null }) },
  })
  const summary = await processDeletionJobs(admin, silent)
  assert.equal(summary.processed, 1)
  assert.deepEqual(admin.removed, [['status-photos', ['a.webp']]])
  assert.equal(names(admin).includes('deleteUser'), false)
  assert.equal(names(admin).includes('confirm_auth_deletion'), false)
})

test('um job com erro inesperado não impede os seguintes', async () => {
  const admin = makeAdmin({
    jobs: [{ id: 'j1' }, { id: 'j2' }],
    rpcs: {
      run_deletion_job: ({ p_job_id }) => {
        if (p_job_id === 'j1') throw new Error('inesperado')
        return authPending({ targetId: 'u2' })
      },
    },
  })
  const summary = await processDeletionJobs(admin, silent)
  assert.equal(summary.errored, 1)
  assert.equal(summary.processed, 1)
})

test('falha ao listar jobs devolve erro sem processar nada', async () => {
  const admin = makeAdmin()
  admin.rpc = async () => ({ data: null, error: { message: 'down' } })
  assert.deepEqual(await processDeletionJobs(admin, silent), { ok: false, error: 'INTERNAL_ERROR' })
})
