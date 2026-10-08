// MERIDIAN11-CDP-R1: small dependency-free Chrome DevTools helper.
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function withMobileChrome(chrome,width,url,probe){
 const dir=mkdtempSync(join(tmpdir(),'v11-cdp-'));
 const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore',detached:true});
 let ws;const pending=new Map();let seq=0;
 try{
  let port;
  for(let i=0;i<200;i++){
   if(child.exitCode!==null)throw Error('Chrome exited '+child.exitCode);
   const f=join(dir,'DevToolsActivePort');
   if(existsSync(f)){port=Number(readFileSync(f,'utf8').split('\n')[0]);break;}
   await sleep(50);
  }
  if(!port)throw Error('Chrome DevTools startup timeout');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(x=>x.type==='page');if(!page)throw Error('No Chrome page target');
  if(typeof WebSocket!=='function')throw Error('Node WebSocket unavailable');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
   ws.addEventListener('open',resolve,{once:true});
   ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',e=>{
   const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;
   pending.delete(m.id);clearTimeout(p.timer);
   m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},10000);
   pending.set(id,{resolve,reject,timer});
   ws.send(JSON.stringify({id,method,params}));
  });
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true,
   screenWidth:width,screenHeight:844});
  await call('Page.navigate',{url});
  let loaded=false;
  for(let i=0;i<100;i++){
   const r=await call('Runtime.evaluate',{expression:'document.readyState',returnByValue:true});
   if(r.result?.value==='complete'){loaded=true;break;}
   await sleep(50);
  }
  if(!loaded)throw Error('Page load timeout');
  const r=await call('Runtime.evaluate',{expression:probe,returnByValue:true});
  if(r.exceptionDetails)throw Error('CDP probe exception '+JSON.stringify(r.exceptionDetails));
  return r.result?.value;
 }finally{
  if(ws)ws.close();
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'));}
  try{process.kill(-child.pid,'SIGKILL');}catch{}
  await sleep(100);rmSync(dir,{recursive:true,force:true});
 }
}
