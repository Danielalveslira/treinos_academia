import{test,before,after}from'node:test'
import assert from'node:assert/strict'
import{build}from'esbuild'
import{mkdtemp,rm}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
let dir,service
before(async()=>{dir=await mkdtemp(join(tmpdir(),'community-owner-'));await build({entryPoints:[new URL('./communitiesService.js',import.meta.url).pathname],outfile:join(dir,'service.mjs'),bundle:true,platform:'node',format:'esm',define:{'import.meta.env':'{}'},plugins:[{name:'client',setup(b){b.onResolve({filter:/\/supabase\/config$/},()=>({path:'client',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const query={select(...a){globalThis.__communityCalls.push(['select',...a]);return this},eq(...a){globalThis.__communityCalls.push(['eq',...a]);return this},order(...a){globalThis.__communityCalls.push(['order',...a]);return this},limit(...a){globalThis.__communityCalls.push(['limit',...a]);return Promise.resolve({data:[{id:'c',name:'Own',owner_id:'owner'}],error:null})}};export const supabase={from(){return query}}`}))}}]});service=await import(join(dir,'service.mjs'))})
after(async()=>{await rm(dir,{recursive:true,force:true});delete globalThis.__communityCalls})
test('owner picker filters in PostgreSQL before the cap and transfers only identity fields',async()=>{globalThis.__communityCalls=[];const rows=await service.listActiveCommunities('owner');assert.equal(rows[0].ownerId,'owner');assert.deepEqual(globalThis.__communityCalls.slice(0,3),[['select','id,name,owner_id'],['eq','is_active',true],['eq','owner_id','owner']]);assert.equal(globalThis.__communityCalls.at(-1)[0],'limit')})
test('existing public consumers keep their complete community projection',async()=>{globalThis.__communityCalls=[];await service.listActiveCommunities();assert.deepEqual(globalThis.__communityCalls[0],['select','*']);assert.equal(globalThis.__communityCalls.some(c=>c[0]==='eq'&&c[1]==='owner_id'),false)})
