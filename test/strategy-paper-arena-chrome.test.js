// Component acceptance using production modules/styles; synthetic data, no trading endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
const routes=new Map([
  ['/v10/strategy-arena.js',['../v10/strategy-arena.js','text/javascript']],
  ['/research/strategy-paper-arena.js',['../research/strategy-paper-arena.js','text/javascript']],
  ['/v9/v9.css',['../v9/v9.css','text/css']],
  ['/v10/v10.css',['../v10/v10.css','text/css']],
  ['/v10/r124-typography-floor.css',['../v10/r124-typography-floor.css','text/css']]
]);
for(const name of ['manifest','BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'])routes.set('/research/results/strategy-arena-20261016/'+name+'.json',['../research/results/strategy-arena-20261016/'+name+'.json','application/json']);
const html=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/v9/v9.css"><link rel="stylesheet" href="/v10/v10.css"><link rel="stylesheet" href="/v10/r124-typography-floor.css">
<style>body{margin:0}*,*:before,*:after{box-sizing:border-box}</style><body><button id="keyboard-start">Prüfung starten</button><main class="app-shell"><section id="view-paper" class="view active"><div id="qa-root"><div data-strategy-arena></div></div></section></main>
<script type="module">import {createStrategyArenaView} from '/v10/strategy-arena.js';
window.networkAttempts=0;window.storedRequests=0;window.metadataRequests=0;const nativeFetch=window.fetch.bind(window);window.fetch=(url,options)=>{const u=new URL(url,location.href);if(window.allowStored&&u.origin===location.origin&&u.pathname.startsWith('/research/results/strategy-arena-20261016/')){window.storedRequests++;return nativeFetch(url,options);}if(u.origin===location.origin&&u.pathname==='/research/results/strategy-arena-20261016/manifest.json'&&window.allowMetadata){window.metadataRequests++;return nativeFetch(url,options);}window.networkAttempts++;throw Error('UNEXPECTED_RUNTIME_NETWORK');};
const root=document.getElementById('qa-root'),view=createStrategyArenaView();root.querySelector('[data-strategy-arena]').innerHTML=view.html();view.bind(root);window.arenaReady=true;</script></body></html>`;

test('Paper Arena Chrome: native file import, integrity rejection and 320/390 layout',{timeout:120000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],{env,encoding:'utf8',timeout:115000});
    assert.equal(child.status,0,String(child.stdout).slice(-2200)+String(child.stderr).slice(-1200));
    assert.equal(String(child.stdout).split('\n').filter(l=>l.startsWith('ARENA_CHROME_WIDTH ')).length,2);
    console.log(String(child.stdout).split('\n').filter(l=>l.startsWith('ARENA_CHROME_WIDTH ')).join('\n'));return;
  }
  const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  assert.ok(chrome,'Chrome required; Paper Arena browser acceptance must not silently skip');
  const server=createServer(async(req,res)=>{
    try{
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
      const route=routes.get(path);if(!route){res.writeHead(404);res.end();return;}
      const bytes=await readFile(new URL(route[0],import.meta.url));res.writeHead(200,{'content-type':route[1]});res.end(bytes);
    }catch{res.writeHead(500);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const url='http://127.0.0.1:'+server.address().port+'/';
    for(const width of [320,390])await withMobileChrome(chrome,width,url,async call=>{
      const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result?.value;};
      const waitFor=expression=>evaluate(`(async()=>{for(let i=0;i<200;i++){if(${expression})return true;await new Promise(r=>setTimeout(r,20));}throw Error('ARENA_STATE_TIMEOUT')})()`);
      const layout=()=>evaluate(`(()=>{const cards=[...document.querySelectorAll('.arena-model')],view=document.getElementById('view-paper'),bounds=view.getBoundingClientRect(),targets=[...cards,...document.querySelectorAll('.arena-toolbar,.arena-import,[data-arena-input],.arena-toolbar>button')];return{cards:cards.length,width:innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth,inside:view.scrollWidth<=view.clientWidth+1&&targets.every(c=>{const r=c.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1;})}})()`);
      await waitFor('window.arenaReady===true');
      let m=await layout();assert.equal(m.cards,5);assert.equal(m.width,width);assert.ok(m.body<=width+1&&m.root<=width+1&&m.inside,JSON.stringify(m));
      assert.equal(await evaluate(`document.querySelectorAll('.paper-model-head').length`),0,'diagnostic cards must not impersonate runtime Paper model identities');
      assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-arena-input]')).fontSize)>=16`),'mobile import control must meet the typography floor');
      assert.ok(await evaluate(`[...document.querySelectorAll('.arena-model-head span,.arena-model-head b,.arena-model-head strong,.arena-model>small')].every(el=>parseFloat(getComputedStyle(el).fontSize)>=12)`),'arena identities, status and PnL must remain readable at the actual mobile width');
      assert.equal(await evaluate(`document.querySelector('[data-arena-export]').disabled`),true);
      assert.equal(await evaluate(`document.querySelector('.arena-evidence').textContent.includes('Noch keine')`),true);
      await evaluate(`window.allowMetadata=true;document.querySelector('[data-arena-provenance]').click()`);
      await waitFor(`window.metadataRequests===1&&!document.querySelector('[data-arena-provenance]').disabled`);
      assert.equal(await evaluate(`document.querySelectorAll('.arena-provenance').length`),5);
      assert.equal(await evaluate(`document.querySelectorAll('.arena-provenance details').length`),4);
      assert.ok(await evaluate(`document.querySelector('.arena-provenance').textContent.includes('PRESENT · SOURCE-RECORDED, NOT AUTHENTICATED')`));
      assert.ok(await evaluate(`document.querySelectorAll('.arena-provenance')[4].textContent.includes('Kraken USD metadata is not borrowed')`));
      assert.equal(await evaluate(`window.storedRequests`),0,'metadata view must not fetch candle chunks or invoke stored replay');
      assert.equal(await evaluate(`window.networkAttempts`),0);
      await evaluate(`document.querySelector('.arena-provenance details summary').focus()`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await call('Input.dispatchKeyEvent',{type:'char',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r'});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await evaluate(`document.querySelector('.arena-provenance details').open`),true,'full hashes are available through a keyboard-operable native disclosure');
      m=await layout();assert.ok(m.body<=width+1&&m.root<=width+1&&m.inside,JSON.stringify(m));
      await evaluate(`document.getElementById('keyboard-start').focus()`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await evaluate(`document.activeElement.matches('[data-arena-input]')`),true,'file input reachable with native Tab');
      assert.ok(await evaluate(`document.querySelector('[data-arena-input]').labels[0].textContent.includes('Snapshot')`));
      await evaluate(`(()=>{const day=86400000,start=Date.UTC(2025,0,1),symbols=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];window.syntheticInput={data:Object.fromEntries(symbols.map(s=>[s,Array.from({length:210},(_,i)=>({openTime:start+i*day,closeTime:start+(i+1)*day-1,open:100+i,close:100+i,high:101+i,low:99+i}))])),asOf:start+210*day,sourceKind:'SYNTHETIC'};const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(syntheticInput)],'synthetic.json',{type:'application/json'}));const input=document.querySelector('[data-arena-input]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitFor(`!document.querySelector('[data-arena-export]').disabled`);
      assert.equal(await evaluate(`document.querySelector('.arena-evidence').textContent.includes('SYNTHETISCHE TESTDATEN')`),true);
      assert.equal(await evaluate(`document.querySelectorAll('.arena-model').length`),5);
      assert.equal(await evaluate(`document.querySelector('[role="alert"]')===null`),true);
      assert.equal(await evaluate(`window.networkAttempts`),0);
      assert.ok(await evaluate(`document.querySelector('.strategy-arena').textContent.includes('keine Freigabe für echte oder serverseitige Paper-Orders')`));
      m=await layout();assert.ok(m.body<=width+1&&m.root<=width+1&&m.inside,JSON.stringify(m));
      const evidence=process.env.V11_A2_EVIDENCE_DIR;
      if(evidence){await mkdir(evidence,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(evidence,'paper-arena-'+width+'.png'),Buffer.from(shot.data,'base64'));}
      await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify({input:syntheticInput,inputSha256:'0'.repeat(64)})],'tampered.json',{type:'application/json'}));const input=document.querySelector('[data-arena-input]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitFor(`document.querySelector('[role="alert"]')!==null`);
      assert.equal(await evaluate(`document.querySelector('[data-arena-export]').disabled`),true);
      assert.ok(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('Hash')`));
      assert.equal(await evaluate(`document.querySelectorAll('.arena-model').length`),5);
      assert.equal(await evaluate(`document.querySelector('.arena-evidence').textContent.includes('Noch keine')`),true);
      assert.equal(await evaluate(`window.networkAttempts`),0);
      await evaluate(`window.allowStored=true;document.querySelector('[data-arena-stored]').click()`);
      await waitFor(`!document.querySelector('[data-arena-export]').disabled`);
      assert.equal(await evaluate(`window.storedRequests`),9,'one manifest and eight verified stored chunks');
      assert.equal(await evaluate(`window.networkAttempts`),0);
      assert.equal(await evaluate(`document.querySelector('[role="alert"]')===null`),true);
      assert.ok(await evaluate(`document.querySelector('.arena-evidence').textContent.includes('RETROSPEKTIVE DIAGNOSE')`));
      assert.ok(await evaluate(`document.querySelector('.arena-model').textContent.includes('USD')&&!document.querySelector('.arena-model').textContent.includes('USDT')`));
      assert.ok(await evaluate(`document.querySelector('.arena-digest').textContent.includes('decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473')`));
      m=await layout();assert.ok(m.body<=width+1&&m.root<=width+1&&m.inside,JSON.stringify(m));
      console.log('ARENA_CHROME_WIDTH '+width+' '+JSON.stringify(m));
    });
  }finally{await new Promise(resolve=>server.close(resolve));}
});
