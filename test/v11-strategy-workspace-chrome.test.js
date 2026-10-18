import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {ARENA_SYMBOLS} from '../research/strategy-paper-arena.js';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const repository=fileURLToPath(new URL('../',import.meta.url));
const v11=join(repository,'v11');
const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
  {width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}];

function staticServer(){
  const requests=[];
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    requests.push({method:request.method,path:url.pathname});
    if(request.method!=='GET'){response.writeHead(405);response.end();return;}
    const roots=[['/v11/',v11],['/research/',join(repository,'research')],['/docs/',join(repository,'docs')]];
    const match=roots.find(([prefix])=>url.pathname.startsWith(prefix));
    if(!match){response.writeHead(404);response.end();return;}
    const [prefix,root]=match;
    const path=normalize(join(root,decodeURIComponent(url.pathname.slice(prefix.length))));
    if(path!==root&&!path.startsWith(root.endsWith(sep)?root:root+sep)){response.writeHead(404);response.end();return;}
    try{
      const body=readFileSync(path);
      const type=path.endsWith('.html')?'text/html; charset=utf-8':
        path.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8';
      response.writeHead(200,{'content-type':type,'cache-control':'no-store'});
      response.end(body);
    }catch{response.writeHead(404);response.end();}
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({
    server,requests,url:`http://127.0.0.1:${server.address().port}/v11/index.html`
  })));
}

function syntheticPayload(){
  const day=86400000,start=Date.UTC(2025,0,1);
  const data=Object.fromEntries(ARENA_SYMBOLS.map(symbol=>[symbol,Array.from({length:210},(_,index)=>({
    openTime:start+index*day,closeTime:start+(index+1)*day-1,
    open:100+index,close:100+index+.5,high:101+index,low:99+index
  }))]));
  return {data,asOf:start+210*day,sourceKind:'SYNTHETIC',quoteCurrency:'USD',liquidateAtEnd:true};
}

