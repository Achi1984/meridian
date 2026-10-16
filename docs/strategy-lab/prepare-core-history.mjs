import fs from 'node:fs';
import crypto from 'node:crypto';
import {normalizeBinanceDaily} from './normalize-binance-daily.mjs';
const root=process.cwd(); // Requires local audited cache; no network.
const read=p=>JSON.parse(fs.readFileSync(`${root}/${p}`));
const report=read('core-history-downloads.json');
const old=read('docs/strategy-lab/warmup-history-audit-20241013.json');
const folder='docs/strategy-lab/core-history-20241013';fs.mkdirSync(`${root}/${folder}`,{recursive:true});
const manifest={schema:'CORE_ENGINEERING_HISTORY_V1',selection:'BTC_ETH_ENGINEERING_REFERENCES_NOT_TOP20_BACKTEST',fromOpen:'2023-01-01',throughOpen:'2024-10-13',requiredRowsPerAsset:652,quoteCurrency:'USDT',eurConverted:false,executionAuthorized:false,strategyEvaluated:false,historicalAvailabilityVerified:false,identityVerified:false,inspectedSourceMonths:'January2023–October2024; all inspected, not untouched holdout',sourceAudits:['extension-audit.json','../warmup-history-audit-20241013.json'],columns:['openTimeMs','exclusiveCloseTimeMs','open','high','low','close','volumeBaseAsset'],assets:[]};
for(const symbol of ['BTC','ETH']){
 const prefix=report.archives.filter(x=>x.symbol===symbol),suffix=old.archives.filter(x=>x.symbol===symbol);
 const errors=prefix.filter(a=>a.status!=='CHECKSUM_VERIFIED');if(errors.length){manifest.assets.push({symbol,valid:false,failedMonths:errors.map(x=>x.month)});continue;}
 const raw=[...prefix.flatMap(a=>read(`core-history-cache/${a.pair}-${a.month}.json`)),...suffix.flatMap(a=>read(`history-probe-cache/${a.pair}-${a.month}.json`))].sort((a,b)=>Number(a[0])-Number(b[0]));
 const receipt=Math.max(...[...prefix,...suffix].map(a=>a.retrievedAtMs));
 const norm=normalizeBinanceDaily({rows:raw,timestampUnit:'ms',availableAtMs:raw.map(()=>receipt),asOfMs:receipt});
 if(!norm.valid||norm.bars.length!==652||norm.bars[0].openTimeMs!==1672531200000||norm.bars.at(-1).openTimeMs!==1728777600000)throw Error(symbol+' failed join');
 const rows=norm.bars.map(b=>[b.openTimeMs,b.closeTimeMs,b.open,b.high,b.low,b.close,b.volume]);
 const prior=read(`docs/strategy-lab/ohlcv-20241013/${symbol}.json`);if(JSON.stringify(rows.slice(-201))!==JSON.stringify(prior.rows))throw Error('suffix changed');
 const file=symbol+'.json',content=JSON.stringify({symbol,providerId:prefix[0].providerId,pair:prefix[0].pair,availableAtMs:receipt,availabilityMeaning:'CURRENT_ARCHIVE_RECEIPT_NOT_HISTORICAL_PUBLICATION',rows})+'\n';fs.writeFileSync(`${root}/${folder}/${file}`,content);
 manifest.assets.push({symbol,file,valid:true,rows:rows.length,sha256:crypto.createHash('sha256').update(content).digest('hex')});
}
fs.writeFileSync(`${root}/${folder}/extension-audit.json`,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(`${root}/${folder}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest.assets));
