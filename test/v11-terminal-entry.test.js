import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const terminal=readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const preimageBlob='5dc0fc4970f9c67a3c0d1a5e2467bf721566d5f3';
const css=`    /* Fixed packet A: visible terminal entry; no data or execution changes. */
    .terminal-entry{max-width:var(--container);margin:12px auto 0;display:flex;justify-content:flex-start;min-width:0}
    .terminal-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;max-width:100%;padding:10px 14px;border:1px solid #44607b;border-radius:10px;background:#142235;color:#d7e6f6;font-size:13px;line-height:1.5;font-weight:650;text-underline-offset:3px;overflow-wrap:anywhere}
    .terminal-entry-link:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}
`;
const entry=`    <nav class="terminal-entry" aria-label="Terminal-Zugang">
      <a class="terminal-entry-link" href="../v10/">Terminal öffnen</a>
    </nav>
`;
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));

function gitBlob(content){
  return createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
}

test('Terminal öffnen is the only source change and stays outside version history',()=>{
  assert.equal(css.trimEnd(),html.match(/    \/\* Fixed packet A:[\s\S]*?    \.terminal-entry-link:focus-visible\{[^\n]*\}\n/)?.[0]?.trimEnd());
  assert.equal(html.split(entry).length-1,1);
  const anchor=[...html.matchAll(/<a\b[^>]*class="terminal-entry-link"[^>]*>[\s\S]*?<\/a>/g)];
  assert.equal(anchor.length,1);
  assert.equal(anchor[0][0],'<a class="terminal-entry-link" href="../v10/">Terminal öffnen</a>');
  assert.ok(anchor[0].index<html.indexOf('<section id="version-panel"'));
  assert.match(html,/id="version-panel"[^>]* hidden/);
  const restored=html.replace(css,'').replace(entry,'');
  assert.equal(gitBlob(restored),preimageBlob,'all source bytes except the two approved insertions must be unchanged');
});

function deploymentServer(){
  const inlineScript=html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(inlineScript,'the actual v11 source has its known UI-only inline script');
  const scriptHash=createHash('sha256').update(inlineScript).digest('base64');
  const policies=new Map();
  const requests=[];
  const pages=new Map([
    ['/meridian/v11/',{body:html,scriptSource:`'sha256-${scriptHash}'`}],
    ['/meridian/v10/',{body:terminal,scriptSource:"'none'"}]
  ]);
  const server=createServer((request,response)=>{
    const path=new URL(request.url,'http://127.0.0.1').pathname;
    requests.push({method:request.method,path});
    const page=request.method==='GET'&&pages.get(path);
    if(!page){response.writeHead(404);response.end();return;}
    const policy=`default-src 'none'; script-src ${page.scriptSource}; style-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; manifest-src 'none'`;
    policies.set(path,policy);
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy});
    response.end(page.body);
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const base=`http://127.0.0.1:${server.address().port}/meridian/`;
      resolve({
        base,
        policies,
        requests,
        close:()=>new Promise((done,fail)=>{
          server.close(error=>error?fail(error):done());
          server.closeAllConnections();
        })
      });
    });
  });
}

