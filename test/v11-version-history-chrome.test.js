import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
test('version history: native keyboard, focus and compact viewport at four mobile widths',{timeout:120000},async()=>{
 if(typeof WebSocket!=='function'){
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],{env,encoding:'utf8',timeout:115000});
  assert.equal(child.status,0,String(child.stdout).slice(-1600)+String(child.stderr).slice(-800));
  assert.equal(String(child.stdout).split('\n').filter(l=>l.includes('V11_HISTORY_WIDTH')).length,4);return;
 }
 assert.ok(chrome,'Chrome binary required');
 const url=process.env.V11_TEST_URL||'file://'+fileURLToPath(new URL('../v11/index.html',import.meta.url));
 for(const width of [320,375,390,430]){
  await withMobileChrome(chrome,width,url,async call=>{
   const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
   const key=async(key,code,windowsVirtualKeyCode)=>{
    // Match the existing A2 native-key probe: Enter/Space need their text event payload.
    const text=key==='Enter'?'\r':key===' '?' ':null;
    await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(text===null?{}:{text,unmodifiedText:text})});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
   };
   const before=await evaluate(`JSON.stringify({value:document.querySelector('.portfolio-value').textContent,sources:[...document.querySelectorAll('.trust-cell span')].map(x=>x.textContent),decision:document.querySelector('[data-decision-owner]').textContent})`);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),true);
   await evaluate(`document.getElementById('version-toggle').focus()`);
   assert.equal(await evaluate(`document.activeElement.id`),'version-toggle','native keyboard target is focused');
   await key('Enter','Enter',13);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),false);
   const metrics=await evaluate(`(()=>{const b=document.getElementById('version-toggle').getBoundingClientRect(),p=document.getElementById('version-panel').getBoundingClientRect();return {width:innerWidth,buttonWidth:b.width,buttonHeight:b.height,left:p.left,right:p.right,body:document.body.scrollWidth,root:document.documentElement.scrollWidth,expanded:document.getElementById('version-toggle').getAttribute('aria-expanded')};})()`);
   assert.equal(metrics.width,width);assert.ok(metrics.buttonWidth>=44&&metrics.buttonHeight>=44);assert.ok(metrics.left>=0&&metrics.right<=width+1&&metrics.body<=width+1&&metrics.root<=width+1);assert.equal(metrics.expanded,'true');
   await evaluate(`document.querySelector('#version-panel a').focus()`);await key('Escape','Escape',27);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),true);
   assert.equal(await evaluate(`document.activeElement.id`),'version-toggle');
   await key(' ','Space',32);assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),false);
   await key('Escape','Escape',27);assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),true);
   assert.equal(await evaluate(`JSON.stringify({value:document.querySelector('.portfolio-value').textContent,sources:[...document.querySelectorAll('.trust-cell span')].map(x=>x.textContent),decision:document.querySelector('[data-decision-owner]').textContent})`),before);
   console.log('V11_HISTORY_WIDTH',width,JSON.stringify(metrics));
  });
 }
});
