import {
  GRID_PATH_SIMULATOR_V1_RULESET,
  buildGridLevels,
  validateMinuteBars,
  crossSegment
} from './grid-path-simulator-v1.js';

export const DYNAMIC_GRID_PROXY_V1_RULESET='DYNAMIC-GRID-PROXY-V1-FROZEN';
export const DYNAMIC_GRID_PROXY_V1_ASSETS=Object.freeze(['BTC','ETH']);
export const DYNAMIC_GRID_PROXY_V1_PATHS=Object.freeze(['PAPER_OLHC','ALT_OHLC']);
export const DYNAMIC_GRID_PROXY_V1_STEPS=Object.freeze([0.005,0.01,0.015,0.02]);
export const DYNAMIC_GRID_PROXY_V1_HALF_LEVELS=Object.freeze([2,3,5]);
export const DYNAMIC_GRID_PROXY_V1_CONFIG=Object.freeze({
  startEquity:10000,
  feeBps:8,
  slippageBps:2,
  stressExtraSlippageBps:5,
  maxGapMs:120000,
  levelMode:'GEOMETRIC',
  gate:Object.freeze({
    minAssetMonthCycles:40,
    minCyclesPerAsset:20,
    minProfitFactor:1.10,
    maxDrawdownPct:35,
    minPositiveWindows:3,
    maxPathSpreadPctPoints:15
  })
});

const EPS=1e-8;
const finite=x=>Number.isFinite(Number(x));
const n=x=>Number(x);
const sum=a=>a.reduce((s,x)=>s+x,0);
const mean=a=>a.length?sum(a)/a.length:0;
const round=(x,d=8)=>finite(x)?Number(n(x).toFixed(d)):null;

function profitFactor(rs){
  const w=sum(rs.filter(x=>x>0)),l=Math.abs(sum(rs.filter(x=>x<0)));
  return l>0?w/l:(w>0?99:0);
}
function compound(rs){
  let e=1;
  for(const r of rs)e*=1+r;
  return e-1;
}
function chronologicalWindows(periods,parts=5){
  const windows=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    const rs=periods.slice(a,b).map(x=>x.return);
    windows.push({index:i+1,periods:rs.length,returnPct:compound(rs)*100});
  }
  return{windows,positiveWindows:windows.filter(x=>x.returnPct>0).length};
}
function monthKey(ts){
  const d=new Date(ts);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
}
function pathPoints(bar,previousClose,pathMode,firstOrReset=false){
  const start=firstOrReset?bar.open:previousClose;
  if(pathMode==='PAPER_OLHC')return[start,bar.low,bar.high,bar.close];
  if(pathMode==='ALT_OHLC')return[start,bar.high,bar.low,bar.close];
  throw new Error('unsupported path mode');
}
function tradeCost(notional,feeBps){return notional*feeBps/10000}

function executeBuy(wallet,qty,level,cfg){
  const px=level*(1+cfg.slippageBps/10000),notional=qty*px,fee=tradeCost(notional,cfg.feeBps),need=notional+fee;
  if(wallet.cash+EPS<need)return{ok:false,reason:'INSUFFICIENT_CASH',need,cash:wallet.cash};
  wallet.cash-=need;wallet.base+=qty;wallet.costs+=fee+qty*(px-level);wallet.fills++;
  return{ok:true,notional,fee,execPrice:px};
}
function executeSell(wallet,qty,level,cfg){
  if(wallet.base+EPS<qty)return{ok:false,reason:'INSUFFICIENT_BASE',need:qty,base:wallet.base};
  const px=level*(1-cfg.slippageBps/10000),notional=qty*px,fee=tradeCost(notional,cfg.feeBps);
  wallet.base-=qty;wallet.cash+=notional-fee;wallet.costs+=fee+qty*(level-px);wallet.fills++;
  return{ok:true,notional,fee,execPrice:px};
}
function markEquity(wallet,price){return wallet.cash+wallet.base*price}

