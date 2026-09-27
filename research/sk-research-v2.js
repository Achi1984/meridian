import {
  SK_PAPERBOT_V1_CONFIG,replaySkPaperBot,summarizeSkTradeCohort,
  skChronologicalStability,deepestSkEntryRatio
} from './sk-paperbot-v1.js';

export const SK_RESEARCH_V2_RULESET='SK-RESEARCH-V2-AB-FROZEN';
export const SK_RESEARCH_V2_ENGINE_REVISION='PREENTRY-CLOSED-BAR-R2';
export const SK_RESEARCH_V2_ASSETS=Object.freeze(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
export const SK_RESEARCH_V2_GATE=Object.freeze({
  minDoubleTrades:20,
  minProfitFactor:1.2,
  maxClosedTradeDrawdownPct:10,
  minPositiveWindows:3,
  minPositiveAssets:3,
  maxPositivePnlConcentrationPct:50
});

const finite=v=>Number.isFinite(Number(v));
const num=v=>Number(v);
const safe=(v,d=6)=>finite(v)?Math.round(num(v)*10**d)/10**d:null;

export function isPreEntryDoubleAdvantage(trade){
  return !!(
    trade?.doubleAdvantage===true &&
    trade?.doubleAdvantageBeforeEntry===true &&
    finite(trade?.doubleAdvantageAt) &&
    finite(trade?.openedAt) &&
    num(trade.doubleAdvantageAt)<num(trade.openedAt)
  );
}

export function skV2Cohorts(replay){
  const core=(replay?.trades||[]).filter(t=>finite(t?.realizedPnl));
  const double=core.filter(isPreEntryDoubleAdvantage);
  const nonDouble=core.filter(t=>!isPreEntryDoubleAdvantage(t));
  return{core,double,nonDouble};
}

export function skEntryDepthCohorts(trades){
  const ratios=[.5,.559,.618,.667],out={};
  for(const r of ratios){
    const rows=(trades||[]).filter(t=>deepestSkEntryRatio(t)===r);
    out[r.toFixed(3)]={ratio:r,summary:summarizeSkTradeCohort(rows),trades:rows.length};
  }
  return out;
}

export function compareSkCoreVsDouble(replay){
  const c=skV2Cohorts(replay),core=summarizeSkTradeCohort(c.core),double=summarizeSkTradeCohort(c.double),nonDouble=summarizeSkTradeCohort(c.nonDouble);
  return{
    core,double,nonDouble,
    delta:{
      profitFactor:safe(double.profitFactor-core.profitFactor),
      expectancy:safe(double.expectancy-core.expectancy),
      winRate:safe(double.winRate-core.winRate),
      maxDrawdownPct:safe(double.maxDrawdownPct-core.maxDrawdownPct)
    },
    entryDepth:skEntryDepthCohorts(c.core)
  };
}

function positivePnlConcentration(assetRows){
  const pos=(assetRows||[]).filter(x=>num(x.double?.pnl)>0);
  const total=pos.reduce((a,x)=>a+num(x.double.pnl),0);
  if(!(total>0))return 0;
  return Math.max(...pos.map(x=>num(x.double.pnl)/total*100),0);
}

export function evaluateSkResearchV2(batch,gate=SK_RESEARCH_V2_GATE){
  const d=batch?.pooled?.double||{},st=batch?.stability||{},assets=batch?.assets||[];
  const reasons=[];
  if((d.trades||0)<gate.minDoubleTrades)reasons.push('DOUBLE_SAMPLE_LT_'+gate.minDoubleTrades);
  if((d.profitFactor||0)<gate.minProfitFactor)reasons.push('DOUBLE_PF_LT_'+gate.minProfitFactor);
  if(!finite(d.expectancy)||d.expectancy<=0)reasons.push('DOUBLE_EXPECTANCY_NOT_POSITIVE');
  if((d.maxDrawdownPct??Infinity)>gate.maxClosedTradeDrawdownPct)reasons.push('DOUBLE_CLOSED_DD_GT_'+gate.maxClosedTradeDrawdownPct+'PCT');
  if((st.positiveWindows||0)<gate.minPositiveWindows)reasons.push('DOUBLE_POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  const positiveAssets=assets.filter(x=>num(x.double?.pnl)>0).length;
  if(positiveAssets<gate.minPositiveAssets)reasons.push('DOUBLE_POSITIVE_ASSETS_LT_'+gate.minPositiveAssets);
  const concentration=positivePnlConcentration(assets);
  if(concentration>gate.maxPositivePnlConcentrationPct)reasons.push('DOUBLE_PNL_CONCENTRATION_GT_'+gate.maxPositivePnlConcentrationPct+'PCT');
  return{
    pass:reasons.length===0,
    reasons,
    autoPromotion:false,
    executionImpact:false,
    label:reasons.length?'V2_GATE_FAIL':'V2_GATE_PASS',
    positiveAssets,
    positivePnlConcentrationPct:safe(concentration,2)
  };
}

export function aggregateSkResearchV2(assetRuns){
  const runs=(assetRuns||[]).filter(x=>x?.replay);
  const coreTrades=[],doubleTrades=[],assets=[];
  for(const row of runs){
    const cmp=compareSkCoreVsDouble(row.replay);
    const annotate=t=>({...t,symbol:row.symbol});
    coreTrades.push(...(row.replay.trades||[]).map(annotate));
    doubleTrades.push(...(row.replay.trades||[]).filter(isPreEntryDoubleAdvantage).map(annotate));
    assets.push({
      symbol:row.symbol,
      bars:row.bars||0,
      first:row.first||null,
      last:row.last||null,
      core:cmp.core,
      double:cmp.double,
      delta:cmp.delta,
      entryDepth:cmp.entryDepth
    });
  }
  coreTrades.sort((a,b)=>(a.openedAt??0)-(b.openedAt??0));
  doubleTrades.sort((a,b)=>(a.openedAt??0)-(b.openedAt??0));
  const pooled={
    core:summarizeSkTradeCohort(coreTrades),
    double:summarizeSkTradeCohort(doubleTrades),
    entryDepth:skEntryDepthCohorts(coreTrades)
  };
  const stability=skChronologicalStability(doubleTrades,5);
  const batch={ruleset:SK_RESEARCH_V2_RULESET,engineRevision:SK_RESEARCH_V2_ENGINE_REVISION,researchOnly:true,executionImpact:false,autoPromotion:false,assets,pooled,stability};
  return{...batch,gate:evaluateSkResearchV2(batch)};
}

export function runSkResearchV2Asset(rows,symbol){
  const replay=replaySkPaperBot(rows,{config:SK_PAPERBOT_V1_CONFIG});
  const comparison=compareSkCoreVsDouble(replay);
  return{symbol,replay,comparison};
}
