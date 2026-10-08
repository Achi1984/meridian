// MERIDIAN11-CDP-TEST-R1: real mobile layout metrics via Chrome DevTools.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const page='file://'+fileURLToPath(new URL('../v11/index.html',import.meta.url));
const probe=`(()=>{const x={width:innerWidth,viewport:document.documentElement.clientWidth,
body:document.body.scrollWidth,root:document.documentElement.scrollWidth,dpr:devicePixelRatio,
nav:[],views:[],decision:document.querySelectorAll('[data-decision-owner]').length};
for(const b of document.querySelectorAll('#nav button')){
const l=b.querySelector('span:last-child'),s=getComputedStyle(l);
x.nav.push({name:b.dataset.v,font:parseFloat(s.fontSize),height:b.getBoundingClientRect().height,
fit:l.scrollWidth<=l.clientWidth+1,oneLine:l.getBoundingClientRect().height<=parseFloat(s.fontSize)*1.3});
b.click();x.views.push({name:b.dataset.v,
visible:[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id),
current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(v=>v.dataset.v),
body:document.body.scrollWidth,root:document.documentElement.scrollWidth});
}return x;})()`;
test('V11 Chrome CDP: true 320/375/390/430 mobile layout and navigation',{timeout:120000},async()=>{
if(typeof WebSocket!=='function'){
 const child=spawnSync(process.execPath,['--experimental-websocket','--test',fileURLToPath(import.meta.url)],{encoding:'utf8',timeout:115000,env:{...process.env,V11_CDP_CHILD:'1'}});
 assert.equal(child.status,0,'WebSocket-enabled Node child failed: '+String(child.stdout).slice(-1200)+' '+String(child.stderr).slice(-1200));
 return;
}
assert.ok(chrome,'Chrome binary required');
for(const width of [320,375,390,430]){
 const x=await withMobileChrome(chrome,width,page,probe);
 console.log('V11_CDP_WIDTH',width,JSON.stringify(x));
 assert.equal(x.width,width,'real innerWidth');assert.equal(x.viewport,width,'real clientWidth');
 assert.equal(x.dpr,1);assert.ok(x.body<=width+1&&x.root<=width+1,'overflow '+width);
 assert.equal(x.decision,1);assert.equal(x.nav.length,5);
 for(const n of x.nav){
  assert.ok(n.fit&&n.oneLine,'wrapped/clipped label '+width+' '+n.name);
  assert.ok(n.font>=9&&n.height>=44,'touch/label floor '+width+' '+n.name);
 }
 for(const v of x.views){
  assert.deepEqual(v.visible,['view-'+v.name]);
  assert.deepEqual(v.current,[v.name]);
  assert.ok(v.body<=width+1&&v.root<=width+1,'view overflow '+width+' '+v.name);
 }
}
});
