/**
 * MERIDIAN FIB DCA Futures Long research backtester.
 * Pure JS; oldest->newest closed OHLCV. Research/paper only.
 */
import {approxLongLiquidation,liquidationTouched} from "./liquidation.js";
export const DEFAULT_CONFIG={leverage:3,dcaLevels:[.382,.5,.618,.786],dcaWeights:[.15,.2,.3,.35],tpExtensions:[1,1.272,1.618],tpWeights:[.3,.3,.4],feeRate:.0005,slippageRate:.0003,initialEquity:10000,riskCapitalFraction:.1,maintenanceMarginRate:.005,beCostBufferRate:.001,profitLockRate:.002,conservativeIntrabar:true,funding:[]};
export function fibPrices(lo,hi,cfg=DEFAULT_CONFIG){if(!(hi>lo))throw new Error("swingHigh must exceed swingLow");const r=hi-lo;return{dca:cfg.dcaLevels.map(x=>hi-r*x),tp:cfg.tpExtensions.map(x=>x===1?hi:lo+r*x),invalidation:lo}}
export function weightedEntry(fills){const q=fills.reduce((s,f)=>s+f.qty,0);return q?fills.reduce((s,f)=>s+f.price*f.qty,0)/q:0}
const buy=(p,s)=>p*(1+s),sell=(p,s)=>p*(1-s);
export function backtestFibCycle(candles,swingLow,swingHigh,userCfg={}){
 const cfg={...DEFAULT_CONFIG,...userCfg},lv=fibPrices(swingLow,swingHigh,cfg);
 const allocation=cfg.initialEquity*cfg.riskCapitalFraction*cfg.leverage,fills=[],used=new Set(),tpDone=new Set(),events=[],curve=[];
 let realized=0,fees=0,fundingCost=0,qtyOpen=0,stopped=false,liquidated=false,protectStop=null,lastFundingTs=-Infinity,peak=cfg.initialEquity,maxDrawdown=0;
 const totalFilledQty=()=>fills.reduce((s,f)=>s+f.qty,0);
 const close=(c,type,target)=>{
   const px=sell(target,cfg.slippageRate),avg=weightedEntry(fills),q=qtyOpen,pnl=(px-avg)*q,fee=px*q*cfg.feeRate;
   realized+=pnl-fee;fees+=fee;events.push({ts:c.ts,type,price:px,qty:q,pnl:pnl-fee});qtyOpen=0;stopped=type!=="LIQUIDATION";liquidated=type==="LIQUIDATION";
 };
 for(const c of candles){
   for(const f of cfg.funding||[])if(f.ts>lastFundingTs&&f.ts<=c.ts&&qtyOpen>0){const cost=qtyOpen*c.close*f.rate;fundingCost+=cost;realized-=cost;events.push({ts:f.ts,type:"FUNDING",rate:f.rate,cost});lastFundingTs=f.ts}
   if(qtyOpen>0){
     const avg=weightedEntry(fills),liq=approxLongLiquidation(avg,cfg.leverage,cfg.maintenanceMarginRate);
     const stop=Math.max(lv.invalidation,protectStop||0);
     if(liquidationTouched(c,liq)){close(c,"LIQUIDATION",liq);break}
     if(c.low<=stop){close(c,protectStop?"PROTECT_STOP":"STOP",stop);break}
   }
   for(let i=0;i<lv.dca.length;i++)if(!used.has(i)&&c.low<=lv.dca[i]){
     const gate=typeof cfg.entryGate==="function"?cfg.entryGate({candle:c,level:i+1,target:lv.dca[i],fills:[...fills]}):{pass:true};
     if(!gate?.pass){events.push({ts:c.ts,type:"DCA_BLOCKED",level:i+1,target:lv.dca[i],gate});continue}
     const px=buy(lv.dca[i],cfg.slippageRate),notional=allocation*cfg.dcaWeights[i],qty=notional/px,fee=notional*cfg.feeRate;
     fills.push({level:i,price:px,qty});qtyOpen+=qty;fees+=fee;realized-=fee;used.add(i);events.push({ts:c.ts,type:"DCA",level:i+1,price:px,qty,fee});
   }
   if(qtyOpen>0)for(let i=0;i<lv.tp.length;i++)if(!tpDone.has(i)&&c.high>=lv.tp[i]){
     const qty=i===lv.tp.length-1?qtyOpen:Math.min(qtyOpen,totalFilledQty()*cfg.tpWeights[i]);if(qty<=0)continue;
     const px=sell(lv.tp[i],cfg.slippageRate),avg=weightedEntry(fills),pnl=(px-avg)*qty,fee=px*qty*cfg.feeRate;
     realized+=pnl-fee;fees+=fee;qtyOpen-=qty;tpDone.add(i);events.push({ts:c.ts,type:`TP${i+1}`,price:px,qty,pnl:pnl-fee});
     if(i===0&&qtyOpen>0){protectStop=avg*(1+cfg.beCostBufferRate);events.push({ts:c.ts,type:"STOP_TO_BE",price:protectStop})}
     if(i===1&&qtyOpen>0){protectStop=Math.max(protectStop||0,avg*(1+cfg.profitLockRate));events.push({ts:c.ts,type:"STOP_TO_PROFIT",price:protectStop})}
   }
   const mtm=realized+(qtyOpen?(c.close-weightedEntry(fills))*qtyOpen:0),equity=cfg.initialEquity+mtm;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak);curve.push({ts:c.ts,equity,qtyOpen});
 }
 const last=candles.at(-1),unrealized=last&&qtyOpen?(last.close-weightedEntry(fills))*qtyOpen:0;
 return{swingLow,swingHigh,levels:lv,fills,events,stopped,liquidated,weightedEntry:weightedEntry(fills),realizedPnl:realized,unrealizedPnl:unrealized,fundingCost,fees,openQty:qtyOpen,maxDrawdown,equityCurve:curve,tpHits:[0,1,2].map(i=>tpDone.has(i)),dcaUsed:[0,1,2,3].map(i=>used.has(i))};
}
