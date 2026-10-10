// Real browser acceptance of the fixed candidate; no navigation into the terminal engine.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const adapter=fileURLToPath(new URL('../scripts/meridian-nav-packet.py',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/v11-terminal-preimage.html',import.meta.url));

async function interact(call){
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true});
  assert.ok(!r.exceptionDetails,'browser interaction evaluation failed');
  return r.result?.value;
 };
 const key=async(key,code,virtual)=>{
  await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
 };
 await call('Page.bringToFront');
 await evaluate(`(()=>{
  window.__meridianNavQA={start:location.href,activations:[],historyInitiallyHidden:document.getElementById('version-panel').hidden};
  document.addEventListener('click',event=>{
   const link=event.target.closest?.('a.terminal-entry-link');if(!link)return;
   event.preventDefault();
   window.__meridianNavQA.activations.push({trusted:event.isTrusted,href:link.getAttribute('href'),prevented:event.defaultPrevented});
  },true);
  return true;
 })()`);
 // Reach the anchor through actual keyboard traversal, not HTMLElement.click/focus.
 let reached=false;
 for(let step=0;step<12;step++){
  await key('Tab','Tab',9);
  if(await evaluate("document.activeElement?.matches('a.terminal-entry-link')")){reached=true;break;}
 }
 assert.ok(reached,'Terminal entry must be reachable by Tab');
 await evaluate(`(()=>{const s=getComputedStyle(document.activeElement);
  window.__meridianNavQA.keyboardFocus={visible:document.activeElement.matches(':focus-visible'),
   style:s.outlineStyle,width:parseFloat(s.outlineWidth)};return true;})()`);
 await key('Enter','Enter',13);
 const activation=await evaluate('window.__meridianNavQA.activations');
 assert.deepEqual(activation,[{trusted:true,href:'../v10/',prevented:true}], 'trusted Enter activation intercepted');
 assert.equal(await evaluate('location.href===window.__meridianNavQA.start'),true,'must not load terminal');
 // Existing history behavior uses native keyboard activation and Escape dismissal.
 await evaluate("document.getElementById('version-toggle').focus(); true");
 await key('Enter','Enter',13);
 const opened=await evaluate("!document.getElementById('version-panel').hidden && document.getElementById('version-toggle').getAttribute('aria-expanded')==='true'");
 assert.equal(opened,true,'history opens through Enter');
 await key('Escape','Escape',27);
 const closed=await evaluate("document.getElementById('version-panel').hidden && document.getElementById('version-toggle').getAttribute('aria-expanded')==='false' && document.activeElement.id==='version-toggle'");
 assert.equal(closed,true,'Escape closes history and restores focus');
 await evaluate(`window.__meridianNavQA.historyOpened=${JSON.stringify(opened)};window.__meridianNavQA.historyClosed=${JSON.stringify(closed)};true`);
}

const probe=`(()=>{
 const link=document.querySelector('a.terminal-entry-link'),rect=link.getBoundingClientRect(),style=getComputedStyle(link);
 const x={width:innerWidth,viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,
  root:document.documentElement.scrollWidth,dpr:devicePixelRatio,links:document.querySelectorAll('a.terminal-entry-link').length,
  label:link.textContent,href:link.getAttribute('href'),link:{width:rect.width,height:rect.height,left:rect.left,right:rect.right,
   visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility==='visible',
   outsideHiddenHistory:!link.closest('#version-panel')&&!link.closest('[hidden]')},
  qa:window.__meridianNavQA,stillAtCandidate:location.href===window.__meridianNavQA.start,views:[]};
 for(const button of document.querySelectorAll('#nav button')){
  button.click();x.views.push({name:button.dataset.v,
   visible:[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id),
   current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(v=>v.dataset.v),
   body:document.body.scrollWidth,root:document.documentElement.scrollWidth});
 }return x;
})()`;

test('fixed terminal-entry candidate: real mobile geometry, trusted keyboard and existing navigation',{timeout:180000},async()=>{
 if(typeof WebSocket!=='function'){
  assert.notEqual(process.env.MERIDIAN_NAV_CDP_CHILD,'1','WebSocket child remains unsupported');
  const childEnv={...process.env,MERIDIAN_NAV_CDP_CHILD:'1'};delete childEnv.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
   {encoding:'utf8',timeout:175000,env:childEnv});
  assert.equal(child.status,0,'Real-browser child failed: '+String(child.stdout).slice(-2400)+' '+String(child.stderr).slice(-1600));
  const lines=String(child.stdout).split('\n').filter(line=>line.includes('MERIDIAN_NAV_CDP_WIDTH'));
  assert.equal(lines.length,4,'four actual browser measurements required');
  for(const line of lines)console.log(line);
  return;
 }
 assert.ok(chrome,'Chrome binary required; browser acceptance cannot be skipped');
 const folder=mkdtempSync(join(tmpdir(),'meridian-nav-candidate-'));
 try{
  const page=join(folder,'v11','index.html');
  const generated=spawnSync('python3',['-c',
   'import importlib.util,pathlib,sys\nspec=importlib.util.spec_from_file_location("nav",sys.argv[1]);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)\nsource=pathlib.Path(sys.argv[2]).read_bytes().decode("utf-8")\nfiles=p.transform(source,{"label":"Terminal öffnen","href":"../v10/"})\nassert set(files)=={"v11/index.html"}\ntarget=pathlib.Path(sys.argv[3]);target.parent.mkdir(parents=True);target.write_bytes(files["v11/index.html"].encode("utf-8"))',
   adapter,fixture,page],{encoding:'utf8',timeout:10000});
  assert.equal(generated.status,0,'Candidate transformation failed: '+generated.stderr);
  for(const width of [320,375,390,430]){
   const x=await withMobileChrome(chrome,width,pathToFileURL(page).href,probe,interact);
   assert.equal(x.width,width);assert.equal(x.viewport,width);assert.equal(x.dpr,1);
   assert.ok(x.body<=width+1&&x.root<=width+1,'page overflow at '+width);
   assert.equal(x.links,1);assert.equal(x.label,'Terminal öffnen');assert.equal(x.href,'../v10/');
   assert.ok(x.link.visible&&x.link.outsideHiddenHistory,'link visible without history');
   assert.ok(x.link.width>=44&&x.link.height>=44,'minimum44px target');
   assert.ok(x.link.left>=0&&x.link.right<=width,'link within viewport');
   assert.ok(x.qa.keyboardFocus.visible&&x.qa.keyboardFocus.style!=='none'&&x.qa.keyboardFocus.width>=3,'visible keyboard outline');
   assert.deepEqual(x.qa.activations,[{trusted:true,href:'../v10/',prevented:true}]);
   assert.ok(x.qa.historyInitiallyHidden&&x.qa.historyOpened&&x.qa.historyClosed&&x.stillAtCandidate);
   assert.deepEqual(x.views.map(v=>v.name),['command','depot','bots','market','research']);
   for(const view of x.views){
    assert.deepEqual(view.visible,['view-'+view.name]);assert.deepEqual(view.current,[view.name]);
    assert.ok(view.body<=width+1&&view.root<=width+1,'view overflow '+view.name+' at '+width);
   }
   console.log('MERIDIAN_NAV_CDP_WIDTH',width,JSON.stringify(x));
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