function rebalanceHalf(wallet,price,cfg){
  const before=markEquity(wallet,price),targetBase=(before*0.5)/price,diff=targetBase-wallet.base;
  let result={ok:true};
  if(diff>EPS)result=executeBuy(wallet,diff,price,cfg);
  else if(diff<-EPS)result=executeSell(wallet,-diff,price,cfg);
  if(!result.ok)return result;
  wallet.rebalances++;
  return{ok:true,equityBefore:before,equityAfter:markEquity(wallet,price),targetBase};
}
function newGrid(wallet,price,{stepPct,halfLevels,levelMode},cfg){
  const r=rebalanceHalf(wallet,price,cfg);
  if(!r.ok)return{ok:false,...r};
  const levels=buildGridLevels({center:price,stepPct,halfLevels,mode:levelMode});
  const currentIndex=halfLevels;
  const orderQty=wallet.base/halfLevels;
  if(!(orderQty>0))return{ok:false,reason:'INVALID_ORDER_QTY'};
  return{ok:true,levels,currentIndex,orderQty,center:price};
}

export function runDynamicGridMonth({
  bars:rawBars,
  stepPct,
  halfLevels,
  pathMode='PAPER_OLHC',
  dynamicReset=true,
  levelMode='GEOMETRIC',
  startEquity=DYNAMIC_GRID_PROXY_V1_CONFIG.startEquity,
  feeBps=DYNAMIC_GRID_PROXY_V1_CONFIG.feeBps,
  slippageBps=DYNAMIC_GRID_PROXY_V1_CONFIG.slippageBps,
  maxGapMs=DYNAMIC_GRID_PROXY_V1_CONFIG.maxGapMs
}={}){
  const cfg={feeBps,slippageBps};
  let bars;
  try{bars=validateMinuteBars(rawBars,{maxGapMs})}
  catch(e){
    return{
      ruleset:DYNAMIC_GRID_PROXY_V1_RULESET,simulatorRuleset:GRID_PATH_SIMULATOR_V1_RULESET,
      valid:false,reason:'DATA_GATE:'+String(e?.message||e),researchOnly:true,executionImpact:false,autoPromotion:false
    };
  }
  if(!bars.length)return{ruleset:DYNAMIC_GRID_PROXY_V1_RULESET,valid:false,reason:'DATA_GATE:NO_BARS',researchOnly:true,executionImpact:false,autoPromotion:false};
  if(!DYNAMIC_GRID_PROXY_V1_PATHS.includes(pathMode))throw new Error('unsupported path mode');
  if(!(stepPct>0&&Number.isInteger(halfLevels)&&halfLevels>=1))throw new Error('invalid strategy parameters');

  const wallet={cash:startEquity,base:0,costs:0,fills:0,rebalances:0,resets:0};
  let grid=newGrid(wallet,bars[0].open,{stepPct,halfLevels,levelMode},cfg);
  if(!grid.ok)return{ruleset:DYNAMIC_GRID_PROXY_V1_RULESET,valid:false,reason:'WALLET:'+grid.reason,researchOnly:true,executionImpact:false,autoPromotion:false};
  let resetPending=false,peak=markEquity(wallet,bars[0].open),maxDD=0,previousClose=bars[0].open;
  const equityCurve=[],events=[];
  const firstTs=bars[0].openTime,lastTs=bars.at(-1).openTime;

  for(let bi=0;bi<bars.length;bi++){
    const bar=bars[bi];
    let resetThisBar=false;
    if(resetPending){
      grid=newGrid(wallet,bar.open,{stepPct,halfLevels,levelMode},cfg);
      if(!grid.ok)return{ruleset:DYNAMIC_GRID_PROXY_V1_RULESET,valid:false,reason:'WALLET:'+grid.reason,insufficientWallet:true,researchOnly:true,executionImpact:false,autoPromotion:false};
      wallet.resets++;
      resetPending=false;
      resetThisBar=true;
    }
    const points=pathPoints(bar,previousClose,pathMode,bi===0||resetThisBar);
    let stopBar=false;
    for(let si=0;si<points.length-1&&!stopBar;si++){
      const r=crossSegment({start:points[si],end:points[si+1],levels:grid.levels,currentIndex:grid.currentIndex,meta:{barIndex:bi,segmentIndex:si,openTime:bar.openTime}});
      for(const ev of r.events){
        const tr=ev.side==='BUY'?executeBuy(wallet,grid.orderQty,ev.price,cfg):executeSell(wallet,grid.orderQty,ev.price,cfg);
        if(!tr.ok){
          return{
            ruleset:DYNAMIC_GRID_PROXY_V1_RULESET,valid:false,reason:'WALLET:'+tr.reason,insufficientWallet:true,
            month:monthKey(firstTs),pathMode,dynamicReset,stepPct,halfLevels,levelMode,researchOnly:true,executionImpact:false,autoPromotion:false
          };
        }
        events.push({openTime:bar.openTime,side:ev.side,price:ev.price,toLevelIndex:ev.toLevelIndex});
        grid.currentIndex=ev.toLevelIndex;
        const boundary=grid.currentIndex===0||grid.currentIndex===grid.levels.length-1;
        if(dynamicReset&&boundary){
          resetPending=true;stopBar=true;break;
        }
      }
      if(!stopBar)grid.currentIndex=r.currentIndex;
    }
    const eq=markEquity(wallet,bar.close);
    peak=Math.max(peak,eq);
    if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);
    equityCurve.push({openTime:bar.openTime,equity:eq});
    previousClose=bar.close;
  }

  const finalPrice=bars.at(-1).close,endEquity=markEquity(wallet,finalPrice);
  return{
    ruleset:DYNAMIC_GRID_PROXY_V1_RULESET,
    simulatorRuleset:GRID_PATH_SIMULATOR_V1_RULESET,
    valid:true,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    month:monthKey(firstTs),firstTs,lastTs,pathMode,dynamicReset,stepPct,halfLevels,levelMode,
    startEquity,endEquity:returnFinite(endEquity),
    return:endEquity/startEquity-1,
    returnPct:(endEquity/startEquity-1)*100,
    maxDrawdownPct:maxDD,
    fills:wallet.fills,rebalances:wallet.rebalances,resets:wallet.resets,costs:wallet.costs,
    insufficientWallet:false,
    buyHoldReturn:finalPrice/bars[0].open-1,
    eventCount:events.length,
    equityCurve
  };
}
function returnFinite(x){if(!finite(x))throw new Error('non-finite equity');return x}

