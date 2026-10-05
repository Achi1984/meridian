import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {strictNum} from '../research/cross-venue-funding-edge-v2.js';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_SOURCE as CONTRACT,
  validateCrossVenueV2Source
} from '../research/cross-venue-funding-edge-v2-data-contract.js';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK as STAGE_LOCK} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

const execFileAsync=promisify(execFile);
const BINANCE_ARCHIVE='https://data.binance.vision';
const OKX_API='https://www.okx.com';
const START=Date.parse(CONTRACT.rawStart);
const FUNDING_END=Date.parse(CONTRACT.fundingCoverageEnd);
const MARK_END=Date.parse(CONTRACT.markCoverageEnd);
const HOUR=60*60*1000,DAY=24*HOUR;

const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dayStamp=ms=>new Date(ms).toISOString().slice(0,10);

export function assertV2SourceAuditAuthorized(lock=STAGE_LOCK){
  if(lock?.ruleset!=='CROSS-VENUE-FUNDING-EDGE-V2'||lock?.sourceAudit!==true)
    throw new Error('CROSS_VENUE_V2_SOURCE_AUDIT_LOCKED');
  return true;
}

function strictCsvNumber(value,label,{positive=false,integer=false}={}){
  const n=strictNum(value);
  if(!Number.isFinite(n)||(positive&&n<=0)||(integer&&!Number.isSafeInteger(n)))
    throw new Error(label);
  return n;
}

function splitLines(csv){
  return String(csv??'').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}

export function parseBinanceMarkCsv(csv){
  const lines=splitLines(csv);
  if(!lines.length)return[];
  const data=/^\d/.test(lines[0])?lines:lines.slice(1);
  return data.map(line=>{
    const r=line.split(',').map(x=>x.trim());
    if(r.length<5)throw new Error('BINANCE_MARK_ARCHIVE_SCHEMA');
    return{
      openTime:strictCsvNumber(r[0],'BINANCE_MARK_ARCHIVE_ROW',{positive:true,integer:true}),
      open:strictCsvNumber(r[1],'BINANCE_MARK_ARCHIVE_ROW',{positive:true}),
      high:strictCsvNumber(r[2],'BINANCE_MARK_ARCHIVE_ROW',{positive:true}),
      low:strictCsvNumber(r[3],'BINANCE_MARK_ARCHIVE_ROW',{positive:true}),
      close:strictCsvNumber(r[4],'BINANCE_MARK_ARCHIVE_ROW',{positive:true}),
      confirmed:true
    };
  });
}

export function parseBinanceFundingCsv(csv){
  const lines=splitLines(csv);
  if(!lines.length)return[];
  const first=lines[0].split(',').map(x=>x.trim()),lower=first.map(x=>x.toLowerCase());
  let ti=0,ri=2,data=lines;
  if(!/^\d/.test(lines[0])){
    ti=lower.indexOf('calc_time');if(ti<0)ti=lower.indexOf('fundingtime');
    ri=lower.indexOf('last_funding_rate');if(ri<0)ri=lower.indexOf('fundingrate');
    if(ti<0||ri<0)throw new Error('BINANCE_FUNDING_ARCHIVE_SCHEMA');
    data=lines.slice(1);
  }
  return data.map(line=>{
    const r=line.split(',').map(x=>x.trim());
    if(r.length<=Math.max(ti,ri))throw new Error('BINANCE_FUNDING_ARCHIVE_SCHEMA');
    return{
      fundingTime:strictCsvNumber(r[ti],'BINANCE_FUNDING_ARCHIVE_ROW',{positive:true,integer:true}),
      fundingRate:strictCsvNumber(r[ri],'BINANCE_FUNDING_ARCHIVE_ROW')
    };
  });
}

export function parseOkxFundingCsv(csv){
  const lines=splitLines(csv);
  if(!lines.length)return[];
  const header=lines[0].split(',').map(x=>x.trim().toLowerCase());
  if(header.join(',')!=='instrument_name,funding_rate,funding_time')throw new Error('OKX_FUNDING_ARCHIVE_SCHEMA');
  return lines.slice(1).map(line=>{
    const r=line.split(',').map(x=>x.trim());
    if(r.length!==3||r[0]!=='BTC-USDT-SWAP')throw new Error('OKX_FUNDING_ARCHIVE_SCHEMA');
    return{
      fundingTime:strictCsvNumber(r[2],'OKX_FUNDING_ARCHIVE_ROW',{positive:true,integer:true}),
      fundingRate:strictCsvNumber(r[1],'OKX_FUNDING_ARCHIVE_ROW')
    };
  });
}

