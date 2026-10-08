// MERIDIAN11-A0-CHROME-R1: real headless browser measurements on the static public preview.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const page=fileURLToPath(new URL('../v11/index.html',import.meta.url));
const source=readFileSync(page,'utf8');
const probe=`<style>html{width:100%;max-width:100%;}</style><script>
window.addEventListener('load',()=>{
document.querySelector('meta[name=viewport]').setAttribute('content','width=device-width,initial-scale=1');
const root=document.documentElement;root.style.width='\${width}px';root.style.maxWidth='\${width}px';
const out={width:root.getBoundingClientRect().width,body:document.body.scrollWidth,viewport:root.getBoundingClientRect().width,
nav:[],views:[],decision:document.querySelectorAll('[data-decision-owner]').length};
for(const b of document.querySelectorAll('#nav button')){
const label=b.querySelector('span:last-child');const s=getComputedStyle(label);
out.nav.push({name:b.dataset.v,font:parseFloat(s.fontSize),height:b.getBoundingClientRect().height,
fit:label.scrollWidth<=label.clientWidth+1,oneLine:label.getBoundingClientRect().height<=parseFloat(s.fontSize)*1.3});
b.click();out.views.push({name:b.dataset.v,visible:[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id),
current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(v=>v.dataset.v)});
}
document.body.setAttribute('data-v11-probe',encodeURIComponent(JSON.stringify(out)));
});
<\/script>`;
test('A0 Chrome: 320/375/390/430 viewport and five-view navigation', {timeout:120000},()=>{
assert.ok(chrome,'Chrome required for release evidence');
for(const width of [320,375,390,430]){
 const dir=mkdtempSync(join(tmpdir(),'v11-chrome-'));
 try{
  const html=join(dir,'index.html');
  writeFileSync(html,source.replace('</body>',probe+'</body>'));
  const run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--window-size='+width+',844','--hide-scrollbars','--force-device-scale-factor=1','--virtual-time-budget=1500',
   '--user-data-dir='+join(dir,'profile'),'--dump-dom','file://'+html],
   {encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
  assert.equal(run.status,0,'Chrome '+width+': '+String(run.stderr).slice(-500));
  const match=run.stdout.match(/data-v11-probe="([^"]+)"/);
  assert.ok(match,'missing browser measurement '+width);
  const x=JSON.parse(decodeURIComponent(match[1].replaceAll('&amp;','&')));
  console.log('V11_CHROME_WIDTH',width,JSON.stringify(x));
  assert.equal(x.width,width,'Emulated layout viewport must match requested mobile width');
  assert.ok(x.body<=x.viewport+1,'horizontal overflow '+width);
  assert.equal(x.decision,1);
  assert.equal(x.nav.length,5);
  for(const n of x.nav){assert.ok(n.fit&&n.oneLine,'clipped/wrapped label '+width+' '+n.name);assert.ok(n.font>=9);assert.ok(n.height>=44);}
  for(const v of x.views){assert.deepEqual(v.visible,['view-'+v.name]);assert.deepEqual(v.current,[v.name]);}
 }finally{rmSync(dir,{recursive:true,force:true});}
}
});
