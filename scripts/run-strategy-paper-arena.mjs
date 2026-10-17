#!/usr/bin/env node
// Offline by default. This writes diagnostic evidence, never trading instructions.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { replayStrategyPaperArena } from '../research/strategy-paper-arena.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DAY=86400000, SYMBOLS=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function canonicalJSON(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('NONFINITE_JSON_NUMBER');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
  throw Error('NON_JSON_VALUE');
}
export async function collectBinanceDaily({fetchImpl=globalThis.fetch,asOf=Date.now()}={}){
  if(!Number.isSafeInteger(asOf)||asOf<DAY)throw Error('INVALID_AS_OF');
  const cutoff=Math.floor(asOf/DAY)*DAY-1, data={}, rawResponses={};
  const collectedAt=new Date().toISOString();
  for(const symbol of SYMBOLS){
    const url=`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=400&endTime=${cutoff}`;
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
    if(response.status!==200)throw Error(`COLLECTION_HTTP_${symbol}_${response.status}`);
    const declared=response.headers?.get?.('content-length');
    if(declared!==null&&declared!==undefined&&Number(declared)>1048576)throw Error('RESPONSE_TOO_LARGE');
    if(!response.body?.getReader)throw Error('STREAMING_RESPONSE_REQUIRED');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
    finally{await reader.cancel();}
    const body=Buffer.concat(chunks).toString('utf8'), rows=JSON.parse(body);
    if(!Array.isArray(rows)||rows.length!==400)throw Error(`PARTIAL_HISTORY_${symbol}`);
    rawResponses[symbol]={url,httpStatus:response.status,body,sha256:sha256(Buffer.from(body))};
    data[symbol]=rows.map((r,i)=>{
      if(!Array.isArray(r)||r.length<7||!Number.isSafeInteger(r[0])||!Number.isSafeInteger(r[6])||![1,2,3,4].every(j=>typeof r[j]==='string'&&r[j].trim()!==''&&Number.isFinite(Number(r[j]))))throw Error(`INVALID_RAW_CANDLE_${symbol}`);
      if(r[0]%DAY!==0||r[6]!==r[0]+DAY-1||r[6]>cutoff||i&&r[0]!==rows[i-1][0]+DAY)throw Error(`GAP_DUPLICATE_OR_UNCLOSED_${symbol}`);
      if(symbol!=='BTC'&&r[0]!==data.BTC[i].openTime)throw Error(`MISALIGNED_HISTORY_${symbol}`);
      return {openTime:r[0],open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),closeTime:r[6]};
    });
    if(data[symbol].at(-1).closeTime!==cutoff)throw Error(`STALE_HISTORY_${symbol}`);
  }
  return {data,asOf,sourceKind:'MARKET_DIAGNOSTIC',collection:{provider:'BINANCE_SPOT_PUBLIC_KLINES',collectedAt,completedAt:new Date().toISOString(),eventTimeCutoff:cutoff,requestCount:8,rawResponses}};
}
const KRAKEN_PAIRS=Object.freeze({BTC:'XBTUSD',ETH:'ETHUSD',SOL:'SOLUSD',XRP:'XRPUSD',HBAR:'HBARUSD',LINK:'LINKUSD',AVAX:'AVAXUSD',SUI:'SUIUSD'});
async function krakenPublicJSON(url,fetchImpl){
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(response.status!==200)throw Error(`KRAKEN_HTTP_${response.status}`);
  const declared=response.headers?.get?.('content-length');
  if(declared!==null&&declared!==undefined&&Number(declared)>1048576)throw Error('RESPONSE_TOO_LARGE');
  if(!response.body?.getReader)throw Error('STREAMING_RESPONSE_REQUIRED');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks),body=new TextDecoder('utf-8',{fatal:true}).decode(bytes),json=JSON.parse(body);
  if(!Array.isArray(json.error)||json.error.length||!json.result||typeof json.result!=='object'||Array.isArray(json.result))throw Error('KRAKEN_API_ERROR_OR_INVALID_RESULT');
  return {json,raw:{url,httpStatus:200,body,sha256:sha256(bytes)}};
}
export async function collectKrakenDaily({fetchImpl=globalThis.fetch,asOf=Date.now()}={}){
  if(!Number.isSafeInteger(asOf)||asOf<DAY*401)throw Error('INVALID_AS_OF');
  const dayStart=Math.floor(asOf/DAY)*DAY,cutoff=dayStart-1,since=(dayStart-400*DAY)/1000;
  const collectedAt=new Date().toISOString(),data={},rawResponses={},instruments={};
  const metadata=await krakenPublicJSON('https://api.kraken.com/0/public/AssetPairs?pair='+Object.values(KRAKEN_PAIRS).join(','),fetchImpl);
  // Resolve each exact USD instrument from official metadata before requesting OHLC.
  for(const symbol of SYMBOLS){
    const altname=KRAKEN_PAIRS[symbol],matches=Object.entries(metadata.json.result).filter(([,p])=>p?.altname===altname);
    if(matches.length!==1)throw Error(`KRAKEN_INSTRUMENT_NOT_UNIQUE_${symbol}`);
    const [key,pair]=matches[0],base=symbol==='BTC'?'XBT':symbol;
    if(pair.status!=='online'||!['USD','ZUSD'].includes(pair.quote)||pair.wsname!==base+'/USD'||!['X'+base,base].includes(pair.base))throw Error(`KRAKEN_INVALID_USD_INSTRUMENT_${symbol}`);
    instruments[symbol]={resultKey:key,altname,wsname:pair.wsname,base:pair.base,quote:pair.quote,status:pair.status};
  }
  for(const symbol of SYMBOLS){
    const instrument=instruments[symbol],url=`https://api.kraken.com/0/public/OHLC?pair=${instrument.altname}&interval=1440&since=${since}`;
    const {json,raw}=await krakenPublicJSON(url,fetchImpl),keys=Object.keys(json.result).filter(k=>k!=='last');
    if(keys.length!==1||keys[0]!==instrument.resultKey||!Number.isSafeInteger(json.result.last))throw Error(`KRAKEN_WRONG_RESULT_KEY_${symbol}`);
    const rows=json.result[instrument.resultKey];
    if(!Array.isArray(rows)||rows.length>720||rows.length<400)throw Error(`KRAKEN_PARTIAL_HISTORY_${symbol}`);
    const parsed=rows.map((r,i)=>{
      if(!Array.isArray(r)||r.length!==8||!Number.isSafeInteger(r[0])||![1,2,3,4].every(j=>typeof r[j]==='string'&&r[j].trim()!==''&&Number.isFinite(Number(r[j]))))throw Error(`KRAKEN_INVALID_CANDLE_${symbol}`);
      const openTime=r[0]*1000;
      if(!Number.isSafeInteger(openTime)||openTime%DAY||openTime>dayStart||i&&r[0]!==rows[i-1][0]+DAY/1000)throw Error(`KRAKEN_GAP_DUPLICATE_OR_UNORDERED_${symbol}`);
      const candle={openTime,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),closeTime:openTime+DAY-1};
      if(!(candle.low>0&&candle.high>=candle.low&&candle.open>=candle.low&&candle.open<=candle.high&&candle.close>=candle.low&&candle.close<=candle.high))throw Error(`KRAKEN_INVALID_OHLC_${symbol}`);
      return candle;
    });
    const excludedUnclosed=parsed.at(-1).openTime===dayStart?parsed.pop():null;
    const trimmedOlderCount=Math.max(0,parsed.length-400),completed=parsed.slice(trimmedOlderCount);
    if(completed.length!==400||completed.at(-1).closeTime!==cutoff||completed[0].openTime!==dayStart-400*DAY)throw Error(`KRAKEN_STALE_OR_PARTIAL_HISTORY_${symbol}`);
    if(symbol!=='BTC'&&completed.some((r,i)=>r.openTime!==data.BTC[i].openTime))throw Error(`KRAKEN_MISALIGNED_HISTORY_${symbol}`);
    data[symbol]=completed;
    rawResponses[symbol]={...raw,returnedRows:rows.length,trimmedOlderCount,excludedUnclosed:excludedUnclosed?{openTime:excludedUnclosed.openTime,reason:'CURRENT_UNCLOSED_UTC_DAILY_CANDLE'}:null,retainedStart:completed[0].openTime,retainedEnd:completed.at(-1).closeTime};
  }
  return {data,asOf,sourceKind:'MARKET_DIAGNOSTIC',quoteCurrency:'USD',collection:{provider:'KRAKEN_SPOT_PUBLIC_OHLC',collectedAt,completedAt:new Date().toISOString(),eventTimeCutoff:cutoff,requestCount:9,instrumentMetadata:metadata.raw,instruments,rawResponses,fxConversion:false}};
}
export async function runArenaBundle({inputPath,outDir,collectBinance=false,collectKrakenUSD=false,asOf,fetchImpl,replay=replayStrategyPaperArena,enginePath=join(ROOT,'research/strategy-paper-arena.js'),protocolPath=join(ROOT,'docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md')}={}){
  if(!outDir||[inputPath,collectBinance,collectKrakenUSD].filter(Boolean).length!==1)throw Error('REQUIRE_NONEXISTENT_OUT_AND_EXACTLY_ONE_INPUT_MODE');
  // Atomic mkdir prevents both accidental overwrite and races. No recursive output creation.
  await mkdir(outDir);
  let sealed=false;
  try{
    const inputRaw=inputPath?await readFile(inputPath):null;
    if(inputRaw)await writeFile(join(outDir,'input.raw.json'),inputRaw,{flag:'wx'});
    const input=inputRaw?JSON.parse(inputRaw.toString('utf8')):collectKrakenUSD?await collectKrakenDaily({fetchImpl,asOf}):await collectBinanceDaily({fetchImpl,asOf});
    const snapshot=Buffer.from(canonicalJSON(input)+'\n');
    await writeFile(join(outDir,'input.json'),snapshot,{flag:'wx'});
    const engine=await readFile(enginePath),protocol=await readFile(protocolPath);
    const receipt={schemaVersion:'MERIDIAN_ARENA_RECEIPT_V1',sealedAt:new Date().toISOString(),inputFile:'input.json',inputSha256:sha256(snapshot),rawInputSha256:inputRaw?sha256(inputRaw):null,engineFile:'research/strategy-paper-arena.js',engineSha256:sha256(engine),protocolFile:'docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md',protocolSha256:sha256(protocol),sourceKind:input.sourceKind??null,provenance:(collectBinance||collectKrakenUSD)?'PUBLIC_SPOT_COLLECTOR_RAW_RESPONSES_RETAINED':input.sourceKind==='SYNTHETIC'?'CALLER_SYNTHETIC':'UNVERIFIED_INPUT',asOf:input.asOf??null,quoteCurrency:input.quoteCurrency??'USDT',collectorProvider:(collectBinance||collectKrakenUSD)?input.collection.provider:null,instruments:collectKrakenUSD?input.collection.instruments:null,evidence:'DIAGNOSTIC_ONLY_NO_FRESH_HOLDOUT',liveAuthorized:false,autoPromotion:false,paperReadiness:false};
    // Receipt is immutable and exists before replay. Evaluation outcome is separate.
    await writeFile(join(outDir,'receipt.json'),canonicalJSON(receipt)+'\n',{flag:'wx'});sealed=true;
    const result=await replay(input);
    await writeFile(join(outDir,'result.json'),canonicalJSON(result)+'\n',{flag:'wx'});
    const bundle={input,result,receipt};
    await writeFile(join(outDir,'bundle.json'),canonicalJSON(bundle)+'\n',{flag:'wx'});
    return bundle;
  }catch(error){
    await writeFile(join(outDir,'error.json'),JSON.stringify({status:'FAILED_CLOSED',sealedBeforeEvaluation:sealed,error:String(error.message)}),{flag:'wx'});
    throw error;
  }
}
async function main(){
  const args=process.argv.slice(2), options={};
  while(args.length){const key=args.shift();if(key==='--collect-binance')options.collectBinance=true;else if(key==='--collect-kraken-usd')options.collectKrakenUSD=true;else if(['--input','--out','--as-of'].includes(key)){const value=args.shift();if(!value||value.startsWith('--'))throw Error('MISSING_ARGUMENT');options[{'--input':'inputPath','--out':'outDir','--as-of':'asOf'}[key]]=key==='--as-of'?Number(value):resolve(value);}else throw Error('UNKNOWN_ARGUMENT: '+key);}
  if(options.asOf!==undefined&&!options.collectBinance&&!options.collectKrakenUSD)throw Error('AS_OF_ONLY_FOR_EXPLICIT_COLLECTION; offline asOf belongs in input JSON');
  const bundle=await runArenaBundle(options);
  process.stdout.write(JSON.stringify({out:options.outDir,ruleset:bundle.result.ruleset,inputSha256:bundle.receipt.inputSha256,evidence:bundle.receipt.evidence})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
