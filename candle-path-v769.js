// MERIDIAN v7.69 — intratrade candle-path drawdown replay
// Research-only. Evaluates close-MTM and adverse intrabar MTM for already-selected trades.
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const tnum=v=>typeof v==='number'?v:Date.parse(v||'');
const oneR=t=>Number(t.equityAtRiskAtOpen||0)*(Number(t.riskPct||0)/100);
const riskDistance=t=>Math.abs(Number(t.atr||0))*1.6;
function rAt(t,px){const d=riskDistance(t);if(!(d>0)||!Number.isFinite(Number(px)))return 0;return t.side==='SHORT'?(Number(t.entry)-Number(px))/d:(Number(px)-Number(t.entry))/d}
function pointsForSymbol(candles=[]){return candles.map(c=>({t:Number(c.closeTime??c.t??tnum(c.time)),close:Number(c.close),low:Number(c.low),high:Number(c.high)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.close)).sort((a,b)=>a.t-b.t)}
export function replayCandlePath(trades=[],candlesBySymbol={},options={}){
  const startEquity=Number(options.startEquity||10000);
  const mode=options.mode==='close'?'close':'adverse';
  const clean=trades.filter(t=>Number.isFinite(tnum(t.sampledAt))&&Number.isFinite(Number(t.exitAt))&&Number.isFinite(Number(t.entry))&&riskDistance(t)>0).map(t=>({...t,openT:tnum(t.sampledAt),exitT:Number(t.exitAt),oneR:oneR(t)}));
  const bySym=new Map(Object.entries(candlesBySymbol).map(([s,x])=>[s,pointsForSymbol(x)]));
  const times=new Set();for(const t of clean){times.add(t.openT);times.add(t.exitT);for(const c of bySym.get(t.symbol)||[])if(c.t>=t.openT&&c.t<=t.exitT)times.add(c.t)}
  const ordered=[...times].sort((a,b)=>a-b);let realized=0,peak=startEquity,maxDD=0,worst=null;const lastMark=new Map(),curve=[];
  for(const now of ordered){
    for(const tr of clean){if(now<tr.openT||now>tr.exitT)continue;const xs=bySym.get(tr.symbol)||[];let c=null;for(const x of xs){if(x.t>now)break;if(x.t>=tr.openT)c=x}if(c)lastMark.set(`${tr.sampledAt}|${tr.symbol}`,c)}
    realized=clean.filter(t=>t.exitT<=now).reduce((s,t)=>s+t.oneR*Number(t.outcomeR||0),0);
    let unrealized=0;
    for(const tr of clean){if(!(tr.openT<=now&&now<tr.exitT))continue;const c=lastMark.get(`${tr.sampledAt}|${tr.symbol}`);if(!c)continue;const px=mode==='close'?c.close:(tr.side==='SHORT'?c.high:c.low);unrealized+=tr.oneR*rAt(tr,px)}
    const eq=startEquity+realized+unrealized;peak=Math.max(peak,eq);const dd=peak>0?Math.max(0,(peak-eq)/peak*100):0;if(dd>maxDD){maxDD=dd;worst={at:new Date(now).toISOString(),equity:eq,peak,realized,unrealized}}curve.push({t:now,equity:round(eq,2),drawdownPct:round(dd,3)})
  }
  const endEquity=startEquity+clean.reduce((s,t)=>s+t.oneR*Number(t.outcomeR||0),0);
  return {schemaVersion:'7.69-CANDLE-PATH-V1',researchOnly:true,executionImpact:false,mode,trades:clean.length,startEquity:round(startEquity,2),endEquity:round(endEquity,2),maxDrawdownPct:round(maxDD,3),worst:worst?{...worst,equity:round(worst.equity,2),peak:round(worst.peak,2),realized:round(worst.realized,2),unrealized:round(worst.unrealized,2)}:null,points:curve.length,curve:options.includeCurve?curve:undefined};
}

export function compareCandlePath(baselineTrades=[],challengerTrades=[],candlesBySymbol={},options={}){
  const baseClose=replayCandlePath(baselineTrades,candlesBySymbol,{...options,mode:'close'}),v32Close=replayCandlePath(challengerTrades,candlesBySymbol,{...options,mode:'close'}),baseAdverse=replayCandlePath(baselineTrades,candlesBySymbol,{...options,mode:'adverse'}),v32Adverse=replayCandlePath(challengerTrades,candlesBySymbol,{...options,mode:'adverse'});
  return {schemaVersion:'7.69-CANDLE-PATH-COMPARISON-V1',researchOnly:true,executionImpact:false,baseline:{close:baseClose,adverse:baseAdverse},challengerV32:{close:v32Close,adverse:v32Adverse},comparison:{closeDdDeltaPct:round(v32Close.maxDrawdownPct-baseClose.maxDrawdownPct,3),adverseDdDeltaPct:round(v32Adverse.maxDrawdownPct-baseAdverse.maxDrawdownPct,3),v32LowerCloseDd:v32Close.maxDrawdownPct<baseClose.maxDrawdownPct,v32LowerAdverseDd:v32Adverse.maxDrawdownPct<baseAdverse.maxDrawdownPct}};
}
