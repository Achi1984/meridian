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
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,844]]){
  await withMobileChrome(chrome,width,url,async call=>{
   const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
   const key=async(key,code,windowsVirtualKeyCode)=>{
    // Match the existing A2 native-key probe: Enter/Space need their text event payload.
    const text=key==='Enter'?'\r':key===' '?' ':null;
    await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(text===null?{}:{text,unmodifiedText:text})});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
   };
   const touch=async(x,y)=>{
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,radiusX:1,radiusY:1,force:1}]});
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   };
   await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenWidth:width,screenHeight:height});
   const before=await evaluate(`JSON.stringify({value:document.querySelector('.portfolio-value').textContent,sources:[...document.querySelectorAll('.trust-cell span')].map(x=>x.textContent),decision:document.querySelector('[data-decision-owner]').textContent})`);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),true);
   await evaluate(`document.getElementById('version-toggle').focus()`);
   assert.equal(await evaluate(`document.activeElement.id`),'version-toggle','native keyboard target is focused');
   await key('Enter','Enter',13);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),false);
   const metrics=await evaluate(`(()=>{const b=document.getElementById('version-toggle').getBoundingClientRect(),p=document.getElementById('version-panel').getBoundingClientRect(),c=document.getElementById('version-close').getBoundingClientRect();return {width:innerWidth,height:innerHeight,buttonWidth:b.width,buttonHeight:b.height,panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom,height:p.height},body:document.body.scrollWidth,root:document.documentElement.scrollWidth,close:{left:c.left,right:c.right,top:c.top,bottom:c.bottom,width:c.width,height:c.height},expanded:document.getElementById('version-toggle').getAttribute('aria-expanded')};})()`);
   assert.equal(metrics.width,width);assert.equal(metrics.height,height);assert.ok(metrics.buttonWidth>=44&&metrics.buttonHeight>=44);assert.ok(metrics.panel.left>=0&&metrics.panel.right<=width+1&&metrics.body<=width+1&&metrics.root<=width+1);assert.ok(metrics.close.width>=44&&metrics.close.height>=44&&metrics.close.left>=metrics.panel.left&&metrics.close.right<=metrics.panel.right&&metrics.close.top>=0&&metrics.close.bottom<=height);assert.equal(metrics.expanded,'true');
   const reachable=await evaluate(`(()=>{const p=document.getElementById('version-panel'),targets=[...p.querySelectorAll('.version-history-list li'),p.querySelector('p:last-child')],positions=[];for(const item of targets){item.scrollIntoView({block:'end'});const r=item.getBoundingClientRect();positions.push({top:r.top,bottom:r.bottom});}return {positions,body:document.body.scrollWidth,root:document.documentElement.scrollWidth};})()`);
   assert.equal(reachable.positions.length,4);assert.ok(reachable.positions.every(r=>r.top>=0&&r.bottom<=height),'all history entries and the closing note can be brought into the short viewport');assert.ok(reachable.body<=width+1&&reachable.root<=width+1);
   await evaluate(`window.scrollTo(0,0)`);
   await key('Tab','Tab',9);
   assert.equal(await evaluate(`document.activeElement.id`),'version-close','close control is keyboard reachable');
   await key('Enter','Enter',13);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),true);
   assert.equal(await evaluate(`document.activeElement.id`),'version-toggle','keyboard close restores focus');
   await key(' ','Space',32);
   const touchPoint=await evaluate(`(()=>{const r=document.getElementById('version-close').getBoundingClientRect();return {x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2)}})()`);
   assert.ok(touchPoint.y<height,'close control is visible for touch without scrolling');
   await touch(touchPoint.x,touchPoint.y);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),true,'touch closes the history panel');
   assert.equal(await evaluate(`document.activeElement.id`),'version-toggle','touch close restores focus');
   await key('Enter','Enter',13);
   assert.equal(await evaluate(`document.getElementById('version-panel').hidden`),false);
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
