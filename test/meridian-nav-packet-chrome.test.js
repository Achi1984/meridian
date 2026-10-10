// Real browser acceptance, including actual local terminal navigation and browser Back.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const adapter=fileURLToPath(new URL('../scripts/meridian-nav-packet.py',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/v11-terminal-preimage.html',import.meta.url));
const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));

async function deploymentServer(candidate){
 const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(req.method,'GET');
   let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   assert.ok(path.startsWith('/meridian/'));
   path=path.slice('/meridian/'.length);
   assert.ok(!path.includes('\\')&&!path.split('/').some(part=>part.startsWith('.')));
   if(path.endsWith('/'))path+='index.html';
   const absolute=resolve(repositoryRoot,path);
   assert.ok(absolute.startsWith(resolve(repositoryRoot)+sep)&&types[extname(absolute)]);
   const bytes=path==='v11/index.html'?await readFile(candidate):await readFile(absolute);
   // Real terminal HTML/styles, but no terminal scripts, APIs or workers. This
   // checks navigation to the deployed document without booting its engine.
   const scripts=path.startsWith('v10/')?"'none'":"'self' 'unsafe-inline'";
   res.writeHead(200,{'Content-Type':types[extname(absolute)],
    'Content-Security-Policy':"default-src 'self' data: blob:; script-src "+scripts+"; style-src 'self' 'unsafe-inline'; connect-src 'none'; worker-src 'none'"});
   res.end(bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
 });
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 return {url:'http://127.0.0.1:'+server.address().port+'/meridian/v11/',
  close:()=>new Promise((ok,fail)=>{server.close(error=>error?fail(error):ok());server.closeAllConnections();})};
}

