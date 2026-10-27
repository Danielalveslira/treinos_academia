// Test-only HTTP adapter: built frontend + controlled public snapshot fixture.
// Not part of the application or Vercel deployment. No database connection.
import http from 'node:http'
const fixture={total_active:1234,revision:'42',updated_at:'2026-10-27T00:00:00Z'}
http.createServer((req,res)=>{
 if(req.url==='/api/public-catalog-snapshot'){
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public, max-age=0, must-revalidate'})
  return res.end(JSON.stringify(fixture))
 }
 const upstream=http.request({hostname:'127.0.0.1',port:4173,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:4173'}},response=>{
  res.writeHead(response.statusCode,response.headers);response.pipe(res)
 })
 upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)
}).listen(4174,'127.0.0.1',()=>console.log('PUBLIC_HOME_TEST_PROXY_READY fixture=1234'))
