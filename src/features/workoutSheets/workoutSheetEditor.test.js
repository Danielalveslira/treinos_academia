import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
let dir, ui
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sheet-editor-ui-'))
  const file = join(dir, 'ui.cjs')
  await build({
    stdin: {
      contents: `
    import React from 'react';import TestRenderer,{act} from 'react-test-renderer';
    import {WorkoutSheetItemEditor} from './src/features/workoutSheets/WorkoutSheetItemEditor.jsx';
    import {WorkoutSheetExercisePicker} from './src/features/workoutSheets/WorkoutSheetExercisePicker.jsx';
    export {act};
    export function mountItem(props){let tree;act(()=>{tree=TestRenderer.create(React.createElement(WorkoutSheetItemEditor,props))});return tree}
    export async function mountPicker(props){let tree;await act(async()=>{tree=TestRenderer.create(React.createElement(WorkoutSheetExercisePicker,props))});return tree}
    export function updateItem(tree,props){act(()=>tree.update(React.createElement(WorkoutSheetItemEditor,props)))}
  `,
      resolveDir: resolve('.'),
      loader: 'jsx',
    },
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'ui-boundaries',
        setup(b) {
          b.onResolve({ filter: /^(react(?:\/.*)?|react-test-renderer)$/ }, ({ path }) => ({
            path: createRequire(import.meta.url).resolve(path),
            external: true,
          }))
          b.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer',
            namespace: 'fixture',
          }))
          b.onResolve({ filter: /contexts\/ExercisesContext$/ }, () => ({
            path: 'exercises',
            namespace: 'fixture',
          }))
          b.onResolve({ filter: /components\/ExerciseCatalog$/ }, () => ({
            path: 'catalog',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            resolveDir: resolve('.'),
            loader: 'jsx',
            contents:
              path === 'primer'
                ? `
      import React from 'react';const element=(tag)=>React.forwardRef(({children,as,...props},ref)=>React.createElement(as||tag,{...props,ref},children));
      export const Box=element('div'),Text=element('span'),Button=element('button'),Heading=({children,...props})=>{globalThis.__itemRenders=(globalThis.__itemRenders||0)+1;return React.createElement('h3',props,children)};
      export const IconButton=({icon,...props})=>React.createElement('button',props);
      export const Flash=element('div'),Spinner=element('span'),TextInput=element('input'),Textarea=element('textarea');
      export const FormControl=element('div');FormControl.Label=element('label');FormControl.Caption=element('span');
      export function SegmentedControl({children,onChange,...props}){return React.createElement('div',props,React.Children.map(children,(child,i)=>React.cloneElement(child,{onClick:()=>onChange(i)})))}
      SegmentedControl.Button=element('button');
    `
                : path === 'exercises'
                  ? `
      const exercises=[{id:'one',name:'Supino',active:true,source:'catalog',provider:'evolutus_dataset',catalogAvailable:true}];
      export function useExercises(){return {exercises,addFromCatalog:async()=>({added:true,exercise:exercises[0]}),loading:false,error:null,refresh:()=>{}}}
    `
                  : `
      import React,{useEffect,useState} from 'react';export function ExerciseCatalog({onClose}){const [query,setQuery]=useState('');useEffect(()=>{globalThis.__catalogMounts=(globalThis.__catalogMounts||0)+1},[]);return <div><input aria-label="Busca sintética" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={onClose}>Meus exercícios</button></div>}
    `,
          }))
        },
      },
    ],
  })
  ui = createRequire(import.meta.url)(file)
})
after(async () => {
  delete globalThis.__itemRenders
  delete globalThis.__catalogMounts
  await rm(dir, { recursive: true, force: true })
})
const item = { exercise_id: 'one', exercise: { name: 'Supino', type: 'strength' }, target_sets: 3 }
const button = (tree, name) =>
  tree.root
    .findAllByType('button')
    .find((node) => node.props['aria-label'] === name || node.children.join('') === name)
test('metas colapsadas não montam campos; abrir preserva valores e alterações usam o vínculo correto', () => {
  const changes = [],
    moves = [],
    removals = []
  const props = {
    item,
    index: 0,
    total: 2,
    disabled: false,
    onPatch: (...args) => changes.push(args),
    onMove: (...args) => moves.push(args),
    onRemove: (id) => removals.push(id),
  }
  const tree = ui.mountItem(props)
  assert.equal(tree.root.findAllByType('input').length, 0)
  const renders = globalThis.__itemRenders
  ui.updateItem(tree, { ...props })
  assert.equal(
    globalThis.__itemRenders,
    renders,
    'props equivalentes não renderizam a linha novamente'
  )
  ui.act(() => button(tree, 'Editar metas de Supino').props.onClick())
  const sets = tree.root.findAllByType('input').find((node) => node.props.max === 10)
  assert.equal(sets.props.value, 3)
  ui.act(() => sets.props.onChange({ target: { value: '4' } }))
  assert.deepEqual(changes, [['one', 'target_sets', '4']])
  assert.equal(button(tree, 'Subir Supino').props.disabled, true)
  ui.act(() => button(tree, 'Descer Supino').props.onClick())
  ui.act(() => button(tree, 'Remover Supino da ficha').props.onClick())
  assert.deepEqual(moves, [[0, 1]])
  assert.deepEqual(removals, ['one'])
  ui.act(() => button(tree, 'Editar metas de Supino').props.onClick())
  assert.equal(tree.root.findAllByType('input').length, 0)
  ui.act(() => tree.unmount())
})
test('catálogo carrega somente na primeira abertura e mantém busca ao voltar pela biblioteca', async () => {
  globalThis.__catalogMounts = 0
  const tree = await ui.mountPicker({ items: [], onAdd: () => {}, disabled: false })
  assert.equal(globalThis.__catalogMounts, 0)
  ui.act(() => button(tree, 'Adicionar exercícios').props.onClick())
  await ui.act(async () => button(tree, 'Catálogo').props.onClick())
  assert.equal(globalThis.__catalogMounts, 1)
  const search = () =>
    tree.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Busca sintética')
  ui.act(() => search().props.onChange({ target: { value: 'Puxada' } }))
  ui.act(() => button(tree, 'Meus exercícios').props.onClick())
  await ui.act(async () => button(tree, 'Catálogo').props.onClick())
  assert.equal(search().props.value, 'Puxada')
  assert.equal(globalThis.__catalogMounts, 1)
  ui.act(() => tree.unmount())
})
