import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium']
  .find(path=>path&&existsSync(path));
const v11Root=fileURLToPath(new URL('../v11/',import.meta.url));
const source=readFileSync(join(v11Root,'index.html'),'utf8');
const bootstrap='<script type="module" src="./bot-read-bootstrap.js?v=B12"></script>';
const fixtureScript=`<script>
window.__botReadMode='fresh';window.__botReads=0;window.__resolveBotRead=null;window.__botErrors=[];
window.addEventListener('error',event=>window.__botErrors.push(event.message));
window.addEventListener('unhandledrejection',event=>window.__botErrors.push(String(event.reason)));
window.__botSnapshot=age=>({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_BOT_API',
 sourceSnapshotAt:new Date(Date.now()-age).toISOString(),freshnessLimitMs:900000,readOnly:true,
 executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
 botCount:6,bots:[
  {botRef:'a'.repeat(20),symbol:'BTCUSDT',side:'LONG',cateType:'inverse',botType:'futures_grid',
   leverage:5,pnl:{usd:-25}},
  {botRef:'b'.repeat(20),symbol:'BTCUSDT',side:'SHORT',cateType:'linear',botType:'futures_grid',
   leverage:2,pnl:{usd:-25}},
  {botRef:'c'.repeat(20),symbol:'ETHUSDT',side:'NEUTRAL',cateType:'linear',botType:'futures_grid',
   leverage:8,pnl:{usd:-3.5}},
  {botRef:'d'.repeat(20),symbol:'ADAUSDT',side:null,cateType:null,botType:'futures_grid',
   leverage:null,pnl:{usd:null}},
  {botRef:'e'.repeat(20),symbol:'XRPUSDT',side:'SHORT',cateType:'inverse',botType:'futures_grid',
   leverage:3,pnl:{usd:-8}},
  {botRef:'f'.repeat(20),symbol:'SOLUSDT',side:'LONG',cateType:'linear',botType:'futures_grid',
   leverage:null,pnl:{usd:0}}
 ]});
window.fetch=async()=>{window.__botReads++;
 if(window.__botReadMode==='error')throw new Error('synthetic private failure');
 if(window.__botReadMode==='unauthorized')return new Response('',{status:401});
 if(window.__botReadMode==='pending')return await new Promise(resolve=>{
  window.__resolveBotRead=()=>resolve(new Response(JSON.stringify(window.__botSnapshot(0)),
   {headers:{'content-type':'application/json'}}));
 });
 const age=window.__botReadMode==='stale'?3600000:window.__botReadMode==='expires'?100:0;
 const payload=window.__botReadMode==='empty'
  ? {...window.__botSnapshot(0),botCount:0,bots:[]} : window.__botSnapshot(age);
 if(window.__botReadMode==='expires')payload.freshnessLimitMs=200;
 return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
};
</script>`;
assert.equal(source.split(bootstrap).length,2,'exact B11 bootstrap insertion point');
const shell=source.replace(bootstrap,fixtureScript+'\n'+bootstrap);

function createShellServer() {
  return createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/v11/index.html'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(shell);return;
    }
    const repositoryRoot=join(v11Root,'..');
    if(!pathname.startsWith('/v11/')&&!pathname.startsWith('/research/')){response.writeHead(404);response.end();return;}
    const root=pathname.startsWith('/v11/')?v11Root:join(repositoryRoot,'research');
    const relative=decodeURIComponent(pathname.replace(/^\/(?:v11|research)\//,''));
    const path=normalize(join(root,relative));
    if(path!==root&&!path.startsWith(root.endsWith(sep)?root:root+sep)){
      response.writeHead(404);response.end();return;
    }
    try{
      const body=readFileSync(path);
      response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});
      response.end(body);
    }catch{if(!response.headersSent)response.writeHead(404);response.end();}
  });
}

