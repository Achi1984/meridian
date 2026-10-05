import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK as LOCK} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

const execFileAsync=promisify(execFile);
const BINANCE='https://data.binance.vision';
const OKX='https://www.okx.com';
const HOUR=60*60*1000, FUNDING=8*HOUR, RESERVE=26*HOUR;
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const iso=x=>new Date(x).toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function requirePrecontractState(){
  if(LOCK.ruleset!=='CROSS-VENUE-FUNDING-EDGE-V2'||LOCK.stage!=='PREREGISTERED'||LOCK.sourceAudit!==false)
    throw new Error('V2_BOUNDARY_PROBE_REQUIRES_PREREGISTERED_SOURCE_LOCKED_STATE');
}
async function fetchRetry(url,attempts=4){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MERIDIAN-Cross-Venue-V2-Boundary-Probe/1.0'},signal:AbortSignal.timeout(30000)});
      if(r.ok)return r;
      last=new Error('HTTP '+r.status+' '+url);
      if(![418,429,500,502,503,504].includes(r.status))throw last;
    }catch(e){last=e}
    if(i<attempts-1)await sleep(750*(i+1));
  }
  throw last;
}
async function unzipText(bytes,name){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meridian-v2-boundary-')),zip=path.join(dir,name);
  try{
    await fs.writeFile(zip,bytes);
    const result=await execFileAsync('unzip',['-p',zip],{maxBuffer:64*1024*1024});
    return result.stdout;
  }finally{await fs.rm(dir,{recursive:true,force:true})}
}
function strictTs(x,label){
  if(!(typeof x==='string'||typeof x==='number')||String(x).trim()===''||!(/^-?\d+$/.test(String(x).trim())))
    throw new Error(label+'_INVALID_TIMESTAMP');
  const n=Number(String(x).trim());
  if(!Number.isSafeInteger(n)||n<=0)throw new Error(label+'_INVALID_TIMESTAMP');
  return n;
}
async function binanceZip(rel,name){
  const pair=await Promise.all([fetchRetry(BINANCE+'/'+rel),fetchRetry(BINANCE+'/'+rel+'.CHECKSUM')]);
  const bytes=Buffer.from(await pair[0].arrayBuffer()),checksumText=(await pair[1].text()).trim();
  const match=checksumText.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
  if(!match||path.basename(match[2].trim())!==name)throw new Error('BINANCE_CHECKSUM_FORMAT '+rel);
  const expected=match[1].toLowerCase(),actual=sha256(bytes);
  if(expected!==actual)throw new Error('BINANCE_CHECKSUM_MISMATCH '+rel);
  return{csv:await unzipText(bytes,name),sha256:expected,rel};
}
function latestBinanceFundingTs(csv){
  const lines=String(csv||'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length)throw new Error('BINANCE_FUNDING_EMPTY');
  const first=lines[0].split(',').map(x=>x.trim()),lower=first.map(x=>x.toLowerCase());
  let ti=0,data=lines;
  if(!/^\d/.test(lines[0])){
    ti=lower.indexOf('calc_time');if(ti<0)ti=lower.indexOf('fundingtime');
    if(ti<0)throw new Error('BINANCE_FUNDING_SCHEMA');
    data=lines.slice(1);
  }
  return Math.max(...data.map(line=>strictTs(line.split(',')[ti],'BINANCE_FUNDING')));
}
function latestBinanceMarkTs(csv){
  const lines=String(csv||'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean).filter(x=>/^\d/.test(x));
  if(!lines.length)throw new Error('BINANCE_MARK_EMPTY');
  return Math.max(...lines.map(line=>strictTs(line.split(',')[0],'BINANCE_MARK')));
}
function dayStamp(ms){return new Date(ms).toISOString().slice(0,10)}
async function latestBinanceMonthly(kind){
  const now=new Date();
  for(let off=0;off<4;off++){
    const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-off,1));
    const ym=d.toISOString().slice(0,7);
    const stem=kind==='funding'?'BTCUSDT-fundingRate-'+ym:'BTCUSDT-1h-'+ym;
    const rel=kind==='funding'
      ?'data/futures/um/monthly/fundingRate/BTCUSDT/'+stem+'.zip'
      :'data/futures/um/monthly/markPriceKlines/BTCUSDT/1h/'+stem+'.zip';
    try{
      const a=await binanceZip(rel,stem+'.zip');
      return{time:kind==='funding'?latestBinanceFundingTs(a.csv):latestBinanceMarkTs(a.csv),receipt:{scope:'monthly',month:ym,rel:a.rel,sha256:a.sha256}};
    }catch(e){
      if(!String(e&&e.message||'').includes('HTTP 404'))throw e;
    }
  }
  throw new Error('BINANCE_'+kind.toUpperCase()+'_MONTHLY_ARCHIVE_NOT_FOUND');
}
async function latestBinanceDailyMark(){
  const today=Math.floor(Date.now()/(24*HOUR))*24*HOUR;
  for(let back=1;back<=14;back++){
    const ds=dayStamp(today-back*24*HOUR);
    const stem='BTCUSDT-1h-'+ds;
    const rel='data/futures/um/daily/markPriceKlines/BTCUSDT/1h/'+stem+'.zip';
    try{
      const a=await binanceZip(rel,stem+'.zip');
      return{time:latestBinanceMarkTs(a.csv),receipt:{scope:'daily',date:ds,rel:a.rel,sha256:a.sha256}};
    }catch(e){
      if(!String(e&&e.message||'').includes('HTTP 404'))throw e;
    }
  }
  return latestBinanceMonthly('marks');
}
function stableOkxMarketData(data){
  return (Array.isArray(data)?data:[]).map(x=>{const y={...(x||{})};delete y.ts;return y});
}
async function okxJson(endpoint,params={}){
  const u=new URL(OKX+endpoint);
  for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,String(v));
  const r=await fetchRetry(u.toString());
  const json=JSON.parse(await r.text());
  if(String(json&&json.code)!=='0')throw new Error('OKX_API '+(json&&json.code)+' '+(json&&json.msg));
  const stable=endpoint==='/api/v5/public/market-data-history'?stableOkxMarketData(json&&json.data):((json&&json.data)??null);
  return{json,receipt:{endpoint,params:Object.fromEntries([...u.searchParams]),sha256:sha256(JSON.stringify(stable))}};
}
function monthAtOffset(offset){
  const now=new Date();
  const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-offset,1));
  return{ym:d.toISOString().slice(0,7)};
}
async function latestOkxFundingArchive(){
  for(let off=0;off<4;off++){
    const info=monthAtOffset(off),ym=info.ym;
    const calendarTs=Date.parse(ym+'-01T00:00:00+08:00');
    const page=await okxJson('/api/v5/public/market-data-history',{
      module:3,instType:'SWAP',dateAggrType:'monthly',begin:calendarTs,end:calendarTs,instFamilyList:'BTC-USDT'
    });
    const groups=(page.json&&page.json.data||[]).flatMap(x=>(x&&x.details||[]).flatMap(d=>d&&d.groupDetails||[]));
    const filename='BTC-USDT-SWAP-fundingrates-'+ym+'.zip';
    const file=groups.find(x=>x&&x.filename===filename);
    if(!file||!file.url)continue;
    const response=await fetchRetry(file.url),bytes=Buffer.from(await response.arrayBuffer());
    const digest=sha256(bytes),csv=await unzipText(bytes,filename);
    const lines=String(csv||'').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const header=(lines[0]||'').split(',').map(x=>x.trim().toLowerCase());
    if(header.join(',')!=='instrument_name,funding_rate,funding_time')throw new Error('OKX_FUNDING_ARCHIVE_SCHEMA');
    const times=lines.slice(1).map(line=>{
      const r=line.split(',').map(x=>x.trim());
      if(r.length!==3||r[0]!=='BTC-USDT-SWAP')throw new Error('OKX_FUNDING_ARCHIVE_SCHEMA');
      return strictTs(r[2],'OKX_FUNDING');
    });
    if(!times.length)throw new Error('OKX_FUNDING_ARCHIVE_EMPTY');
    return{
      time:Math.max(...times),
      receipt:{month:ym,filename,url:file.url,dateTs:Number(file.dateTs??file.dataTs),sha256:digest,query:page.receipt}
    };
  }
  throw new Error('OKX_RECENT_FUNDING_ARCHIVE_NOT_FOUND');
}
async function latestOkxConfirmedMark(){
  const page=await okxJson('/api/v5/market/history-mark-price-candles',{instId:'BTC-USDT-SWAP',bar:'1H',limit:100});
  const confirmed=(page.json&&page.json.data||[]).filter(x=>Array.isArray(x)&&String(x[5])==='1').map(x=>strictTs(x[0],'OKX_MARK'));
  if(!confirmed.length)throw new Error('OKX_MARK_NO_CONFIRMED_ROWS');
  return{time:Math.max(...confirmed),receipt:page.receipt};
}
function scheduledAtOrBefore(ms){return Math.floor(ms/FUNDING)*FUNDING}

