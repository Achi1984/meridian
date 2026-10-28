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
const bootstrap='<script type="module" src="./bot-read-bootstrap.js?v=B14-M11"></script>';
const fixtureScript=`<script>
window.__botReadMode='fresh';window.__botReads=0;window.__resolveBotRead=null;window.__botErrors=[];
window.__appAccessReads=0;
window.addEventListener('error',event=>window.__botErrors.push(event.message));
window.addEventListener('unhandledrejection',event=>window.__botErrors.push(String(event.reason)));
window.__botSnapshot=age=>({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_BOT_API',
 sourceSnapshotAt:new Date(Date.now()-age).toISOString(),freshnessLimitMs:900000,readOnly:true,
 executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
 botCount:6,bots:[
  {botRef:'a'.repeat(20),symbol:'BTCUSDT',side:'LONG',cateType:'inverse',botType:'futures_grid',
   leverage:5,investment:{usd:125.5678},pnl:{usd:-25}},
  {botRef:'b'.repeat(20),symbol:'BTCUSDT',side:'SHORT',cateType:'linear',botType:'futures_grid',
   leverage:2,investment:{usd:0.004},pnl:{usd:-25}},
  {botRef:'c'.repeat(20),symbol:'ETHUSDT',side:'NEUTRAL',cateType:'linear',botType:'futures_grid',
   leverage:8,investment:{quoteAmount:0.0000123456789,currency:'ETH'},pnl:{usd:-3.5}},
  {botRef:'d'.repeat(20),symbol:'ADAUSDT',side:null,cateType:null,botType:'futures_grid',
   leverage:null,pnl:{usd:null}},
  {botRef:'e'.repeat(20),symbol:'XRPUSDT',side:'SHORT',cateType:'inverse',botType:'futures_grid',
   leverage:3,investment:{quoteAmount:0.42,currency:'XRP'},pnl:{usd:0.005}},
  {botRef:'f'.repeat(20),symbol:'SOLUSDT',side:'LONG',cateType:'linear',botType:'futures_grid',
   leverage:null,pnl:{usd:0}}
 ]});
window.__largeBotSnapshot=age=>{const snapshot=window.__botSnapshot(age);
 snapshot.botCount=20;snapshot.bots=Array.from({length:20},(_,index)=>({
  botRef:index.toString(16).padStart(20,'0'),symbol:index<2?'BTCUSDT':'SYNTH'+String(index).padStart(2,'0')+'USDT',
  side:['LONG','SHORT','NEUTRAL'][index%3],cateType:index%2?'linear':'inverse',botType:'futures_grid',
  leverage:index%10+1,investment:{usd:index+1},pnl:{usd:-(index+1)}
 }));return snapshot;};
window.fetch=async(url)=>{if(String(url).endsWith('/app-access')){
  window.__appAccessReads++;
  return new Response(JSON.stringify({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',points:[]}),
    {headers:{'content-type':'application/json'}});
 }
 window.__botReads++;
 if(window.__botReadMode==='error')throw new Error('synthetic private failure');
 if(window.__botReadMode==='unauthorized')return new Response('',{status:401});
 if(window.__botReadMode==='pending')return await new Promise(resolve=>{
  window.__resolveBotRead=()=>resolve(new Response(JSON.stringify(window.__botSnapshot(0)),
   {headers:{'content-type':'application/json'}}));
 });
 const age=window.__botReadMode==='stale'?3600000:window.__botReadMode==='expires'?100:0;
 const payload=window.__botReadMode==='large'?window.__largeBotSnapshot(age):window.__botReadMode==='empty'
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
      let body=readFileSync(path);
      if(path===join(v11Root,'app-access.js')){
        body=body.toString().replace('https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w','/app-access');
      }
      response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});
      response.end(body);
    }catch{if(!response.headersSent)response.writeHead(404);response.end();}
  });
}

test('V11 B11 actual shell: mixed synthetic snapshot, investigation context and invalidation at five viewports',
  {timeout:180000},async()=>{
    if(typeof WebSocket!=='function'){
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
        {env,encoding:'utf8',timeout:175000});
      assert.equal(child.status,0,String(child.stdout).slice(-3000)+String(child.stderr).slice(-1000));
      const rows=child.stdout.split('\n').filter(line=>line.includes('V11_B11_SIZE'));
      assert.equal(rows.length,5);rows.forEach(row=>console.log(row));return;
    }
    assert.ok(chrome,'Chrome required; actual-shell acceptance must not silently skip');
    const server=createShellServer();
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/v11/index.html`;
    const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
      {width:390,height:844,mobile:true},{width:430,height:932,mobile:true},{width:1440,height:900,mobile:false}];
    const evidence=process.env.V11_B11_EVIDENCE_DIR;
    try{
      for(const size of sizes){
        const measurements=await withMobileChrome(chrome,size.width,url,async call=>{
          const evaluate=async expression=>{
            const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
            assert.ok(!result.exceptionDetails,'B11 shell browser expression failed');
            return result.result?.value;
          };
          const openApp=async()=>{
            await evaluate(`(()=>{const input=document.getElementById('app-access-password');input.value='synthetic-token';
              document.getElementById('app-access-form').requestSubmit();return true;})()`);
            for(let attempt=0;attempt<100;attempt++){
              if(await evaluate(`!document.getElementById('app').hidden`))return;
              await new Promise(resolve=>setTimeout(resolve,10));
            }
            assert.fail('shared app access did not unlock');
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
          await openApp();
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
          await evaluate(`window.__botReadMode='fresh';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          assert.equal(await evaluate('window.__botReads'),1);
          const fresh=await evaluate(`(()=>{
            const root=document.getElementById('bot-read-root');
            const cards=[...root.querySelectorAll('.bot-card')];
            const command=document.getElementById('command-bot-overview');
            return {cards:cards.length,ids:cards.map(c=>c.id),count:root.innerText.includes('6 Bots im Snapshot'),
              duplicate:cards.filter(c=>c.innerText.includes('BTCUSDT')).length,
              cardHeights:cards.map(c=>c.getBoundingClientRect().height),
              cardGeometry:cards.map(c=>({open:c.open,summary:c.querySelector('summary').getBoundingClientRect().height,
                width:c.getBoundingClientRect().width,body:c.querySelector('.bot-card-body').getBoundingClientRect().height,
                rows:getComputedStyle(c.querySelector('summary')).gridTemplateRows,
                top:c.querySelector('.bot-card-top').getBoundingClientRect().height,
                identity:c.querySelector('.bot-card-identity').getBoundingClientRect().height,
                pnl:c.querySelector('.bot-card-pnl').getBoundingClientRect().height,
                heading:c.querySelector('.bot-card-heading').getBoundingClientRect().height,
                badges:c.querySelector('.bot-card-badges').getBoundingClientRect().height,
                badgeRects:[...c.querySelectorAll('.bot-card-badge')].map(b=>({text:b.innerText,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),
                text:c.querySelector('summary').innerText})),
              referenceLabels:cards.map(c=>c.querySelector('summary').getAttribute('aria-label')),
              referencesVisible:cards.some(c=>c.querySelector('summary').innerText.includes('Referenz')),
              tinyPositive:cards.find(c=>c.id.endsWith('e'.repeat(20)))?.querySelector('.bot-pnl-positive')?.innerText,
              tinyCapital:cards.find(c=>c.id.endsWith('b'.repeat(20)))?.querySelector('.bot-card-capital strong')?.innerText,
              command:command.innerText,lossButtons:command.querySelectorAll('button').length,
              commandState:command.dataset.state,
              touch:[...root.querySelectorAll('input,select,button')].filter(e=>!e.hidden).map(e=>[e.tagName,e.getAttribute('aria-label')||e.textContent,e.getBoundingClientRect().height]),
              leak:/synthetic-token|private failure/.test(document.body.innerText)};
          })()`);
          assert.equal(fresh.cards,6);assert.equal(new Set(fresh.ids).size,6);assert.equal(fresh.duplicate,2);
          assert.equal(fresh.count,true);assert.equal(fresh.commandState,'fresh');assert.equal(fresh.lossButtons,3);
          assert.ok(fresh.cardHeights.every(height=>height>=44&&height<=150),JSON.stringify(fresh.cardGeometry));
          assert.equal(new Set(fresh.referenceLabels).size,6,'duplicate symbols have distinct accessible names');
          assert.equal(fresh.referencesVisible,false,'full references stay out of collapsed visual cards');
          assert.equal(fresh.tinyPositive,'+<0,01 USD');
          assert.equal(fresh.tinyCapital,'<0,01 USD/USDT');
          const visibleAmounts=await evaluate(`[...document.querySelectorAll('#bot-read-root .bot-card')].map(card=>({id:card.id,text:card.querySelector('summary').innerText}))`);
          assert.match(visibleAmounts.find(row=>row.id.endsWith('a'.repeat(20))).text,/-25,00 USD/);
          assert.match(visibleAmounts.find(row=>row.id.endsWith('e'.repeat(20))).text,/\+<0,01 USD/);
          const zero=visibleAmounts.find(row=>row.id.endsWith('f'.repeat(20))).text;
          assert.match(zero,/P\/L laut Quelle\s*Nicht verfügbar/);
          assert.doesNotMatch(zero,/0,00 USD/);
          const pnlContrast=await evaluate(`(()=>{
            const ratio=(foreground,background)=>{
              const channel=value=>{value/=255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4};
              const luminance=color=>{const [r,g,b]=color.match(/\\d+/g).map(Number);
                return .2126*channel(r)+.7152*channel(g)+.0722*channel(b);};
              const a=luminance(foreground),b=luminance(background);
              return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
            };
            return [...document.querySelectorAll('#bot-read-root .bot-pnl-negative,#bot-read-root .bot-pnl-positive')]
              .map(node=>ratio(getComputedStyle(node).color,getComputedStyle(node.closest('.bot-card')).backgroundColor));
          })()`);
          assert.ok(pnlContrast.length>=2&&pnlContrast.every(ratio=>ratio>=4.5),JSON.stringify(pnlContrast));
          assert.match(fresh.command,/6 Bots · nur lesend/);assert.match(fresh.command,/Quelle & Zeit/);
          assert.match(fresh.command,/Bestätigte negative P\/L-Werte/);
          const commandMetadata=await evaluate(`document.querySelector('#command-bot-overview .command-bot-metadata').innerText`);
          assert.match(commandMetadata,/Quelle: Pionex Bot API · Richtung: Long 2 · Short 2 · Neutral 1 · Unbekannt 1/);
          const exactCommandTimestamp=commandMetadata.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/)?.[0];
          assert.ok(exactCommandTimestamp);
          assert.ok(fresh.command.includes(new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short',
            timeZone:'UTC'}).format(new Date(exactCommandTimestamp))+' UTC'),fresh.command);
          assert.ok(fresh.touch.every(([, ,height])=>height>=43.99),JSON.stringify(fresh.touch));
          assert.equal(fresh.leak,false);
          const lossNames=await evaluate(`[...document.querySelectorAll('#command-bot-overview button')].map(button=>({text:button.textContent,name:button.getAttribute('aria-label')}))`);
          assert.equal(new Set(lossNames.map(row=>row.text)).size,3,'distinct visible loss labels');
          assert.equal(new Set(lossNames.map(row=>row.name)).size,3,'distinct accessible loss labels');
          assert.ok(lossNames.every(row=>!/[a-f0-9]{20}/.test(row.text)),'technical refs are not in primary rows');
          assert.match(lossNames[0].name,/BTCUSDT · Long · Referenz a{20}/);
          assert.match(lossNames[1].name,/BTCUSDT · Short · Referenz b{20}/);
          assert.match(lossNames[0].name,/-25,00 USD/);assert.match(lossNames[1].name,/-25,00 USD/);
          await assertPopulatedLayout('populated collapsed');
          // Native disclosure state follows botRef, not symbol, through local selection.
          await evaluate(`document.querySelector('#bot-card-${'a'.repeat(20)} summary').focus()`);
          await key('Enter','Enter',13);
          assert.equal(await evaluate(`document.getElementById('bot-card-${'a'.repeat(20)}').open`),true);
          await evaluate(`(()=>{const dir=document.getElementById('bot-direction-filter');dir.value='short';
            dir.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.getElementById('bot-card-${'b'.repeat(20)}').open`),false,
            'duplicate symbol must not inherit the other reference disclosure');
          await evaluate(`(()=>{const dir=document.getElementById('bot-direction-filter');dir.value='all';
            dir.dispatchEvent(new Event('change',{bubbles:true}));
            const sort=document.getElementById('bot-sort-filter');sort.value='pnl';
            sort.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.getElementById('bot-card-${'a'.repeat(20)}').open`),true);
          await evaluate(`(()=>{const search=document.getElementById('bot-symbol-search');search.value='ETH';
            search.focus();search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.activeElement===document.getElementById('bot-symbol-search')`),true);
          await evaluate(`document.querySelector('#nav [data-v="command"]').click();
            document.querySelectorAll('#command-bot-overview button')[1].focus()`);
          await key('Enter','Enter',13);
          assert.equal(await evaluate(`document.activeElement===document.querySelector('#bot-card-${'b'.repeat(20)} summary')`),true);
          assert.equal(await evaluate(`document.getElementById('bot-card-${'b'.repeat(20)}').open`),true);
          await assertPopulatedLayout('investigation jump expanded');
          const backSelector=`[...document.querySelectorAll('#bot-read-root button')].find(b=>b.textContent==='Zur vorherigen Auswahl zurück')`;
          assert.equal(await evaluate(`(${backSelector}).hidden`),false);
          assert.ok(await evaluate(`(${backSelector}).getBoundingClientRect().height>=44`));
          await evaluate(`window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'))`);
          assert.deepEqual(await evaluate(`({query:document.getElementById('bot-symbol-search').value,
            sort:document.getElementById('bot-sort-filter').value,
            backHidden:(${backSelector}).hidden,
            targetOpen:document.getElementById('bot-card-${'b'.repeat(20)}').open,
            reads:window.__botReads})`),
            {query:'',sort:'symbol',backHidden:false,targetOpen:true,reads:1},
            'focus/pageshow reproject the same read without clearing jump context or fetching');
          await evaluate(`(${backSelector}).focus()`);await key('Enter','Enter',13);
          assert.deepEqual(await evaluate(`({query:document.getElementById('bot-symbol-search').value,
            sort:document.getElementById('bot-sort-filter').value,
            focus:document.activeElement===document.getElementById('bot-symbol-search'),
            hidden:(${backSelector}).hidden,reads:window.__botReads})`),
            {query:'ETH',sort:'pnl',focus:true,hidden:true,reads:1});
          await evaluate(`document.querySelector('[aria-label="Alle Botfilter zurücksetzen"]').click()`);
          assert.equal(await evaluate(`document.getElementById('bot-card-${'a'.repeat(20)}').open`),true);
          assert.equal(await evaluate(`document.getElementById('bot-card-${'b'.repeat(20)}').open`),true);
          // Close through native keyboard before the existing baseline screenshot.
          for(const ref of ['a','b']){
            await evaluate(`document.querySelector('#bot-card-'+ '${ref}'.repeat(20)+' summary').focus()`);
            await key('Enter','Enter',13);
          }
          if(evidence){
            mkdirSync(evidence,{recursive:true});
            await evaluate("document.querySelector('.bot-overview-filters').scrollIntoView({block:'start'})");
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-bot-compact-${size.width}x${size.height}-bots.png`),
              Buffer.from(image.data,'base64'));
          }
          if(size.width===320){
            const normalHeights=await evaluate(`[...document.querySelectorAll('#bot-read-root .bot-card')].map(card=>card.getBoundingClientRect().height)`);
            await evaluate(`(()=>{
              const nodes=[...document.querySelectorAll('#bot-read-root .bot-card *')];
              const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
              nodes.forEach((node,index)=>{if(Number.isFinite(sizes[index]))node.style.fontSize=(sizes[index]*1.35)+'px';});
            })()`);
            const enlarged=await evaluate(`(()=>{
              const cards=[...document.querySelectorAll('#bot-read-root .bot-card')];
              return {overflow:document.documentElement.scrollWidth>innerWidth+1,
                heights:cards.map(card=>card.getBoundingClientRect().height),
                targets:cards.every(card=>card.querySelector('summary').getBoundingClientRect().height>=44),
                overlap:cards.some(card=>{
                  const identity=card.querySelector('.bot-card-identity').getBoundingClientRect();
                  const pnl=card.querySelector('.bot-card-pnl').getBoundingClientRect();
                  return identity.right>pnl.left+1;
                }),
                clipping:cards.some(card=>card.scrollWidth>card.clientWidth+1)};
            })()`);
            assert.equal(enlarged.overflow,false,JSON.stringify(enlarged));
            assert.ok(enlarged.heights.every((height,index)=>height>=normalHeights[index]),JSON.stringify(enlarged));
            assert.equal(enlarged.targets,true);assert.equal(enlarged.overlap,false);assert.equal(enlarged.clipping,false);
            if(evidence){
              const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
              writeFileSync(join(evidence,'v11-bot-compact-320x568-enlarged-text.png'),Buffer.from(image.data,'base64'));
            }
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
            ['BTCUSDT','BTCUSDT','ETHUSDT','XRPUSDT','ADAUSDT','SOLUSDT']);
          await evaluate(`(()=>{const dir=document.getElementById('bot-direction-filter');dir.value='unknown';
            dir.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.querySelector('#bot-read-root .bot-card .bot-card-heading').innerText`),
            'ADAUSDT');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root .bot-card .bot-card-direction').innerText`),
            'Unbekannt');
          await evaluate(`(()=>{const dir=document.getElementById('bot-direction-filter');dir.value='all';
            dir.dispatchEvent(new Event('change',{bubbles:true}));
            const type=document.getElementById('bot-category-filter');type.value='coin-m';
            type.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root .bot-card').length`),2);
          await evaluate(`(()=>{const search=document.getElementById('bot-symbol-search');search.value='NO_MATCH';
            search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          const none=await evaluate(`document.getElementById('bot-read-root').innerText`);
          assert.match(none,/0 von 6 Bots im Snapshot/);assert.match(none,/Keine Bots entsprechen den Filtern/);
          assert.doesNotMatch(none,/Keine Bots in diesem Snapshot/);
          assert.equal(await evaluate('window.__botReads'),1,'local filter, sort, reset and navigation must not fetch');

          await evaluate(`document.querySelector('#nav [data-v="command"]').click()`);
          const commandTargets=await evaluate(`[...document.querySelectorAll('#command-bot-overview button')].map(b=>b.getBoundingClientRect().height)`);
          assert.ok(commandTargets.every(height=>height>=44),JSON.stringify(commandTargets));
          await evaluate(`document.querySelector('#command-bot-overview .command-bot-details summary').focus()`);
          await key('Enter','Enter',13);
          assert.equal(await evaluate(`document.querySelector('#command-bot-overview .command-bot-details').open`),true);
          assert.match(await evaluate(`document.querySelector('#command-bot-overview .command-bot-details').innerText`),
            /Technische Referenz: a{20}[\s\S]*P\/L laut Quelle · Originalwert: -25 USD/);
          await key('Enter','Enter',13);
          await evaluate(`document.querySelector('#command-bot-overview .command-bot-metadata summary').focus()`);
          await key('Enter','Enter',13);
          assert.match(await evaluate(`document.querySelector('#command-bot-overview .command-bot-metadata').innerText`),
            /Snapshot-Zeit exakt \(UTC\):\s*\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/);
          await key('Enter','Enter',13);
          if(evidence){
            await evaluate("document.getElementById('command-bot-overview').scrollIntoView({block:'start'})");
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-bot-compact-${size.width}x${size.height}-command.png`),
              Buffer.from(image.data,'base64'));
          }
          const commandLayout=await evaluate(`(()=>{
            const root=document.getElementById('command-bot-overview');
            const rows=[...root.querySelectorAll('.command-bot-row')];
            return {overflow:document.documentElement.scrollWidth>innerWidth+1,
              rowHeights:rows.map(row=>row.getBoundingClientRect().height),
              actionHeights:[...root.querySelectorAll('button,summary')].map(node=>node.getBoundingClientRect().height)};
          })()`);
          assert.equal(commandLayout.overflow,false,JSON.stringify(commandLayout));
          assert.ok(commandLayout.actionHeights.every(height=>height>=43.99),JSON.stringify(commandLayout));
          let commandLargeText=null;
          if(size.width===320){
            commandLargeText=await evaluate(`(()=>{
              const root=document.getElementById('command-bot-overview');
              const nodes=[...root.querySelectorAll('*')];
              const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
              nodes.forEach((node,index)=>{
                if(Number.isFinite(sizes[index]))node.style.fontSize=(sizes[index]*1.35)+'px';
              });
              const rows=[...root.querySelectorAll('.command-bot-row')];
              return {overflow:document.documentElement.scrollWidth>innerWidth+1,
                overlap:rows.some(row=>row.firstElementChild.getBoundingClientRect().right>
                  row.lastElementChild.getBoundingClientRect().left+1),
                rowHeights:rows.map(row=>row.getBoundingClientRect().height),
                actionHeights:[...root.querySelectorAll('button,summary')].map(node=>node.getBoundingClientRect().height)};
            })()`);
            assert.equal(commandLargeText.overflow,false,JSON.stringify(commandLargeText));
            assert.equal(commandLargeText.overlap,false,JSON.stringify(commandLargeText));
            assert.ok(commandLargeText.actionHeights.every(height=>height>=43.99),JSON.stringify(commandLargeText));
          }
          if(evidence&&commandLargeText){
            const enlargedShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-bot-compact-${size.width}x${size.height}-command-enlarged-text.png`),
              Buffer.from(enlargedShot.data,'base64'));
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
          assert.equal(await evaluate(`(${backSelector}).hidden`),true,'new read drops prior return context');
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

          await openApp();
          await evaluate(`window.__botReadMode='pending';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'loading');
          await evaluate(`document.getElementById('bot-read-lock').click();window.__resolveBotRead?.()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'locked');
          await openApp();
          await evaluate(`window.__botReadMode='fresh';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          await evaluate(`Object.defineProperty(document,'hidden',{value:true,configurable:true});
            document.dispatchEvent(new Event('visibilitychange'))`);
          assert.equal(await evaluate(`document.getElementById('app').hidden`),true);
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'fresh');
          await evaluate(`Object.defineProperty(document,'hidden',{value:false,configurable:true});
            document.dispatchEvent(new Event('visibilitychange'))`);
          assert.equal(await evaluate(`document.getElementById('app').hidden`),false);
          assert.equal(await evaluate('window.__botReads'),8,'visibility and navigation do not fetch');

          await evaluate(`window.__botReadMode='unauthorized';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'locked');
          assert.equal(await evaluate(`document.getElementById('app').hidden`),true);

          await openApp();
          await evaluate(`window.__botReadMode='expires';document.getElementById('bot-read-refresh').click()`);
          await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
          assert.equal(await evaluate(`document.querySelector('#bot-read-root [data-state]').dataset.state`),'stale');
          assert.equal(await evaluate(`document.getElementById('command-bot-overview').dataset.state`),'stale');
          assert.doesNotMatch(await evaluate(`document.getElementById('command-bot-overview').innerText`),/Bots im Snapshot|BTCUSDT|Snapshot-Zeit/);
          assert.equal(await evaluate('window.__botReads'),10,'only explicit refresh actions reach the mock source');
          if(size.width===320||size.width===390){
            await evaluate(`window.__botReadMode='fresh';document.getElementById('bot-read-refresh').click()`);
            await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
            await evaluate(`window.__botReadMode='large';document.getElementById('bot-read-refresh').click()`);
            await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
            assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root .bot-card').length`),20);
            await evaluate('window.scrollTo(0,0)');
            const largeLayout=await evaluate(`(()=>{
              const root=document.getElementById('bot-read-root'),first=root.querySelector('.bot-card');
              const filter=root.querySelector('.bot-overview-filters'),actions=filter.nextElementSibling;
              const filtersRect=filter.getBoundingClientRect(),actionsRect=actions.getBoundingClientRect();
              const firstRect=first.getBoundingClientRect();
              return {count:root.querySelectorAll('.bot-card').length,
                filtersBeforeCards:Boolean(filter.compareDocumentPosition(first)&Node.DOCUMENT_POSITION_FOLLOWING),
                actionsBeforeCards:Boolean(actions.compareDocumentPosition(first)&Node.DOCUMENT_POSITION_FOLLOWING),
                controlsReachable:filtersRect.top<firstRect.top&&actionsRect.top<firstRect.top&&
                  filtersRect.bottom<=firstRect.top&&actionsRect.bottom<=firstRect.top,
                overflow:document.documentElement.scrollWidth>innerWidth+1,
                clipping:[...root.querySelectorAll('.bot-card')].some(card=>card.scrollWidth>card.clientWidth+1),
                refs:new Set([...root.querySelectorAll('.bot-card')].map(card=>card.id)).size};
            })()`);
            assert.deepEqual(largeLayout,{count:20,filtersBeforeCards:true,actionsBeforeCards:true,
              controlsReachable:true,overflow:false,clipping:false,refs:20},
              `20-bot controls and geometry at ${size.width}px`);
            await evaluate(`(()=>{
              const search=document.getElementById('bot-symbol-search');search.value='NO_MATCH';
              search.dispatchEvent(new Event('input',{bubbles:true}));
              document.querySelector('#nav [data-v="command"]').click();
              const jump=document.querySelector('#command-bot-overview button');
              window.__largeJumpRef=jump.getAttribute('aria-label').match(/Referenz ([a-f0-9]{20})/)[1];
              jump.focus();
            })()`);
            await key('Enter','Enter',13);
            assert.equal(await evaluate(`document.getElementById('bot-card-'+window.__largeJumpRef)?.open`),true,
              'keyboard jump selects the stable reference in a 20-bot snapshot');
            const largeBack=`[...document.querySelectorAll('#bot-read-root button')].find(button=>button.textContent==='Zur vorherigen Auswahl zurück')`;
            assert.equal(await evaluate(`(${largeBack}).hidden`),false);
            await evaluate(`(${largeBack}).focus()`);await key('Enter','Enter',13);
            assert.deepEqual(await evaluate(`({query:document.getElementById('bot-symbol-search').value,
              focus:document.activeElement===document.getElementById('bot-symbol-search'),
              hidden:(${largeBack}).hidden,reads:window.__botReads,
              overflow:document.documentElement.scrollWidth>innerWidth+1})`),
              {query:'NO_MATCH',focus:true,hidden:true,reads:12,overflow:false},
              'keyboard return restores the selection without a new read or horizontal overflow');
          }
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
            writeFileSync(join(evidence,`v11-bot-compact-${size.width}x${size.height}-stale.png`),
              Buffer.from(image.data,'base64'));
          }
          return {width:size.width,height:size.height,mixedRows:fresh.cards,
            collapsedCardHeights:fresh.cardHeights,requests:await evaluate('window.__botReads'),
            filtersNoRequest:true,commandJumpFocused:jump.focused,statesCleared:true,
            overflow:finalLayout.overflow,controls44px:fresh.touch,commandLayout,commandLargeText};
        },size.height);
        console.log('V11_B11_SIZE',`${size.width}x${size.height}`,JSON.stringify(measurements));
      }
    }finally{
      await new Promise(resolve=>server.close(resolve));
    }
  });
