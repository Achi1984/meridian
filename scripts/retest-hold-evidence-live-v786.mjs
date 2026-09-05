import fs from 'node:fs';
import { loadRetestHoldMarket } from '../retest-hold-source-v786.js';
import { prepareRetestHoldSignals,retestHoldEvidenceReport,markdownRetestHoldReport } from '../retest-hold-evidence-v786.js';

const DAY=86400000;
const assets=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const dataEnd=Date.now(),start=dataEnd-94*DAY,signalEnd=dataEnd-48*3600000;
console.log('[v7.86] load market',new Date(start).toISOString(),'->',new Date(dataEnd).toISOString());
const loaded=await loadRetestHoldMarket({assets,start,end:dataEnd,onProgress:x=>{if(x.stage==='loading')console.log(`[v7.86] ${x.index+1}/${x.total} ${x.symbol}`);if(x.stage==='retry')console.log('[retry]',x.symbol,x.interval,x.endpoint,x.attempt,x.error)}});
const signals=prepareRetestHoldSignals({market:loaded.market,start:signalEnd-90*DAY,end:signalEnd,stepMinutes:15,horizonHours:48});
const report=retestHoldEvidenceReport(signals,{windowsDays:[30,60,90],dataEnd:signalEnd});
report.assets=assets;report.endpoints=loaded.endpoints;report.signalCount=signals.length;report.generatedAt=new Date().toISOString();
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/retest-hold-v786-r2.json',JSON.stringify(report,null,2));
fs.writeFileSync('artifacts/retest-hold-v786-r2.md',markdownRetestHoldReport(report));
console.log(JSON.stringify(report.windows,null,2));