export function parseOkxMarkRows(rows=[]){
  if(!Array.isArray(rows))throw new Error('OKX_MARK_PAGE_SCHEMA');
  return rows.map(row=>{
    if(!Array.isArray(row)||row.length<6||String(row[5])!=='1')throw new Error('OKX_MARK_PAGE_ROW');
    return{
      openTime:strictCsvNumber(row[0],'OKX_MARK_PAGE_ROW',{positive:true,integer:true}),
      open:strictCsvNumber(row[1],'OKX_MARK_PAGE_ROW',{positive:true}),
      high:strictCsvNumber(row[2],'OKX_MARK_PAGE_ROW',{positive:true}),
      low:strictCsvNumber(row[3],'OKX_MARK_PAGE_ROW',{positive:true}),
      close:strictCsvNumber(row[4],'OKX_MARK_PAGE_ROW',{positive:true}),
      confirmed:true
    };
  });
}

export function stableOkxReceiptPayload(endpoint,data){
  if(endpoint==='/api/v5/public/market-data-history'&&Array.isArray(data)){
    return data.map(x=>{const y={...(x||{})};delete y.ts;return y});
  }
  return data??null;
}

async function fetchRetry(url,options={},attempts=5){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch(url,{
        ...options,
        headers:{accept:'application/json','user-agent':'MERIDIAN-Cross-Venue-Edge-V2/1.0',...(options.headers||{})},
        signal:AbortSignal.timeout(30000)
      });
      if(r.ok)return r;
      last=new Error('HTTP '+r.status+' '+url);
      if(![418,429,500,502,503,504].includes(r.status))throw last;
    }catch(e){last=e}
    if(i<attempts-1)await sleep(1000*(i+1));
  }
  throw last;
}

async function unzipText(bytes,name){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cross-venue-v2-')),zip=path.join(dir,name);
  try{
    await fs.writeFile(zip,bytes);
    const result=await execFileAsync('unzip',['-p',zip],{maxBuffer:64*1024*1024});
    return result.stdout;
  }finally{await fs.rm(dir,{recursive:true,force:true})}
}

async function binanceArchiveCsv(rel,name,{missingOk=false}={}){
  const results=await Promise.all([
    fetchRetry(BINANCE_ARCHIVE+'/'+rel,{},3).catch(e=>e),
    fetchRetry(BINANCE_ARCHIVE+'/'+rel+'.CHECKSUM',{},3).catch(e=>e)
  ]);
  const zr=results[0],cr=results[1];
  if(zr instanceof Error||cr instanceof Error){
    const z404=String(zr?.message||'').includes('HTTP 404'),c404=String(cr?.message||'').includes('HTTP 404');
    if(missingOk&&z404&&c404)return null;
    throw zr instanceof Error?zr:cr;
  }
  const bytes=Buffer.from(await zr.arrayBuffer()),checksumText=(await cr.text()).trim();
  const match=checksumText.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
  if(!match||path.basename(match[2].trim())!==name)throw new Error('BINANCE_CHECKSUM_FORMAT '+rel);
  const expected=match[1].toLowerCase(),actual=sha256(bytes);
  if(actual!==expected)throw new Error('BINANCE_CHECKSUM_MISMATCH '+rel);
  return{csv:await unzipText(bytes,name),checksum:expected,rel};
}

function monthBounds(year,month,end){
  const monthStart=Date.UTC(year,month-1,1),monthEnd=Date.UTC(year,month,1)-1;
  return{from:Math.max(START,monthStart),to:Math.min(end,monthEnd)};
}

function markMonthCoverageOk(rows,year,month){
  const bounds=monthBounds(year,month,MARK_END);
  const first=Math.ceil(bounds.from/HOUR)*HOUR,last=Math.floor(bounds.to/HOUR)*HOUR;
  if(first>last)return true;
  const times=rows.filter(x=>x.openTime>=bounds.from&&x.openTime<=bounds.to).map(x=>x.openTime).sort((a,b)=>a-b);
  const expected=Math.floor((last-first)/HOUR)+1;
  return times.length===expected&&times.every((t,i)=>t===first+i*HOUR);
}

