import {createServer} from 'node:http';
import {readFile} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const TYPES={'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8',
 '.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
 '.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};

export async function startV11StaticServer(){
 const server=createServer((request,response)=>{
  if(request.method!=='GET'){response.writeHead(405);response.end();return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);}
  catch{response.writeHead(400);response.end();return;}
  const path=resolve(ROOT,'.'+pathname);
  if(path!==ROOT&&!path.startsWith(ROOT+sep)){response.writeHead(404);response.end();return;}
  readFile(path,(error,content)=>{
   if(error){response.writeHead(404);response.end();return;}
   const extension=path.slice(path.lastIndexOf('.'));
   response.writeHead(200,{'content-type':TYPES[extension]||'application/octet-stream',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
   response.end(content);
  });
 });
 await new Promise((resolveListen,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen);
 });
 return {url:`http://127.0.0.1:${server.address().port}/v11/index.html`,
  close:()=>new Promise((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()))};
}
