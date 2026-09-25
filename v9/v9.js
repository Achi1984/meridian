const API_BASE=(window.MERIDIAN_V9_CONFIG?.apiBase||'https://p01--achi-meridian--ttvk44grdlp7.code.run').replace(/\/$/,'');
const TOKEN_KEY='meridian.v8.readToken';
const FALLBACK=[
{id:'BTC-7X',symbol:'BTC',leverage:7,lower:55000,upper:100000,be:85907.2,liq:62001.6,tp:100000,investCoin:.03,price:85704.2,createdPrice:85866,grids:174},
{id:'ETH-3X-A',symbol:'ETH',leverage:3,lower:1750.02,upper:3900,be:2623.5,liq:1694.32,tp:3900,investCoin:.2518},{id:'ETH-4X-B',symbol:'ETH',leverage:4,lower:1750.02,upper:3500.05,be:2632.87,liq:1783.99,tp:3500.05,investCoin:.3405},
{id:'SOL-4X',symbol:'SOL',leverage:4,lower:55,upper:185,be:115.655,liq:66.51,tp:185,investCoin:58.807,price:115.553,createdPrice:115.6,grids:374},
{id:'XRP-4X',symbol:'XRP',leverage:4,lower:.85,upper:1.8501,be:1.4442,liq:.9163,tp:1.8501,investCoin:1868.17},
{id:'HBAR-5X-A',symbol:'HBAR',leverage:5,lower:.06,upper:.12,be:.08569,liq:.0606,tp:.12,investCoin:10800,dynamicMargin:2200},{id:'HBAR-5X-B',symbol:'HBAR',leverage:5,lower:.06,upper:.125,be:.08622,liq:.06343,tp:.125,investCoin:5000},{id:'HBAR-3X-C',symbol:'HBAR',leverage:3,lower:.05,upper:.15,be:.08682,liq:.05198,tp:.15,investCoin:7990.15},
{id:'SUI-LONG-4X',symbol:'SUI',side:'LONG',leverage:4,lower:.6,upper:1.5,be:1.0196,liq:.6543,tp:1.5,investCoin:1365.2,price:.9686,createdPrice:1.0375,grids:289,pnlCoin:-75.89,profitPct:-5.56},
{id:'ADA-LONG-5X',symbol:'ADA',side:'LONG',leverage:5,lower:.125,upper:.5,be:.2572,liq:.1616,tp:.5,investCoin:5891.35,price:.2398,createdPrice:.259,grids:482,profitPct:-8.33},
{id:'PEPE-4X-A',symbol:'PEPE',leverage:4,lower:.000002,upper:.000006,be:.0000040029,liq:.000002368,tp:.000006,investCoin:73524672.71},{id:'PEPE-3X-B',symbol:'PEPE',leverage:3,lower:.000002,upper:.000006,be:.0000040029,liq:.0000021748,tp:.000006,investCoin:31670289.08},
{id:'AVAX-LONG-6X',symbol:'AVAX',side:'LONG',leverage:6,lower:6,upper:14.5,be:10.889,liq:7.169,tp:14.5,investCoin:90.46,dynamicMargin:13.1,price:10.295,createdPrice:11.189,grids:253,pnlCoin:-6.58,profitPct:-7.28,note:'Screenshot 24.09.2026 16:06 · authoritative'},
{id:'DOT-SHORT-5X',symbol:'DOT',side:'SHORT',leverage:5,lower:.7,upper:2,be:1.195,liq:1.604,tp:.7,investCoin:244.66,price:1.099,createdPrice:1.188,grids:364,profitPct:24.18},
{id:'ADA-SHORT-3X',symbol:'ADA',side:'SHORT',leverage:3,lower:.125,upper:.5,be:.2596,liq:.477,tp:.125,investCoin:1443.37,price:.2398,createdPrice:.2587,grids:483,profitPct:13.54},
{id:'SUI-SHORT-4X',symbol:'SUI',side:'SHORT',leverage:4,lower:.75,upper:2,be:1.0148,liq:1.7314,tp:.75,investCoin:455.06,price:.9681,createdPrice:1.0077,grids:413,profitPct:6.22},
{id:'AVAX-SHORT-10X',symbol:'AVAX',side:'SHORT',leverage:10,lower:8,upper:20,be:11.085,liq:14.499,tp:8,investCoin:4.99,dynamicMargin:0,price:10.295,createdPrice:10.908,grids:366,pnlCoin:.935,profitPct:18.74,note:'Screenshot 24.09.2026 16:06 · authoritative'},
{id:'LINK-LONG-5X',symbol:'LINK',side:'LONG',leverage:5,lower:6.5,upper:21,be:12.707,liq:8.178,tp:21,investCoin:147.37,price:12.292,createdPrice:12.734,grids:379,profitPct:-3.69},
{id:'LINK-SHORT-4X',symbol:'LINK',side:'SHORT',leverage:4,lower:8,upper:25,be:12.737,liq:19.959,tp:8,investCoin:36.84,price:12.292,createdPrice:12.72,grids:445,profitPct:7.03},
{id:'XLM-LONG-5X',symbol:'XLM',side:'LONG',leverage:5,lower:.12,upper:.36001,be:.21304,liq:.14327,tp:.36001,investCoin:5430.54,price:.20386,createdPrice:.21364,grids:373,profitPct:-6.09},
{id:'XLM-SHORT-5X',symbol:'XLM',side:'SHORT',leverage:5,lower:.145,upper:.4,be:.2141,liq:.32662,tp:.145,investCoin:1357.63,price:.20386,createdPrice:.21345,grids:398,profitPct:9.33},
{id:'TRX-LONG-6X',symbol:'TRX',side:'LONG',leverage:6,lower:.25,upper:.44,be:.3417,liq:.26389,tp:.44,investCoin:3533.43,price:.33943,createdPrice:.34163,grids:185,profitPct:-1.32},
{id:'TRX-SHORT-5X',symbol:'TRX',side:'SHORT',leverage:5,lower:.275,upper:.45,be:.34139,liq:.45975,tp:.275,investCoin:706.68,price:.33943,createdPrice:.34154,grids:170,profitPct:1.37},
{id:'WIF-LONG-6X',symbol:'WIF',side:'LONG',leverage:6,lower:.1,upper:.45,be:.2418,liq:.1385,tp:.45,investCoin:2042.24,price:.2275,createdPrice:.2432,grids:480,profitPct:-5.09},
{id:'WIF-SHORT-6X',symbol:'WIF',side:'SHORT',leverage:6,lower:.1,upper:.5,be:.2441,liq:.3131,tp:.135,investCoin:408.44,price:.2275,createdPrice:.2435,grids:546,profitPct:27.92}
];
const HEDGES=[
{id:'BTC-HEDGE-PIONEX-GRID-7X',venue:'Pionex',symbol:'BTC',side:'SHORT',leverage:7,investCoin:.00631,entry:84265.6,be:84246.2,liq:103105.8,sl:null,lower:65000,upper:105800,tp:65000,dynamicMargin:0,price:84334.3,grids:161,note:'BTC COIN-M Short Grid · bestätigt 23.09.2026 21:01'},
{id:'BTC-HEDGE-PIONEX-MANUAL-7X',venue:'Pionex',symbol:'BTC',side:'SHORT',leverage:7,investCoin:.00428,entry:81095.5,be:81095.5,liq:100054.2,sl:100000,tp:79200,dynamicMargin:.00149,price:84277,note:'Separater manueller BTC COIN-M Short · bestätigt 23.09.2026 21:02'}
];
const MANUAL_POSITIONS=[
{id:'PIONEX-PEPE-MANUAL-3X',venue:'Pionex',symbol:'PEPE',side:'LONG',leverage:3,investCoin:3746504.29,entry:.0000047394,be:.0000047394,price:.0000043636,liq:.0000035907,dynamicMargin:0,note:'Separater manueller PEPE COIN-M Long · bestätigt 23.09.2026 21:02'}
];
const PIONEX_MANUAL=[
{id:'PIONEX-XRP-MANUAL-LONG-5X',venue:'Pionex',type:'MANUAL',marginMode:'CROSS',symbol:'XRP',side:'LONG',leverage:5,sizeCoin:105,marginUsd:31.39,notionalUsd:156.97,entry:1.5725,be:1.5725,price:1.495,liq:1.262,pnlUsd:-8.14,pnlPct:-24.65,marginRatio:2.52,note:'Confirmed screenshot 23.09.2026 21:02'}
];
const OKX_POSITIONS=[
{id:'OKX-INJ-LONG-3X',venue:'OKX',symbol:'INJ',side:'LONG',leverage:3,sizeCoin:33.4,marginUsd:90.77,entry:8.156,price:7.682,liq:5.497,pnlUsd:-15.83,pnlPct:-17.43},
{id:'OKX-XRP-LONG-3X',venue:'OKX',symbol:'XRP',side:'LONG',leverage:3,sizeCoin:103,marginUsd:54.57,entry:1.5899,price:1.4987,liq:1.0824,pnlUsd:-9.39,pnlPct:-17.20}
];
const HEDGE=HEDGES[0];
const state={bots:FALLBACK,hedge:HEDGE,hedges:HEDGES,okxPositions:OKX_POSITIONS,manualPositions:MANUAL_POSITIONS,pionexManual:PIONEX_MANUAL,source:'REFERENCE',market:null,intel:null,assetIntel:{},priceChecks:{},portfolio:null,error:null,syncedAt:null,marketSyncedAt:null,liveRows:0,backtest:{symbol:'BTC',running:false,result:null,error:null},manual:{pionex:3126.12,bitpanda:0,ledger:776.74,okx:120.27}};
const $=s=>document.querySelector(s),num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const money=x=>{x=num(x);if(x==null)return'—';if(x!==0&&Math.abs(x)<.001)return'$'+x.toPrecision(5);return'$'+x.toLocaleString('de-DE',{maximumFractionDigits:2})};
function botMarketPrice(b){
 const feed=num(state.assetIntel&&b&&state.assetIntel[b.symbol]&&state.assetIntel[b.symbol].price),direct=num(b&&b.price),check=state.priceChecks&&b?state.priceChecks[b.symbol]:null;
 const verified=check&&check.verified?[num(check.okx),num(check.binance)].filter(x=>x>0):[];
 if(b&&b._livePrice&&direct>0){
  if(verified.length===2){const all=[direct,...verified],avg=all.reduce((a,x)=>a+x,0)/all.length,credible=all.filter(x=>Math.abs(x-avg)/avg<=.025);if(credible.length>=2)return b.side==='SHORT'?Math.max(...credible):Math.min(...credible)}
  return direct
 }
 if(verified.length===2)return b&&b.side==='SHORT'?Math.max(...verified):Math.min(...verified);
 if(feed>0)return feed;
 return direct>0?direct:null
}
function botPriceSource(b){const c=state.priceChecks&&b?state.priceChecks[b.symbol]:null;if(b&&b._livePrice&&c&&c.verified)return'PIONEX + OKX + BINANCE';if(c&&c.verified)return'OKX + BINANCE';if(b&&b._livePrice)return'PIONEX LIVE';if(state.assetIntel&&b&&state.assetIntel[b.symbol]&&state.assetIntel[b.symbol].price)return'SINGLE MARKET';return'REFERENCE'}
function liveMatched(b){return !!(b&&b._liveMatched)}
function livePnlAvailable(b){return liveMatched(b)&&!!b._livePnl}
function liveInvestAvailable(b){return liveMatched(b)&&!!b._liveInvest}
function botPnlUsd(b){
 if(b&&b._liveMatched===true&&b._livePnl===false)return{value:null,source:'NONE',corrected:false};
 if(b&&b._liveMatched===false)return{value:num(b.pnl),source:'REFERENCE',corrected:false};
 const raw=num(b&&b.pnl),invest=num(b&&b.invest),pct=num(b&&b.profitPct),implied=invest>0&&pct!=null?invest*pct/100:null;
 if(implied!=null){
  if(raw==null)return{value:implied,source:'PCT_X_INVEST',corrected:false};
  const tolerance=Math.max(1,Math.abs(implied)*.35);
  if(Math.abs(raw-implied)>tolerance)return{value:implied,source:'PCT_X_INVEST',corrected:true,raw:raw}
 }
 return{value:raw,source:raw==null?'NONE':'LIVE_USD',corrected:false}
}
function token(){try{return String(localStorage.getItem(TOKEN_KEY)||'').trim()}catch{return''}}
async function getJson(path){const r=await fetch(API_BASE+path,{cache:'no-store',headers:{accept:'application/json',...(token()?{authorization:'Bearer '+token()}:{})}});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
function holdingValue(d,h){const q=num(h?.quantity),lp=num(d?.livePrices?.[h?.symbol]?.price),own=num(h?.price),stored=num(h?.value)??num(h?.valueUsd)??num(h?.usdValue);return q!=null&&q>=0&&lp>0?q*lp:q!=null&&q>=0&&own>0?q*own:stored||0}
function portfolioModel(d){const hs=Array.isArray(d?.portfolio?.holdings)?d.portfolio.holdings:[];const by={};for(const h of hs){const venue=String(h?.venue||'OTHER').toUpperCase(),v=holdingValue(d,h);by[venue]=(by[venue]||0)+v}const liveBots=Array.isArray(d?.pionexRisk?.bots)?d.pionexRisk.bots.map(normalizeLive):[];const botCapital=liveBots.reduce((s,b)=>s+(num(b.invest)||0)+(botPnlUsd(b).value||0),0);const apiPionex=num(d?.pionex?.equityUsd)??num(d?.pionex?.totalEquityUsd)??num(d?.pionex?.accountValueUsd)??num(d?.pionexRisk?.accountEquityUsd)??num(d?.pionexRisk?.totalEquityUsd);const botRowsWithCapital=liveBots.filter(b=>b.invest!=null);const allBotsHaveCapital=liveBots.length>0&&botRowsWithCapital.length===liveBots.length;/* The current private API equity field is COIN-M bot equity, not Pionex account total.
   Never let that partial figure overwrite the verified account-total snapshot. */
const verifiedPionexTotal=state.manual.pionex;
const apiLooksLikeAccountTotal=apiPionex!=null&&apiPionex>=verifiedPionexTotal*.8;
const pionex=apiLooksLikeAccountTotal?apiPionex:verifiedPionexTotal;
const bitpanda=0,ledger=state.manual.ledger,okx=state.manual.okx;const total=pionex+ledger+okx;return{total,pionex,bitpanda,ledger,okx,botCapital:allBotsHaveCapital?botCapital:null,pionexComplete:true,pionexSource:apiLooksLikeAccountTotal?'PRIVATE_ACCOUNT_TOTAL':'SCREENSHOT_TOTAL',bitpandaSource:'REMOVED'}}
function pick(b,keys){for(const k of keys){const v=num(b?.[k]);if(v!=null)return v}return null}function normalizeLive(b){const nested=b?.bot||b?.position||b?.data||{};const x={...nested,...b};return{id:String(x.id||x.botId||x.bot_id||x.name||x.symbol||'BOT'),symbol:String(x.symbol||x.asset||x.baseAsset||x.base_asset||'').replace(/[-_/]?(USDT|USDC|USD)$/,'').toUpperCase(),leverage:pick(x,['leverage','leverageX','leverage_x']),lower:pick(x,['lowerRange','rangeLower','lowerPrice','lower_price','minPrice','min_price']),upper:pick(x,['upperRange','rangeUpper','upperPrice','upper_price','maxPrice','max_price']),be:pick(x,['breakEvenPrice','breakevenPrice','break_even_price','avgEntryPrice','averageEntryPrice','breakEven','break_even','entryPrice','entry_price']),liq:pick(x,['pionexLiquidationPrice','liquidationPrice','liqPrice','liquidation_price']),tp:pick(x,['takeProfit','tpPrice','tp','take_profit_price']),price:pick(x,['currentPrice','price','markPrice','lastPrice','mark_price','last_price']),buffer:pick(x,['pionexLiqBufferPct','liqBufferPct','liquidationDistancePct']),pnl:pick(x,['totalProfitUsd','totalProfitUSDT','totalProfitUsdt','total_profit_usdt','pnlUsd','unrealizedPnlUsd','unrealizedPnl','unrealized_profit','totalProfit','total_profit','profit']),invest:pick(x,['investmentUsd','investmentUSDT','investmentUsdt','investment','investedUsd','invested','investment_usdt','invested_amount','initialInvestment','initial_investment']),profitPct:pick(x,['totalProfitPct','profitPct','pnlPct','total_profit_pct','profit_rate','profitRate']),side:String(x.side||x.direction||x.positionSide||'LONG').toUpperCase()}}
function relDiff(a,b){a=num(a);b=num(b);if(!(a>0&&b>0))return null;return Math.abs(a-b)/Math.max(Math.abs(a),Math.abs(b),1e-12)}
function botMatchScore(ref,x){
  if(x.symbol!==ref.symbol||x.side!==(ref.side||'LONG'))return 1e9;
  let score=0,signals=0;
  if(x.leverage!=null){score+=Math.abs(x.leverage-ref.leverage)*12;signals++}
  for(const [k,w] of [['lower',30],['upper',30],['tp',24],['be',10],['liq',6]]){
    const d=relDiff(x[k],ref[k]);if(d!=null){score+=Math.min(d,2)*w;signals++}
  }
  return score+(signals?0:500);
}
function mergeReference(live){
  const used=new Set,refs=FALLBACK.map(ref=>({...ref,_liveMatched:false,_livePrice:false,_livePnl:false,_liveInvest:false,_source:'REFERENCE'})),matches=[];
  for(let ri=0;ri<refs.length;ri++)for(let li=0;li<live.length;li++){
    const score=botMatchScore(refs[ri],live[li]);if(score<1e9)matches.push({ri,li,score});
  }
  matches.sort((a,b)=>a.score-b.score);
  const refUsed=new Set;
  for(const m of matches){
    if(refUsed.has(m.ri)||used.has(m.li))continue;
    const ref=refs[m.ri],x=live[m.li];
    /* Reject weak duplicate-coin guesses: live row must agree on leverage or a structural field. */
    const levOk=x.leverage!=null&&x.leverage===ref.leverage;
    const structureOk=['lower','upper','tp','be'].some(k=>{const d=relDiff(x[k],ref[k]);return d!=null&&d<.03});
    if(!levOk&&!structureOk)continue;
    refs[m.ri]={...ref,...Object.fromEntries(Object.entries(x).filter(([,v])=>v!=null&&v!=='')),price:num(x.price),pnl:num(x.pnl),profitPct:num(x.profitPct),invest:num(x.invest),side:ref.side||'LONG',_liveMatched:true,_livePrice:num(x.price)>0,_livePnl:num(x.pnl)!=null||num(x.profitPct)!=null,_livePnlUsd:num(x.pnl)!=null,_liveProfitPct:num(x.profitPct)!=null,_liveInvest:num(x.invest)!=null,_source:'LIVE_MATCH'};
    refUsed.add(m.ri);used.add(m.li);
  }
  /* Dashboard is intentionally pinned to the verified 13-bot COIN-M roster.
     Unmatched API rows are often stale/partial bot records and must not create phantom cards.
     Live values are allowed to enrich a verified reference bot only after a confident match. */
  /* Never promote unmatched API rows into the active roster. */
  return refs;
}

function ema(v,p){if(v.length<p)return null;const k=2/(p+1);let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<v.length;i++)e=v[i]*k+e*(1-k);return e}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d)}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(0,d))/p;l=(l*(p-1)+Math.max(0,-d))/p}return l?100-100/(1+g/l):100}
function macd(v){if(v.length<35)return null;const series=p=>{const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o};const a=series(12),b=series(26),m=v.map((_,i)=>a[i]-b[i]);const k=2/10;let s=m[0];for(let i=1;i<m.length;i++)s=m[i]*k+s*(1-k);return{line:m.at(-1),signal:s,hist:m.at(-1)-s}}
function atr(rows,p=14){if(rows.length<p+1)return null;const t=[];for(let i=1;i<rows.length;i++)t.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));let a=t.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<t.length;i++)a=(a*(p-1)+t[i])/p;return a}
async function marketKlines(interval,limit,symbol='BTC'){
 const barMap={'15m':'15m','1h':'1H','4h':'4H','1d':'1D'},bar=barMap[interval]||interval;
 try{
  const u='https://www.okx.com/api/v5/market/candles?instId='+symbol+'-USDT-SWAP&bar='+bar+'&limit='+Math.min(limit,300),r=await fetch(u,{cache:'no-store'});
  if(!r.ok)throw new Error('OKX '+r.status);
  const j=await r.json();if(j.code!=='0'||!j.data?.length)throw new Error('OKX data');
  return j.data.map(x=>({openTime:+x[0],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[0]})).reverse()
 }catch(e){
  const r=await fetch('https://api.binance.com/api/v3/klines?symbol='+symbol+'USDT&interval='+interval+'&limit='+limit,{cache:'no-store'});
  if(!r.ok)throw e;
  return(await r.json()).map(x=>({openTime:+x[0],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[6]}))
 }
}
async function syncCrossPrices(){
 try{
  const [or,br]=await Promise.all([fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP',{cache:'no-store'}),fetch('https://api.binance.com/api/v3/ticker/price',{cache:'no-store'})]);
  if(!or.ok||!br.ok)throw new Error('cross-price http');
  const [oj,bj]=await Promise.all([or.json(),br.json()]),om=new Map((oj.data||[]).map(x=>[x.instId,num(x.last)])),bm=new Map((Array.isArray(bj)?bj:[]).map(x=>[x.symbol,num(x.price)])),out={};
  for(const symbol of [...new Set(state.bots.map(b=>b.symbol))]){const okx=om.get(symbol+'-USDT-SWAP')||null,binance=bm.get(symbol+'USDT')||null,spread=okx>0&&binance>0?Math.abs(okx-binance)/Math.min(okx,binance)*100:null;out[symbol]={okx,binance,spreadPct:spread,verified:spread!=null&&spread<=1.5}}
  state.priceChecks=out;state.marketSyncedAt=Date.now()
 }catch(e){state.priceChecks={}}
}
function intel(rows15,rows1h,rows4,rows1d){
 const c15=rows15.map(x=>x.close),c1h=rows1h.map(x=>x.close),c4=rows4.map(x=>x.close),c1d=rows1d.map(x=>x.close),p=c15.at(-1);
 const R15=rsi(c15),R1H=rsi(c1h),R4=rsi(c4),R1D=rsi(c1d),M15=macd(c15),M1H=macd(c1h),M4=macd(c4),M1D=macd(c1d),A=atr(rows4);
 const e20=ema(c1d,20),e50=ema(c1d,50),e100=ema(c1d,100),e200=ema(c1d,200);
 const w=rows4.slice(-90),lo=Math.min(...w.map(x=>x.low)),hi=Math.max(...w.map(x=>x.high)),span=hi-lo,fibs=[.382,.5,.618,.786].map(f=>({f,price:hi-span*f})),near=fibs.reduce((a,b)=>Math.abs(b.price-p)<Math.abs(a.price-p)?b:a);
 const dailyBull=p>e200&&e20>e50;
 const score=(dailyBull?25:0)+(R15>=40&&R15<=68?10:0)+(R1H>=42&&R1H<=68?15:0)+(R4>=42&&R4<=68?15:0)+(M15&&M15.hist>0?5:0)+(M1H&&M1H.hist>0?10:0)+(M4&&M4.hist>0?10:0)+(Math.abs(p-near.price)<=Math.max(A*.75,p*.012)?10:0);
 const status=score>=70&&dailyBull&&M1H?.hist>0?'RE-ENTRY READY':score>=55?'SETUP FORMING':'WAIT FOR RETRACE';
 return{price:p,rsi15:R15,rsi1h:R1H,rsi4:R4,rsi1d:R1D,rsi1:R1D,macd15:M15,macd1h:M1H,macd4:M4,macd1d:M1D,macd1:M1D,atr:A,ema20:e20,ema50:e50,ema100:e100,ema200:e200,lo,hi,near,score,status}
}
function signalAction(score){return score>=6?'RISK REVIEW':score>=4?'PROFIT LOCK CANDIDATE':score>=2?'WATCH PROFIT':'HOLD'}
function signalRank(action){return action==='RISK REVIEW'?3:action==='PROFIT LOCK CANDIDATE'?2:action==='WATCH PROFIT'?1:0}
function signalTone(action){return action==='RISK REVIEW'?'danger':action==='PROFIT LOCK CANDIDATE'||action==='WATCH PROFIT'?'watch':'safe'}
function actionForSide(pi,side){return side==='SHORT'?(pi?.shortAction||'SYNC'):(pi?.longAction||'SYNC')}
function reasonsForSide(pi,side){return side==='SHORT'?(pi?.shortReasons||[]):(pi?.longReasons||[])}
function profitLockIntel(rows15,rows1h,rows4){
 const c15=rows15.map(x=>x.close),c1h=rows1h.map(x=>x.close),c4=rows4.map(x=>x.close),p=c15.at(-1);
 const R15=rsi(c15),R1H=rsi(c1h),R4=rsi(c4),M15=macd(c15),M1H=macd(c1h),M4=macd(c4),e20=ema(c1h,20),e50=ema(c1h,50);
 let bear=0,bull=0,longReasons=[],shortReasons=[];
 if(R15>=72){bear++;longReasons.push('RSI15m heiß')}if(R1H>=70){bear++;longReasons.push('RSI1h heiß')}if(R4>=68){bear++;longReasons.push('RSI4h heiß')}
 if(M15&&M15.hist<0){bear++;longReasons.push('MACD15m ↓')}if(M1H&&M1H.hist<0){bear+=2;longReasons.push('MACD1h ↓')}if(M4&&M4.hist<0){bear+=2;longReasons.push('MACD4h ↓')}
 if(e20&&p<e20){bear+=2;longReasons.push('unter EMA20 1h')}if(e20&&e50&&e20<e50){bear++;longReasons.push('EMA20<50 1h')}
 if(R15<=28){bull++;shortReasons.push('RSI15m tief')}if(R1H<=30){bull++;shortReasons.push('RSI1h tief')}if(R4<=32){bull++;shortReasons.push('RSI4h tief')}
 if(M15&&M15.hist>0){bull++;shortReasons.push('MACD15m ↑')}if(M1H&&M1H.hist>0){bull+=2;shortReasons.push('MACD1h ↑')}if(M4&&M4.hist>0){bull+=2;shortReasons.push('MACD4h ↑')}
 if(e20&&p>e20){bull+=2;shortReasons.push('über EMA20 1h')}if(e20&&e50&&e20>e50){bull++;shortReasons.push('EMA20>50 1h')}
 const longAction=signalAction(bear),shortAction=signalAction(bull),bias=bull-bear>=3?'BULLISH':bear-bull>=3?'BEARISH':'MIXED';
 return{action:longAction,longAction,shortAction,bearish:bear,bullish:bull,bias,longReasons,shortReasons,reasons:longReasons,rsi15:R15,rsi1h:R1H,rsi4:R4,macd15:M15,macd1h:M1H,macd4:M4,ema20:e20,ema50:e50,price:p}
}
async function syncIntel(){
 const cross=syncCrossPrices();
 try{
  const [m15,h1,h4,d1]=await Promise.all([marketKlines('15m',180),marketKlines('1h',200),marketKlines('4h',240),marketKlines('1d',240)]);
  state.intel=intel(m15,h1,h4,d1)
 }catch(e){state.intel=null}
 const assets=[...new Set(state.bots.map(b=>b.symbol))],out={};
 for(let i=0;i<assets.length;i+=4){
  const batch=assets.slice(i,i+4);
  await Promise.all(batch.map(async symbol=>{try{
   const [m15,h1,h4]=await Promise.all([marketKlines('15m',160,symbol),marketKlines('1h',180,symbol),marketKlines('4h',160,symbol)]);
   out[symbol]=profitLockIntel(m15,h1,h4)
  }catch{}}));
  if(i+4<assets.length)await new Promise(r=>setTimeout(r,220))
 }
 state.assetIntel=out;await cross;renderHeaderTruth()
}

function risk(b){const p=botMarketPrice(b),liq=num(b.liq),api=num(b.buffer);if(api!=null&&api>0&&api<100)return api;if(!(p>0&&liq>0))return null;return b.side==='SHORT'?(liq-p)/p*100:(p-liq)/p*100}
function assetPairRisk(symbol){
 const rows=state.bots.filter(b=>b.symbol===symbol&&liveMatched(b)),longs=rows.filter(b=>(b.side||'LONG')==='LONG'),shorts=rows.filter(b=>b.side==='SHORT');
 const notional=b=>liveInvestAvailable(b)?(num(b.invest)||0)*(num(b.leverage)||1):null;
 const longKnown=longs.map(notional).filter(x=>x!=null),shortKnown=shorts.map(notional).filter(x=>x!=null),longUsd=longKnown.reduce((s,x)=>s+x,0),shortUsd=shortKnown.reduce((s,x)=>s+x,0),unknownExposure=rows.filter(b=>notional(b)==null).length,hedgePct=longUsd>0&&unknownExposure===0?shortUsd/longUsd*100:null;
 const buffers=rows.map(risk).filter(x=>x!=null),minBuffer=buffers.length?Math.min(...buffers):null,pi=state.assetIntel[symbol];
 let score=0,reasons=[];
 if(minBuffer!=null&&minBuffer<10){score+=5;reasons.push('Liq <10%')}else if(minBuffer!=null&&minBuffer<18){score+=4;reasons.push('Liq <18%')}else if(minBuffer!=null&&minBuffer<28){score+=2;reasons.push('Liq <28%')}
 const dominantSide=shortUsd>longUsd?'SHORT':'LONG',profitAction=actionForSide(pi,dominantSide);
 if(profitAction==='RISK REVIEW'){score+=3;reasons.push('Struktur/Momentum')}else if(profitAction==='PROFIT LOCK CANDIDATE'){score+=2;reasons.push('Profit-Lock')}else if(profitAction==='WATCH PROFIT'){score+=1;reasons.push('Profit-Watch')}
 const btc=state.intel;if(symbol!=='BTC'&&btc&&btc.price<btc.ema20){score+=1;reasons.push('BTC < EMA20')}
 const label=score>=7?'LIQ RISK':score>=4?'RISK REVIEW':score>=2?'WATCH':'SAFE',tone=score>=7?'danger':score>=4?'danger':score>=2?'watch':'safe';
 return{symbol,rows,longUsd,shortUsd,netUsd:longUsd-shortUsd,hedgePct,minBuffer,unknownExposure,score,label,tone,reasons,profitAction,dominantSide,bias:pi?.bias||'SYNC'};
}
function riskCockpitV2(){
 const order=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];
 const pairs=order.map(assetPairRisk).filter(x=>x.rows.length).sort((a,b)=>b.score-a.score||(a.minBuffer??999)-(b.minBuffer??999));
 return '<section class="risk-v2"><div class="section-title"><h2>RISK COCKPIT V2</h2><small>Asset-Paare · Liq + Hedge + 15m/1h/4h + BTC-Regime</small></div><div class="risk-v2-grid">'+pairs.map(x=>'<article class="risk-v2-row"><div><strong>'+x.symbol+'</strong><span class="tag tone-'+x.tone+'">'+x.label+'</span></div><div><span>KNOWN NET</span><b>'+(x.unknownExposure?money(x.netUsd)+'*':money(x.netUsd))+'</b></div><div><span>HEDGE</span><b>'+(x.hedgePct==null?'—':x.hedgePct.toFixed(1)+'%')+'</b></div><div><span>MIN LIQ</span><b>'+(x.minBuffer==null?'—':x.minBuffer.toFixed(1)+'%')+'</b></div><div><span>MOMENTUM '+x.dominantSide+'</span><b class="tone-'+signalTone(x.profitAction)+'">'+x.profitAction+'</b></div><small>'+(x.reasons.join(' · ')||'kein neues Warnsignal')+'</small></article>').join('')+'</div></section>';
}
function tpDist(b){const p=botMarketPrice(b),tp=num(b.tp);if(!(p>0&&tp>0))return null;return b.side==='SHORT'?(p-tp)/p*100:(tp-p)/p*100}
function status(b){if(!liveMatched(b))return['REF','muted'];const r=risk(b),t=tpDist(b);if(t!=null&&t<=5)return['TP ZONE','tp'];if(r==null)return['CHECK','muted'];if(r<5)return['URGENT','danger'];if(r<10)return['MARGIN','danger'];if(r<18)return['WATCH','watch'];return['SAFE','safe']}
function botProfitPct(b){const direct=num(b.profitPct);if(direct!=null)return direct;const pnl=botPnlUsd(b).value,invest=num(b.invest);return pnl!=null&&invest>0?pnl/invest*100:null}
function profitPlanRank(code){return code==='SAFETY'?7:code==='LOCK50'?6:code==='LOCK25'?5:code==='LOCK20'?4:code==='HEDGE'?3:code==='WATCH'?2:code==='HOLD'?1:0}
function profitLockPlan(b){
 const side=b.side||'LONG',pi=state.assetIntel[b.symbol],signal=actionForSide(pi,side),reasons=reasonsForSide(pi,side),pnl=botProfitPct(b),t=tpDist(b),liq=risk(b),pair=assetPairRisk(b.symbol),hedgeLow=side==='LONG'&&pair.longUsd>0&&pair.hedgePct<15;
 const why=reasons.slice(0,3).join(' · '),tpText=t==null?'TP-Distanz —':Math.max(0,t).toFixed(1)+'% zum TP',pnlText=pnl==null?'PnL —':(pnl>=0?'+':'')+pnl.toFixed(1)+'% PnL';
 if(!liveMatched(b))return{code:'SYNC',label:'REFERENCE · VERIFY',tone:'muted',reducePct:0,signal,pnl:null,tp:t,detail:'Bot nicht live bestätigt · Referenzwerte sind nicht handlungsrelevant'};
 if(liq!=null&&liq<10)return{code:'SAFETY',label:'SAFETY FIRST',tone:'danger',reducePct:0,signal,pnl,tp:t,detail:'Liq-Puffer '+liq.toFixed(1)+'% · zuerst Margin/Exposure prüfen · keine Profit-Lock-Aktion'};
 if(!livePnlAvailable(b))return{code:'SYNC',label:'SYNC · PNL',tone:'muted',reducePct:0,signal,pnl:null,tp:t,detail:'Live-PnL fehlt · '+tpText+' · keine Aktion ableiten'};
 if(pnl==null)return{code:'SYNC',label:'SYNC · PNL',tone:'muted',reducePct:0,signal,pnl,tp:t,detail:'Live-PnL unvollständig · keine Aktion ableiten'};
 if(pnl<=0){
  if(signal==='RISK REVIEW'&&hedgeLow)return{code:'HEDGE',label:'HEDGE CHECK',tone:'watch',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Momentum gegen Position')+' · 10–20% Gegenexposure prüfen, nicht Verlust realisieren'};
  return{code:'HOLD',label:'HOLD · NO LOCK',tone:signal==='RISK REVIEW'?'watch':'safe',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+tpText+' · kein Gewinn zum Sichern'};
 }
 if(signal==='HOLD'||signal==='SYNC')return{code:'HOLD',label:'RUN TO TP',tone:'safe',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+tpText+' · Momentum bestätigt keinen Exit'};
 if(signal==='WATCH PROFIT'){
  if(t!=null&&t<=5&&pnl>=8)return{code:'LOCK20',label:'LOCK 20%',tone:'watch',reducePct:20,signal,pnl,tp:t,detail:pnlText+' · TP nah · 20% Exposure sichern, 80% weiterlaufen lassen'};
  return{code:'WATCH',label:'WATCH · KEEP RUNNING',tone:'watch',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+tpText+' · noch keine Teilgewinn-Schwelle'};
 }
 if(signal==='PROFIT LOCK CANDIDATE'){
  if((pnl>=20)||(t!=null&&t<=5&&pnl>=10))return{code:'LOCK25',label:'LOCK 25%',tone:'watch',reducePct:25,signal,pnl,tp:t,detail:pnlText+' · '+tpText+' · 25% Exposure sichern → Reload-Reserve, 75% Runner'};
  if(pnl>=8)return{code:'LOCK20',label:'LOCK 20%',tone:'watch',reducePct:20,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Momentum schwächt')+' · 20% sichern → Reload-Reserve'};
  return{code:'WATCH',label:'WATCH · KEEP RUNNING',tone:'watch',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · Signal vorhanden, Gewinnpolster noch zu klein'};
 }
 if(signal==='RISK REVIEW'){
  if((pnl>=20)||(t!=null&&t<=3&&pnl>=12))return{code:'LOCK50',label:'LOCK 50%',tone:'danger',reducePct:50,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Struktur dreht')+' · 50% sichern → Reload-Reserve, 50% Runner'};
  if(pnl>=8)return{code:'LOCK25',label:'LOCK 25%',tone:'danger',reducePct:25,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Struktur dreht')+' · 25% sichern, Rest bis Bestätigung laufen lassen'};
  if(pnl>=3)return{code:'LOCK20',label:'LOCK 20%',tone:'watch',reducePct:20,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Struktur dreht')+' · kleiner Profit-Lock statt Komplettausstieg'};
  if(hedgeLow)return{code:'HEDGE',label:'HEDGE CHECK',tone:'watch',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Struktur dreht')+' · 10–20% Gegenexposure prüfen'};
  return{code:'WATCH',label:'DEFENSIVE WATCH',tone:'watch',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+(why||'Struktur dreht')+' · nicht reflexartig schließen'};
 }
 return{code:'HOLD',label:'RUN TO TP',tone:'safe',reducePct:0,signal,pnl,tp:t,detail:pnlText+' · '+tpText};
}
function topProfitPlan(){return state.bots.map(b=>({b,plan:profitLockPlan(b)})).filter(x=>!['SYNC','HOLD'].includes(x.plan.code)).sort((a,b)=>profitPlanRank(b.plan.code)-profitPlanRank(a.plan.code)||((b.plan.pnl||0)-(a.plan.pnl||0)))[0]||null}
function profitLockRadar(){
 const rows=state.bots.map(b=>({b,plan:profitLockPlan(b)})),actionable=rows.filter(x=>!['SYNC','HOLD'].includes(x.plan.code)).sort((a,b)=>profitPlanRank(b.plan.code)-profitPlanRank(a.plan.code)||((b.plan.pnl||0)-(a.plan.pnl||0))).slice(0,6);
 const counts=rows.reduce((o,x)=>{o[x.plan.code]=(o[x.plan.code]||0)+1;return o},{});
 return `<section class="lock-radar"><div class="lock-radar-head"><div><span>PROFIT LOCK V2</span><b>RUNNER DISCIPLINE</b></div><small>Decision support · keine Auto-Order</small></div><div class="lock-summary"><span>RUN/HOLD <b>${(counts.HOLD||0)}</b></span><span>WATCH <b>${(counts.WATCH||0)}</b></span><span>LOCK <b>${(counts.LOCK20||0)+(counts.LOCK25||0)+(counts.LOCK50||0)}</b></span><span>HEDGE <b>${(counts.HEDGE||0)}</b></span></div>${actionable.length?'<div class="lock-grid">'+actionable.map(x=>'<article class="lock-row"><div><strong>'+x.b.symbol+' '+(x.b.side||'LONG')+' · '+(x.b.leverage||'—')+'x</strong><span>'+((x.plan.pnl==null?'—':(x.plan.pnl>=0?'+':'')+x.plan.pnl.toFixed(1)+'%'))+' PnL</span></div><b class="tone-'+x.plan.tone+'">'+x.plan.label+'</b><small>'+x.plan.detail+'</small></article>').join('')+'</div>':'<div class="lock-empty">Keine Profit-Lock-Aktion · Runner weiterlaufen lassen</div>'}</section>`;
}
function botCard(b){const [st,tone]=status(b),r=risk(b),t=tpDist(b),pct=botProfitPct(b),pl=profitLockPlan(b),px=botMarketPrice(b),pu=botPnlUsd(b),truth=liveMatched(b)?(livePnlAvailable(b)?'LIVE MATCH':'LIVE MATCH · PNL SYNC'):'REFERENCE';return `<article class="bot bot-v2"><div class="bothead"><div><h3>${b.symbol}</h3><small>${b.side||'LONG'} · ${b.leverage||'—'}x</small></div><span class="tag tone-${tone}">${st}</span></div><div class="truth-badge ${liveMatched(b)?'truth-live':'truth-ref'}">${truth}</div><div class="profit-lock-v2 pl-${pl.tone}"><div class="pl-top"><span>PROFIT LOCK V2</span><b class="tone-${pl.tone}">${pl.label}</b></div><small>${pl.detail}</small></div><div class="profit-row"><div><span>INVEST</span><b>${b.invest==null?'—':money(b.invest)}</b></div><div><span>GESAMTPROFIT</span><b class="${pu.value>0?'profit-pos':pu.value<0?'profit-neg':''}">${pu.value==null?'—':money(pu.value)}${pct==null?'':' · '+(pct>=0?'+':'')+pct.toFixed(1)+'%'}</b>${pu.corrected?'<small class="data-guard">VALIDATED FROM % × INVEST</small>':''}</div></div><div class="bot-details"><span>PRICE <b>${money(px)}</b><small class="data-guard">${botPriceSource(b)}</small></span><span>BE <b>${money(b.be)}</b></span><span>LIQ <b>${money(b.liq)}</b></span><span>TP <b>${money(b.tp)}</b></span></div><div class="range-line">RANGE <b>${money(b.lower)} – ${money(b.upper)}</b></div><div class="risk"><i style="width:${Math.max(2,Math.min(100,r||0)*3)}%"></i></div><small class="distance">${r==null?'Liq —':r.toFixed(1)+'% Liq'} · ${t==null?'TP —':Math.max(0,t).toFixed(1)+'% TP'}</small></article>`}
function critical(){return [...state.bots].filter(liveMatched).sort((a,b)=>(risk(a)??999)-(risk(b)??999))[0]||null}
function beDistance(b){const p=botMarketPrice(b),be=num(b.be);return p>0&&be>0?(p-be)/be*100:null}
function assetExposureShare(symbol){const e=exposureModel(),x=state.bots.filter(b=>b.symbol===symbol&&liveInvestAvailable(b)).reduce((s,b)=>s+(num(b.invest)||0)*(num(b.leverage)||1),0);return e.longUsd>0?x/e.longUsd*100:0}
function riskV2(b){const liq=risk(b),be=beDistance(b),share=assetExposureShare(b.symbol),mom=state.assetIntel[b.symbol];let score=0,reasons=[];if(liq!=null&&liq<18){score+=3;reasons.push('LIQ')}else if(liq!=null&&liq<28){score+=2;reasons.push('Liq')}else if(liq!=null&&liq<38){score+=1;reasons.push('liq')}if((b.leverage||0)>=7){score+=2;reasons.push('Hebel')}else if((b.leverage||0)>=5){score+=1;reasons.push('hebel')}if(share>=25){score+=3;reasons.push('Konzentration')}else if(share>=15){score+=2;reasons.push('Exposure')}else if(share>=10){score+=1;reasons.push('exposure')}if(be!=null&&be<-8){score+=2;reasons.push('unter BE')}else if(be!=null&&be<0){score+=1;reasons.push('BE')}const momAction=actionForSide(mom,b.side||'LONG');if(momAction==='RISK REVIEW'){score+=3;reasons.push('Momentum')}else if(momAction==='PROFIT LOCK CANDIDATE'){score+=2;reasons.push('Momentum')}else if(momAction==='WATCH PROFIT'){score+=1;reasons.push('Momentum')}const label=score>=8?'RISK REVIEW':score>=5?'WATCH':score>=3?'ATTENTION':'HOLD',tone=score>=8?'danger':score>=5?'watch':score>=3?'watch':'safe';return{score,label,tone,reasons,liq,be,share}}

function signalSummary(){const out={hold:0,watch:0,lock:0,risk:0,sync:0};for(const b of state.bots){const p=profitLockPlan(b);if(p.code==='SYNC')out.sync++;else if(['LOCK20','LOCK25','LOCK50'].includes(p.code))out.lock++;else if(p.code==='WATCH')out.watch++;else if(['SAFETY','HEDGE'].includes(p.code))out.risk++;else out.hold++}return out}
function topSignalBot(){return state.bots.filter(liveMatched).map(b=>({b,action:actionForSide(state.assetIntel[b.symbol],b.side||'LONG')})).filter(x=>x.action!=='SYNC'&&x.action!=='HOLD').sort((a,b)=>signalRank(b.action)-signalRank(a.action)||((num(b.b.profitPct)||0)-(num(a.b.profitPct)||0)))[0]||null}
function exposureModel(){const botNotional=b=>liveInvestAvailable(b)?(num(b.invest)||0)*(num(b.leverage)||1):null,confirmed=state.bots.filter(liveMatched),rows=confirmed.map(b=>({...b,notional:botNotional(b)})).filter(b=>b.notional!=null),unknownBots=confirmed.filter(b=>botNotional(b)==null).length,longUsd=rows.filter(b=>(b.side||'LONG')==='LONG').reduce((x,b)=>x+b.notional,0),shortUsd=rows.filter(b=>b.side==='SHORT').reduce((x,b)=>x+b.notional,0),grossUsd=longUsd+shortUsd,netUsd=longUsd-shortUsd,coverage=longUsd>0?shortUsd/longUsd*100:null;return{longUsd,shortUsd,hedgeUsd:shortUsd,grossUsd,netUsd,coverage,unknownBots,confirmedBots:confirmed.length,complete:confirmed.length>0&&unknownBots===0}}
function portfolioRegime(){const e=exposureModel(),i=state.intel,confirmed=state.bots.filter(liveMatched);let points=0,reasons=[];if(i){if(i.price>i.ema20&&i.ema20>i.ema50){points+=2;reasons.push('BTC > EMA20/50')}else if(i.price<i.ema20){points-=2;reasons.push('BTC < EMA20')}if(i.macd4?.hist>0){points++;reasons.push('4h MACD +')}else if(i.macd4?.hist<0){points--;reasons.push('4h MACD -')}if(i.rsi4>=70){points--;reasons.push('4h RSI heiß')}else if(i.rsi4>=50){points++;reasons.push('4h RSI >50')}}const avgRisk=confirmed.length?confirmed.reduce((s,b)=>s+riskV2(b).score,0)/confirmed.length:0;if(avgRisk>=6){points-=2;reasons.push('Bot-Risiko hoch')}else if(avgRisk>=4){points--;reasons.push('Bot-Risiko erhöht')}const regime=points>=2?'RISK-ON':points<=-2?'DEFENSIVE':'NEUTRAL';const hedge=e.coverage==null?'UNVOLLSTÄNDIG':e.coverage>=15?'AUSREICHEND':e.coverage>=7?'MITTEL':'KLEIN';const tone=regime==='RISK-ON'?'safe':regime==='DEFENSIVE'?'danger':'watch';return{regime,hedge,tone,points,avgRisk,reasons}}
function regimeStrip(){const r=portfolioRegime();return `<section class="regime-strip"><div><span>PORTFOLIO REGIME</span><b class="tone-${r.tone}">${r.regime}</b></div><div><span>HEDGE</span><b>${r.hedge}</b></div><div><span>AVG RISK</span><b>${r.avgRisk.toFixed(1)}</b></div><small>${r.reasons.slice(0,4).join(' · ')||'Market sync'}</small></section>`}
function exposureStrip(){const e=exposureModel(),tone=e.coverage==null?'muted':e.coverage>=15?'safe':e.coverage>=7?'watch':'danger';return `<section class="exposure-strip"><div><span>KNOWN LIVE BOT LONG</span><b>${money(e.longUsd)}</b></div><div><span>KNOWN LIVE BOT SHORT</span><b>${money(e.hedgeUsd)}</b></div><div><span>KNOWN NET</span><b>${money(e.netUsd)}</b></div><div><span>SHORT / LONG</span><b class="tone-${tone}">${e.coverage==null?'—':e.coverage.toFixed(1)+'%'}</b></div><small class="exposure-note">${e.unknownBots?e.unknownBots+' live-matched Bots ohne belastbare Investition · Exposure unvollständig':'nur live bestätigte Kapitalwerte'}</small></section>`}
function manualRisk(x){const p=num(x.price),l=num(x.liq);return p>0&&l>0?(p-l)/p*100:null}
function manualStrip(){const ps=state.pionexManual||[];if(!ps.length)return'';return `<section class="manual-strip"><div class="okx-title"><span>PIONEX MANUAL</span><b>${ps.length} POSITION</b></div>${ps.map(x=>{const bf=manualRisk(x);return `<div class="manual-row"><strong>${x.symbol} ${x.side} · ${x.leverage}x ${x.marginMode}</strong><span>Mark ${money(x.price)}</span><span>BE ${money(x.be)}</span><span>Liq ${money(x.liq)}</span><b class="${bf<10?'tone-danger':bf<18?'tone-watch':'tone-safe'}">${bf.toFixed(1)}% Puffer</b></div>`}).join('')}</section>`}
function okxRisk(x){const p=num(x.price),l=num(x.liq);return p>0&&l>0?(p-l)/p*100:null}
function okxStrip(){const ps=state.okxPositions||[];if(!ps.length)return'';return `<section class="okx-strip"><div class="okx-title"><span>OKX POSITIONS</span><b>${ps.length} LONGS</b></div>${ps.map(x=>`<div class="okx-row"><strong>${x.symbol} · ${x.leverage}x</strong><span>Mark ${money(x.price)}</span><span>Entry ${money(x.entry)}</span><span>Liq ${money(x.liq)}</span><b class="${okxRisk(x)<25?'tone-watch':'tone-safe'}">${okxRisk(x).toFixed(1)}% Puffer</b></div>`).join('')}</section>`}
function dataTruthCard(){const matched=state.bots.filter(liveMatched).length,pnl=state.bots.filter(livePnlAvailable).length,verified=Object.values(state.priceChecks||{}).filter(x=>x&&x.verified).length,pSource=state.portfolio?.pionexSource==='PRIVATE_ACCOUNT_TOTAL'?'LIVE ACCOUNT':'SNAPSHOT';return `<section class="data-truth"><div class="data-truth-head"><span>DATA TRUTH</span><b>${matched===state.bots.length?'LIVE':'MIXED'}</b></div><div class="truth-grid"><div><span>BOT MATCH</span><b>${matched}/${state.bots.length}</b></div><div><span>LIVE PNL</span><b>${pnl}</b></div><div><span>2-SOURCE PRICE</span><b>${verified}</b></div><div><span>PORTFOLIO</span><b>${pSource}</b></div></div><small>Referenzwerte dürfen keine Profit-Lock/Next-Action Entscheidung auslösen.</small></section>`}
function renderHeaderTruth(){const el=$('#data-status');if(!el)return;const matched=state.bots.filter(liveMatched).length,verified=Object.values(state.priceChecks||{}).filter(x=>x&&x.verified).length;el.textContent=matched||verified?'● MIXED':'● REFERENCE';el.className='live '+(matched||verified?'mixed':'reference')}
function command(){
 const c=critical(),p=state.portfolio||{total:0,pionex:0,bitpanda:state.manual.bitpanda,ledger:state.manual.ledger,okx:state.manual.okx},e=exposureModel(),rg=portfolioRegime(),sig=signalSummary(),sa=topSignalBot(),pp=topProfitPlan(),cr=c?risk(c):null,bd=c?beDistance(c):null,matched=state.bots.filter(liveMatched),tp=matched.filter(b=>{const x=tpDist(b);return x!=null&&x<=10}),watch=matched.filter(b=>{const x=risk(b);return x!=null&&x<30}).length;
 let action='HALTEN · KEIN MARGIN-EINGRIFF',actionReason=rg.reasons.slice(0,3).join(' · ');
 if(cr!=null&&cr<10){action=c.symbol+' · LIQ-PUFFER PRÜFEN';actionReason='Liquidationsschutz hat Vorrang vor Profit Lock'}
 else if(pp&&['LOCK50','LOCK25','LOCK20'].includes(pp.plan.code)){action=pp.b.symbol+' '+(pp.b.side||'LONG')+' · '+pp.plan.label;actionReason=pp.plan.detail}
 else if(cr!=null&&cr<18){action=c.symbol+' · ENG BEOBACHTEN';actionReason=(cr.toFixed(1)+'% Liq-Puffer · keine hektische Profit-Realisierung')}
 else if(pp&&['HEDGE','WATCH'].includes(pp.plan.code)){action=pp.b.symbol+' '+(pp.b.side||'LONG')+' · '+pp.plan.label;actionReason=pp.plan.detail}
 else if(sa&&sa.action!=='HOLD'){action=sa.b.symbol+' '+(sa.b.side||'LONG')+' · MOMENTUM WATCH';actionReason='Kein Profit-Lock ohne bestätigten Gewinn · '+reasonsForSide(state.assetIntel[sa.b.symbol],sa.b.side||'LONG').slice(0,3).join(' · ')}
 return `<section class="portfolio-hero command-hero"><div class="hero-top"><div><span>GESAMTPORTFOLIO</span><strong>${p.total!=null?money(p.total):'PIONEX SYNC'}</strong><small>KNOWN TOTAL · mixed live/snapshot sources</small></div><div class="regime-pill tone-${rg.tone}">${rg.regime}</div></div><div class="source-grid"><div><span>PIONEX</span><b>${p.pionex!=null?money(p.pionex):'SYNC'}</b><small>${p.pionexSource==='PRIVATE_ACCOUNT_TOTAL'?'LIVE ACCOUNT':'VERIFIED SNAPSHOT'}</small></div><div><span>LEDGER</span><b>${money(p.ledger)}</b><small>WALLET SNAPSHOT</small></div><div><span>OKX</span><b>${money(p.okx)}</b><small>SNAPSHOT · ${(state.okxPositions||[]).length} POSITIONS</small></div></div></section>${dataTruthCard()}<section class="risk-cockpit"><div class="cockpit-head"><div><span>RISK COCKPIT</span><b class="tone-${c?status(c)[1]:'muted'}">${c?c.symbol+' '+(c.side||'LONG')+' '+(c.leverage||'—')+'x':'SYNC'}</b></div><div class="liq-big"><small>LIQ PUFFER</small><strong>${cr==null?'—':cr.toFixed(1)+'%'}</strong></div></div><div class="risk-kpis"><div><span>PRICE</span><b>${c?money(botMarketPrice(c)):'—'}</b></div><div><span>BE</span><b>${c&&num(c.be)>0?money(c.be):'—'}</b></div><div><span>LIQ</span><b>${c?money(c.liq):'—'}</b></div><div><span>BE DIST.</span><b>${bd==null?'—':(bd>=0?'+':'')+bd.toFixed(1)+'%'}</b></div></div><div class="buffer-track"><i style="width:${Math.max(2,Math.min(100,(cr||0)*3.33))}%"></i></div><div class="cockpit-foot"><span>${watch} live Bots &lt;30% Puffer</span><span>Short/Long ${e.coverage==null?'—':e.coverage.toFixed(1)+'%'}</span></div></section><section class="exposure-card"><div><span>KNOWN LIVE LONG</span><b>${money(e.longUsd)}</b></div><div><span>KNOWN LIVE SHORT</span><b>${money(e.hedgeUsd)}</b></div><div><span>KNOWN NET</span><b>${money(e.netUsd)}</b></div><div><span>SHORT / LONG</span><b class="tone-${e.coverage==null?'muted':e.coverage>=15?'safe':e.coverage>=7?'watch':'danger'}">${e.coverage==null?'—':e.coverage.toFixed(1)+'%'}</b></div></section>${manualStrip()}${okxStrip()}${riskCockpitV2()}${profitLockRadar()}<section class="action command-action"><span>NEXT ACTION</span><b>${action}</b><small>${actionReason||'Market sync'}</small></section><div class="quick-grid"><section><span>LIVE MATCHED</span><b>${matched.length}</b><small>${state.bots.length} tracked · ${new Set(state.bots.map(b=>b.symbol)).size} Assets</small></section><section><span>TP RADAR</span><b>${tp.length}</b><small>≤10% zum TP</small></section><section><span>AVG RISK</span><b>${rg.avgRisk.toFixed(1)}</b><small>Portfolio Score</small></section><section><span>BTC SETUP</span><b class="wait">${state.intel?state.intel.score+'/100':'SYNC'}</b><small>${state.intel?.status||'loading'}</small></section><section><span>WATCH PROFIT</span><b class="tone-watch">${sig.watch}</b><small>15m/1h Frühwarnung</small></section><section><span>PROFIT LOCK</span><b class="tone-watch">${sig.lock}</b><small>Teilgewinn prüfen</small></section><section><span>RISK REVIEW</span><b class="tone-danger">${sig.risk}</b><small>Struktur dreht</small></section><section><span>HOLD</span><b class="tone-safe">${sig.hold}</b><small>${sig.sync?'+'+sig.sync+' SYNC':'kein Lock-Signal'}</small></section></div><div class="section-title"><h2>RISK PRIORITY</h2><small>engster Liq-Puffer zuerst</small></div><div class="bots command-bots">${matched.length?[...matched].sort((a,b)=>(risk(a)??999)-(risk(b)??999)).slice(0,4).map(botCard).join(''):'<section class="card">Keine live bestätigten Bots für Risk Priority.</section>'}</div>`}
function botGroup(title,subtitle,items){if(!items.length)return '';return `<section class="bot-group"><div class="group-head"><div><h2>${title}</h2><small>${subtitle}</small></div><b>${items.length}</b></div><div class="bots">${items.map(botCard).join('')}</div></section>`}
function manualPositionCard(){return (state.manualPositions||[]).map(b=>{const p=num(b.price),l=num(b.liq),buffer=p>0&&l>0?(p-l)/p*100:null;return `<section class="bot-group"><div class="group-head"><div><h2>${b.symbol} · MANUAL ${b.side}</h2><small>${b.venue} · separate offene Position, kein Grid-Bot</small></div><b>${b.leverage}x</b></div><article class="bot bot-v2"><div class="bot-details"><span>MARK <b>${money(b.price)}</b></span><span>ENTRY <b>${money(b.entry)}</b></span><span>LIQ <b>${money(b.liq)}</b></span><span>LIQ PUFFER <b>${buffer==null?'—':buffer.toFixed(1)+'%'}</b></span></div><div class="range-line">SIZE <b>${b.investCoin.toLocaleString('de-DE')} ${b.symbol}</b> · DYN. MARGIN <b>${b.dynamicMargin||0}</b></div></article></section>`}).join('')}
function hedgeCard(){const hs=state.hedges||[state.hedge];return hs.map(h=>{const tp=(h.tps||[{price:h.tp,pct:100}]).map(x=>money(x.price)+' · '+(x.pct!=null?x.pct+'%':x.coin+' BTC')).join(' / '),runner=h.runnerPct!=null?h.runnerPct+'%':h.runnerCoin!=null?h.runnerCoin+' BTC':'—';return `<section class="bot-group hedge-group"><div class="group-head"><div><h2>BTC HEDGE · ${h.venue||'Pionex'}</h2><small>separate Versicherung · nicht als Long-Bot gezählt</small></div><b>SHORT ${h.leverage}x</b></div><article class="bot bot-v2"><div class="bot-details"><span>ENTRY <b>${money(h.entry)}</b></span><span>SL <b>${money(h.sl)}</b></span><span>LIQ <b>${money(h.liq)}</b></span><span>SIZE <b>${h.investCoin} BTC</b></span></div><div class="range-line">TP <b>${tp}</b></div><div class="profit-lock"><span>RUNNER</span><b class="tone-safe">${runner}</b><small>${h.note||''}</small></div></article></section>`}).join('')}
function assetGroup(symbol,items){const live=items.filter(liveMatched),exposure=live.reduce((s,b)=>s+(liveInvestAvailable(b)?num(b.invest)||0:0),0),worst=live.length?Math.min(...live.map(b=>risk(b)??999)):999,rv=live.length?live.map(riskV2).sort((a,b)=>b.score-a.score)[0]:{label:'REFERENCE',share:0,score:0};return botGroup(symbol+' · '+items.length+' TRACKED · '+live.length+' LIVE · '+rv.label,(exposure?money(exposure)+' live capital · ':'')+(worst<999?worst.toFixed(1)+'% Liq · ':'')+(live.length?rv.share.toFixed(1)+'% Exposure · Risk '+rv.score:'keine Action aus Referenzdaten'),items)}
function bots(){const order=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];const groups=order.map(s=>assetGroup(s,state.bots.filter(b=>b.symbol===s))).join('');return `<section class="hero bot-hero"><div class="eyebrow">BOT CONTROL CENTER · ${state.source}</div><h1>PIONEX COIN-M</h1><p class="muted">${state.bots.length} tracked rows · ${state.bots.filter(liveMatched).length} live matched · ${new Set(state.bots.map(b=>b.symbol)).size} Assets · Referenz ≠ live</p></section>${regimeStrip()}${exposureStrip()}${hedgeCard()}${manualPositionCard()}${groups}`}
function market(){const i=state.intel;return `<section class="hero"><div class="eyebrow">MARKET + BODEN</div><h1>BTC REGIME</h1><p class="muted">1D Regime · 4h Struktur · 1h Setup · 15m Trigger · OKX USDT-SWAP</p></section><div class="grid"><section class="metric"><span>REGIME</span><b>${state.market||'SYNC'}</b><small>${i?money(i.price):'Market sync'}</small></section><section class="metric"><span>RSI 15m / 1h</span><b>${i?i.rsi15.toFixed(1)+' · '+i.rsi1h.toFixed(1):'SYNC'}</b><small>Trigger · Setup</small></section><section class="metric"><span>RSI 4h / 1D</span><b>${i?i.rsi4.toFixed(1)+' · '+i.rsi1d.toFixed(1):'SYNC'}</b><small>Struktur · Regime</small></section><section class="metric"><span>MACD 15m / 1h</span><b>${i&&i.macd15&&i.macd1h?i.macd15.hist.toFixed(2)+' · '+i.macd1h.hist.toFixed(2):'SYNC'}</b><small>Timing momentum</small></section><section class="metric"><span>MACD 4h</span><b>${i&&i.macd4?i.macd4.hist.toFixed(2):'SYNC'}</b><small>Structure momentum</small></section><section class="metric"><span>EMA 20 / 50</span><b>${i?money(i.ema20)+' / '+money(i.ema50):'SYNC'}</b><small>1D trend</small></section><section class="metric"><span>NEAREST FIB</span><b>${i?i.near.f.toFixed(3)+' · '+money(i.near.price):'SYNC'}</b><small>90 × 4h swing</small></section><section class="metric"><span>ATR 4H</span><b>${i?money(i.atr):'SYNC'}</b><small>Range width input</small></section><section class="metric"><span>NEXT RANGE SCORE</span><b class="${i&&i.status==='RE-ENTRY READY'?'tone-safe':'wait'}">${i?i.score+'/100':'SYNC'}</b><small>${i?i.status:'loading'}</small></section></div>`}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
async function binanceHistory(interval,limit,symbol){
 let rows=[],endTime=null;const marketSymbol=symbol+'USDT';
 while(rows.length<limit){
  const take=Math.min(1000,limit-rows.length),u='https://api.binance.com/api/v3/klines?symbol='+marketSymbol+'&interval='+interval+'&limit='+take+(endTime!=null?'&endTime='+endTime:'');
  const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('Binance history '+r.status);
  const j=await r.json();if(!Array.isArray(j)||!j.length)break;
  const batch=j.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[6]}));
  rows=batch.concat(rows);endTime=batch[0].openTime-1;if(batch.length<take)break
 }
 const dedup=[...new Map(rows.map(x=>[x.openTime,x])).values()].sort((a,b)=>a.openTime-b.openTime);
 return dedup.slice(-limit)
}
function latestIndexAt(rows,ts){let lo=0,hi=rows.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].openTime<=ts){ans=m;lo=m+1}else hi=m-1}return ans}
function histSignal(rows1,i1,rows4,i4,side){
 const s1=rows1.slice(Math.max(0,i1-119),i1+1),s4=rows4.slice(Math.max(0,i4-119),i4+1),c1=s1.map(x=>x.close),c4=s4.map(x=>x.close);
 const R1=rsi(c1),R4=rsi(c4),M1=macd(c1),M4=macd(c4),e20=ema(c1,20),e50=ema(c1,50),p=c1.at(-1);
 if([R1,R4,e20,e50,p].some(x=>x==null)||!M1||!M4)return null;
 let score=0;
 if(side==='LONG'){if(R1>=70)score++;if(R4>=68)score++;if(M1.hist<0)score+=2;if(M4.hist<0)score+=2;if(p<e20)score+=2;if(e20<e50)score++}
 else{if(R1<=30)score++;if(R4<=32)score++;if(M1.hist>0)score+=2;if(M4.hist>0)score+=2;if(p>e20)score+=2;if(e20>e50)score++}
 return{rsi1:R1,rsi4:R4,macd1:M1,macd4:M4,e20,e50,price:p,action:signalAction(score),score}
}
function entrySetup(rows1,i1,rows4,i4,side){
 const s=histSignal(rows1,i1,rows4,i4,side);if(!s)return false;
 if(side==='LONG')return s.rsi1>=42&&s.rsi1<=65&&s.rsi4>=40&&s.rsi4<=68&&s.macd1.hist>0;
 return s.rsi1>=35&&s.rsi1<=58&&s.rsi4>=32&&s.rsi4<=60&&s.macd1.hist<0
}
function backtestLeverage(symbol,side){const a=state.bots.filter(b=>b.symbol===symbol&&(b.side||'LONG')===side).map(b=>num(b.leverage)).filter(x=>x>0).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:4}
function desiredLock(action,pnl,tpRemain){
 if(action==='WATCH PROFIT')return tpRemain<=5&&pnl>=8?.20:0;
 if(action==='PROFIT LOCK CANDIDATE'){if(pnl>=20||(tpRemain<=5&&pnl>=10))return .25;if(pnl>=8)return .20;return 0}
 if(action==='RISK REVIEW'){if(pnl>=20||(tpRemain<=3&&pnl>=12))return .50;if(pnl>=8)return .25;if(pnl>=3)return .20}
 return 0
}
function simulatePolicyTrade(rows1,rows4,start,side,leverage,horizon=120){
 const entry=rows1[start].close,i4=latestIndexAt(rows4,rows1[start].openTime);if(i4<20)return null;
 const a4=atr(rows4.slice(Math.max(0,i4-30),i4+1),14),atrPct=a4&&entry>0?a4/entry*100:3,target=clamp(atrPct*2.5,4,14);
 let locked=0,realized=0,lockEvents=0,maxFav=0,maxAdv=0,exit=start+horizon,hitTp=false,finalRet=0;
 const dirRet=p=>side==='LONG'?(p-entry)/entry*100:(entry-p)/entry*100;
 for(let i=start+1;i<=Math.min(rows1.length-1,start+horizon);i++){
  const b=rows1[i],fav=side==='LONG'?dirRet(b.high):dirRet(b.low),adv=side==='LONG'?dirRet(b.low):dirRet(b.high);
  maxFav=Math.max(maxFav,fav);maxAdv=Math.min(maxAdv,adv);
  if(fav>=target){exit=i;hitTp=true;finalRet=target;break}
  const ret=dirRet(b.close),j4=latestIndexAt(rows4,b.openTime),sig=j4>=0?histSignal(rows1,i,rows4,j4,side):null;
  if(sig&&ret>0){
   const pnl=ret*leverage,tpRemain=Math.max(0,target-ret),want=desiredLock(sig.action,pnl,tpRemain);
   if(want>locked){const add=want-locked;realized+=add*ret;locked=want;lockEvents++}
  }
  finalRet=ret;exit=i
 }
 const baseline=hitTp?target:finalRet,policy=realized+(1-locked)*baseline;
 return{baseline,policy,locked,lockEvents,target,hitTp,maxFav,maxAdv,exit}
}
function maxDrawdownFromReturns(rs){let eq=1,peak=1,dd=0;for(const r of rs){eq*=Math.max(.01,1+r/100);peak=Math.max(peak,eq);dd=Math.min(dd,(eq-peak)/peak*100)}return Math.abs(dd)}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function summarizeBacktest(trades){
 const b=trades.map(x=>x.baseline),p=trades.map(x=>x.policy),lost=trades.map(x=>Math.max(0,x.baseline-x.policy)),saved=trades.map(x=>Math.max(0,x.policy-x.baseline));
 return{trades:trades.length,baselineAvg:avg(b),policyAvg:avg(p),delta:avg(p)-avg(b),baselineWin:b.filter(x=>x>0).length/(b.length||1)*100,policyWin:p.filter(x=>x>0).length/(p.length||1)*100,baselineDD:maxDrawdownFromReturns(b),policyDD:maxDrawdownFromReturns(p),lockTrades:trades.filter(x=>x.locked>0).length,avgLocked:avg(trades.filter(x=>x.locked>0).map(x=>x.locked*100)),missedUpside:avg(lost),savedDownside:avg(saved),tpHits:trades.filter(x=>x.hitTp).length}
}
function runSideBacktest(rows1,rows4,symbol,side){
 const horizon=120,lev=backtestLeverage(symbol,side),trades=[];let i=Math.max(240,Math.floor(rows1.length*.1));
 while(i<rows1.length-horizon&&trades.length<28){
  const i4=latestIndexAt(rows4,rows1[i].openTime);
  if(i4>60&&entrySetup(rows1,i,rows4,i4,side)){const t=simulatePolicyTrade(rows1,rows4,i,side,lev,horizon);if(t){trades.push(t);i=t.exit+18;continue}}
  i+=6
 }
 return{side,leverage:lev,metrics:summarizeBacktest(trades),trades}
}
async function runProfitBacktest(symbol){
 const [h1,h4]=await Promise.all([binanceHistory('1h',2600,symbol),binanceHistory('4h',760,symbol)]);
 if(h1.length<600||h4.length<180)throw new Error('Zu wenig History für '+symbol);
 const first=new Date(h1[0].openTime).toISOString().slice(0,10),last=new Date(h1.at(-1).openTime).toISOString().slice(0,10);
 return{symbol,first,last,long:runSideBacktest(h1,h4,symbol,'LONG'),short:runSideBacktest(h1,h4,symbol,'SHORT'),method:'1h setup + 4h structure · 5d horizon · volatility-normalized TP · current leverage proxy'}
}
function btTone(m){return m.delta>0&&m.policyDD<=m.baselineDD?'safe':m.policyDD<m.baselineDD?'watch':'danger'}
function btVerdict(m){return m.trades<6?'LOW SAMPLE':m.delta>0&&m.policyDD<=m.baselineDD?'PROMISING':m.policyDD+1<m.baselineDD?'DEFENSIVE EDGE':'NO CLEAR EDGE'}
function btSideCard(x){const m=x.metrics,t=btTone(m);return `<article class="bt-side"><div class="bt-side-head"><div><span>${x.side}</span><b>${btVerdict(m)}</b></div><small>${m.trades} Trades · ${x.leverage}x PnL-Proxy</small></div><div class="bt-metrics"><div><span>RUN TO TP</span><b>${m.baselineAvg>=0?'+':''}${m.baselineAvg.toFixed(2)}%</b></div><div><span>LOCK V2</span><b class="tone-${t}">${m.policyAvg>=0?'+':''}${m.policyAvg.toFixed(2)}%</b></div><div><span>DELTA</span><b class="tone-${t}">${m.delta>=0?'+':''}${m.delta.toFixed(2)}%</b></div><div><span>MAX DD</span><b>${m.baselineDD.toFixed(1)} → ${m.policyDD.toFixed(1)}%</b></div><div><span>WIN RATE</span><b>${m.baselineWin.toFixed(0)} → ${m.policyWin.toFixed(0)}%</b></div><div><span>LOCK TRADES</span><b>${m.lockTrades}/${m.trades}</b></div><div><span>SAVED DOWNSIDE</span><b>+${m.savedDownside.toFixed(2)}%</b></div><div><span>MISSED UPSIDE</span><b>-${m.missedUpside.toFixed(2)}%</b></div></div></article>`}
function research(){
 const bt=state.backtest||{},r=bt.result,assets=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];
 return `<section class="hero"><div class="eyebrow">PROFIT LOCK LAB · ENGINE r15</div><h1>PROFIT LOCK LAB</h1><p class="muted">Paired historical policy test · identische Entries · RUN TO TP vs Profit Lock V2.</p></section><section class="bt-control"><div><span>ASSET</span><select id="bt-asset">${assets.map(a=>'<option'+(a===(bt.symbol||'BTC')?' selected':'')+'>'+a+'</option>').join('')}</select></div><button id="bt-run" ${bt.running?'disabled':''}>${bt.running?'BACKTEST LÄUFT…':'BACKTEST STARTEN'}</button><small>History: ~100 Tage · 1h Setup + 4h Struktur · keine echten Orders · Ergebnisse sind Policy-Proxies, kein exakter Grid-PnL.</small></section>${bt.error?'<section class="bt-error">'+bt.error+'</section>':''}${r?'<section class="bt-result"><div class="section-title"><h2>'+r.symbol+' · POLICY TEST</h2><small>'+r.first+' → '+r.last+'</small></div><div class="bt-side-grid">'+btSideCard(r.long)+btSideCard(r.short)+'</div><div class="bt-method">'+r.method+' · Locks werden nur stufenweise bis 20/25/50% simuliert; Rest bleibt Runner bis TP/Horizont.</div></section>':'<section class="card"><b>Warum dieser Test?</b><p>Wir testen nur die Exit-/Profit-Lock-Logik auf denselben historischen Trades. Damit vermeiden wir, Entry und Exit gleichzeitig nachträglich zu optimieren.</p><small>Startet erst nach Klick, damit keine unnötigen API-Abfragen im normalen COMMAND entstehen.</small></section>'}`
}
function bindResearch(){
 const sel=$('#bt-asset'),btn=$('#bt-run');if(!sel||!btn)return;
 sel.onchange=()=>{state.backtest.symbol=sel.value};
 btn.onclick=async()=>{state.backtest.symbol=sel.value;state.backtest.running=true;state.backtest.error=null;state.backtest.result=null;go('research');try{state.backtest.result=await runProfitBacktest(state.backtest.symbol)}catch(e){state.backtest.error=e?.message||String(e)}finally{state.backtest.running=false;go('research')}}
}
function more(){return `<section class="hero"><div class="eyebrow">MORE</div><h1>PORTFOLIO + SYSTEM</h1><p class="muted">Spot/Exchanges bleiben sekundär. Live-Quelle: ${state.source}.</p></section>`}
const render={command,bots,market,research,more};let current='command';
function go(v){current=v;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+v));document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.v===v));$('#view-'+v).innerHTML=render[v]();if(v==='research')bindResearch()}
async function sync(){try{const payload=await getJson('/api/private/dashboard'),d=payload?.data||payload,live=Array.isArray(d?.pionexRisk?.bots)?d.pionexRisk.bots.map(normalizeLive):[];state.bots=live.length?mergeReference(live):FALLBACK.map(ref=>({...ref,_liveMatched:false,_livePrice:false,_livePnl:false,_liveInvest:false,_source:'REFERENCE'}));state.liveRows=live.length;const matched=state.bots.filter(liveMatched).length;state.source=matched===state.bots.length&&matched?'LIVE':matched?'MIXED':'REFERENCE';state.market=String(d?.market?.regime||d?.btcRegime?.label||d?.regime?.label||'SYNC').toUpperCase();state.portfolio=portfolioModel(d);state.syncedAt=Date.now();state.error=null}catch(e){state.error=e.message;state.source='REFERENCE'}renderHeaderTruth();go(current)}
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.v));go('command');Promise.all([sync(),syncIntel()]).then(()=>go(current));setInterval(sync,30000);setInterval(()=>syncIntel().then(()=>{if(['command','bots','market'].includes(current))go(current)}),60000);
