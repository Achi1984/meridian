import fs from 'node:fs';
import { loadBreakoutMarket } from '../breakout-expansion-source-v785.js';
import { prepareBreakoutSignals,breakoutEvidenceReport,markdownBreakoutReport } from '../breakout-expansion-evidence-v785.js';

const DAY=86400000;
const assets=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const dataEnd=Date.now();
const start=dataEnd-94*DAY;
console.log('[v7.85] load market',new Date(start).toISOString(),'->',new Date(dataEnd).toISOString());
const loaded=await loadBreakoutMarket({assets,start,end:dataEnd,onProgress:x=>{if(x.stage==='loading')console.log(`[v7.85] ${x.index+1}/${x.total} ${x.symbol}`);if(x.stage==='retry')console.log('[retry]',x.symbol,x.interval,x.endpoint,x.attempt,x.error)}});
const signals=prepareBreakoutSignals({market:loaded.market,start:dataEnd-90*DAY,end:dataEnd-48*3600000,stepMinutes:15,horizonHours:48});
const report=breakoutEvidenceReport(signals,{windowsDays:[30,60,90],dataEnd:dataEnd-48*3600000});
report.assets=assets;report.endpoints=loaded.endpoints;report.signalCount=signals.length;report.generatedAt=new Date().toISOString();
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/breakout-expansion-v785-r2.json',JSON.stringify(report,null,2));
fs.writeFileSync('artifacts/breakout-expansion-v785-r2.md',markdownBreakoutReport(report));
console.log(JSON.stringify(report.windows,null,2));
