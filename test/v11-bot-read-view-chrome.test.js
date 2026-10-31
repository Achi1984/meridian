// Synthetic component acceptance only. Uses the existing CI Chrome helper and evidence directory.
// Does not activate v11/index.html or authenticate against any account.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
function fixture() {
  const sources=['bot-read-model.js','bot-overview-model.js','bot-read-client.js','bot-read-view.js'].map(name=>{
    let source=readFileSync(new URL('../v11/'+name,import.meta.url),'utf8');
    if(name==='bot-read-client.js') {
      const expected="import {buildBotReadModel} from './bot-read-model.js?v=B16-M11-FIX8';";
      assert.equal(source.split(expected).length,2,'known client import boundary');
      source=source.replace(expected,'');
    }
    if(name==='bot-read-view.js') {
      const expected="import {buildBotOverviewModel} from './bot-overview-model.js?v=B16-M11-FIX8';";
      assert.equal(source.split(expected).length,2,'known overview model import boundary');
      source=source.replace(expected,'');
      const depotExpected="import {subscribeDepotPortfolio} from './depot-portfolio-state.js?v=B16-M11-FIX8';";
      assert.equal(source.split(depotExpected).length,2,'known shared Depot state boundary');
      source=source.replace(depotExpected,'');
    }
    source=source.replace(/^export function /gm,'function ');
    if(name==='bot-overview-model.js')
      source='(()=>{'+source+'\nwindow.__buildBotOverviewModel=buildBotOverviewModel;})();const buildBotOverviewModel=window.__buildBotOverviewModel;';
    assert.doesNotMatch(source,/^\s*(?:import|export)\b/m,'unexpected module dependency');
    assert.doesNotMatch(source,/<\/script/i,'inline fixture boundary');
    return source;
  });
  // The copied production functions execute unchanged inside one lexical scope.
  // Only module import/export syntax is removed; no storage or network adapter is installed.
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>V11 Bot-Komponente · synthetischer Test</title>
<style>body{font:16px system-ui;margin:16px;background:#101923;color:#edf4ff}main{max-width:600px;margin:auto}button{font:inherit;min-height:44px;min-width:44px;margin:4px;padding:8px}button:focus-visible{outline:3px solid #80caff}p,strong,time{overflow-wrap:anywhere}ul{padding-left:24px}li{margin:12px 0}h1{font-size:20px}</style>
<main><h1>Synthetische Bot-Komponente</h1><div id="root"></div></main><script>
(()=>{${sources.join('\n')}
const subscribeDepotPortfolio=listener=>{listener({status:'not_loaded'});return()=>{};};
let clock=Date.parse('2026-10-12T20:01:00Z'),credential='synthetic-token',mode='fresh',pending=null,requests=0,unexpected=0,completion;
window.fetch=()=>{unexpected++;throw Error('External fetch forbidden');};
const snapshot=()=>({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_WALLET_BOT_DETAIL',sourceSnapshotAt:'2026-10-12T20:00:00Z',freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:1,bots:[{botRef:'a'.repeat(20),symbol:'BTC',side:'SHORT',cateType:'inverse',botType:'futures_grid',sideSource:'economic_inverse_asset'}]});
const root=document.getElementById('root');
const view=createBotReadView(root,{getToken:()=>credential,createClient:options=>{
 const client=createBotReadClient({...options,now:()=>clock,fetchImpl:async()=>{
  requests++;
  if(mode==='loading')return new Promise(resolve=>{pending=resolve;});
  if(mode==='unavailable')throw Error('synthetic-private-error');
  return new Response(JSON.stringify(snapshot()));
 }});
 return {...client,refresh(){completion=client.refresh();return completion;}};
}});
const initialLive=root.querySelector('[role=status]');
const refresh=()=>document.getElementById('bot-read-refresh'),lock=()=>document.getElementById('bot-read-lock');
window.botQA={
 state(){return root.querySelector('.bot-read-state')?.dataset.state||'disposed';},
 metrics(){return {width:innerWidth,viewport:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,rows:root.querySelectorAll('li').length,requests,unexpected,secretLeak:/synthetic-token|synthetic-private-error/.test(root.textContent),statusRole:root.querySelector('[role=status]')?.getAttribute('aria-live'),statusPersistent:root.querySelector('[role=status]')===initialLive,statusConnected:initialLive.isConnected,statusNotBusy:!initialLive.closest('[aria-busy="true"]'),targets:[...root.querySelectorAll('button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44),focusStable:document.activeElement===refresh()};},
 async show(next){
  lock().click();mode=next;clock=Date.parse('2026-10-12T20:01:00Z');credential='synthetic-token';
  if(next==='locked')return;
  if(next==='stale')clock+=900000;
  refresh().focus();refresh().click();
  if(next!=='loading')await completion;
 },
 async cancelLoading(){const resolve=pending;lock().click();resolve?.(new Response(JSON.stringify(snapshot())));await completion;},
 expire(){clock+=900000;view.revalidate();},
 logout(){credential='';view.revalidate();},
 dispose(){view.dispose();}
};})();</script></html>`;
}

test('V11 bot component Chrome: synthetic client/model/view states at four widths',{timeout:120000},async()=>{
  if(typeof WebSocket!=='function') {
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],{env,encoding:'utf8',timeout:115000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.includes('V11_BOT_COMPONENT_WIDTH'));
    assert.equal(rows.length,4);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome required; no silent skip');
  const dir=mkdtempSync(join(tmpdir(),'v11-bot-component-'));
  try {
    const html=join(dir,'synthetic-bots.html');writeFileSync(html,fixture());
    for(const width of [320,375,390,430]) {
      const result=await withMobileChrome(chrome,width,pathToFileURL(html).href,async call=>{
        const evaluate=async expression=>{
          const reply=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
          assert.ok(!reply.exceptionDetails,'synthetic component browser exception '+JSON.stringify(reply.exceptionDetails));
          return reply.result?.value;
        };
        assert.equal(await evaluate('botQA.metrics().requests'),0,'mount must not request data');
        for(const state of ['locked','loading','fresh','stale','unavailable']) {
          await evaluate('botQA.show('+JSON.stringify(state)+')');
          assert.equal(await evaluate('botQA.state()'),state);
          const measurements=await evaluate('botQA.metrics()');
          assert.equal(measurements.width,width);assert.equal(measurements.viewport,width);
          assert.equal(measurements.overflow,false);assert.equal(measurements.secretLeak,false);
          assert.equal(measurements.unexpected,0);assert.equal(measurements.statusRole,'polite');
          assert.equal(measurements.statusPersistent,true,'live region identity persists');
          assert.equal(measurements.statusConnected,true,'live region stays connected');
          assert.equal(measurements.statusNotBusy,true,'loading announcements are not suppressed');
          assert.equal(measurements.targets,true,'minimum control target at '+state+': '+JSON.stringify(measurements));
          assert.equal(measurements.rows,state==='fresh'?1:0);
          if(state!=='locked')assert.equal(measurements.focusStable,true,'refresh node retains focus');
          const evidence=process.env.V11_A2_EVIDENCE_DIR;
          if(evidence) {
            mkdirSync(evidence,{recursive:true});
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,'v11-bot-component-'+width+'-'+state+'.png'),Buffer.from(image.data,'base64'));
          }
          if(state==='loading') {
            await evaluate('botQA.cancelLoading()');assert.equal(await evaluate('botQA.state()'),'locked');
            assert.equal(await evaluate('botQA.metrics().rows'),0,'late response stays hidden');
          }
        }
        await evaluate("botQA.show('fresh')");await evaluate('botQA.expire()');
        assert.equal(await evaluate('botQA.state()'),'stale');
        await evaluate("botQA.show('fresh')");await evaluate('botQA.logout()');
        assert.equal(await evaluate('botQA.state()'),'locked');
        await evaluate('botQA.dispose()');assert.equal(await evaluate('document.getElementById("root").textContent'),'');
        return {width,states:5,syntheticOnly:true};
      });
      console.log('V11_BOT_COMPONENT_WIDTH',width,JSON.stringify(result));
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
