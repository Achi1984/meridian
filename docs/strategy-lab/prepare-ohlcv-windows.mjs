import fs from 'node:fs';
import crypto from 'node:crypto';
import {normalizeBinanceDaily} from './normalize-binance-daily.mjs';
const root=process.cwd(); // Run at repo root with already-audited local history-probe-cache.
const read=p=>JSON.parse(fs.readFileSync(`${root}/${p}`));
const audit=read('docs/strategy-lab/warmup-history-audit-20241013.json');
const closes=read('docs/strategy-lab/prepared-close-windows-20241013.json');
const folder='docs/strategy-lab/ohlcv-20241013';fs.mkdirSync(`${root}/${folder}`,{recursive:true});
const manifest={schema:'OHLCV_PREPARATION_V1',executionAuthorized:false,strategyEvaluated:false,historicalPublicationVerified:false,identityVerified:false,quoteCurrency:'USDT',eurConverted:false,sourceAudit:'../warmup-history-audit-20241013.json',columns:['openTimeMs','exclusiveCloseTimeMs','open','high','low','close','volumeBaseAsset'],availabilityMeaning:'CURRENT_ARCHIVE_RECEIPT_ONLY',assets:[]};
for(const asset of audit.assets.filter(x=>x.complete201DayPriceWindow)) {
 const archives=audit.archives.filter(x=>x.symbol===asset.symbol);
 const raw=archives.flatMap(a=>read(`history-probe-cache/${a.pair}-${a.month}.json`)).sort((a,b)=>Number(a[0])-Number(b[0]));
 const receipt=Math.max(...archives.map(a=>a.retrievedAtMs));
 const result=normalizeBinanceDaily({rows:raw,timestampUnit:'ms',availableAtMs:raw.map(()=>receipt),asOfMs:receipt});
 if(!result.valid||result.bars.length!==201)throw Error(asset.symbol+' invalid');
 const old=closes.datasets.find(x=>x.symbol===asset.symbol);
 const compact=result.bars.map(b=>[b.openTimeMs,b.closeTimeMs,b.open,b.high,b.low,b.close,b.volume]);
 if(compact.some((r,i)=>r[1]!==old.rows[i][0]||r[5]!==old.rows[i][1]))throw Error('close mismatch');
 const data={symbol:asset.symbol,providerId:asset.providerId,pair:asset.pair,availableAtMs:receipt,rows:compact};
 const content=JSON.stringify(data)+'\n';const file=asset.symbol+'.json';fs.writeFileSync(`${root}/${folder}/${file}`,content);
 manifest.assets.push({symbol:asset.symbol,file,rows:201,sha256:crypto.createHash('sha256').update(content).digest('hex')});
}
manifest.assetCount=manifest.assets.length;manifest.totalRows=manifest.assets.reduce((s,a)=>s+a.rows,0);manifest.excluded=audit.summary.incomplete;
fs.writeFileSync(`${root}/${folder}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({assets:manifest.assetCount,rows:manifest.totalRows}));
