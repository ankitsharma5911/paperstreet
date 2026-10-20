import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleMarket} from './lib/market/api.mjs';
const root=fileURLToPath(new URL('./public/terminal/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/market/')){
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
      const request=new Request(new URL(req.url,'http://'+req.headers.host),{method:req.method,headers:req.headers,body:req.method==='GET'||req.method==='HEAD'?undefined:Buffer.concat(chunks)});
      const response=await handleMarket(request,{userId:'local-workspace',secret:process.env.BROKER_SESSION_SECRET??'local-preview-only-encryption-secret-for-loopback'});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const relative=decodeURIComponent(url.pathname).replace(/^\/terminal\//,'').replace(/^\/+/, '')||'index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log(`Paperstreet is running at http://127.0.0.1:${server.address().port}`));
