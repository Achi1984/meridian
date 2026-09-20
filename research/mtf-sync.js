/**
 * Build a common historical window for multi-timeframe research.
 * Prevents comparing "5999 candles" that represent different spans.
 */
export function commonWindow(seriesByTf){
 const sets=Object.values(seriesByTf).filter(x=>x?.length);
 if(!sets.length)return {start:0,end:0,series:{}};
 const start=Math.max(...sets.map(x=>x[0].ts));
 const end=Math.min(...sets.map(x=>x.at(-1).ts));
 const series=Object.fromEntries(Object.entries(seriesByTf).map(([k,v])=>[k,v.filter(x=>x.ts>=start&&x.ts<=end)]));
 return {start,end,series};
}
export function splitByTimestamp(series,trainFraction=.7){
 const keys=Object.keys(series); if(!keys.length)return null;
 const start=Math.max(...keys.map(k=>series[k][0]?.ts||0)),end=Math.min(...keys.map(k=>series[k].at(-1)?.ts||0));
 const cut=start+(end-start)*trainFraction;
 return {cut,train:Object.fromEntries(keys.map(k=>[k,series[k].filter(x=>x.ts<cut)])),test:Object.fromEntries(keys.map(k=>[k,series[k].filter(x=>x.ts>=cut)]))};
}
