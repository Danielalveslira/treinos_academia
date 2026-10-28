import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
let directory, mount, act
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'professional-owner-'))
  await build({
    stdin: {
      contents: `import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import Page from './ProfessionalListingsHub.jsx';export {act};export const mount=()=>TestRenderer.create(<Page/>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile: join(directory, 'page.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'fixtures',
        setup(b) {
          const map = new Map([['./MyProfessionalListing',`import React from 'react';export default function Editor(p){return <div>Selected {p.listingId}</div>}`],
            ['../hooks/useAuth', `export const useAuth=()=>globalThis.__fixture.auth`],
            ['../services/communitiesService', `export const listActiveCommunities=async()=>[]`],
            ['../services/professionalListingsService',`export const listMyProfessionalListings=(...a)=>globalThis.__fixture.list(...a);export const getProfessionalListingLimits=async()=>globalThis.__fixture.limits;export const createProfessionalListing=(...a)=>globalThis.__fixture.create(...a);`],
            ['../services/usageProfileService', `export const setUsageProfile=async()=>{}`],
            [
              '../services/storefrontService',
              `export const uploadStorefrontImage=(...a)=>globalThis.__fixture.upload(...a)`,
            ],
            [
              '../components/ProfessionalListingForm',
              `import React from 'react';export default function Form(p){globalThis.__form=p;return <form onSubmit={p.onSubmit}><button type="submit">Salvar rascunho</button></form>}`,
            ],
            [
              '../components/CommercialLeasePurchase',
              `import React from 'react';export default function Lease(p){globalThis.__lease=p;return <div>Contratação autorizada</div>}`,
            ],
            [
              '../components/CommercialOrderHistory',
              `export default function History(){return null}`,
            ],
            ['../components/ListingLegalNotice', `export default function Notice(){return null}`],
            ['../components/StorefrontImage', `export default function Image(){return null}`],
            ['../components/UsageProfileField', `export const UsageProfileField=()=>null`],
            ['react-router-dom',`import React from 'react';export const Link=({to,children,...p})=><a href={to} {...p}>{children}</a>;export const useSearchParams=()=>[new URLSearchParams(globalThis.__fixture.query||''),p=>globalThis.__fixture.navigate(p)];`],
            [
              '@primer/react',
              `import React from 'react';export const Box=({as:Tag='div',children,...p})=><Tag {...p}>{children}</Tag>;export const Heading=({as:Tag='h1',children})=><Tag>{children}</Tag>;export const Button=({children,...p})=><button {...p}>{children}</button>;export const Text=({as:Tag='span',children})=><Tag>{children}</Tag>;export const Label=({children})=><span>{children}</span>;export const Flash=({children})=><div>{children}</div>;export const Spinner=()=>null;export const Dialog=({children})=><div>{children}</div>;export const FormControl=Object.assign(({children})=><div>{children}</div>,{Label:({children})=><label>{children}</label>});export const Select=Object.assign(({children,...p})=><select {...p}>{children}</select>,{Option:({children,...p})=><option {...p}>{children}</option>});`,
            ],
          ])
          b.onResolve({ filter: /^(react|react-test-renderer|react\/jsx-runtime)$/ }, (a) => ({
            path: createRequire(import.meta.url).resolve(a.path),
            external: true,
          }))
          b.onResolve({ filter: /.*/ }, (a) =>
            map.has(a.path) ? { path: a.path, namespace: 'fixture' } : null
          )
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            contents: map.get(a.path),
            loader: 'jsx',
            resolveDir: new URL('.', import.meta.url).pathname,
          }))
        },
      },
    ],
  })
  ;({ mount, act } = createRequire(import.meta.url)(join(directory, 'page.cjs')))
})
after(async () => {
  await rm(directory, { recursive: true, force: true })
  delete globalThis.__fixture
  delete globalThis.__form
  delete globalThis.__lease
})
async function start(extra={}){globalThis.IS_REACT_ACT_ENVIRONMENT=true;const calls=[],navigation=[];globalThis.__fixture={auth:{user:{uid:'owner'},profile:{usageProfile:'professional'}},limits:[{kind:'professional',maxPerOwner:3},{kind:'space',maxPerOwner:3}],list:async(...a)=>{calls.push(['list',...a]);return{items:[{id:'a',kind:'space',displayName:'A',reviewState:'draft',state:'private'},{id:'b',kind:'space',displayName:'B',reviewState:'approved',state:'active'}],nextCursor:'next-id'}},create:async(...a)=>{calls.push(['create',...a]);return{listingId:'new-id'}},navigate:p=>navigation.push(p),...extra};let view;await act(async()=>{view=mount();await new Promise(r=>setTimeout(r,5))});return{view,calls,navigation,button:text=>view.root.findAll(n=>n.type==='button'&&n.children.join('')===text)[0],text:()=>JSON.stringify(view.toJSON())}}
async function stop(p){await act(async()=>p.view.unmount())}
test('central lists compact summaries and links each resource explicitly',async()=>{const p=await start();try{assert.match(p.text(),/\?cadastro=a/);assert.match(p.text(),/\?cadastro=b/);assert.equal(p.calls.length,1);assert.deepEqual(p.calls[0],['list',null,null]);assert.doesNotMatch(p.text(),/Histórico de contratações/)}finally{await stop(p)}})
test('creation double-click has one idempotent intent and selects the returned resource',async()=>{const p=await start();try{await act(async()=>{const click=p.button('Criar estabelecimento').props.onClick;click();click();await new Promise(r=>setTimeout(r,5))});const c=p.calls.filter(c=>c[0]==='create');assert.equal(c.length,1);assert.equal(c[0][1],'space');assert.match(c[0][2],/^[a-f0-9-]{36}$/);assert.deepEqual(p.navigation,[{cadastro:'new-id'}])}finally{await stop(p)}})
test('missing policy prevents creation without preventing existing management',async()=>{const p=await start({limits:[]});try{assert.equal(p.button('Criar estabelecimento').props.disabled,true);assert.match(p.text(),/\?cadastro=a/)}finally{await stop(p)}})
test('backend page cursor is used instead of preloading all resources',async()=>{const p=await start();try{await act(async()=>p.button('Próxima página').props.onClick());assert.deepEqual(p.calls.at(-1),['list',null,'next-id'])}finally{await stop(p)}})
test('explicit selection mounts only that editor and does not load summaries',async()=>{const p=await start({query:'cadastro=selected-id'});try{assert.match(p.text(),/selected-id/);assert.equal(p.calls.length,0)}finally{await stop(p)}})
