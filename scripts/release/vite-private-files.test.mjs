import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'vite'

test('development HTTP denies private audit files while /app remains available', {timeout:30000}, async()=>{
  const dir=resolve('.finance-local/validation')
  mkdirSync(dir,{recursive:true})
  const file=resolve(dir,'http-canary-'+randomUUID()+'.txt')
  const body='synthetic-audit-canary'
  writeFileSync(file,body)
  let server
  try {
    server=await createServer({logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:true}})
    await server.listen()
    const origin='http://127.0.0.1:'+server.httpServer.address().port
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
    if(server)await server.close()
    unlinkSync(file)
  }
})