async function roundTrip(call,start,expectedBuild){
 const evaluate=async expression=>{
  const result=await call('Runtime.evaluate',{expression,returnByValue:true});
  assert.ok(!result.exceptionDetails,'round-trip browser evaluation failed');return result.result?.value;
 };
 const key=async(key,code,virtual)=>{
  const text=key==='Enter'?'\r':'';
  await call('Input.dispatchKeyEvent',{type:text?'keyDown':'rawKeyDown',key,code,text,unmodifiedText:text,
   windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
 };
 const wait=async(url)=>{
  for(let i=0;i<100;i++){
   // Navigation temporarily destroys execution contexts; no result is accepted
   // until the exact destination document is complete.
   try{if(await evaluate('location.href==='+JSON.stringify(url)+'&&document.readyState==="complete"'))return;}catch{}
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.fail('navigation did not finish at '+url);
 };
 const state=()=>evaluate(`({view:[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id),
  current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(v=>v.dataset.v),
  historyHidden:document.getElementById('version-panel').hidden,
  historyExpanded:document.getElementById('version-toggle').getAttribute('aria-expanded')})`);
 await call('Page.bringToFront');
 await evaluate('document.querySelector("#nav button[data-v=depot]").focus();true');
 await key('Enter','Enter',13);
 await evaluate('document.getElementById("version-toggle").focus();true');
 await key('Enter','Enter',13);
 const before=await state();
 assert.deepEqual(before,{view:['view-depot'],current:['depot'],historyHidden:false,historyExpanded:'true'});
 const initialHistory=await call('Page.getNavigationHistory');
 const previewEntry=initialHistory.entries[initialHistory.currentIndex];
 assert.equal(previewEntry.url,start);
 await evaluate(`(()=>{sessionStorage.removeItem('meridian-navigation-proof');
  document.querySelector('a.terminal-entry-link').addEventListener('click',event=>{
   sessionStorage.setItem('meridian-navigation-proof',JSON.stringify({trusted:event.isTrusted,
    prevented:event.defaultPrevented,href:event.currentTarget.getAttribute('href')}));
  },{once:true});return true;})()`);
 let reached=false;
 for(let i=0;i<16;i++){
  await key('Tab','Tab',9);
  if(await evaluate('document.activeElement?.matches("a.terminal-entry-link")')){reached=true;break;}
 }
 assert.ok(reached,'real destination anchor reachable by keyboard');
 await key('Enter','Enter',13); // No preventDefault, synthetic click or Page.navigate.
 const terminal=new URL('../v10/',start).href;
 await wait(terminal);
 const destination=await evaluate(`({url:location.href,title:document.title,
  build:document.querySelector('meta[name="meridian-build"]')?.content,
  engineNotStarted:typeof window.MERIDIAN_V10==='undefined',shell:!!document.querySelector('#app.v10-shell'),
  proof:JSON.parse(sessionStorage.getItem('meridian-navigation-proof'))})`);
 assert.equal(destination.url,terminal);assert.match(destination.title,/MERIDIAN v10/);
 assert.equal(destination.build,expectedBuild);assert.ok(destination.shell,'actual v10 document loaded');
 assert.ok(destination.engineNotStarted,'terminal scripts stay blocked by test-server policy');
 assert.deepEqual(destination.proof,{trusted:true,prevented:false,href:'../v10/'});
 const terminalHistory=await call('Page.getNavigationHistory');
 assert.equal(terminalHistory.entries[terminalHistory.currentIndex-1]?.id,previewEntry.id,'preview is preceding history entry');
 await call('Page.navigateToHistoryEntry',{entryId:previewEntry.id}); // Real browser Back, not a fresh URL load.
 await wait(start);
 const after=await state();assert.deepEqual(after,before,'Back restores nondefault preview tab and open history');
 assert.equal(await evaluate('document.querySelectorAll("a.terminal-entry-link").length'),1);
 // Back focus may return to the link; explicitly focus the existing history
 // toggle before checking it remains operable after returning.
 await evaluate('document.getElementById("version-toggle").focus();true');
 await key('Escape','Escape',27);
 assert.equal(await evaluate('document.getElementById("version-panel").hidden'),true,'history still dismisses after Back');
 const backHistory=await call('Page.getNavigationHistory');
 assert.equal(backHistory.entries[backHistory.currentIndex].id,previewEntry.id);
 return {destination:destination.url,build:destination.build,engineNotStarted:destination.engineNotStarted,
  trustedEnter:destination.proof,backRestored:true,before,after};
}

async function interact(call){
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true});
  assert.ok(!r.exceptionDetails,'browser interaction evaluation failed');
  return r.result?.value;
 };
 const key=async(key,code,virtual)=>{
  // Match Chrome/Puppeteer keyboard semantics: Enter carries a carriage-return
  // character so native buttons receive keypress; non-text keys use rawKeyDown.
  const text=key==='Enter'?'\r':'';
  await call('Input.dispatchKeyEvent',{type:text?'keyDown':'rawKeyDown',key,code,text,unmodifiedText:text,
   windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
 };
 await call('Page.bringToFront');
 await evaluate(`(()=>{
  window.__meridianNavQA={start:location.href,activations:[],historyActivations:[],keys:[],historyInitiallyHidden:document.getElementById('version-panel').hidden};
  for(const type of ['keydown','keypress','keyup'])document.addEventListener(type,event=>{
   window.__meridianNavQA.keys.push({type:event.type,key:event.key,target:event.target.id||event.target.className,trusted:event.isTrusted});
  },true);
  document.addEventListener('click',event=>{
   if(event.target.closest?.('#version-toggle'))window.__meridianNavQA.historyActivations.push({trusted:event.isTrusted});
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
 assert.equal(await evaluate("document.getElementById('version-toggle').focus(); document.activeElement.id"),'version-toggle','history button focused before key input');
 await key('Enter','Enter',13);
 const opened=await evaluate("!document.getElementById('version-panel').hidden && document.getElementById('version-toggle').getAttribute('aria-expanded')==='true'");
 const historyEvidence=await evaluate('({keys:window.__meridianNavQA.keys,clicks:window.__meridianNavQA.historyActivations})');
 assert.ok(historyEvidence.keys.some(e=>e.type==='keypress'&&e.key==='Enter'&&e.target==='version-toggle'&&e.trusted),
  'native button receives trusted Enter keypress: '+JSON.stringify(historyEvidence));
 assert.deepEqual(historyEvidence.clicks,[{trusted:true}],'one native history activation: '+JSON.stringify(historyEvidence));
 assert.equal(opened,true,'history opens through Enter: '+JSON.stringify(historyEvidence));
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
 const folder=mkdtempSync(join(tmpdir(),'meridian-nav-candidate-'));let deployment;
 try{
  const page=join(folder,'v11','index.html');
  const generated=spawnSync('python3',['-c',
   'import importlib.util,pathlib,sys\nspec=importlib.util.spec_from_file_location("nav",sys.argv[1]);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)\nsource=pathlib.Path(sys.argv[2]).read_bytes().decode("utf-8")\nfiles=p.transform(source,{"label":"Terminal öffnen","href":"../v10/"})\nassert set(files)=={"v11/index.html"}\ntarget=pathlib.Path(sys.argv[3]);target.parent.mkdir(parents=True);target.write_bytes(files["v11/index.html"].encode("utf-8"))',
   adapter,fixture,page],{encoding:'utf8',timeout:10000});
  assert.equal(generated.status,0,'Candidate transformation failed: '+generated.stderr);
  deployment=await deploymentServer(page);
  const expectedBuild=readFileSync(new URL('../v10/index.html',import.meta.url),'utf8').match(/name="meridian-build" content="([^"]+)"/)?.[1];
  assert.ok(expectedBuild,'real terminal build marker required');
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
   x.roundTrip=await withMobileChrome(chrome,width,deployment.url,call=>roundTrip(call,deployment.url,expectedBuild));
   console.log('MERIDIAN_NAV_CDP_WIDTH',width,JSON.stringify(x));
  }
 }finally{if(deployment)await deployment.close();rmSync(folder,{recursive:true,force:true});}
});