function fundingMonthCoverageOk(rows,year,month){
  const bounds=monthBounds(year,month,FUNDING_END);
  const xs=rows.filter(x=>x.fundingTime>=bounds.from&&x.fundingTime<=bounds.to).sort((a,b)=>a.fundingTime-b.fundingTime);
  if(!xs.length)return false;
  if(xs[0].fundingTime>bounds.from+CONTRACT.fundingIntervalMs+CONTRACT.timestampToleranceMs)return false;
  if(xs.at(-1).fundingTime<bounds.to-CONTRACT.fundingIntervalMs-CONTRACT.timestampToleranceMs)return false;
  return true;
}

async function binanceDaily({year,month,kind,parse,receipts}){
  const end=kind==='marks'?MARK_END:FUNDING_END;
  const bounds=monthBounds(year,month,end),out=[];
  for(let d=Math.floor(bounds.from/DAY)*DAY;d<=bounds.to;d+=DAY){
    const ds=dayStamp(d);
    const stem=kind==='marks'?'BTCUSDT-1h-'+ds:'BTCUSDT-fundingRate-'+ds;
    const rel=kind==='marks'
      ?'data/futures/um/daily/markPriceKlines/BTCUSDT/1h/'+stem+'.zip'
      :'data/futures/um/daily/fundingRate/BTCUSDT/'+stem+'.zip';
    const a=await binanceArchiveCsv(rel,stem+'.zip');
    receipts.push({kind,scope:'daily',rel:a.rel,sha256:a.checksum});
    out.push(...parse(a.csv));
  }
  return out;
}

async function binanceMonth({year,month,kind,parse,receipts}){
  const ym=year+'-'+String(month).padStart(2,'0');
  const stem=kind==='marks'?'BTCUSDT-1h-'+ym:'BTCUSDT-fundingRate-'+ym;
  const rel=kind==='marks'
    ?'data/futures/um/monthly/markPriceKlines/BTCUSDT/1h/'+stem+'.zip'
    :'data/futures/um/monthly/fundingRate/BTCUSDT/'+stem+'.zip';
  const a=await binanceArchiveCsv(rel,stem+'.zip',{missingOk:true});
  if(a){
    const parsed=parse(a.csv);
    const complete=kind==='marks'?markMonthCoverageOk(parsed,year,month):fundingMonthCoverageOk(parsed,year,month);
    if(complete){
      receipts.push({kind,scope:'monthly',rel:a.rel,sha256:a.checksum});
      return parsed;
    }
  }
  return binanceDaily({year,month,kind,parse,receipts});
}

async function collectBinanceKind(kind){
  const end=kind==='marks'?MARK_END:FUNDING_END;
  const parse=kind==='marks'?parseBinanceMarkCsv:parseBinanceFundingCsv;
  const rows=[],receipts=[],sd=new Date(START),ed=new Date(end);
  for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){
    rows.push(...await binanceMonth({year:y,month:m,kind,parse,receipts}));
    if(++m===13){m=1;y++}
  }
  const key=kind==='marks'?'openTime':'fundingTime';
  return{rows:rows.filter(x=>x[key]>=START&&x[key]<=end).sort((a,b)=>a[key]-b[key]),receipts};
}

async function okxJson(endpoint,params){
  const u=new URL(OKX_API+endpoint);
  for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,String(v));
  const r=await fetchRetry(u.toString());
  const raw=await r.text(),json=JSON.parse(raw);
  if(String(json?.code)!=='0')throw new Error('OKX_API '+json?.code+' '+json?.msg);
  return{
    json,
    receipt:{
      endpoint,
      params:Object.fromEntries([...u.searchParams]),
      sha256:sha256(JSON.stringify(stableOkxReceiptPayload(endpoint,json?.data)))
    }
  };
}

