import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';
import {unlockAppThroughGate} from './helpers/v11-app-access-browser.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const sizes=[{width:320,height:568},{width:390,height:844}];

test('real V11 status panel: mobile, keyboard, expiry and fail-closed lifecycle',{timeout:120000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:115000});
    assert.equal(child.status,0,child.stdout+child.stderr);
    assert.equal(child.stdout.split('\n').filter(line=>line.includes('V11_AGENT_STATUS_SIZE')).length,2);
    return;
  }
  assert.ok(chrome,'Chrome required; do not silently skip');
  const hosted=await startV11StaticServer();
  try{
    for(const size of sizes){
      await withMobileChrome(chrome,size.width,hosted.url,async call=>{
        const evaluate=async expression=>{
          const reply=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
          assert.ok(!reply.exceptionDetails,JSON.stringify(reply.exceptionDetails));
          return reply.result?.value;
        };
        const key=async(name,code,keyCode)=>{
          await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,
            ...(name==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
          await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
        };
        const tabTo=async selector=>{
          for(let i=0;i<100;i++){
            if(await evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`))return;
            await key('Tab','Tab',9);
          }
          assert.fail('Keyboard could not reach '+selector);
        };
        const read=()=>evaluate(`(()=>{
          const root=document.getElementById('agent-status-root'),panel=document.getElementById('autonomy-status');
          return {text:root.textContent,cards:root.querySelectorAll('article').length,
            links:root.querySelectorAll('a').length,freshness:root.querySelector('article')?.dataset.freshness,
            task:root.querySelector('article')?.dataset.taskState,
            summary:panel.querySelector('summary').textContent,open:panel.open,
            overflow:document.documentElement.scrollWidth>innerWidth+1,
            panelOverflow:panel.scrollWidth>panel.clientWidth+1,
            requests:performance.getEntriesByType('resource').filter(r=>['fetch','xmlhttprequest'].includes(r.initiatorType)).map(r=>r.name),
            css:[...document.styleSheets].some(s=>s.href?.endsWith('/public/css/m11-agent-status.css')),
            styled:root.querySelector('.m11-agent-status')?getComputedStyle(root.querySelector('.m11-agent-status')).display:null,
            depot:document.querySelector('#depot-read-root [data-state]')?.dataset.state,
            bots:document.getElementById('bot-read-root').textContent};
        })()`);
        let state=await read();
        assert.equal(state.text,'Keine verifizierten Statusdaten.');
        assert.equal(state.cards,0);
        assert.equal(state.requests.length,0,'page load makes no status or private data reads');
        assert.equal(state.css,true);
        await unlockAppThroughGate(call);
        await tabTo('#autonomy-status > summary');
        await key('Enter','Enter',13);
        state=await read();
        assert.equal(state.open,true);
        assert.equal(state.overflow,false);
        assert.equal(state.panelOverflow,false);
        assert.equal(state.requests.length,1,'only central access verification');
        assert.equal(state.depot,'not_loaded');
        const originalBots=state.bots;

        // All synthetic data and producer handles exist only in this CDP test harness.
        await evaluate(`(async()=>{
          const {mountAgentStatus}=await import('/v11/agent-status-bootstrap.js?v=B16-M11-FIX2');
          const {createAgentStatusClient}=await import('/v11/agent-status-client.js?v=B16-M11-FIX2');
          const {appAccess}=await import('/v11/app-access.js?v=B16-M11-FIX2');
          const base=Date.parse('2026-10-29T12:00:00.000Z'),iso=t=>new Date(t).toISOString();
          const binding=value=>({agentId:'synthetic-agent',taskId:'synthetic-task',value,
            observedAt:iso(base-1000),expiresAt:iso(base+1000),
            evidenceUrl:'https://github.com/acme/meridian/actions/runs/123',evidenceType:'github-workflow'});
          const row={agentId:'synthetic-agent',agentName:'Synthetic agent',taskId:'synthetic-task',
            taskLabel:'Synthetic status',taskState:'RUNNING',coordinatorMode:'STOPPED',
            providerRequested:'github',providerVerified:'github',modelRequested:'requested-model',
            modelVerified:'observed-model',providerEvidence:binding('github'),modelEvidence:binding('observed-model'),
            coordinatorEvidence:binding('STOPPED'),taskUrl:'https://github.com/acme/meridian/issues/42',
            observedAt:iso(base-1000),expiresAt:iso(base+2000),
            evidenceUrl:'https://github.com/acme/meridian/actions/runs/123',evidenceType:'github-workflow',
            blocker:null,nextAction:'Wait',ownerDecisionRequired:false,ownerDecisionReason:null};
          const qa={time:base,jobs:new Map(),cancelled:[],id:0,access:appAccess,
            dto:overrides=>JSON.stringify({schemaVersion:1,status:'READY',freshness:'CURRENT',rows:[{...row,...overrides}]})};
          qa.mount=mountAgentStatus(document,window,{access:appAccess,now:()=>qa.time,
            schedule(fn,delay){const id=++qa.id;qa.jobs.set(id,{fn:()=>{qa.jobs.delete(id);fn();},delay});return id;},
            cancelSchedule(id){qa.cancelled.push(qa.jobs.get(id)?.fn);qa.jobs.delete(id);},
            createClient(options){qa.client=createAgentStatusClient(options);return qa.client;}});
          window.__agentStatusQA=qa;
          return qa.client.accept(qa.dto());
        })()`);
        state=await read();
        assert.equal(state.cards,1);assert.equal(state.links,2);
        assert.equal(state.freshness,'CURRENT');assert.equal(state.task,'RUNNING');
        assert.match(state.text,/Modell angefragtrequested-modelModell verifiziertobserved-model/);
        assert.match(state.summary,/Autonome Entwicklung · Unbekannt/);
        assert.equal(state.overflow,false);assert.equal(state.panelOverflow,false);
        assert.equal(state.styled,'block');
        await tabTo('#agent-status-root a');
        const link=await evaluate(`(()=>{
          const a=document.activeElement;return {text:a.textContent,target:a.target,rel:a.rel,
            outline:getComputedStyle(a).outlineStyle};
        })()`);
        assert.equal(link.text,'Aufgabe öffnen');assert.equal(link.target,'_blank');
        assert.equal(link.rel,'noreferrer noopener');assert.notEqual(link.outline,'none');

        assert.equal(await evaluate(`(()=>{
          const q=window.__agentStatusQA;
          if(q.jobs.size!==1||[...q.jobs.values()][0].delay!==1000)return false;
          q.time+=1000;[...q.jobs.values()][0].fn();return true;
        })()`),true);
        state=await read();
        assert.equal(state.freshness,'STALE');assert.equal(state.task,'UNKNOWN');
        assert.match(state.text,/Modell verifiziertUnbekannt/);
        assert.equal(state.overflow,false);assert.equal(state.panelOverflow,false);
        for(const invalid of ['null','{taskId:"wrong-task"}']){
          await evaluate(`(()=>{
            const q=window.__agentStatusQA;q.time-=1000;
            q.client.accept(q.dto({providerEvidence:${invalid},modelEvidence:${invalid},coordinatorEvidence:${invalid}}));
            return true;
          })()`);
          state=await read();
          assert.equal(state.freshness,'UNKNOWN');assert.equal(state.task,'UNKNOWN');
        }
        await evaluate(`(()=>{
          const q=window.__agentStatusQA;q.client.accept(q.dto());
          q.client.accept(q.dto({taskUrl:'javascript:alert(1)'}));return true;
        })()`);
        state=await read();
        assert.equal(state.text,'Statusdaten nicht verfügbar.');
        assert.equal(state.cards,0);assert.equal(state.links,0);
        await evaluate(`(()=>{
          const q=window.__agentStatusQA;q.client.accept(q.dto());
          const create=document.createElement;
          try{document.createElement=()=>{throw new Error('Synthetic render failure');};q.client.accept(q.dto());}
          finally{document.createElement=create;}
          return q.client.revalidate();
        })()`);
        state=await read();
        assert.equal(state.text,'Statusdaten nicht verfügbar.');
        assert.equal(state.cards,0);assert.equal(state.links,0);
        await evaluate(`(()=>{
          const q=window.__agentStatusQA;q.client.accept(q.dto());q.client.accept('{');
          q.access.revalidateReaders();return true;
        })()`);
        state=await read();
        assert.equal(state.text,'Statusdaten nicht verfügbar.');
        assert.equal(state.cards,0);assert.equal(state.links,0);

        await evaluate(`(()=>{
          const q=window.__agentStatusQA;q.client.accept(q.dto());q.access.lock();
          q.cancelled.forEach(fn=>fn?.());return true;
        })()`);
        state=await read();
        assert.equal(state.cards,0);assert.equal(state.links,0);
        await unlockAppThroughGate(call);
        assert.equal((await read()).text,'Keine verifizierten Statusdaten.');
        await evaluate(`(()=>{
          const q=window.__agentStatusQA;q.client.accept(q.dto());
          window.dispatchEvent(new Event('pagehide'));
          q.cancelled.forEach(fn=>fn?.());return true;
        })()`);
        assert.equal((await read()).cards,0);
        assert.equal(await evaluate(`window.__agentStatusQA.client.accept(window.__agentStatusQA.dto())`),false);
        await evaluate(`(()=>{
          const q=window.__agentStatusQA;window.dispatchEvent(new Event('pageshow'));
          q.mount.dispose();q.cancelled.forEach(fn=>fn?.());return q.client.accept(q.dto());
        })()`);
        state=await read();
        assert.equal(state.cards,0);assert.equal(state.links,0);
        assert.equal(state.depot,'locked');
        await unlockAppThroughGate(call);
        state=await read();
        assert.equal(state.depot,'not_loaded');assert.equal(state.bots,originalBots);
        assert.equal(state.requests.length,3,'no status, Bot or Depot reads; only three gate verifications');
        assert.ok(state.requests.every(url=>url.includes('/api/private/portfolio-history?range=1w')));
        console.log('V11_AGENT_STATUS_SIZE '+JSON.stringify({width:size.width,overflow:state.overflow,statusRequests:0}));
      },size.height);
    }
  }finally{await hosted.close();}
});
