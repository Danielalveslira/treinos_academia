import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'

test('development HTTP denies private audit files while /app remains available', {timeout:30000}, async()=>{
  const dir=resolve('.finance-local/validation')
  mkdirSync(dir,{recursive:true})
  const file=resolve(dir,'http-canary-'+randomUUID()+'.txt')
  const body='synthetic-audit-canary'
  writeFileSync(file,body)
  let server
  let http
  try {
    server=await createServer({logLevel:'silent',server:{middlewareMode:true,hmr:false}})
    http=createHttpServer(server.middlewares)
    await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve)})
    const origin='http://127.0.0.1:'+http.address().port
    const relative='/.finance-local/validation/'+file.split('/').at(-1)
    for(const path of [relative,'/@fs'+file,relative+'?raw',relative+'?url']){
      const response=await fetch(origin+path)
      assert.equal(response.status,403,path)
      assert.ok(!(await response.text()).includes(body))
    }
    const app=await fetch(origin+'/app')
    assert.equal(app.status,200)
    assert.ok((await app.text()).includes('id="root"'))
  } finally {
    if(http)await new Promise((resolve,reject)=>http.close(error=>error?reject(error):resolve()))
    if(server)await server.close()
    unlinkSync(file)
  }
})
