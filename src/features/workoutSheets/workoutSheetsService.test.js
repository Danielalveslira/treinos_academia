import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
let dir, service
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sheets-service-'))
  const file = join(dir, 'service.cjs')
  await build({
    entryPoints: [resolve('src/features/workoutSheets/workoutSheetsService.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: file,
    plugins: [
      {
        name: 'rpc-boundary',
        setup(b) {
          b.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'config',
            namespace: 'fake',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents:
              "export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'test-user'}}}})},rpc:(name,args)=>globalThis.__sheetRpc(name,args)}",
          }))
        },
      },
    ],
  })
  service = createRequire(import.meta.url)(file)
})
after(async () => {
  delete globalThis.__sheetRpc
  await rm(dir, { recursive: true, force: true })
})
const sheet = {
  id: 'sheet',
  revision: 3,
  name: ' A ',
  goal: null,
  goal_description: '',
  weekdays: [],
  items: [{ exercise_id: 'exercise', target_sets: '3' }],
}
test('ACK perdido após save é reconciliado sem repetir a gravação', async () => {
  const calls = []
  globalThis.__sheetRpc = async (name, args) => {
    calls.push({ name, args })
    return name === 'save_workout_sheet'
      ? { error: { message: 'Failed to fetch' } }
      : { data: { ...sheet, revision: 4, name: 'A' } }
  }
  assert.deepEqual(await service.saveWorkoutSheet(sheet, 'stable-request'), {
    id: 'sheet',
    revision: 4,
  })
  assert.deepEqual(
    calls.map((c) => c.name),
    ['save_workout_sheet', 'get_my_workout_sheet']
  )
  assert.equal(calls[0].args.p_expected_revision, 3)
  assert.equal(calls[0].args.p_metadata.name, 'A')
  assert.equal(calls[0].args.p_items[0].target_sets, 3)
})
test('timeout com estado divergente preserva erro e não reaplica payload', async () => {
  const failure = { message: 'timeout' }
  const calls = []
  globalThis.__sheetRpc = async (name) => {
    calls.push(name)
    return name === 'save_workout_sheet'
      ? { error: failure }
      : { data: { ...sheet, name: 'Outra aba', revision: 4 } }
  }
  await assert.rejects(
    service.saveWorkoutSheet(sheet, 'stable-request'),
    (error) => error === failure
  )
  assert.deepEqual(calls, ['save_workout_sheet', 'get_my_workout_sheet'])
})
test('conflito permanece explícito para o editor comparar versões', async () => {
  let calls = 0
  globalThis.__sheetRpc = async () => {
    calls++
    return { error: { message: 'SHEET_VERSION_CONFLICT' } }
  }
  await assert.rejects(
    service.saveWorkoutSheet(sheet, 'stable-request'),
    (error) => error.message === 'SHEET_VERSION_CONFLICT'
  )
  assert.equal(calls, 1)
})
test('criação envia metadados e itens juntos e reutiliza request id fornecido', async () => {
  const calls = []
  globalThis.__sheetRpc = async (name, args) => {
    calls.push({ name, args })
    return { data: { id: 'created', revision: 1 } }
  }
  await service.saveWorkoutSheet({ ...sheet, id: null }, 'same-request', 'account-a')
  await service.saveWorkoutSheet({ ...sheet, id: null }, 'same-request', 'account-a')
  assert.equal(calls[0].name, 'create_workout_sheet')
  assert.equal(calls[0].args.p_items[0].exercise_id, 'exercise')
  assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id)
  assert.equal(calls[0].args.p_expected_user, 'account-a')
})

test('exercise picker is a single read RPC with a bounded intent', async () => {
  const calls = []
  globalThis.__sheetRpc = async (name, args) => {
    calls.push({ name, args })
    return { data: { sheets: [{ id: 'matching' }] } }
  }
  assert.deepEqual(await service.getSheetInsightsForExercise('exercise-1'), {
    sheets: [{ id: 'matching' }],
  })
  assert.deepEqual(calls, [
    { name: 'get_my_sheet_insights_for_exercise', args: { p_exercise_id: 'exercise-1' } },
  ])
})