test('V11 B11 actual shell: mixed synthetic snapshot, filters, Command jump and invalidation at four viewports',
  {timeout:180000},async()=>{
    if(typeof WebSocket!=='function'){
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
        {env,encoding:'utf8',timeout:175000});
      assert.equal(child.status,0,String(child.stdout).slice(-3000)+String(child.stderr).slice(-1000));
      const rows=child.stdout.split('\n').filter(line=>line.includes('V11_B11_SIZE'));
      assert.equal(rows.length,4);rows.forEach(row=>console.log(row));return;
    }
    assert.ok(chrome,'Chrome required; actual-shell acceptance must not silently skip');
    const server=createShellServer();
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/v11/index.html`;
    const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
      {width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}];
    const evidence=process.env.V11_B11_EVIDENCE_DIR;
    try{
      for(const size of sizes){
        const measurements=await withMobileChrome(chrome,size.width,url,async call=>{
          const evaluate=async expression=>{
            const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
            assert.ok(!result.exceptionDetails,'B11 shell browser expression failed');
            return result.result?.value;
          };
          const assertPopulatedLayout=async label=>{
            const layout=await evaluate(`(()=>{
              const x=scrollX,y=scrollY,root=document.documentElement;
              const nodes=[...document.querySelectorAll('#bot-read-root .bot-card,#bot-read-root .bot-card summary,#bot-read-root .bot-card-metrics')];
              const clipped=nodes.filter(node=>node.scrollWidth>node.clientWidth+1).length;
              window.scrollTo(0,root.scrollHeight);
              const last=document.querySelector('#view-bots').lastElementChild.getBoundingClientRect();
              const nav=document.getElementById('nav').getBoundingClientRect();
              const result={clipped,overflow:root.scrollWidth>root.clientWidth+1,lastClear:last.bottom<=nav.top+1};
              window.scrollTo(x,y);return result;
            })()`);
            assert.equal(layout.overflow,false,label+' page overflow');
            assert.equal(layout.clipped,0,label+' card clipping');
            assert.equal(layout.lastClear,true,label+' bottom navigation clearance');
          };
          const key=async(name,code,keyCode)=>{
            const text=name==='Enter'?'\r':null;
            await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,
              ...(text===null?{}:{text,unmodifiedText:text})});
            await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
          };
          await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,
            deviceScaleFactor:1,mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
          await evaluate(`document.querySelector('#nav [data-v="bots"]').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
          const initial=await evaluate(`({width:innerWidth,height:innerHeight,reads:window.__botReads,
            overflow:document.documentElement.scrollWidth>innerWidth+1,
            navTargets:[...document.querySelectorAll('#nav button')].every(b=>b.getBoundingClientRect().height>=44),
            botState:document.querySelector('#bot-read-root [data-state]')?.dataset.state,
            root:document.getElementById('bot-read-root').innerText,errors:window.__botErrors})`);
          assert.equal(initial.width,size.width);assert.equal(initial.height,size.height);
          assert.equal(initial.reads,0);assert.equal(initial.overflow,false);assert.equal(initial.navTargets,true);
          assert.equal(initial.botState,'locked',JSON.stringify(initial));
          await evaluate(`document.getElementById('bot-read-token').value='synthetic-token';
            document.getElementById('bot-read-provide').click();
            window.__botReadMode='fresh';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          assert.equal(await evaluate('window.__botReads'),1);
          const fresh=await evaluate(`(()=>{
            const root=document.getElementById('bot-read-root');
            const cards=[...root.querySelectorAll('.bot-card')];
            const command=document.getElementById('command-bot-overview');
            return {cards:cards.length,ids:cards.map(c=>c.id),count:root.innerText.includes('6 Bots im Snapshot'),
              duplicate:cards.filter(c=>c.innerText.includes('BTCUSDT')).length,
              command:command.innerText,lossButtons:command.querySelectorAll('button').length,
              commandState:command.dataset.state,
              touch:[...root.querySelectorAll('input,select,button')].map(e=>[e.tagName,e.getAttribute('aria-label')||e.textContent,e.getBoundingClientRect().height]),
              leak:/synthetic-token|private failure/.test(document.body.innerText)};
          })()`);
          assert.equal(fresh.cards,6);assert.equal(new Set(fresh.ids).size,6);assert.equal(fresh.duplicate,2);
          assert.equal(fresh.count,true);assert.equal(fresh.commandState,'fresh');assert.equal(fresh.lossButtons,3);
          assert.match(fresh.command,/Lesestatus: aktueller Snapshot/);assert.match(fresh.command,/Richtung: Long 2 · Short 2 · Neutral 1 · Unbekannt 1/);
          assert.match(fresh.command,/P\/L laut Quelle/);
          assert.ok(fresh.touch.every(([, ,height])=>height>=44),JSON.stringify(fresh.touch));
          assert.equal(fresh.leak,false);
          const lossNames=await evaluate(`[...document.querySelectorAll('#command-bot-overview button')].map(button=>({text:button.textContent,name:button.getAttribute('aria-label')}))`);
          assert.equal(new Set(lossNames.map(row=>row.text)).size,3,'distinct visible loss labels');
          assert.equal(new Set(lossNames.map(row=>row.name)).size,3,'distinct accessible loss labels');
          assert.match(lossNames[0].name,/BTCUSDT · Long · Referenz a{20}/);
          assert.match(lossNames[1].name,/BTCUSDT · Short · Referenz b{20}/);
          assert.match(lossNames[0].name,/-25 USD/);assert.match(lossNames[1].name,/-25 USD/);
          await assertPopulatedLayout('populated collapsed');
          if(evidence){
            mkdirSync(evidence,{recursive:true});
            await evaluate("document.querySelector('.bot-overview-filters').scrollIntoView({block:'start'})");
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-b11-${size.width}x${size.height}-bots.png`),
              Buffer.from(image.data,'base64'));
          }

          await evaluate('window.scrollTo(0,0)');
          await evaluate(`(()=>{const search=document.getElementById('bot-symbol-search');search.value='BTC';
            search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root .bot-card').length`),2);
          await evaluate(`(()=>{document.getElementById('bot-symbol-search').value='';
            document.getElementById('bot-symbol-search').dispatchEvent(new Event('input',{bubbles:true}));
            const select=document.getElementById('bot-sort-filter');select.value='leverage';
            select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.deepEqual(await evaluate(`[...document.querySelectorAll('#bot-read-root .bot-card')].map(c=>c.querySelector('.bot-card-heading').innerText.split(' · ')[0])`,
          ),['ETHUSDT','BTCUSDT','XRPUSDT','BTCUSDT','ADAUSDT','SOLUSDT']);
          await evaluate(`(()=>{const select=document.getElementById('bot-sort-filter');select.value='pnl';
            select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.deepEqual(await evaluate(`[...document.querySelectorAll('#bot-read-root .bot-card')].map(c=>c.querySelector('.bot-card-heading').innerText.split(' · ')[0])`),
            ['BTCUSDT','BTCUSDT','XRPUSDT','ETHUSDT','ADAUSDT','SOLUSDT']);
          await evaluate(`(()=>{const dir=document.getElementById('bot-direction-filter');dir.value='unknown';
            dir.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.querySelector('#bot-read-root .bot-card .bot-card-heading').innerText`),
            'ADAUSDT · Unbekannt');
          await evaluate(`(()=>{const dir=document.getElementById('bot-direction-filter');dir.value='all';
            dir.dispatchEvent(new Event('change',{bubbles:true}));
            const type=document.getElementById('bot-category-filter');type.value='coin-m';
            type.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root .bot-card').length`),2);
          await evaluate(`(()=>{const search=document.getElementById('bot-symbol-search');search.value='NO_MATCH';
            search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          const none=await evaluate(`document.getElementById('bot-read-root').innerText`);
          assert.match(none,/0 Treffer von 6 Bots/);assert.match(none,/Keine Bots entsprechen den Filtern/);
          assert.doesNotMatch(none,/Keine Bots in diesem Snapshot/);
          assert.equal(await evaluate('window.__botReads'),1,'local filter, sort, reset and navigation must not fetch');

          await evaluate(`document.querySelector('#nav [data-v="command"]').click()`);
          const commandTargets=await evaluate(`[...document.querySelectorAll('#command-bot-overview button')].map(b=>b.getBoundingClientRect().height)`);
          assert.ok(commandTargets.every(height=>height>=44),JSON.stringify(commandTargets));
          if(evidence){
            await evaluate("document.getElementById('command-bot-overview').scrollIntoView({block:'start'})");
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-b11-${size.width}x${size.height}-command.png`),
              Buffer.from(image.data,'base64'));
          }
          await evaluate('window.scrollTo(0,0)');
          await evaluate(`document.querySelector('#command-bot-overview button').focus()`);
          await key('Enter','Enter',13);
          const jump=await evaluate(`(()=>{
            const card=document.getElementById('bot-card-${'a'.repeat(20)}');
            return {view:document.querySelector('.view.active').id,open:card?.open,
              focused:document.activeElement===card?.querySelector('summary'),
              query:document.getElementById('bot-symbol-search').value,
              reads:window.__botReads};
          })()`);
          assert.equal(jump.view,'view-bots');assert.equal(jump.open,true);assert.equal(jump.focused,true);
          assert.equal(jump.query,'');assert.equal(jump.reads,1);
          await assertPopulatedLayout('populated expanded');
          await evaluate(`document.querySelector('#nav [data-v="command"]').click();document.querySelectorAll('#command-bot-overview button')[1].focus()`);
          await key('Enter','Enter',13);
          assert.equal(await evaluate(`document.activeElement===document.querySelector('#bot-card-${'b'.repeat(20)} summary')`),true,'equal-loss second BTC opens exact reference');
          assert.equal(await evaluate(`document.getElementById('bot-card-${'b'.repeat(20)}').open`),true);
          assert.equal(await evaluate('window.__botReads'),1);
          await assertPopulatedLayout('second equal-loss card expanded');

          const navButton=`document.querySelector('#nav [data-v="bots"]')`;
          await evaluate(`${navButton}.click();window.__botReadMode='empty';
            document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          const empty=await evaluate(`document.getElementById('bot-read-root').innerText`);
          assert.match(empty,/0 Bots im Snapshot/);assert.match(empty,/Keine Bots in diesem Snapshot/);
          assert.doesNotMatch(empty,/Keine Bots entsprechen den Filtern/);
          assert.doesNotMatch(await evaluate(`document.getElementById('command-bot-overview').innerText`),/P\/L laut Quelle/);

          await evaluate(`${navButton}.click();window.__botReadMode='stale';
            document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'stale');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'stale');
          assert.doesNotMatch(await evaluate(`document.getElementById('command-bot-overview').innerText`),/Bots im Snapshot|BTCUSDT|Snapshot-Zeit/);

          await evaluate(`window.__botReadMode='fresh';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          await evaluate(`window.__botReadMode='error';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'unavailable');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'unavailable');
          assert.doesNotMatch(await evaluate(`document.getElementById('command-bot-overview').innerText`),/BTCUSDT|Snapshot-Zeit/);

          await evaluate(`window.__botReadMode='fresh';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          await evaluate(`document.getElementById('bot-read-lock').click()`);
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'locked');
          assert.doesNotMatch(await evaluate(`document.getElementById('command-bot-overview').innerText`),/BTCUSDT|Snapshot-Zeit/);

          await evaluate(`document.getElementById('bot-read-token').value='synthetic-token';
            document.getElementById('bot-read-provide').click();
            window.__botReadMode='pending';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'loading');
          await evaluate(`document.getElementById('bot-read-lock').click();window.__resolveBotRead?.()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'locked');
          await evaluate(`document.getElementById('bot-read-token').value='synthetic-token';
            document.getElementById('bot-read-provide').click();window.__botReadMode='fresh';
            document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          await evaluate(`Object.defineProperty(document,'hidden',{value:true,configurable:true});
            document.dispatchEvent(new Event('visibilitychange'))`);
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'locked');
          await evaluate(`Object.defineProperty(document,'hidden',{value:false,configurable:true});
            document.dispatchEvent(new Event('visibilitychange'))`);
          assert.equal(await evaluate('window.__botReads'),8,'visibility and navigation do not fetch');

          await evaluate(`document.getElementById('bot-read-token').value='synthetic-token';
            document.getElementById('bot-read-provide').click();window.__botReadMode='unauthorized';
            document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('bot-read-token').value`),'');

          await evaluate(`document.getElementById('bot-read-token').value='synthetic-token';
            document.getElementById('bot-read-provide').click();window.__botReadMode='expires';
            document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'stale');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'stale');
          assert.doesNotMatch(await evaluate(`document.getElementById('command-bot-overview').innerText`),/Bots im Snapshot|BTCUSDT|Snapshot-Zeit/);
          assert.equal(await evaluate('window.__botReads'),10,'only explicit refresh actions reach the mock source');
          const finalLayout=await evaluate(`(()=>{
            window.scrollTo(0,document.documentElement.scrollHeight);
            const nav=document.getElementById('nav').getBoundingClientRect();
            const last=document.querySelector('#view-bots').lastElementChild.getBoundingClientRect();
            return {overflow:document.documentElement.scrollWidth>innerWidth+1,
              navHeight:[...document.querySelectorAll('#nav button')].every(b=>b.getBoundingClientRect().height>=44),
              lastClear:last.bottom<=nav.top+1};
          })()`);
          assert.equal(finalLayout.overflow,false);assert.equal(finalLayout.navHeight,true);
          assert.equal(finalLayout.lastClear,true);
          if(evidence){
            mkdirSync(evidence,{recursive:true});
            await evaluate("document.getElementById('bot-read-root').scrollIntoView({block:'start'})");
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-b11-${size.width}x${size.height}-stale.png`),
              Buffer.from(image.data,'base64'));
          }
          return {width:size.width,height:size.height,mixedRows:fresh.cards,requests:10,
            filtersNoRequest:true,commandJumpFocused:jump.focused,statesCleared:true,
            overflow:finalLayout.overflow,controls44px:fresh.touch};
        },size.height);
        console.log('V11_B11_SIZE',`${size.width}x${size.height}`,JSON.stringify(measurements));
      }
    }finally{
      await new Promise(resolve=>server.close(resolve));
    }
  });
