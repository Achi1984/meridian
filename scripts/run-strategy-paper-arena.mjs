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
export async function runArenaBundle({inputPath,outDir,collectBinance=false,asOf,fetchImpl,replay=replayStrategyPaperArena,enginePath=join(ROOT,'research/strategy-paper-arena.js'),protocolPath=join(ROOT,'docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md')}={}){
  if(!outDir||Boolean(inputPath)===Boolean(collectBinance))throw Error('REQUIRE_NONEXISTENT_OUT_AND_EXACTLY_ONE_INPUT_MODE');
  // Atomic mkdir prevents both accidental overwrite and races. No recursive output creation.
  await mkdir(outDir);
  let sealed=false;
  try{
    const inputRaw=inputPath?await readFile(inputPath):null;
    if(inputRaw)await writeFile(join(outDir,'input.raw.json'),inputRaw,{flag:'wx'});
    const input=inputRaw?JSON.parse(inputRaw.toString('utf8')):await collectBinanceDaily({fetchImpl,asOf});
    const snapshot=Buffer.from(canonicalJSON(input)+'\n');
    await writeFile(join(outDir,'input.json'),snapshot,{flag:'wx'});
    const engine=await readFile(enginePath),protocol=await readFile(protocolPath);
    const receipt={schemaVersion:'MERIDIAN_ARENA_RECEIPT_V1',sealedAt:new Date().toISOString(),inputFile:'input.json',inputSha256:sha256(snapshot),rawInputSha256:inputRaw?sha256(inputRaw):null,engineFile:'research/strategy-paper-arena.js',engineSha256:sha256(engine),protocolFile:'docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md',protocolSha256:sha256(protocol),sourceKind:input.sourceKind??null,provenance:collectBinance?'PUBLIC_SPOT_COLLECTOR_RAW_RESPONSES_RETAINED':input.sourceKind==='SYNTHETIC'?'CALLER_SYNTHETIC':'UNVERIFIED_INPUT',asOf:input.asOf??null,evidence:'DIAGNOSTIC_ONLY_NO_FRESH_HOLDOUT',liveAuthorized:false,autoPromotion:false,paperReadiness:false};
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
  while(args.length){const key=args.shift();if(key==='--collect-binance')options.collectBinance=true;else if(['--input','--out','--as-of'].includes(key)){const value=args.shift();if(!value||value.startsWith('--'))throw Error('MISSING_ARGUMENT');options[{'--input':'inputPath','--out':'outDir','--as-of':'asOf'}[key]]=key==='--as-of'?Number(value):resolve(value);}else throw Error('UNKNOWN_ARGUMENT: '+key);}
  if(options.asOf!==undefined&&!options.collectBinance)throw Error('AS_OF_ONLY_FOR_EXPLICIT_COLLECTION; offline asOf belongs in input JSON');
  const bundle=await runArenaBundle(options);
  process.stdout.write(JSON.stringify({out:options.outDir,ruleset:bundle.result.ruleset,inputSha256:bundle.receipt.inputSha256,evidence:bundle.receipt.evidence})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
