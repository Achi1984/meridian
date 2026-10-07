import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

const ROOT=process.cwd();
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'R131 browser acceptance requires Chrome/Chromium');
const SYMBOLS=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];
const SPAN={'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value))};
const base=s=>({BTC:80000,ETH:2600,SOL:120,XRP:1.5,HBAR:.09,PEPE:.0000045,DOT:1.2,ADA:.25,SUI:1.2,AVAX:11,LINK:14,XLM:.21,TRX:.33,WIF:.24}[s]||100);
const barInterval=b=>({'15m':'15m','1H':'1h','4H':'4h','1D':'1d'}[b]||b);
function rows(symbol,interval,limit,now=Date.now()){
  const span=SPAN[interval]||60000,n=Math.max(40,Math.min(300,Number(limit)||160)),p=base(symbol);
  return Array.from({length:n},(_,i)=>{const openTime=now-(n-i)*span,close=p*(1+(i-n/2)*.0002);return{openTime,closeTime:openTime+span-1,high:close*1.003,low:close*.997,close}});
}
function dashboard(caseName){
  const now=Date.now(),age=caseName==='pwa-resume'?896000:1000,updatedAt=new Date(now-age).toISOString(),buffer=caseName==='expiry'?8:25;
  return{
    pionexBotSync:{status:'DISABLED_MISSING_CREDENTIALS'},
    pionexAccountSync:{status:'OK',updatedAt},
    pionexAccount:{updatedAt,snapshotAt:updatedAt,walletStatus:'OK',wallet:{totalInUsdt:1000},walletBotRisk:{updatedAt,snapshotAt:updatedAt,source:'R131_BROWSER_QA',detailsComplete:true,supportedRows:1,normalizedRows:1,bots:[{id:'qa-btc-1',symbol:'BTCUSDT',side:'LONG',leverage:5,investmentUsd:100,totalProfitUsd:5,totalProfitPct:5,currentPrice:80000,breakEvenPrice:78000,liquidationPrice:73600,takeProfit:90000,liqBufferPct:buffer}]}},
    portfolio:{pionexEquityUsd:1000,pionexEquitySource:'R131_BROWSER_QA',pionexEquityUpdatedAt:new Date(updatedAt).toISOString(),holdings:[],manualVenueBalances:[]},
    market:{regime:'QA'}
  };
}
function marketFail(caseName,phase,symbol,interval){
  if(phase==='market-down'||phase==='down')return true;
  return caseName==='partial-btc'&&phase==='btc1d-fail'&&symbol==='BTC'&&interval==='1d';
}
function externalTarget(raw){
  try{
    const u=new URL(raw);
    if(u.hostname==='www.okx.com'&&u.pathname.includes('/market/candles'))return{symbol:String(u.searchParams.get('instId')||'BTC').split('-')[0],interval:barInterval(u.searchParams.get('bar')||'1h')};
    if(u.hostname==='fapi.binance.com'&&u.pathname.includes('/klines'))return{symbol:String(u.searchParams.get('symbol')||'BTCUSDT').replace(/USDT$/,''),interval:u.searchParams.get('interval')||'1h'};
  }catch{}
  return null;
}
async function external(res,u,caseName,phase){
  const raw=u.searchParams.get('url')||'',target=externalTarget(raw);
  if(target&&marketFail(caseName,phase,target.symbol,target.interval))return json(res,503,{error:'R131_QA_MARKET_DOWN'});
  if(phase==='slow')await sleep(120);
  let x;try{x=new URL(raw)}catch{return json(res,400,{error:'BAD_EXTERNAL_URL'})}
  if(x.hostname==='www.okx.com'&&x.pathname.includes('/market/candles')){
    const symbol=String(x.searchParams.get('instId')||'BTC').split('-')[0],interval=barInterval(x.searchParams.get('bar')||'1h'),limit=Number(x.searchParams.get('limit'))||160;
    return json(res,200,{code:'0',data:rows(symbol,interval,limit).map(r=>[String(r.openTime),'0',String(r.high),String(r.low),String(r.close),'0']).reverse()});
  }
  if(x.hostname==='www.okx.com'&&x.pathname.includes('/market/tickers'))return json(res,200,{code:'0',data:SYMBOLS.map(s=>({instId:s+'-USDT-SWAP',last:String(base(s))}))});
  if(x.hostname==='fapi.binance.com'&&x.pathname.includes('/klines')){
    const symbol=String(x.searchParams.get('symbol')||'BTCUSDT').replace(/USDT$/,''),interval=x.searchParams.get('interval')||'1h',limit=Number(x.searchParams.get('limit'))||160;
    return json(res,200,rows(symbol,interval,limit).map(r=>[r.openTime,'0',String(r.high),String(r.low),String(r.close),'0',r.closeTime]));
  }
  if(x.hostname==='fapi.binance.com'&&x.pathname.includes('/ticker/price'))return json(res,200,SYMBOLS.map(s=>({symbol:s+'USDT',price:String(base(s))})));
  if((x.hostname==='api.binance.com'||x.hostname==='data-api.binance.vision')&&x.pathname.includes('/api/v3/ticker/price'))return json(res,200,SYMBOLS.map(s=>({symbol:s+'USDT',price:String(base(s))})));
  return json(res,200,{});
}
async function browserRuntime(CASE){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),trace=[];
  window.MERIDIAN_V10=true;
  window.MERIDIAN_V9_CONFIG={apiBase:location.origin};
  window.__qaPhase=sessionStorage.getItem('r131.qa.stage')==='after'?'down':'initial';
  window.__qaCounts={dashboard:0,market:0,external:0};
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init={})=>{
    const raw=typeof input==='string'?input:input.url,u=new URL(raw,location.href),headers=new Headers(init.headers||(input instanceof Request?input.headers:undefined));
    headers.set('x-meridian-qa-case',CASE);headers.set('x-meridian-qa-phase',window.__qaPhase||'initial');
    let target=raw;
    if(u.pathname==='/api/private/dashboard')window.__qaCounts.dashboard++;
    if(u.pathname==='/api/private/market-klines')window.__qaCounts.market++;
    if(['api.binance.com','data-api.binance.vision','www.okx.com','fapi.binance.com'].includes(u.hostname)){window.__qaCounts.external++;target=location.origin+'/__external?url='+encodeURIComponent(u.toString())}
    return nativeFetch(target,{...init,headers});
  };
  const bridge=()=>window.MERIDIAN_V10_BRIDGE,state=()=>bridge()?.getState?.();
  window.addEventListener('meridian:data',()=>{const s=state();if(s)queueMicrotask(()=>trace.push({bot:s.botRefreshStatus,market:s.marketSyncStatus,mktText:document.getElementById('market-status')?.textContent||'',botText:document.getElementById('data-status')?.textContent||''}))});
  const waitFor=async(fn,timeout=16000)=>{const start=Date.now();while(Date.now()-start<timeout){try{if(fn())return}catch{}await sleep(25)}throw new Error('WAIT_TIMEOUT '+CASE)};
  const finish=(checks,detail={})=>{const report={case:CASE,ok:Object.values(checks).every(Boolean),checks,detail,trace:trace.slice(-24)};const p=document.createElement('pre');p.id='r131-browser-qa-report';p.hidden=true;p.textContent=JSON.stringify(report);document.body.appendChild(p)};
  const ready=()=>{const s=state();return !!s&&s.botRefreshStatus==='OK'&&s.marketSyncStatus==='OK'&&s.botFeedTimestampTrusted===true&&s.intel?.updatedAt};
  const idle=()=>{const s=state();return !!s&&s.botRefreshStatus!=='RUNNING'&&s.marketSyncStatus!=='RUNNING'};
  const reset=()=>{window.__qaCounts={dashboard:0,market:0,external:0}};
  try{
    await import('/v9/v9.js?qa=r131');
    await import('/v10/v10.js?qa=r131');
    if(CASE==='cold-reload'&&sessionStorage.getItem('r131.qa.stage')==='after'){
      await waitFor(()=>idle()&&state().botRefreshStatus==='ERROR'&&state().marketSyncStatus==='ERROR');
      const s=state();const checks={noMarketRevival:s.intel===null&&Object.keys(s.assetIntel||{}).length===0,noBotRevival:s.botFeedUpdatedAt==null&&s.botFeedTimestampTrusted===false&&s.lastGoodBotSnapshot==null,referenceNotZero:Array.isArray(s.bots)&&s.bots.length>0};
      sessionStorage.removeItem('r131.qa.stage');finish(checks,{botRows:s.bots.length,botStatus:s.botRefreshStatus,marketStatus:s.marketSyncStatus});return;
    }
    await waitFor(ready);
    if(CASE==='refresh'){
      const s=state();finish({botRunningSeen:trace.some(x=>x.bot==='RUNNING'),marketRunningSeen:trace.some(x=>x.market==='RUNNING'),completedOk:s.botRefreshStatus==='OK'&&s.marketSyncStatus==='OK',trustedAges:Date.now()-Number(s.botFeedUpdatedAt)>=0&&Date.now()-Number(s.botFeedUpdatedAt)<=15*60*1000&&Date.now()-Number(s.intel.updatedAt)>=0&&Date.now()-Number(s.intel.updatedAt)<=3*60*1000},{botAge:Date.now()-Number(s.botFeedUpdatedAt),marketAge:Date.now()-Number(s.intel.updatedAt)});
    }else if(CASE==='partial-btc'){
      const before={global:state().intel.updatedAt,btc:state().assetIntel.BTC.updatedAt,eth:state().assetIntel.ETH.updatedAt,price:state().intel.price};
      await sleep(80);window.__qaPhase='btc1d-fail';await bridge().refreshNow();await waitFor(idle);const s=state();
      finish({partial:s.marketSyncStatus==='PARTIAL'&&String(s.marketError||'').includes('BTC'),btcLastGood:s.intel.updatedAt===before.global&&s.assetIntel.BTC.updatedAt===before.btc&&s.intel.price===before.price,altAdvanced:Number(s.assetIntel.ETH.updatedAt)>Number(before.eth),timestampHonest:Number(s.intel.updatedAt)>0&&Date.now()-Number(s.intel.updatedAt)>0},{before,after:{global:s.intel.updatedAt,btc:s.assetIntel.BTC.updatedAt,eth:s.assetIntel.ETH.updatedAt},error:s.marketError});
    }else if(CASE==='expiry'){
      const old=state().intel.updatedAt;await sleep(5000);window.__qaPhase='market-down';await bridge().refreshNow();await waitFor(idle);bridge().refreshCurrentView();await sleep(40);const s=state(),text=document.getElementById('view-command')?.textContent||'';
      finish({marketExpired:Date.now()-Number(old)>3*60*1000&&s.intel.updatedAt===old&&s.marketSyncStatus==='ERROR',noMomentum:!text.includes('MOMENTUM WATCH'),liquidationSurvives:text.includes('LIQ-PUFFER PRÜFEN')&&bridge().helpers.botFeedFresh()===true},{age:Date.now()-Number(old),action:text.match(/NEXT ACTION[\s\S]{0,180}/)?.[0]||'',marketError:s.marketError});
    }else if(CASE==='overlap'){
      window.__qaPhase='slow';reset();await Promise.all([bridge().refreshNow(),bridge().refreshNow()]);await waitFor(idle);const s=state();
      finish({singleDashboardBurst:window.__qaCounts.dashboard===1,boundedMarketBurst:window.__qaCounts.market>0&&window.__qaCounts.market<60,consistentFinal:s.botRefreshStatus==='OK'&&s.marketSyncStatus==='OK'&&!s.error},{counts:window.__qaCounts,status:{bot:s.botRefreshStatus,market:s.marketSyncStatus}});
    }else if(CASE==='visibility'){
      const old=state().intel.updatedAt;await sleep(5000);window.dispatchEvent(new CustomEvent('meridian:data'));await sleep(50);const staleBefore=(document.getElementById('market-status')?.textContent||'').includes('STALE')||Date.now()-Number(old)>3*60*1000;
      window.__qaPhase='market-down';reset();document.dispatchEvent(new Event('visibilitychange'));await waitFor(()=>window.__qaCounts.dashboard>=1&&idle());const s=state();
      finish({staleVisibleFirst:staleBefore,oneVisibilityRefresh:window.__qaCounts.dashboard===1,evidenceAgeNotReset:s.intel.updatedAt===old&&Date.now()-Number(s.intel.updatedAt)>3*60*1000},{counts:window.__qaCounts,marketText:document.getElementById('market-status')?.textContent||'',age:Date.now()-Number(old)});
    }else if(CASE==='cold-reload'){
      sessionStorage.setItem('r131.qa.stage','after');location.reload();
    }else if(CASE==='pwa-resume'){
      const oldBot=state().botFeedUpdatedAt,oldMarket=state().intel.updatedAt;await sleep(5000);const splitBefore=bridge().helpers.botFeedFresh()===false&&Date.now()-Number(oldMarket)<3*60*1000;
      window.__qaPhase='down';reset();document.dispatchEvent(new Event('visibilitychange'));await waitFor(()=>window.__qaCounts.dashboard>=1&&idle());const s=state();
      finish({independentThresholds:splitBefore&&bridge().helpers.botFeedFresh()===false&&Date.now()-Number(s.intel.updatedAt)<3*60*1000,botEvidenceNotRenewed:s.botFeedUpdatedAt===oldBot&&Date.now()-Number(oldBot)>15*60*1000,marketEvidenceNotInvented:s.intel.updatedAt===oldMarket,oneResumeRefresh:window.__qaCounts.dashboard===1},{counts:window.__qaCounts,botAge:Date.now()-Number(oldBot),marketAge:Date.now()-Number(oldMarket)});
    }else throw new Error('UNKNOWN_CASE '+CASE);
  }catch(error){finish({exception:false},{error:String(error?.stack||error)})}
}
function harness(caseName){
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R131 Browser QA</title></head><body><div id="app"><header><div id="market-status">● MKT SYNC</div><div id="data-status">● BOT REF</div><button id="refresh-feeds">UPDATE</button></header><main><section id="view-command" class="view active"></section><section id="view-depot" class="view"></section><section id="view-bots" class="view"></section><section id="view-market" class="view"></section><section id="view-research" class="view"></section><section id="view-asset-detail" class="view"></section><section id="view-paper" class="view"></section><section id="view-more" class="view"></section></main><nav id="nav"><button data-v="command" class="active">COMMAND</button><button data-v="depot">DEPOT</button><button data-v="bots">BOTS</button><button data-v="market">FORECAST</button><button data-v="research">SCANNER</button></nav></div><script type="module">('+browserRuntime.toString()+')('+JSON.stringify(caseName)+')</script></body></html>';
}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1'),caseName=String(req.headers['x-meridian-qa-case']||u.searchParams.get('case')||'refresh'),phase=String(req.headers['x-meridian-qa-phase']||'initial');
  if(u.pathname==='/__r131'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(harness(caseName))}
  if(u.pathname==='/api/private/dashboard'){if(phase==='down')return json(res,503,{error:'R131_QA_DASHBOARD_DOWN'});if(phase==='slow')await sleep(250);return json(res,200,dashboard(caseName))}
  if(u.pathname==='/api/private/portfolio-history')return json(res,200,{source:'R131_BROWSER_QA',points:[]});
  if(u.pathname==='/api/private/market-klines'){
    const symbol=String(u.searchParams.get('symbol')||'BTC').toUpperCase(),interval=String(u.searchParams.get('interval')||'1h'),limit=Number(u.searchParams.get('limit'))||160;
    if(marketFail(caseName,phase,symbol,interval))return json(res,503,{error:'R131_QA_MARKET_DOWN'});
    if(phase==='slow')await sleep(120);const age=caseName==='expiry'||caseName==='visibility'?176000:1000;
    return json(res,200,{ok:true,rows:rows(symbol,interval,limit),source:'R131_BROWSER_QA',fetchedAt:Date.now()-age,ageMs:age,cache:'MISS'});
  }
  if(u.pathname==='/__external')return external(res,u,caseName,phase);
  const rel=decodeURIComponent(u.pathname).replace(/^\/+/,'')||'index.html',file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('not found')}
  res.writeHead(200,{'content-type':TYPES[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
});
async function chromeCase(origin,name){
  const profile=path.join('/tmp','meridian-r131-browser-'+process.pid+'-'+name),args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--run-all-compositor-stages-before-draw','--force-device-scale-factor=1','--window-size=390,844','--virtual-time-budget=22000','--user-data-dir='+profile,'--dump-dom',origin+'/__r131?case='+encodeURIComponent(name)],child=spawn(chrome,args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(name+' Chrome timeout'))},60000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',c=>{clearTimeout(timer);resolve(c)})}).finally(()=>fs.rmSync(profile,{recursive:true,force:true}));
  assert.equal(code,0,name+' Chrome exit '+code+': '+err.slice(-1500));const m=out.match(/<pre id="r131-browser-qa-report"[^>]*>([\s\S]*?)<\/pre>/);assert.ok(m,name+' report missing: '+err.slice(-1200));
  const report=JSON.parse(String(m[1]).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));assert.equal(report.ok,true,name+' failed: '+JSON.stringify(report));return report;
}

test('R131 production browser refresh and lifecycle acceptance',{timeout:180000},async t=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const address=server.address(),origin='http://127.0.0.1:'+address.port,cases=['refresh','partial-btc','expiry','overlap','visibility','cold-reload','pwa-resume'];
  try{for(const name of cases)await t.test(name,{timeout:60000},async()=>{const report=await chromeCase(origin,name);assert.ok(Object.values(report.checks).every(Boolean),JSON.stringify(report))})}
  finally{await new Promise(resolve=>server.close(()=>resolve()))}
});
