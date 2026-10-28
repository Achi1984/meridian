// Synthetic browser acceptance: real index.html, real central gate and real Depot/Command view.
// All network traffic is intercepted and answered with generated bodies; no credentials or private endpoints.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const sizes=[{width:320,height:568},{width:390,height:844}];
const PASSWORD='synthetic-browser-gate-password';
const evidence=process.env.V11_DEPOT_EVIDENCE_DIR;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('V11 Depot Chrome: central unlock shows not-loaded on both surfaces without reads',{timeout:120000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:115000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.includes('V11_DEPOT_SIZE'));
    assert.equal(rows.length,sizes.length);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome required; this test must not silently skip');
  const hosted=await startV11StaticServer();
  try{
    if(evidence)mkdirSync(evidence,{recursive:true});
    for(const size of sizes){
      const result=await withMobileChrome(chrome,size.width,hosted.url,async call=>{
        const evaluate=async expression=>{
          const reply=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
          assert.ok(!reply.exceptionDetails,'browser exception '+JSON.stringify(reply.exceptionDetails));
          return reply.result?.value;
        };
        const key=async(name,code,keyCode)=>{
          const text=name==='Enter'?'\r':null;
          await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,...(text?{text,unmodifiedText:text}:{})});
          await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
        };
        const counts={dashboard:0,prices:0,history:0};let failure=null;
        const cors=[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Cache-Control',value:'no-store'}];
        call.onEvent('Fetch.requestPaused',event=>{void (async()=>{
          const url=event.request.url;
          if(event.request.method==='OPTIONS'){
            await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:204,responseHeaders:[...cors,
              {name:'Access-Control-Allow-Methods',value:'GET'},{name:'Access-Control-Allow-Headers',value:'authorization,accept'}]});
            return;
          }
          const kind=url.includes('/api/private/dashboard')?'dashboard':url.includes('portfolio-history')?'history':url.includes('binance.vision')?'prices':null;
          if(!kind)throw Error('unexpected request');
          counts[kind]++;
          const body=kind==='prices'?[]:kind==='history'?{points:[]}:{};
          await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,
            responseHeaders:[...cors,{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
        })().catch(error=>{failure=error;});});
        await call('Fetch.enable',{patterns:[{urlPattern:'*/api/private/*',requestStage:'Request'},{urlPattern:'*binance.vision*',requestStage:'Request'}]});
        const unlock=async()=>{
          await evaluate('document.getElementById("app-access-password").focus()');
          await call('Input.insertText',{text:PASSWORD});
          await key('Enter','Enter',13);
          for(let i=0;i<200&&await evaluate('document.getElementById("app").hidden');i++)await sleep(25);
          assert.equal(await evaluate('document.getElementById("app").hidden'),false,'keyboard unlock failed');
        };
        const snap=()=>evaluate(`(()=>{
          const root=document.getElementById('depot-read-root'),cmd=document.getElementById('command-portfolio');
          const view=document.getElementById('view-depot');
          const rects=[...document.querySelectorAll('#command-portfolio .portfolio-description,#command-portfolio [data-command-depot-status]')].map(n=>n.getBoundingClientRect());
          return {depot:root.querySelector('[data-state]')?.dataset.state,command:cmd.dataset.state,
            depotText:root.textContent,commandText:cmd.textContent,
            overflow:document.documentElement.scrollWidth>innerWidth+1,
            targets:[...root.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44),
            overlap:rects.some((a,i)=>rects.slice(i+1).some(b=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)),
            leak:/synthetic-browser-gate-password/.test(document.body.innerText)};
        })()`);
        const shot=async name=>{if(evidence){const image=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,'v11-depot-'+size.width+'-'+name+'.png'),Buffer.from(image.data,'base64'));}};
        const showDepot=()=>evaluate("document.querySelector('#nav button[data-v=depot]').click();window.scrollTo(0,0);true");
        const showCommand=()=>evaluate("document.querySelector('#nav button[data-v=command]').click();window.scrollTo(0,0);true");

        await unlock();
        assert.equal(counts.dashboard+counts.prices,0,'unlock must not read Depot sources');
        assert.equal(counts.history,1,'only the central verification request');
        await showCommand();let s=await snap();
        assert.equal(s.command,'not_loaded');assert.match(s.commandText,/Noch nicht geladen/);assert.equal(s.overflow,false);assert.equal(s.overlap,false);
        await shot('command-not-loaded');
        await showDepot();s=await snap();
        assert.equal(s.depot,'not_loaded');assert.match(s.depotText,/Noch nicht geladen/);assert.match(s.depotText,/Depot manuell aktualisieren/);
        assert.equal(s.overflow,false);assert.equal(s.targets,true);assert.equal(s.leak,false);
        await shot('depot-not-loaded');
        assert.equal(counts.dashboard+counts.prices,0);assert.equal(counts.history,1);

        // Keyboard activation of the single manual refresh CTA.
        await evaluate("[...document.querySelectorAll('#depot-read-root button')].find(b=>b.textContent==='Depot aktualisieren').focus()");
        await key('Enter','Enter',13);
        for(let i=0;i<200&&counts.history<2;i++)await sleep(25);
        await sleep(100);
        assert.equal(counts.dashboard,1);assert.equal(counts.prices,1);assert.equal(counts.history,2);
        s=await snap();
        assert.equal(s.depot,'unavailable');assert.match(s.depotText,/Nicht verfügbar/);
        assert.match(s.depotText,/Aktuell: unvollständig/);assert.match(s.depotText,/Historie: unvollständig/);
        assert.equal(s.overflow,false);assert.equal(s.targets,true);assert.equal(s.leak,false);
        await showCommand();s=await snap();
        assert.equal(s.command,'unavailable');assert.equal(s.overlap,false);assert.equal(s.overflow,false);
        await shot('command-unavailable');

        // Shared lock, then re-unlock returns to not-loaded with prior private view cleared.
        await evaluate('document.getElementById("app-access-lock").focus()');
        await key('Enter','Enter',13);await sleep(100);
        assert.equal(await evaluate('document.getElementById("app").hidden'),true);
        s=await snap();assert.equal(s.depot,'locked');assert.equal(s.command,'locked');
        await unlock();await showDepot();s=await snap();
        assert.equal(s.depot,'not_loaded');assert.equal(s.command,'not_loaded');
        assert.doesNotMatch(s.depotText,/unvollständig/);
        assert.equal(counts.dashboard,1);assert.equal(counts.prices,1,'re-unlock must not read Depot sources');
        if(failure)throw failure;
        return {width:size.width,height:size.height,counts};
      },size.height);
      console.log('V11_DEPOT_SIZE '+JSON.stringify(result));
    }
  }finally{await hosted.close();}
});