requirePrecontractState();
const all=await Promise.all([latestBinanceMonthly('funding'),latestBinanceDailyMark(),latestOkxFundingArchive(),latestOkxConfirmedMark()]);
const bf=all[0],bm=all[1],of=all[2],om=all[3];
const fundingCoverageEnd=Math.min(bf.time,of.time);
const markCoverageEnd=Math.min(bm.time,om.time);
const coverageEnd=Math.min(fundingCoverageEnd,markCoverageEnd);
const decisionWindowEnd=scheduledAtOrBefore(coverageEnd-RESERVE);
const result={
  schema:'CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-PROBE-1',
  researchOnly:true,
  executionImpact:false,
  sourceAudit:false,
  strategyPnlCalculated:false,
  ratesEmitted:false,
  pricesEmitted:false,
  checkedAt:new Date().toISOString(),
  funding:{binanceEnd:iso(bf.time),okxEnd:iso(of.time),fundingCoverageEnd:iso(fundingCoverageEnd)},
  marks:{binanceEnd:iso(bm.time),okxEnd:iso(om.time),markCoverageEnd:iso(markCoverageEnd)},
  coverageEnd:iso(coverageEnd),
  decisionWindowEnd:iso(decisionWindowEnd),
  decisionReserveHours:26,
  provenance:{binanceFunding:bf.receipt,binanceMarks:bm.receipt,okxFunding:of.receipt,okxMarks:om.receipt}
};
console.log(JSON.stringify(result,null,2));