export function summarizeGridCycles(cycles,{assets=DYNAMIC_GRID_PROXY_V1_ASSETS}={}){
  const valid=(cycles||[]).filter(x=>x?.valid);
  const insufficient=(cycles||[]).filter(x=>x?.insufficientWallet).length;
  const byMonth=new Map();
  for(const c of valid){
    if(!byMonth.has(c.month))byMonth.set(c.month,[]);
    byMonth.get(c.month).push(c);
  }
  const periods=[...byMonth.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,xs])=>{
    const rows=assets.map(a=>xs.find(x=>x.asset===a)).filter(Boolean);
    if(rows.length!==assets.length)return null;
    return{month,return:mean(rows.map(x=>x.return)),assetReturns:Object.fromEntries(rows.map(x=>[x.asset,x.return]))};
  }).filter(Boolean);
  const rs=periods.map(x=>x.return),stability=chronologicalWindows(periods,5);
  const byAsset=assets.map(asset=>{
    const xs=valid.filter(x=>x.asset===asset&&periods.some(p=>p.month===x.month));
    const ars=xs.sort((a,b)=>a.month.localeCompare(b.month)).map(x=>x.return);
    return{
      asset,cycles:xs.length,returnPct:compound(ars)*100,
      maxDrawdownPct:xs.length?Math.max(...xs.map(x=>x.maxDrawdownPct)):null,
      fills:sum(xs.map(x=>x.fills||0)),resets:sum(xs.map(x=>x.resets||0)),costs:sum(xs.map(x=>x.costs||0))
    };
  });
  return{
    cycles:valid.length,
    pairedCycles:periods.length*assets.length,
    months:periods.length,
    periods,
    totalReturnPct:compound(rs)*100,
    profitFactor:profitFactor(rs),
    maxDrawdownPct:valid.length?Math.max(...valid.map(x=>x.maxDrawdownPct)):null,
    positiveWindows:stability.positiveWindows,
    windows:stability.windows,
    byAsset,
    fills:sum(valid.map(x=>x.fills||0)),
    resets:sum(valid.map(x=>x.resets||0)),
    costs:sum(valid.map(x=>x.costs||0)),
    insufficientWallet:insufficient,
    rejected:(cycles||[]).length-valid.length
  };
}

