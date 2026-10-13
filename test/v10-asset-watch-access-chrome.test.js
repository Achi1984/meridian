// Native dialog acceptance with production styles; synthetic submit, no account access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
test('V10 one-use access dialog: native keyboard, clearing and responsive layout',{timeout:120000},async()=>{
 if(typeof WebSocket!=='function'){
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],{env,encoding:'utf8',timeout:115000});
  assert.equal(r.status,0,String(r.stdout).slice(-2000)+String(r.stderr).slice(-1000));return;
 }
 const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 assert.ok(chrome,'Chrome required; no silent skip');
 const source=readFileSync(new URL('../v10/asset-watch-access-dialog.js',import.meta.url),'utf8').replace('export function ','function ');
 assert.doesNotMatch(source,/<\/script/i);
 const css=['../v9/v9.css','../v10/v10.css','../v10/r124-typography-floor.css'].map(p=>readFileSync(new URL(p,import.meta.url),'utf8')).join('\n');
 const dir=mkdtempSync(join(tmpdir(),'v10-access-'));
 try{
  const file=join(dir,'dialog.html');
  writeFileSync(file,`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><button id="open">Lesezugang verwenden</button><script>${source}\nlet count=0,cleared=false;const ui=createAssetWatchAccessDialog({document,submit:()=>{count++;cleared=document.querySelector('input').value==='';}});document.getElementById('open').onclick=()=>ui.open();window.qa={open:()=>ui.open(),state:()=>({count,cleared,value:document.querySelector('input')?.value,open:document.querySelector('dialog')?.open})};window.fetch=()=>{throw Error('Unexpected network');};</script></body></html>`);
  for(const width of [320,390,1280])await withMobileChrome(chrome,width,pathToFileURL(file).href,async call=>{
   if(width===1280)await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false,screenWidth:width,screenHeight:844});
   const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,'dialog exception');return r.result?.value;};
   const key=async(name='Escape')=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:name==='Escape'?27:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:name==='Escape'?27:13});};
   await evaluate('qa.open()');
   const m=await evaluate(`(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,focused:document.activeElement.type,targets:[...d.querySelectorAll('button,input')].every(n=>{const t=n.getBoundingClientRect();return t.height>=44&&t.left>=r.left&&t.right<=r.right;})};})()`);
   assert.ok(m.left>=0&&m.right<=width+1&&m.top>=0&&m.bottom<=m.height+1);assert.equal(m.overflow,false);assert.equal(m.focused,'password');assert.equal(m.targets,true);
   const evidence=process.env.V11_A2_EVIDENCE_DIR;if(evidence){mkdirSync(evidence,{recursive:true});const s=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(evidence,'v10-read-access-'+width+'.png'),Buffer.from(s.data,'base64'));}
   await evaluate("document.querySelector('input').value='synthetic-access';qa.open()");assert.equal((await evaluate('qa.state()')).count,0);assert.equal((await evaluate('qa.state()')).value,'synthetic-access');
   await key();let s=await evaluate('qa.state()');assert.equal(s.open,false);assert.equal(s.value,'');assert.equal(s.count,0);
   await evaluate("qa.open();document.querySelector('button[value=rotate]').click()");s=await evaluate('qa.state()');assert.equal(s.open,true);assert.equal(s.count,0);
   await evaluate("document.querySelector('input').value='synthetic-access';document.querySelector('input').focus()");await key('Enter');s=await evaluate('qa.state()');assert.equal(s.open,false);assert.equal(s.value,'');assert.equal(s.count,1);assert.equal(s.cleared,true);
   console.log('V10_ACCESS_DIALOG_WIDTH',width);
  });
 }finally{rmSync(dir,{recursive:true,force:true});}
});