async function collectOkxFunding(){
  const rows=[],queryReceipts=[],archiveReceipts=[],sd=new Date(START),ed=new Date(FUNDING_END);
  for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){
    const ym=y+'-'+String(m).padStart(2,'0');
    const calendarTs=Date.parse(ym+'-01T00:00:00+08:00');
    const page=await okxJson('/api/v5/public/market-data-history',{
      module:3,instType:'SWAP',dateAggrType:'monthly',begin:calendarTs,end:calendarTs,instFamilyList:'BTC-USDT'
    });
    queryReceipts.push(page.receipt);
    const groups=(page.json?.data||[]).flatMap(x=>(x?.details||[]).flatMap(d=>d?.groupDetails||[]));
    const filename='BTC-USDT-SWAP-fundingrates-'+ym+'.zip';
    const file=groups.find(x=>x?.filename===filename);
    if(!file?.url)throw new Error('OKX_FUNDING_ARCHIVE_MISSING '+ym);
    const response=await fetchRetry(file.url,{},4),bytes=Buffer.from(await response.arrayBuffer());
    const digest=sha256(bytes),csv=await unzipText(bytes,filename),parsed=parseOkxFundingCsv(csv);
    const dateTs=strictNum(file.dateTs??file.dataTs);
    if(!Number.isFinite(dateTs))throw new Error('OKX_FUNDING_ARCHIVE_METADATA');
    archiveReceipts.push({filename,url:file.url,dateTs,sha256:digest});
    rows.push(...parsed);
    await sleep(350);
    if(++m===13){m=1;y++}
  }
  return{
    rows:rows.filter(x=>x.fundingTime>=START&&x.fundingTime<=FUNDING_END).sort((a,b)=>a.fundingTime-b.fundingTime),
    queryReceipts,archiveReceipts
  };
}

async function collectOkxMarks(){
  const rows=[],receipts=[];let cursor=MARK_END+1,guard=0,lastMin=Infinity;
  while(cursor>START&&guard++<1000){
    const page=await okxJson('/api/v5/market/history-mark-price-candles',{
      instId:'BTC-USDT-SWAP',bar:'1H',after:cursor,limit:100
    });
    receipts.push(page.receipt);
    const raw=Array.isArray(page.json?.data)?page.json.data:[];
    if(!raw.length)break;
    const parsed=parseOkxMarkRows(raw);
    rows.push(...parsed);
    const min=Math.min(...parsed.map(x=>x.openTime));
    if(!Number.isFinite(min)||min>=lastMin)throw new Error('OKX_MARK_PAGINATION_NONPROGRESS');
    lastMin=min;
    if(min<=START)break;
    cursor=min;
    await sleep(125);
  }
  if(guard>=1000)throw new Error('OKX_MARK_PAGINATION_GUARD');
  return{
    rows:rows.filter(x=>x.openTime>=START&&x.openTime<=MARK_END).sort((a,b)=>a.openTime-b.openTime),
    receipts
  };
}

export async function collectCrossVenueFundingEdgeV2Source(){
  assertV2SourceAuditAuthorized();
  const results=await Promise.all([
    collectBinanceKind('funding'),
    collectBinanceKind('marks'),
    collectOkxFunding(),
    collectOkxMarks()
  ]);
  const binanceFunding=results[0],binanceMarks=results[1],okxFunding=results[2],okxMarks=results[3];
  const provenance={
    collectedAt:new Date().toISOString(),
    boundaryEvidence:'research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json',
    binance:{provider:'Binance Vision',archive:BINANCE_ARCHIVE,receipts:[...binanceFunding.receipts,...binanceMarks.receipts]},
    okx:{
      provider:'OKX public historical market data',
      baseUrl:OKX_API,
      fundingQueryReceipts:okxFunding.queryReceipts,
      fundingArchiveReceipts:okxFunding.archiveReceipts,
      markPageReceipts:okxMarks.receipts
    },
    binanceChecksumsVerified:true,
    okxFundingArchivesHashed:true,
    okxMarkPagesHashed:true,
    deterministicParsing:true,
    strategyPnlCalculated:false
  };
  const packageData={
    schema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-PACKAGE-1',
    researchOnly:true,
    executionImpact:false,
    stage:'SOURCE_AUDIT',
    contract:CONTRACT,
    provenance,
    binanceFunding:binanceFunding.rows,
    okxFunding:okxFunding.rows,
    binanceMarks:binanceMarks.rows,
    okxMarks:okxMarks.rows
  };
  const validation=validateCrossVenueV2Source(packageData);
  if(!validation.ok)throw new Error('CROSS_VENUE_V2_SOURCE_INVALID '+JSON.stringify(validation));
  packageData.integrityEvents=validation.integrityEvents;
  packageData.receipt=validation.receipt;
  return packageData;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const out=await collectCrossVenueFundingEdgeV2Source();
  await fs.mkdir('research/data',{recursive:true});
  await fs.writeFile('research/data/cross-venue-funding-edge-v2-source.json',JSON.stringify(out));
  console.log(JSON.stringify({
    schema:out.receipt.schema,
    commonFundingDecisions:out.receipt.commonFundingDecisions,
    integrityEventCount:out.receipt.integrityEventCount,
    split:out.receipt.split,
    digest:out.receipt.digest,
    strategyPnlCalculated:false
  },null,2));
}