export function evaluateDynamicGridPath({dynamicCycles,staticCycles,assets=DYNAMIC_GRID_PROXY_V1_ASSETS,gate=DYNAMIC_GRID_PROXY_V1_CONFIG.gate}={}){
  const dynamic=summarizeGridCycles(dynamicCycles,{assets}),staticSummary=summarizeGridCycles(staticCycles,{assets}),reasons=[];
  if(dynamic.pairedCycles<gate.minAssetMonthCycles)reasons.push('CYCLES_LT_'+gate.minAssetMonthCycles);
  for(const a of dynamic.byAsset)if(a.cycles<gate.minCyclesPerAsset)reasons.push(a.asset+'_CYCLES_LT_'+gate.minCyclesPerAsset);
  if(!(dynamic.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(dynamic.profitFactor>=gate.minProfitFactor))reasons.push('PF_LT_'+gate.minProfitFactor);
  if(!(dynamic.maxDrawdownPct<=gate.maxDrawdownPct))reasons.push('DD_GT_'+gate.maxDrawdownPct+'PCT');
  if(dynamic.positiveWindows<gate.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  for(const a of dynamic.byAsset)if(!(a.returnPct>0))reasons.push(a.asset+'_RETURN_NOT_POSITIVE');
  if(!(dynamic.totalReturnPct>staticSummary.totalReturnPct))reasons.push('DYNAMIC_NOT_ABOVE_STATIC');
  if(dynamic.insufficientWallet>0)reasons.push('INSUFFICIENT_WALLET');
  return{pass:reasons.length===0,reasons,dynamic,static:staticSummary};
}

export function evaluateDynamicGridCandidate({
  paper,alt,paperStress,altStress,
  gate=DYNAMIC_GRID_PROXY_V1_CONFIG.gate
}={}){
  const reasons=[];
  for(const [name,r] of [['PAPER',paper],['ALT',alt]]){
    if(!r?.pass)reasons.push(...(r?.reasons||['MISSING_'+name]).map(x=>name+':'+x));
  }
  if(!(paperStress?.dynamic?.totalReturnPct>0))reasons.push('PAPER:STRESS_RETURN_NOT_POSITIVE');
  if(!(altStress?.dynamic?.totalReturnPct>0))reasons.push('ALT:STRESS_RETURN_NOT_POSITIVE');
  const p=paper?.dynamic?.totalReturnPct,a=alt?.dynamic?.totalReturnPct;
  const spread=finite(p)&&finite(a)?Math.abs(p-a):Infinity;
  if(spread>gate.maxPathSpreadPctPoints)reasons.push('PATH_SPREAD_GT_'+gate.maxPathSpreadPctPoints+'PCTPTS');
  const worstReturn=Math.min(finite(p)?p:-Infinity,finite(a)?a:-Infinity);
  const worstDD=Math.max(paper?.dynamic?.maxDrawdownPct??Infinity,alt?.dynamic?.maxDrawdownPct??Infinity);
  return{
    pass:reasons.length===0,reasons,
    worstPathReturnPct:worstReturn,worstPathMaxDrawdownPct:worstDD,pathSpreadPctPoints:spread,
    paper,alt,paperStress,altStress
  };
}
