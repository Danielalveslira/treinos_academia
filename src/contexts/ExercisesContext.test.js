import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
let directory, mount
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'exercise-context-'))
  const outfile = join(directory, 'test.cjs')
  await build({
    stdin: {
      contents: `
      import React from 'react'
      import TestRenderer, {act} from 'react-test-renderer'
      import {ExercisesProvider,useExercises} from './ExercisesContext.jsx'
      import {clearPageCache} from '../utils/pageCache.js'
      export function mountProvider(){
        clearPageCache()
        let context, renderer
        function Consumer(){context=useExercises();return null}
        const tree=()=>React.createElement(ExercisesProvider,null,React.createElement(Consumer))
        act(()=>{renderer=TestRenderer.create(tree())})
        return {get:()=>context, switchUser:(uid)=>act(()=>{globalThis.__exerciseUser=uid;renderer.update(tree())}), unmount:()=>act(()=>renderer.unmount())}
      }
    `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [
      {
        name: 'service-fixtures',
        setup(b) {
          b.onResolve({ filter: /\/hooks\/useAuth$/ }, () => ({
            path: 'auth',
            namespace: 'fixture',
          }))
          b.onResolve({ filter: /\/services\/exercisesService$/ }, () => ({
            path: 'service',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'auth'
                ? `export const useAuth=()=>({user:{uid:globalThis.__exerciseUser},offlineLocal:false})`
                : `
        export const listExercises=async(uid)=>[{id:uid,name:uid,muscleGroup:'Peito',source:'catalog',provider:'evolutus_dataset',active:true}]
        export const createCatalogExercise=(uid,item)=>globalThis.__exerciseCreate(uid,item)
        export const updateExercise=async(...args)=>{globalThis.__exerciseUpdates.push(args)}
        export const deleteExercise=async()=>{}
        export const saveExerciseOrder=async()=>{}
      `,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  ;({ mountProvider: mount } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
beforeEach(() => {
  globalThis.__exerciseUser = 'A'
  globalThis.__exerciseUpdates = []
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
const catalog = {
  id: 'cat',
  provider: 'evolutus_dataset',
  providerExerciseId: 'cat',
  name: 'Oficial',
  primaryMuscles: ['peito'],
}
const confirmed = {
  id: 'new',
  source: 'catalog',
  provider: 'evolutus_dataset',
  providerExerciseId: 'cat',
  name: 'Confirmado pelo servidor',
  muscleGroup: 'Peito',
  active: true,
}

test('concurrent official additions merge the confirmed row once and preferences never overwrite identity', async () => {
  const pending = []
  globalThis.__exerciseCreate = () => new Promise((resolve) => pending.push(resolve))
  const page = mount()
  await tick()
  const first = page.get().addFromCatalog(catalog)
  const second = page.get().addFromCatalog(catalog)
  pending[0]({ added: true, exercise: confirmed })
  await first
  pending[1]({ added: false, exercise: confirmed })
  await second
  assert.equal(page.get().exercises.filter((exercise) => exercise.id === 'new').length, 1)
  assert.equal(page.get().exercises.find((exercise) => exercise.id === 'new').name, confirmed.name)
  await page
    .get()
    .edit('new', {
      name: 'Forjado',
      muscleGroup: 'Outro',
      source: 'custom',
      note: 'Minha nota',
      active: false,
    })
  assert.deepEqual(globalThis.__exerciseUpdates[0][2], { note: 'Minha nota', active: false })
  assert.equal(page.get().exercises.find((exercise) => exercise.id === 'new').source, 'catalog')
  page.unmount()
})

test('an old account response cannot pollute the next account, including subsequent edits', async () => {
  let resolve
  globalThis.__exerciseCreate = () =>
    new Promise((done) => {
      resolve = done
    })
  const page = mount()
  await tick()
  const request = page.get().addFromCatalog(catalog)
  page.switchUser('B')
  await tick()
  resolve({ added: true, exercise: confirmed })
  await request
  await page.get().edit('B', { note: 'Nota B' })
  assert.deepEqual(
    page.get().exercises.map((exercise) => exercise.id),
    ['B']
  )
  assert.equal(page.get().exercises[0].note, 'Nota B')
  page.unmount()
})
