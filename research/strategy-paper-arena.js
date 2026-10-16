// Isolated experimental spot simulations. No runtime, network, storage or trading authority.
export const ARENA_RULESET='STRATEGY-PAPER-ARENA-20261016-V1';
export const ARENA_SYMBOLS=Object.freeze(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
export const ARENA_CANDIDATES=Object.freeze(['H1-B','H1-E','H7-B','H7-R','H9']);
const DAY=86400000,START=10000,WARMUP=200;
const AUTHORITY=Object.freeze({liveAuthorized:false,autoPromotion:false,validation:'UNPROVEN'});
const COMPATIBILITY=Object.freeze({riskPolicy:'PORTFOLIO_LEVEL_NO_STOP',plannedNetCRV:'NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF',crvAssessment:'NOT_ASSESSED',legacyCRVCompatibility:'UNRESOLVED',paperReadiness:false});
export const ARENA_MODEL=Object.freeze({currency:'USDT',startingEquity:START,spotLeverage:1,warmupBars:WARMUP,baselineCostBps:8,stressCostBps:16,maxBarsPerAsset:2500,costBasis:'DESIGN_ASSUMPTION_NOT_VERIFIED_VENUE_COST',riskPolicy:'PORTFOLIO_LEVEL_NO_STOP',lossBound:'ENTIRE_NOMINAL_ACCOUNT_CAPITAL',riskLimitation:'Daily signal exits are not hard stops; losses can reach all committed spot capital.',targetWeightLimitH7:0.25,targetCashMinimumH7:0.25,weightLimitApplies:'AT_WEEKLY_REBALANCE_TARGET_ONLY; MARKET_DRIFT_IS_NOT_A_TARGET_CAP_BREACH',tradeUnit:'REALIZED_SALE_SLICE_NOT_INDEPENDENT_BET',turnoverDenominator:'INITIAL_NOMINAL_ACCOUNT_CAPITAL',h1EntryBufferFraction:0.0016,thresholdH1E:0.0016,h1EntryBufferTreatment:'FROZEN_BASELINE_ASSUMPTION_UNCHANGED_IN_COST_STRESS',h7TieBreak:'FIXED_UNIVERSE_ORDER',h7Retention:'ELIGIBLE_PREEXISTING_HOLDINGS_RANK_AT_MOST_4_THEN_FILL_TO_3'});

function validate({data,asOf,sourceKind,liquidateAtEnd}){
  if(!Number.isFinite(asOf)||!['SYNTHETIC','MARKET_DIAGNOSTIC'].includes(sourceKind))throw Error('EXPLICIT_AS_OF_AND_SOURCE_KIND_REQUIRED');
  if(typeof liquidateAtEnd!=='boolean')throw Error('INVALID_LIQUIDATION_OPTION');
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==ARENA_SYMBOLS.length||Object.keys(data).some(s=>!ARENA_SYMBOLS.includes(s)))throw Error('EXACT_EIGHT_SYMBOL_UNIVERSE_REQUIRED');
  let length=null;
  for(const symbol of ARENA_SYMBOLS){
    const rows=data[symbol];
    if(!Array.isArray(rows)||rows.length<202||rows.length>2500||(length!==null&&rows.length!==length))throw Error('INVALID_COMMON_HISTORY_LENGTH');
    length=rows.length;
    for(let i=0;i<length;i++){
      const r=rows[i];
      if(!r||!['openTime','open','high','low','close','closeTime'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])))throw Error('INVALID_CANDLE_NUMBER');
      if(!Number.isSafeInteger(r.openTime)||r.openTime%DAY!==0||r.closeTime!==r.openTime+DAY-1||r.closeTime>asOf)throw Error('INVALID_OR_UNCLOSED_UTC_DAILY_CANDLE');
      if(!(r.low>0&&r.high>=r.low&&r.open>=r.low&&r.open<=r.high&&r.close>=r.low&&r.close<=r.high))throw Error('INVALID_OHLC');
      if(i&&r.openTime!==rows[i-1].openTime+DAY)throw Error('GAP_DUPLICATE_OR_UNORDERED_CANDLES');
      if(symbol!==ARENA_SYMBOLS[0]&&r.openTime!==data[ARENA_SYMBOLS[0]][i].openTime)throw Error('UNALIGNED_COMMON_CALENDAR');
    }
  }
  return length;
}
function features(rows,index){
  let sma200=0;for(let j=index-199;j<=index;j++)sma200+=rows[j].close/200;
  const close=rows[index].close;
  const returns=[];for(let j=index-29;j<=index;j++)returns.push(Math.log(rows[j].close)-Math.log(rows[j-1].close));
  const mean=returns.reduce((a,b)=>a+b,0)/30;
  const f={close,sma200,momentum90:close/rows[index-90].close-1,volatility30:Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/30)};
  if(!Object.values(f).every(Number.isFinite)||!(f.sma200>0))throw Error('NONFINITE_DERIVED_FEATURE');
  return f;
}
function run(id,data,length,costBps,liquidateAtEnd){
  const rate=costBps/10000,positions={},fills=[],trades=[],decisions=[],equityCurve=[];
  let cash=START,costs=0,turnoverNotional=0,peak=START,maxDrawdownPct=0;
  const equityAt=(i,field)=>{const value=cash+ARENA_SYMBOLS.reduce((sum,s)=>sum+(positions[s]?.quantity||0)*data[s][i][field],0);if(!Number.isFinite(value)||value<0)throw Error('INVALID_DERIVED_EQUITY');return value;};
  function rebalance(i,targets,reason,signalTime,field='open'){
    const prices=Object.fromEntries(ARENA_SYMBOLS.map(s=>[s,data[s][i][field]]));
    const before=equityAt(i,field);
    // Targets are either post-cost equity weights or unchanged quantities.
    const fixedNotional=ARENA_SYMBOLS.reduce((v,s)=>v+(targets[s]?.weight===undefined?(targets[s]?.quantity||0)*prices[s]:0),0);
    const weightSum=ARENA_SYMBOLS.reduce((v,s)=>v+(targets[s]?.weight||0),0);
    const amount=(s,e)=>targets[s]?.weight!==undefined?Math.min(targets[s].weight*e,weightSum>0?targets[s].weight/weightSum*Math.max(0,e-fixedNotional):0):(targets[s]?.quantity||0)*prices[s];
    const fee=e=>ARENA_SYMBOLS.reduce((sum,s)=>sum+Math.abs(amount(s,e)-(positions[s]?.quantity||0)*prices[s])*rate,0);
    let lo=0,hi=before;for(let j=0;j<60;j++){const mid=(lo+hi)/2;if(mid+fee(mid)>before)hi=mid;else lo=mid;}
    const after=(lo+hi)/2,executionTime=field==='open'?data.BTC[i].openTime:data.BTC[i].closeTime;
    const deltas=ARENA_SYMBOLS.map(symbol=>({symbol,quantity:amount(symbol,after)/prices[symbol]-(positions[symbol]?.quantity||0)}));
    // All sells before buys; post-cost equity sizing prevents negative cash.
    for(const {symbol,quantity:delta} of [...deltas.filter(x=>x.quantity<0),...deltas.filter(x=>x.quantity>0)]){
      const price=prices[symbol],quantity=Math.abs(delta),notional=quantity*price,feePaid=notional*rate;
      if(![quantity,notional,feePaid].every(Number.isFinite))throw Error('NONFINITE_FILL_ACCOUNTING');
      if(notional<1e-8)continue;
      const side=delta>0?'BUY':'SELL';costs+=feePaid;turnoverNotional+=notional;
      fills.push({symbol,side,quantity,price,notional,cost:feePaid,signalTime,executionTime,reason});
      if(side==='BUY'){
        cash-=notional+feePaid;
        const p=positions[symbol];
        positions[symbol]={quantity:(p?.quantity||0)+quantity,entryNotional:(p?.entryNotional||0)+notional,entryCost:(p?.entryCost||0)+feePaid,openedAt:p?.openedAt??executionTime};
      }else{
        const p=positions[symbol],fraction=quantity/p.quantity,entryNotional=p.entryNotional*fraction,entryCost=p.entryCost*fraction;
        cash+=notional-feePaid;
        trades.push({symbol,quantity,openedAt:p.openedAt,closedAt:executionTime,entryNotional,exitNotional:notional,costs:entryCost+feePaid,netPnl:notional-entryNotional-entryCost-feePaid,reason});
        if(quantity>=p.quantity*(1-1e-10))delete positions[symbol];
        else{p.quantity-=quantity;p.entryNotional-=entryNotional;p.entryCost-=entryCost;}
      }
    }
    if(cash< -1e-6)throw Error('NEGATIVE_CASH_INVARIANT');
    if(Math.abs(cash)<1e-8)cash=0;
    return {equity:equityAt(i,field),cash,weights:Object.fromEntries(ARENA_SYMBOLS.map(s=>[s,(positions[s]?.quantity||0)*prices[s]/equityAt(i,field)]))};
  }
  for(let i=WARMUP;i<length;i++){
    const signalIndex=i-1,signalTime=data.BTC[signalIndex].closeTime,executionTime=data.BTC[i].openTime;
    const f=Object.fromEntries(ARENA_SYMBOLS.map(s=>[s,features(data[s],signalIndex)]));
    const targets=Object.fromEntries(ARENA_SYMBOLS.map(s=>[s,{quantity:positions[s]?.quantity||0}]));
    let reason=null;
    if(id==='BUY_AND_HOLD'&&i===WARMUP){for(const s of ARENA_SYMBOLS)targets[s]={weight:1/8};reason='INITIAL_EQUAL_WEIGHT';}
    if(id.startsWith('H1')){
      for(const s of ARENA_SYMBOLS){
        if(positions[s]&&f[s].close<=f[s].sma200){targets[s]={quantity:0};reason='DAILY_TREND_EXIT';}
        else if(!positions[s]&&f[s].close>f[s].sma200&&f[s].momentum90>0&&(id!=='H1-E'||f[s].close/f[s].sma200-1>ARENA_MODEL.thresholdH1E)){targets[s]={weight:1/8};reason=reason||'DAILY_TREND_ENTRY';}
      }
    }
    if(id.startsWith('H7')){
      for(const s of ARENA_SYMBOLS)if(positions[s]&&f[s].close<=f[s].sma200){targets[s]={quantity:0};reason='DAILY_TREND_EXIT';}
      if(new Date(executionTime).getUTCDay()===6){
        const ranked=ARENA_SYMBOLS.filter(s=>f[s].close>f[s].sma200).sort((a,b)=>f[a].volatility30-f[b].volatility30||ARENA_SYMBOLS.indexOf(a)-ARENA_SYMBOLS.indexOf(b));
        const selected=id==='H7-R'?ranked.filter((s,j)=>j<4&&positions[s]).slice(0,3):[];
        for(const s of ranked)if(selected.length<3&&!selected.includes(s))selected.push(s);
        for(const s of ARENA_SYMBOLS)targets[s]={weight:selected.includes(s)?0.25:0};
        reason='WEEKLY_RANK_REBALANCE';
      }
    }
    if(reason){const allocation=rebalance(i,targets,reason,signalTime);decisions.push({signalTime,executionTime,reason,...allocation});}
    const equity=equityAt(i,'close');peak=Math.max(peak,equity);maxDrawdownPct=Math.max(maxDrawdownPct,100*(peak-equity)/peak);
    equityCurve.push({at:data.BTC[i].closeTime,equity,cash});
  }
  if(liquidateAtEnd){
    const targets=Object.fromEntries(ARENA_SYMBOLS.map(s=>[s,{quantity:0}]));
    rebalance(length-1,targets,'DIAGNOSTIC_END_CLOSE_LIQUIDATION',null,'close');
    const equity=cash;peak=Math.max(peak,equity);maxDrawdownPct=Math.max(maxDrawdownPct,100*(peak-equity)/peak);
    equityCurve[equityCurve.length-1]={at:data.BTC[length-1].closeTime,equity,cash,diagnosticLiquidation:true};
  }
  const equity=equityAt(length-1,'close'),wins=trades.reduce((a,t)=>a+Math.max(0,t.netPnl),0),losses=trades.reduce((a,t)=>a+Math.max(0,-t.netPnl),0);
  return {id,currency:'USDT',costBps,costBasis:ARENA_MODEL.costBasis,startingEquity:START,equity,netPnl:equity-START,netReturnPct:100*(equity/START-1),maxDrawdownPct,turnoverNotional,turnoverRatio:turnoverNotional/START,costs,closedTrades:trades.length,openPositions:Object.keys(positions).length,profitFactor:losses>0?wins/losses:null,profitFactorReason:losses>0?'DEFINED':trades.length?'NO_GROSS_LOSS':'NO_CLOSED_TRADES',drawdownSampling:'DAILY_CLOSE_ONLY',drawdownTerminalLiquidationIncluded:liquidateAtEnd,initialPeakEquity:START,initialEquityCurvePoint:{at:data.BTC[WARMUP].openTime-1,equity:START,cash:START},unrealizedIncludesExitCosts:false,cash,positions,decisions,fills,trades,equityCurve,endTreatment:liquidateAtEnd?'DIAGNOSTIC_END_CLOSE_LIQUIDATION':'MARKED_OPEN_POSITIONS_NO_TERMINAL_EXIT_COST',...AUTHORITY,...COMPATIBILITY};
}
export function replayStrategyPaperArena({data,asOf,sourceKind,liquidateAtEnd=false}={}){
  const length=validate({data,asOf,sourceKind,liquidateAtEnd});
  const pair=id=>({id,baseline:run(id,data,length,8,liquidateAtEnd),stress:run(id,data,length,16,liquidateAtEnd)});
  return {schemaVersion:'MERIDIAN_STRATEGY_PAPER_ARENA_V1',ruleset:ARENA_RULESET,sourceKind,asOf,mode:'PAPER_SIMULATION',evidence:sourceKind==='SYNTHETIC'?'ENGINEERING_ONLY_NOT_MARKET_EVIDENCE':'RETROSPECTIVE_DIAGNOSTIC_NOT_INDEPENDENT_VALIDATION',model:{...ARENA_MODEL},...AUTHORITY,...COMPATIBILITY,candidates:[...['H1-B','H1-E','H7-B','H7-R'].map(pair),{id:'H9',status:'BLOCKED_DATA',reasons:['DATED_FUTURES_EXECUTABLE_QUOTES_SETTLEMENT_FINANCING_AND_MARGIN_PATH_REQUIRED'],netPnl:null,profitFactor:null,...AUTHORITY,...COMPATIBILITY}],controls:{buyAndHold:pair('BUY_AND_HOLD'),cash:pair('CASH')},capitalAccounting:'INDEPENDENT_10000_USDT_SIMULATIONS_NOT_ADDITIVE_PORTFOLIO',window:{warmupStart:data.BTC[0].openTime,firstDecision:data.BTC[199].closeTime,firstExecution:data.BTC[200].openTime,end:data.BTC[length-1].closeTime,bars:length-WARMUP},limitations:['Fixed current universe: survivorship bias not resolved.','Caller-supplied OHLC and source labels are not independently authenticated availability evidence.','No historical holdout independence, statistical validation or forward sample established.','No spread, depth, market impact, taxes or EUR conversion separately verified; costs are aggregate design assumptions.','No strategy promotion or running server is created by this pure replay.']};
}
