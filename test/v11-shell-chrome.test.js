// MERIDIAN11-CDP-TEST-R1: real mobile layout metrics via Chrome DevTools.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const page=process.env.V11_TEST_URL||'file://'+fileURLToPath(new URL('../v11/index.html',import.meta.url));
const probe=`(()=>{const x={width:innerWidth,viewport:document.documentElement.clientWidth,
body:document.body.scrollWidth,root:document.documentElement.scrollWidth,dpr:devicePixelRatio,
nav:[],views:[],decision:document.querySelectorAll('[data-decision-owner]').length,
decisionBackground:getComputedStyle(document.querySelector('.decision')).backgroundImage,
sourceLabels:[...document.querySelectorAll('.trust-cell span')].map(n=>n.textContent),
stateColor:getComputedStyle(document.querySelector('.preview-status strong')).color};
for(const b of document.querySelectorAll('#nav button')){
const l=b.querySelector('span:last-child'),s=getComputedStyle(l);
x.nav.push({name:b.dataset.v,font:parseFloat(s.fontSize),height:b.getBoundingClientRect().height,
fit:l.scrollWidth<=l.clientWidth+1,oneLine:l.getBoundingClientRect().height<=parseFloat(s.fontSize)*1.3});
b.click();x.views.push({name:b.dataset.v,color:getComputedStyle(b).color,
visible:[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id),
current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(v=>v.dataset.v),
body:document.body.scrollWidth,root:document.documentElement.scrollWidth});
}return x;})()`;
test('V11 Chrome CDP: true 320/375/390/430 mobile layout and navigation',{timeout:120000},async()=>{
if(typeof WebSocket!=='function'){
 const childEnv={...process.env,V11_CDP_CHILD:'1'};
 delete childEnv.NODE_TEST_CONTEXT;
 const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],{encoding:'utf8',timeout:115000,env:childEnv});
 assert.equal(child.status,0,'WebSocket-enabled Node child failed: '+String(child.stdout).slice(-1200)+' '+String(child.stderr).slice(-1200));
 const evidence=String(child.stdout).split('\n').filter(line=>line.includes('V11_CDP_WIDTH'));
 console.log('V11_CDP_CHILD_OUTPUT',String(child.stdout).slice(-1600));
 assert.equal(evidence.length,4,'Expected four actual CDP width measurements');
 for(const line of evidence)console.log(line);
 return;
}
assert.ok(chrome,'Chrome binary required');
for(const width of [320,375,390,430]){
 const x=await withMobileChrome(chrome,width,page,probe);
 console.log('V11_CDP_WIDTH',width,JSON.stringify(x));
 assert.equal(x.width,width,'real innerWidth');assert.equal(x.viewport,width,'real clientWidth');
 assert.equal(x.dpr,1);assert.ok(x.body<=width+1&&x.root<=width+1,'overflow '+width);
 assert.equal(x.decision,1);assert.equal(x.nav.length,5);
 assert.match(x.decisionBackground,/125deg.*rgb\(27, 53, 80\)/,'A1 gradient must survive CSS cascade');
 assert.deepEqual(x.sourceLabels,['Unbekannt','Unbekannt','Unbekannt'],'category colors do not verify sources');
 assert.equal(x.stateColor,'rgb(240, 202, 133)','A2 unknown-state color stays independent');
 const categoryColors={command:'rgb(169, 212, 255)',depot:'rgb(123, 182, 255)',bots:'rgb(46, 207, 154)',market:'rgb(182, 155, 255)',research:'rgb(212, 154, 255)'};
 for(const n of x.nav){
  assert.ok(n.fit&&n.oneLine,'wrapped/clipped label '+width+' '+n.name);
  assert.equal(n.font,10,'A1 label size '+width+' '+n.name);
  assert.ok(n.height>=44,'touch floor '+width+' '+n.name);
 }
 for(const v of x.views){
  assert.equal(v.color,categoryColors[v.name],'active category '+v.name);
  assert.deepEqual(v.visible,['view-'+v.name]);
  assert.deepEqual(v.current,[v.name]);
  assert.ok(v.body<=width+1&&v.root<=width+1,'view overflow '+width+' '+v.name);
 }
}
});