async function browserRun(call,start,width,expectedBuild,server){
  const evaluate=async expression=>{
    const response=await call('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!response.exceptionDetails,'browser evaluation failed: '+JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const key=async(name,code,virtual)=>{
    const text=name==='Enter'?'\r':'';
    await call('Input.dispatchKeyEvent',{
      type:text?'keyDown':'rawKeyDown',key:name,code,text,unmodifiedText:text,
      windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual
    });
    await call('Input.dispatchKeyEvent',{
      type:'keyUp',key:name,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual
    });
  };
  const waitForUrl=async url=>{
    for(let attempt=0;attempt<100;attempt++){
      try{
        if(await evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==="complete"`))return;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.fail('browser did not finish navigation to '+url);
  };
  const state=()=>evaluate(`({
    views:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
    current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v),
    historyHidden:document.getElementById('version-panel').hidden,
    historyExpanded:document.getElementById('version-toggle').getAttribute('aria-expanded')
  })`);

  const initial=await evaluate(`(()=>{
    const link=document.querySelector('a.terminal-entry-link'),rect=link.getBoundingClientRect(),style=getComputedStyle(link);
    return {width:innerWidth,viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,
      root:document.documentElement.scrollWidth,count:document.querySelectorAll('a.terminal-entry-link').length,
      text:link.textContent,href:link.getAttribute('href'),height:rect.height,linkWidth:rect.width,
      visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility==='visible',
      outsideHistory:!link.closest('#version-panel')&&!link.closest('[hidden]'),
      historyHidden:document.getElementById('version-panel').hidden};
  })()`);
  assert.equal(initial.width,width);assert.equal(initial.viewport,width);
  assert.ok(initial.body<=width+1&&initial.root<=width+1,'initial page overflow at '+width);
  assert.equal(initial.count,1);assert.equal(initial.text,'Terminal öffnen');assert.equal(initial.href,'../v10/');
  assert.ok(initial.visible&&initial.outsideHistory&&initial.historyHidden,'entry is visible while history is closed');
  assert.ok(initial.height>=44&&initial.linkWidth>=44,'entry target is at least 44x44px');

  for(const tab of ['command','depot','bots','market','research']){
    await evaluate(`document.querySelector('#nav button[data-v="${tab}"]').focus();true`);
    await key('Enter','Enter',13);
    assert.deepEqual(await evaluate(`({
      view:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
      current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v)
    })`),{view:['view-'+tab],current:[tab]},'native Enter tab navigation: '+tab);
  }
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Enter','Enter',13);
  assert.equal(await evaluate(`!document.getElementById('version-panel').hidden`),true,'history opens with Enter');
  await key('Escape','Escape',27);
  assert.equal(await evaluate(`document.getElementById('version-panel').hidden&&document.activeElement.id==='version-toggle'`),true,
    'Escape closes history and restores focus');

  await evaluate(`document.querySelector('#nav button[data-v="depot"]').focus();true`);
  await key('Enter','Enter',13);
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Enter','Enter',13);
  const before=await state();
  assert.deepEqual(before,{views:['view-depot'],current:['depot'],historyHidden:false,historyExpanded:'true'});
  await key('Tab','Tab',9);
  assert.equal(await evaluate(`document.activeElement.matches('a.terminal-entry-link')`),true,
    'entry follows the history button in keyboard order');
  const focus=await evaluate(`(()=>{
    const style=getComputedStyle(document.activeElement);
    return {visible:document.activeElement.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth)};
  })()`);
  assert.ok(focus.visible&&focus.outline!=='none'&&focus.width>=3,'keyboard focus indicator is visible');
  await evaluate(`document.addEventListener('click',event=>{
    const link=event.target.closest?.('a.terminal-entry-link');
    if(link)sessionStorage.setItem('meridian-terminal-entry-proof',JSON.stringify({
      trusted:event.isTrusted,prevented:event.defaultPrevented,href:link.getAttribute('href')
    }));
  },true);true`);

  await key('Enter','Enter',13);
  const destination=new URL('../v10/',start).href;
  await waitForUrl(destination);
  const terminalState=await evaluate(`({
    url:location.href,title:document.title,
    build:document.querySelector('meta[name="meridian-build"]')?.content,
    root:!!document.querySelector('#app'),
    proof:JSON.parse(sessionStorage.getItem('meridian-terminal-entry-proof'))
  })`);
  assert.equal(terminalState.url,destination);assert.match(terminalState.title,/MERIDIAN v10/);
  assert.equal(terminalState.build,expectedBuild);assert.ok(terminalState.root,'actual v10 document was served');
  assert.deepEqual(terminalState.proof,{trusted:true,prevented:false,href:'../v10/'},
    'trusted Enter uses the uncancelled native anchor');
  assert.match(server.policies.get('/meridian/v10/'),/script-src 'none'/);
  assert.match(server.policies.get('/meridian/v10/'),/connect-src 'none'/);
  assert.match(server.policies.get('/meridian/v10/'),/worker-src 'none'/);
  const history=await call('Page.getNavigationHistory');
  const previewEntry=history.entries[history.currentIndex-1];
  assert.equal(previewEntry?.url,start,'v11 is the previous browser history entry');
  await call('Page.navigateToHistoryEntry',{entryId:previewEntry.id});
  await waitForUrl(start);
  assert.deepEqual(await state(),before,'browser Back restores the nondefault tab and open history');
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Escape','Escape',27);
  assert.equal(await evaluate(`document.getElementById('version-panel').hidden&&document.activeElement.id==='version-toggle'`),true,
    'history still closes with Escape after Back');
  assert.ok(server.requests.every(request=>request.path==='/meridian/v11/'||request.path==='/meridian/v10/'),
    'deployment serves only the actual v11 and v10 documents');
  return {width,terminal:terminalState,focus,before,backRestored:true};
}

test('actual v11 terminal entry works in Chrome on four mobile widths and safely reaches v10',{timeout:180000},async()=>{
  if(typeof WebSocket!=='function'){
    assert.notEqual(process.env.V11_TERMINAL_CDP_CHILD,'1','WebSocket-enabled child has no WebSocket');
    const env={...process.env,V11_TERMINAL_CDP_CHILD:'1'};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {encoding:'utf8',timeout:175000,env});
    assert.equal(child.status,0,'browser child failed: '+String(child.stdout).slice(-2500)+' '+String(child.stderr).slice(-1200));
    const results=String(child.stdout).split('\n').filter(line=>line.startsWith('V11_TERMINAL_WIDTH '));
    assert.equal(results.length,4,'expected actual Chrome results at all four widths');
    for(const result of results)console.log(result);
    return;
  }
  assert.ok(chrome,'Chrome binary required; browser acceptance cannot be skipped');
  const server=await deploymentServer();
  try{
    const start=server.base+'v11/';
    const expectedBuild=terminal.match(/<meta name="meridian-build" content="([^"]+)">/)?.[1];
    assert.ok(expectedBuild,'actual terminal build marker exists');
    for(const width of [320,375,390,430]){
      const result=await withMobileChrome(chrome,width,start,call=>browserRun(call,start,width,expectedBuild,server));
      console.log('V11_TERMINAL_WIDTH',JSON.stringify(result));
    }
  }finally{
    await server.close();
  }
});
