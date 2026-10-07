import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';

const ROOT=process.cwd();
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'R132 browser acceptance requires actual Chrome/Chromium');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml'};
const widths=[320,375,390,430];

async function commandProbe(){
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const anomalies=[],counts=[],errors=[];
  window.addEventListener('error',e=>errors.push(String(e?.message||'browser error')));
  window.addEventListener('unhandledrejection',e=>errors.push(String(e?.reason||'rejection')));
  const finish=(ok,checks,detail={})=>{
    const out=document.createElement('pre');out.id='r132-browser-qa-report';out.hidden=true;
    out.textContent=JSON.stringify({ok,checks,detail,anomalies:anomalies.slice(0,15),errors:errors.slice(0,8)});
    document.body.appendChild(out);
  };
  const wait=async(fn,ms=11000)=>{
    const start=Date.now();while(Date.now()-start<ms){try{if(fn())return}catch{}await sleep(35)}
    throw Error('R132_BROWSER_WAIT_TIMEOUT');
  };
  const count=selector=>document.querySelectorAll('#view-command '+selector).length;
  const snapshot=()=>({
    owner:count('[data-command-decision-owner="r132"]'),
    portfolio:count('.command-portfolio-hero'),
    portfolioDetails:count('.command-portfolio-details'),
    sources:count('.command-source-details'),
    sourceAuthority:count('.command-source-details .portfolio-hero'),
    riskRows:count('.command-pro-risk-row')
  });
  const validate=(label)=>{
    const v=snapshot();counts.push(v);
    if(v.owner!==1||v.portfolio!==1||v.portfolioDetails!==1||v.sources!==1||v.sourceAuthority!==1||v.riskRows>3)
      anomalies.push(label+' '+JSON.stringify(v));
  };
  try{
    await wait(()=>document.querySelector('#view-command .command-pro-decision')&&document.documentElement.dataset.visualQaReady);
    const initial=snapshot();
    validate('initial');
    const initiallyCollapsed=document.querySelector('#view-command .command-source-details')?.open===false;
    const partialValue=document.querySelector('#view-command .command-portfolio-hero strong')?.textContent?.trim()==='—';
    const tabs=[...document.querySelectorAll('#nav button[data-v]')].map(x=>x.dataset.v);
    let focusRestored=0,sourcePreserved=0,openPreserved=0;
    const windows=['1h','1d','1w'];
    for(let i=0;i<20;i++){
      const details=document.querySelector('#view-command .command-portfolio-details');
      if(!details)throw Error('PORTFOLIO_DETAILS_MISSING_'+i);
      details.open=true;
      const key=windows[i%windows.length];
      const button=details.querySelector('[data-portfolio-range="'+key+'"]');
      if(!button)throw Error('RANGE_BUTTON_MISSING_'+key+'_'+i);
      button.click();
      await sleep(55);
      validate('range-'+i);
      const selected=document.querySelector('#view-command .command-portfolio-details [data-portfolio-range="'+key+'"]');
      if(!selected||selected.getAttribute('aria-pressed')!=='true')anomalies.push('RANGE_NOT_SELECTED_'+i);
      if(selected===document.activeElement)focusRestored++;
      if(document.querySelector('#view-command .command-portfolio-details')?.open)openPreserved++;
      if(i%4===0){
        const sources=document.querySelector('#view-command .command-source-details');
        sources.open=true;
        document.querySelector('#nav button[data-v="bots"]')?.click();
        await sleep(65);
        document.querySelector('#nav button[data-v="command"]')?.click();
        await sleep(95);
        validate('navigation-'+i);
        if(document.querySelector('#view-command .command-source-details')?.open)sourcePreserved++;
      }else{
        document.querySelector('#nav button[data-v="command"]')?.click();
        await sleep(65);
        validate('render-'+i);
      }
    }
    const decision=document.querySelector('#view-command .command-pro-decision');
    const portfolio=document.querySelector('#view-command .command-portfolio-hero');
    const urgent=decision?.classList.contains('tone-danger')===true;
    const priority=!urgent||!!(decision?.compareDocumentPosition(portfolio)&Node.DOCUMENT_POSITION_FOLLOWING);
    const riskButtons=[...document.querySelectorAll('#view-command .command-pro-risk-row>button')];
    const review=document.querySelector('#view-command .command-pro-review');
    const targets=[review,...riskButtons].filter(Boolean);
    const targetSizes=targets.map(x=>Math.round(x.getBoundingClientRect().height));
    const noOverflow=document.documentElement.scrollWidth<=window.innerWidth+1;
    const buttonsAccessible=targets.length>0&&targetSizes.every(h=>h>=44);
    const mode=new URLSearchParams(location.search).get('qaData')||'fresh';
    const staleGuard=mode!=='stale'||!(/NICHTS ZU TUN/.test(String(decision?.textContent||'')));
    const checks={
      initial:initial.owner===1&&initial.portfolio===1&&initial.portfolioDetails===1&&initial.sources===1&&initial.sourceAuthority===1,
      repeatedRenders:anomalies.length===0&&counts.length>=40,
      singleDecisionAndDisclosure:snapshot().owner===1&&snapshot().portfolioDetails===1&&snapshot().sources===1,
      rangeSelected:!anomalies.some(x=>x.startsWith('RANGE_NOT_SELECTED')),
      rangeFocus:focusRestored>=19,
      disclosureOpen:openPreserved>=19,
      sourceOpenAfterNavigation:sourcePreserved===5,
      provenanceCollapsedByDefault:initiallyCollapsed,
      unknownPortfolioNotZero:partialValue,
      criticalDominance:priority,
      riskRowsBounded:snapshot().riskRows<=3,
      fiveTabs:tabs.join(',')==='command,depot,bots,market,research',
      minimumTouchTarget:buttonsAccessible,
      noHorizontalOverflow:noOverflow,
      staleNotAllClear:staleGuard,
      noJavaScriptExceptions:errors.length===0
    };
    finish(Object.values(checks).every(Boolean),checks,{viewport:{width:innerWidth,height:innerHeight},mode,count:counts.length,focusRestored,openPreserved,sourcePreserved,targetSizes,last:snapshot(),urgent,scrollWidth:document.documentElement.scrollWidth});
  }catch(e){finish(false,{exception:false},{error:String(e?.stack||e),last:snapshot()})}
}