test('M11 Strategies native shell, synthetic Arena and responsive evidence at four widths',{timeout:240000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:235000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.startsWith('V11_B12_SIZE '));
    assert.equal(rows.length,4);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome is required for native M11 strategy acceptance.');
  const hosted=await staticServer();
  const evidence=process.env.V11_B12_EVIDENCE_DIR;
  if(evidence)mkdirSync(evidence,{recursive:true});
  try{
    for(const size of sizes){
      const previousSourceRequests=hosted.requests.filter(request=>request.path==='/docs/strategy-lab/campaign-20261013.json').length;
      const metrics=await withMobileChrome(chrome,size.width,hosted.url,async call=>{
        const evaluate=async expression=>{
          const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
          assert.ok(!result.exceptionDetails,'M11 strategy page expression failed');
          return result.result?.value;
        };
        const key=async(name,code,keyCode)=>{
          const text=name==='Enter'?'\r':null;
          await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,
            ...(text===null?{}:{text,unmodifiedText:text})});
          await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
        };
        await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,
          deviceScaleFactor:1,mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
        const initial=await evaluate(`(()=>{
          const nav=[...document.querySelectorAll('#nav button')];
          return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
            nav:nav.map(button=>({name:button.dataset.v,label:button.innerText,height:button.getBoundingClientRect().height})),
            active:document.querySelector('.view.active')?.id,
            v10Links:[...document.querySelectorAll('a')].filter(link=>/v10/i.test(link.href)).length};
        })()`);
        assert.equal(initial.width,size.width);
        assert.equal(initial.overflow,false);
        assert.equal(initial.active,'view-command');
        assert.equal(initial.nav.length,5);
        assert.deepEqual(initial.nav.map(item=>item.name),['command','depot','bots','market','strategies']);
        assert.ok(initial.nav.every(item=>item.height>=44));
        assert.equal(initial.v10Links,0);

        await evaluate(`document.querySelector('#nav button[data-v="strategies"]').focus()`);
        await key('Enter','Enter',13);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`document.querySelectorAll('#strategy-catalog [data-strategy-id^="H"]').length===12`))break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        const catalog=await evaluate(`(()=>{
          const root=document.documentElement,view=document.getElementById('view-strategies');
          return {visible:!view.hidden,active:document.querySelector('.view.active').id,
            current:[...document.querySelectorAll('#nav [aria-current="page"]')].map(button=>button.dataset.v),
            families:[...document.querySelectorAll('#strategy-catalog [data-strategy-id^="H"]')].length,
            candidate:document.querySelector('[data-strategy-id="B1-7"]')?.innerText,
            h9:document.querySelector('[data-strategy-id="H9"]')?.innerText,
            models:[...document.querySelectorAll('.arena-model-card')].map(card=>card.innerText),
            overflow:root.scrollWidth>innerWidth+1,
            controls:[...document.querySelectorAll('#strategy-catalog details summary,#strategy-arena-root button,#strategy-arena-root input')].map(node=>node.getBoundingClientRect().height),
            resources:performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname)};
        })()`);
        assert.equal(catalog.visible,true);assert.equal(catalog.active,'view-strategies');
        assert.deepEqual(catalog.current,['strategies']);assert.equal(catalog.families,12);
        assert.match(catalog.candidate,/7 Assets · 44 geplante Pfade/);
        assert.match(catalog.candidate,/15 bp Basis, 30 bp Stress, \+1 Tag/);
        assert.match(catalog.candidate,/keine Ergebnisse/i);
        assert.match(catalog.h9,/BLOCKED_DATA/);
        assert.equal(catalog.models.length,5);
        assert.equal(catalog.overflow,false);
        assert.ok(catalog.controls.every(height=>height>=44));
        assert.ok(catalog.resources.every(path=>!/\/v10\/|\/api\/|\/market|\/ticker|\/klines/i.test(path)));
        assert.ok(catalog.resources.includes('/docs/strategy-lab/campaign-20261013.json'));
        if(evidence&&size.width!==1440){
          await evaluate('window.scrollTo(0,0)');
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(evidence,`v11-b12-strategies-${size.width}x${size.height}.png`),Buffer.from(image.data,'base64'));
        }

        await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] summary').focus()`);
        await key('Enter','Enter',13);
        assert.equal(await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] details').open`),true);
        assert.match(await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] details').innerText`),/Hindernis/);
        await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] summary').click()`);

        const payload=JSON.stringify(syntheticPayload());
        await evaluate(`(()=>{
          const picker=document.querySelector('[data-arena-input]');
          const transfer=new DataTransfer();
          transfer.items.add(new File([${JSON.stringify(payload)}],'synthetic-arena.json',{type:'application/json'}));
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        for(let attempt=0;attempt<200;attempt++){
          if(await evaluate(`document.querySelector('#strategy-arena-root .arena-evidence')?.innerText.includes('SYNTHETISCHE TESTDATEN')`))break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        const arena=await evaluate(`(()=>{
          const root=document.documentElement;
          return {notice:document.querySelector('#strategy-arena-root .arena-evidence')?.innerText,
            cards:[...document.querySelectorAll('#strategy-arena-root .arena-model-card')].length,
            h9:document.querySelector('#strategy-arena-root').innerText.includes('BLOCKED_DATA'),
            overflow:root.scrollWidth>innerWidth+1,
            bottom:(()=>{window.scrollTo(0,root.scrollHeight);const last=document.getElementById('strategy-arena-root').lastElementChild.getBoundingClientRect();const nav=document.getElementById('nav').getBoundingClientRect();return last.bottom<=nav.top+1;})(),
            network:performance.getEntriesByType('resource').map(row=>row.name)};
        })()`);
        assert.match(arena.notice,/SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ/);
        assert.equal(arena.cards,5);assert.equal(arena.h9,true);assert.equal(arena.overflow,false);assert.equal(arena.bottom,true);
        assert.ok(arena.network.every(url=>new URL(url).origin===new URL(hosted.url).origin),'no external or market requests');
        if(evidence){
          await evaluate(`document.querySelector('#strategy-arena-root .arena-model-card').scrollIntoView({block:'start'})`);
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(evidence,`v11-b12-arena-${size.width}x${size.height}-synthetic.png`),Buffer.from(image.data,'base64'));
        }

        await evaluate(`document.querySelector('#nav button[data-v="command"]').click()`);
        await evaluate(`document.querySelector('.command-open-strategies').click()`);
        assert.equal(await evaluate(`document.querySelector('.view.active').id`),'view-strategies',
          'Command offers direct native navigation to strategies');
        assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);
        const requestPaths=hosted.requests.map(request=>request.path);
        assert.ok(!requestPaths.some(path=>/\/v10\/|\/api\/|\/klines|\/ticker|\/market/i.test(path)));
        return {width:size.width,sourceFetches:requestPaths.filter(path=>path==='/docs/strategy-lab/campaign-20261013.json').length,
          families:catalog.families,models:arena.cards,overflow:catalog.overflow,synthetic:true};
      },size.height);
      assert.equal(metrics.sourceFetches-previousSourceRequests,1);
      assert.equal(metrics.families,12);
      assert.equal(metrics.models,5);
      console.log('V11_B12_SIZE',`${size.width}x${size.height}`,JSON.stringify(metrics));
    }
  }finally{await new Promise(resolve=>hosted.server.close(resolve));}
});