const innerScript='<script>('+commandProbe.toString()+')()</script>';
const outerScript='<script>(function(){let polls=0;const copy=()=>{polls++;const doc=document.querySelector("#qa-frame")?.contentDocument;const source=doc?.getElementById("r132-browser-qa-report");if(source?.textContent){if(!document.getElementById("r132-browser-qa-report")){const out=document.createElement("pre");out.id="r132-browser-qa-report";out.hidden=true;out.textContent=source.textContent;document.body.appendChild(out)}return}if(polls<700)setTimeout(copy,35)};setTimeout(copy,35)})()</script>';
const server=http.createServer((req,res)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname)}catch{res.writeHead(400);res.end();return}
  let full=path.resolve(ROOT,'.'+pathname);
  if(!full.startsWith(ROOT+path.sep)&&full!==ROOT){res.writeHead(403);res.end();return}
  try{if(fs.statSync(full).isDirectory())full=path.join(full,'index.html')}catch{res.writeHead(404);res.end();return}
  const mime=MIME[path.extname(full)]||'application/octet-stream';
  try{
    let body=fs.readFileSync(full);
    if(pathname==='/v10/'||pathname==='/v10/index.html'){
      body=Buffer.from(body.toString('utf8').replace('</body>',innerScript+'</body>'));
    }else if(pathname==='/v10/visual-qa-frame.html'){
      body=Buffer.from(body.toString('utf8').replace('</body>',outerScript+'</body>'));
    }
    res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});
    res.end(body);
  }catch{res.writeHead(404);res.end()}
});

function decode(s){return String(s).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>')}
async function runChrome(origin,width,mode){
  const tag=String(width)+'-'+mode,profile=fs.mkdtempSync(path.join(os.tmpdir(),'meridian-r132-'));
  const url=new URL('/v10/visual-qa-frame.html',origin);
  for(const [key,value] of Object.entries({visualQa:'1',qaView:'command',qaData:mode,qaWidth:String(width),qaHeight:width===320?'568':width===375?'667':'844',build:'r127'}))url.searchParams.set(key,value);
  const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--run-all-compositor-stages-before-draw','--force-device-scale-factor=1','--window-size=800,900','--virtual-time-budget=18000','--user-data-dir='+profile,'--dump-dom',url.toString()];
  const child=spawn(chrome,args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',s=>{stdout+=s;if(stdout.length>10*1024*1024)child.kill('SIGKILL')});
  child.stderr.on('data',s=>stderr+=s);
  try{
    const code=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Chrome timeout '+tag))},70000);
      child.on('error',e=>{clearTimeout(timer);reject(e)});
      child.on('close',n=>{clearTimeout(timer);resolve(n)});
    });
    assert.equal(code,0,tag+' Chrome exit '+code+': '+stderr.slice(-700));
    const m=stdout.match(/<pre id="r132-browser-qa-report"[^>]*>([\s\S]*?)<\/pre>/);
    assert.ok(m,tag+' report missing: '+stderr.slice(-600));
    return JSON.parse(decode(m[1]));
  }finally{fs.rmSync(profile,{recursive:true,force:true})}
}

test('R132 real Chrome Command Pro browser acceptance: 20 render/navigation cycles per viewport',{timeout:300000},async t=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    for(const width of widths){
      await t.test('responsive-'+width,{timeout:70000},async()=>{
        const r=await runChrome(origin,width,'fresh');
        assert.equal(r.ok,true,'R132 '+width+' '+JSON.stringify(r));
        assert.equal(r.detail?.viewport?.width,width,'actual iframe width');
      });
    }
    await t.test('stale-fail-closed',{timeout:70000},async()=>{
      const r=await runChrome(origin,390,'stale');
      assert.equal(r.ok,true,'R132 stale '+JSON.stringify(r));
    });
  }finally{await new Promise(resolve=>server.close(resolve))}
});
