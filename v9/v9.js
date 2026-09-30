import {canonicalPortfolioSnapshot,latestPortfolioHistorySnapshot,pionexEquitySnapshot,sourceTimestampAge,holdingUsd} from '../portfolio-data-contract.js?v=10.0-r70';
import {buildLivePriceOverlay,clearStaleLivePrices} from '../v8-clean/live-price-core-r18.js?v=10.0-r70';
// Legacy-route kill switch: cached /v9/ shells must migrate to v10.
if(!window.MERIDIAN_V10){
  const qs=new URLSearchParams(location.search);
  if(qs.get('legacy')!=='1'){
    qs.delete('legacy');
    qs.set('build','r70');
    location.replace('../v10/?'+qs.toString()+(location.hash||''));
  }
}
const API_BASE=(window.MERIDIAN_V9_CONFIG?.apiBase||'https://p01--achi-meridian--ttvk44grdlp7.code.run').replace(/\/$/,'');
const TOKEN_KEY='meridian.v8.readToken';
const ASSET_WATCH_SNAPSHOT_AT='2026-09-27T19:50:00+02:00';
const FALLBACK=[
{id:'BTC-SHORT-10X-2709',symbol:'BTC',side:'SHORT',leverage:10,investCoin:.00178,lower:70000,upper:95000,be:84125.1,liq:96344,tp:70000,sl:95000,price:84500,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'BTC-LONG-5X-2309',symbol:'BTC',side:'LONG',leverage:5,investCoin:.0014,lower:55000,upper:95000,be:86075.9,liq:57497.4,tp:95000,price:84500,createdAt:'2026-09-23T05:23:00+02:00',snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'BTC-LONG-11X-2709A',symbol:'BTC',side:'LONG',leverage:11,investCoin:.03829,lower:55000,upper:95000,be:85825.5,liq:65667.7,tp:95000,price:84500,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'BTC-LONG-7X-2709',symbol:'BTC',side:'LONG',leverage:7,investCoin:.00371,lower:55000,upper:95000,be:85664.2,liq:60896.4,tp:95000,dynamicMargin:.00003,price:84500,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'BTC-LONG-5X-2709B',symbol:'BTC',side:'LONG',leverage:5,investCoin:.01625,lower:55000,upper:95000,be:84384.5,liq:57047.5,tp:95000,price:84500,createdAt:'2026-09-27T19:07:00+02:00',snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'ETH-SHORT-10X-2709',symbol:'ETH',side:'SHORT',leverage:10,investCoin:.0165,lower:1700.01,upper:3500.05,be:2659.73,liq:3442.24,tp:1700.01,sl:3500.05,price:2689,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'ETH-LONG-5X-2709A',symbol:'ETH',side:'LONG',leverage:5,investCoin:.5005,lower:1450.01,upper:3500.05,be:2769.91,liq:1700.99,tp:3500.05,price:2689,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'ETH-LONG-5X-2709B',symbol:'ETH',side:'LONG',leverage:5,investCoin:.0788,lower:1650,upper:3500.05,be:2705.94,liq:1781.8,tp:3500.05,price:2689,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'ETH-LONG-5X-2709C',symbol:'ETH',side:'LONG',leverage:5,investCoin:.036,lower:1500.01,upper:3400.08,be:2691.24,liq:1565.47,tp:3400.08,price:2689,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'SOL-SHORT-5X-2709',symbol:'SOL',side:'SHORT',leverage:5,investCoin:1.302,lower:65,upper:220.002,be:116.71,liq:203.413,tp:65,sl:200,price:122.05,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'SOL-LONG-5X-2709',symbol:'SOL',side:'LONG',leverage:5,investCoin:59.31,lower:50,upper:200,be:121.999,liq:68.851,tp:200,price:122.05,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'XRP-LONG-5X-2709A',symbol:'XRP',side:'LONG',leverage:5,investCoin:1698.51,lower:.85,upper:2,be:1.5768,liq:.9961,tp:2,price:1.5243,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'XRP-LONG-6X-2709',symbol:'XRP',side:'LONG',leverage:6,investCoin:247.32,lower:.8,upper:2,be:1.5518,liq:.9943,tp:2,price:1.5243,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'XRP-LONG-5X-2709B',symbol:'XRP',side:'LONG',leverage:5,investCoin:141.77,lower:.85,upper:2,be:1.5253,liq:.9807,tp:2,price:1.5243,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'HBAR-LONG-5X-2709',symbol:'HBAR',side:'LONG',leverage:5,investCoin:25643.82,lower:.06,upper:.14,be:.09927,liq:.06851,tp:.14,price:.09397,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'HBAR-LONG-4X-2709',symbol:'HBAR',side:'LONG',leverage:4,investCoin:5673.87,lower:.06,upper:.15,be:.09368,liq:.06328,tp:.15,price:.09397,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'PEPE-LONG-5X-2709A',symbol:'PEPE',side:'LONG',leverage:5,investCoin:89815127.4,lower:.000002,upper:.000008,be:.0000048233,liq:.0000027725,tp:.000008,price:.0000043853,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'PEPE-LONG-5X-2709B',symbol:'PEPE',side:'LONG',leverage:5,investCoin:28169419.21,lower:.000002,upper:.0000055,be:.0000044261,liq:.0000025114,tp:.0000055,price:.0000043853,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'DOT-SHORT-4X-2709',symbol:'DOT',side:'SHORT',leverage:4,investCoin:266.82,lower:.75,upper:2,be:1.165,liq:1.848,tp:.75,sl:1.8,price:1.242,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'DOT-LONG-3X-2709',symbol:'DOT',side:'LONG',leverage:3,investCoin:1272.83,lower:.65,upper:1.8,be:1.242,liq:.678,tp:1.8,price:1.242,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'ADA-SHORT-3X-2709',symbol:'ADA',side:'SHORT',leverage:3,investCoin:1614.65,lower:.16,upper:.5,be:.247,liq:.5501,tp:.16,sl:.5,price:.2545,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'ADA-LONG-5X-2709',symbol:'ADA',side:'LONG',leverage:5,investCoin:5891.35,lower:.125,upper:.5,be:.2573,liq:.1614,tp:.5,price:.2545,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'SUI-SHORT-4X-2709',symbol:'SUI',side:'SHORT',leverage:4,investCoin:459.61,lower:.65,upper:1.85,be:1.0363,liq:1.5591,tp:.65,sl:1.55,price:1.25,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'SUI-LONG-4X-2709',symbol:'SUI',side:'LONG',leverage:4,investCoin:1546.59,lower:.6,upper:1.55,be:1.2467,liq:.6867,tp:1.55,price:1.25,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'AVAX-SHORT-5X-2709',symbol:'AVAX',side:'SHORT',leverage:5,investCoin:10.6,lower:7,upper:15,be:10.351,liq:14.02,tp:7,sl:null,price:11.005,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'AVAX-LONG-5X-2709',symbol:'AVAX',side:'LONG',leverage:5,investCoin:94.89,lower:6,upper:14,be:10.941,liq:6.994,tp:14,price:11.005,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'LINK-SHORT-4X-2709',symbol:'LINK',side:'SHORT',leverage:4,investCoin:36.84,lower:8,upper:25,be:12.872,liq:20.057,tp:8,sl:20.5,price:14.14,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'LINK-LONG-4X-2709',symbol:'LINK',side:'LONG',leverage:4,investCoin:153.79,lower:6,upper:20.5,be:14.122,liq:7.459,tp:20.5,price:14.14,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'XLM-SHORT-5X-2709',symbol:'XLM',side:'SHORT',leverage:5,investCoin:1133.01,lower:.15,upper:.5,be:.21429,liq:.33408,tp:.15,sl:.335,price:.2159,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'XLM-LONG-4X-2709',symbol:'XLM',side:'LONG',leverage:4,investCoin:5794.51,lower:.125,upper:.335,be:.21607,liq:.13769,tp:.335,price:.2159,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'TRX-LONG-6X-2709',symbol:'TRX',side:'LONG',leverage:6,investCoin:3533.43,lower:.25,upper:.44,be:.34067,liq:.26371,tp:.44,price:.3337,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'TRX-LONG-5X-2709',symbol:'TRX',side:'LONG',leverage:5,investCoin:738.37,lower:.26,upper:.4,be:.33399,liq:.25093,tp:.4,price:.3337,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},

{id:'WIF-SHORT-4X-2709',symbol:'WIF',side:'SHORT',leverage:4,investCoin:470.88,lower:.135,upper:.45,be:.235,liq:.348,tp:.135,sl:.35,price:.2455,snapshotAt:ASSET_WATCH_SNAPSHOT_AT},
{id:'WIF-LONG-4X-2709',symbol:'WIF',side:'LONG',leverage:4,investCoin:2071.43,lower:.13,upper:.35,be:.2461,liq:.1415,tp:.35,price:.2455,snapshotAt:ASSET_WATCH_SNAPSHOT_AT}
];
const HEDGES=[];
const MANUAL_POSITIONS=[];
const PIONEX_MANUAL=[];
const OKX_DCA_BOTS=[
{id:'OKX-INJ-FUTURES-DCA-3X',venue:'OKX',type:'FUTURES_DCA',symbol:'INJ',side:'LONG',leverage:3,quote:'USDC',investUsd:65.32,totalPnlUsd:.1729,totalPnlPct:.26,variablePnlUsd:.1824,variablePnlPct:.27,price:7.977,tp:8.28,avgCost:7.908,liq:null,safetyExecuted:0,safetyMax:7,snapshotAt:'2026-09-25T06:22:00+02:00',note:'User screenshot 25.09.2026 06:22 · old OKX position closed, Futures DCA started'},
{id:'OKX-XRP-FUTURES-DCA-3X',venue:'OKX',type:'FUTURES_DCA',symbol:'XRP',side:'LONG',leverage:3,quote:'USDC',investUsd:65.32,totalPnlUsd:-.014,totalPnlPct:-.03,variablePnlUsd:-.0048,variablePnlPct:-.01,price:1.5291,tp:1.5924,avgCost:1.5296,liq:null,safetyExecuted:0,safetyMax:9,snapshotAt:'2026-09-25T06:22:00+02:00',note:'User screenshot 25.09.2026 06:22 · old OKX position closed, Futures DCA started'}
];
const HEDGE=HEDGES[0];
const state={bots:FALLBACK,referenceBots:FALLBACK,referenceSnapshotAt:ASSET_WATCH_SNAPSHOT_AT,hedge:HEDGE,hedges:HEDGES,okxDcaBots:OKX_DCA_BOTS,manualPositions:MANUAL_POSITIONS,pionexManual:PIONEX_MANUAL,source:'REFERENCE',market:null,intel:null,assetIntel:{},priceChecks:{},portfolio:null,portfolioHistory:null,portfolioHistoryError:null,error:null,syncedAt:null,marketSyncedAt:null,marketPriceSyncedAt:null,marketTransport:null,marketError:null,marketPriceError:null,liveRows:0,botApiRows:0,botSupportedRows:0,botDetailRows:0,botDetailsComplete:false,unmatchedLive:[],matchAmbiguous:0,matchDiagnostics:null,botIdentityMode:'REFERENCE_MATCH',apiNativeRows:0,botFeedUpdatedAt:null,botFeedTimestampTrusted:false,botFeedSource:'PRIVATE SNAPSHOT',botFeedStatus:'UNKNOWN',pionexBotSync:null,pionexAccountSync:null,pionexAccount:null,backtest:{symbol:'BTC',running:false,result:null,error:null},manual:{pionex:3126.12,bitpanda:0,ledger:null,okx:null}};
const EXTERNAL_VENUE_REF_KEY='meridian.v10.externalVenueRefs',LEDGER_AUTH_KEY='meridian.v10.ledgerAuthority',EXTERNAL_VENUE_EXPECTED=['Ledger','OKX'],LEDGER_AUTH_MAX_AGE_MS=24*60*60*1000;
function loadExternalVenueRefs(){
 try{
  const raw=JSON.parse(localStorage.getItem(EXTERNAL_VENUE_REF_KEY)||'[]');
  if(!Array.isArray(raw))return[];
  return raw.filter(x=>{const value=num(x?.valueUsd);return x&&EXTERNAL_VENUE_EXPECTED.includes(String(x.venue||''))&&value!=null&&value>=0&&Date.parse(String(x.updatedAt||''))>0})
    .map(x=>({venue:String(x.venue),valueUsd:num(x.valueUsd),source:'LOCAL_USER_REFERENCE',updatedAt:String(x.updatedAt)}));
 }catch{return[]}
}
function saveExternalVenueRefs(rows){try{localStorage.setItem(EXTERNAL_VENUE_REF_KEY,JSON.stringify(rows));return true}catch{return false}}
function loadLedgerAuthority(){
 try{
  const raw=JSON.parse(localStorage.getItem(LEDGER_AUTH_KEY)||'null'),ts=Date.parse(String(raw?.updatedAt||''));
  return Number.isFinite(ts)?{updatedAt:String(raw.updatedAt),source:'LOCAL_LEDGER_CONFIRMATION'}:null;
 }catch{return null}
}
function saveLedgerAuthority(updatedAt=new Date().toISOString()){
 try{localStorage.setItem(LEDGER_AUTH_KEY,JSON.stringify({updatedAt,source:'LOCAL_LEDGER_CONFIRMATION'}));return true}catch{return false}
}
function latestLedgerAuthority(){
 const explicit=loadLedgerAuthority(),legacy=loadExternalVenueRefs().find(x=>String(x.venue).toLowerCase()==='ledger'),rows=[explicit,legacy].filter(Boolean);
 rows.sort((a,b)=>Date.parse(String(b.updatedAt||''))-Date.parse(String(a.updatedAt||'')));
 return rows[0]||null
}
function ledgerAutoState(d){
 const authority=latestLedgerAuthority(),ts=Date.parse(String(authority?.updatedAt||'')),ageMs=Number.isFinite(ts)?Math.max(0,Date.now()-ts):null,fresh=Number.isFinite(ts)&&ts<=Date.now()+30000&&ageMs<=LEDGER_AUTH_MAX_AGE_MS;
 const rows=Array.isArray(d?.portfolio?.holdings)?d.portfolio.holdings.filter(h=>String(h?.venue||'').trim().toLowerCase()==='ledger'&&num(h?.quantity)!=null&&num(h.quantity)>0):[];
 return{active:fresh&&rows.length>0,authorityAt:authority?.updatedAt||null,ageMs,fresh,rowCount:rows.length,rows:fresh?rows.map(h=>({...h,updatedAt:authority.updatedAt,authoritySource:'LOCAL_LEDGER_CONFIRMATION'})):[]};
}
function parseMoneyInput(v){
 const raw=String(v??'').trim().replace(/\s/g,'');if(!raw)return null;
 let x=raw;
 if(raw.includes(',')&&raw.includes('.'))x=raw.lastIndexOf(',')>raw.lastIndexOf('.')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'');
 else if(raw.includes(','))x=raw.replace(',','.');
 const n=Number(x);return Number.isFinite(n)&&n>=0?n:null
}
function portfolioVenueBalances(d,ledgerAuto){
 const existing=Array.isArray(d?.portfolio?.manualVenueBalances)?d.portfolio.manualVenueBalances:[],local=loadExternalVenueRefs(),rows=[...existing,...local];
 return ledgerAuto?.active?rows.filter(x=>String(x?.venue||x?.name||'').trim().toLowerCase()!=='ledger'):rows;
}
function bindPortfolioRefEditor(){
 const ledgerBtn=$('#ledger-authority-confirm'),okxBtn=$('#okx-ref-edit');
 if(ledgerBtn)ledgerBtn.onclick=()=>{
  if(!saveLedgerAuthority()){alert('Ledger-Bestätigung konnte lokal nicht gespeichert werden.');return}
  sync().catch(()=>{});
 };
 if(okxBtn)okxBtn.onclick=()=>{
  const refs=loadExternalVenueRefs(),current=refs.find(x=>String(x.venue).toLowerCase()==='okx');
  const raw=prompt('OKX Gesamtwert in USD',current?.valueUsd??'');if(raw===null)return;
  const value=parseMoneyInput(raw);if(value==null){alert('Ungültiger OKX-Wert. Bitte nur den USD-Gesamtwert eingeben.');return}
  const updatedAt=new Date().toISOString(),kept=refs.filter(x=>String(x.venue).toLowerCase()!=='okx');
  if(!saveExternalVenueRefs([...kept,{venue:'OKX',valueUsd:value,source:'LOCAL_USER_REFERENCE',updatedAt}])){alert('OKX-Referenz konnte lokal nicht gespeichert werden.');return}
  sync().catch(()=>{});
 };
}
const $=s=>document.querySelector(s),num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const money=x=>{x=num(x);if(x==null)return'—';if(x!==0&&Math.abs(x)<.001)return'$'+x.toPrecision(5);return'$'+x.toLocaleString('de-DE',{maximumFractionDigits:2})};
function botMarketPrice(b){
 const intel=state.assetIntel&&b?state.assetIntel[b.symbol]:null,feed=marketIntelFresh(intel)?num(intel.price):null,direct=num(b&&b.price),check=state.priceChecks&&b?state.priceChecks[b.symbol]:null,checkFresh=check?.updatedAt&&Date.now()-Number(check.updatedAt)<=3*60*1000;
 const verified=check&&check.verified&&checkFresh?[num(check.okx),num(check.binance)].filter(x=>x>0):[];
 if(b&&b._livePrice&&direct>0){
  if(verified.length===2){const all=[direct,...verified],avg=all.reduce((a,x)=>a+x,0)/all.length,credible=all.filter(x=>Math.abs(x-avg)/avg<=.025);if(credible.length>=2)return b.side==='SHORT'?Math.max(...credible):Math.min(...credible)}
  return direct
 }
 if(verified.length===2)return b&&b.side==='SHORT'?Math.max(...verified):Math.min(...verified);
 if(feed>0)return feed;
 return b&&b._livePrice&&direct>0?direct:null
}
function botPriceSource(b){const c=state.priceChecks&&b?state.priceChecks[b.symbol]:null,cf=c?.updatedAt&&Date.now()-Number(c.updatedAt)<=3*60*1000,i=state.assetIntel&&b?state.assetIntel[b.symbol]:null;if(b&&b._livePrice&&c&&c.verified&&cf)return'PIONEX + OKX SWAP + BINANCE USD-M';if(c&&c.verified&&cf)return'OKX SWAP + BINANCE USD-M';if(b&&b._livePrice)return'PIONEX LIVE';if(marketIntelFresh(i)&&i.price)return i.source||'FRESH MARKET';return'UNVERIFIED'}
function liveMatched(b){return !!(b&&b._liveMatched)}
function livePnlAvailable(b){return liveMatched(b)&&!!b._livePnl}
function liveInvestAvailable(b){return liveMatched(b)&&!!b._liveInvest}
function liveInvestUsdAvailable(b){return liveMatched(b)&&!!b._liveInvestUsd}
function parseTs(v){const t=Date.parse(String(v||''));return Number.isFinite(t)?t:null}
function botFeedTimeState(){const updatedAt=state.botFeedUpdatedAt??null,trusted=!!state.botFeedTimestampTrusted,future=updatedAt!=null&&updatedAt>Date.now()+5*60*1000,ageMs=updatedAt!=null?Math.max(0,Date.now()-updatedAt):null;return{updatedAt,trusted,future,ageMs}}
function botFeedAgeMs(){return botFeedTimeState().ageMs}
function botFeedFresh(){const t=botFeedTimeState();return t.trusted&&!t.future&&t.ageMs!=null&&t.ageMs<=15*60*1000}
function botFeedAgeLabel(){const t=botFeedTimeState();if(!t.trusted)return'NO TRUSTED TIMESTAMP';if(t.future)return'FUTURE TIMESTAMP';return ageText(t.ageMs)}
function botFeedCoverage(){const matched=state.bots.filter(liveMatched).length,supported=Math.max(0,Number(state.liveRows)||0),unmatched=Math.max(0,supported-matched),ambiguous=Number(state.matchAmbiguous||0),fresh=botFeedFresh(),coverageComplete=fresh&&supported>0&&unmatched===0&&ambiguous===0;return{matched,supported,unmatched,ambiguous,fresh,coverageComplete}}
function ageText(ms){if(ms==null)return'NO TIMESTAMP';const m=Math.floor(ms/60000);if(m<1)return'<1 MIN';if(m<60)return m+' MIN';const h=Math.floor(m/60);return h<48?h+'H '+(m%60)+'M':Math.floor(h/24)+'D '+(h%24)+'H'}
function marketIntelFresh(i,maxAge=3*60*1000){const ts=num(i?.updatedAt);return !!i&&ts!=null&&ts<=Date.now()+30000&&Date.now()-ts<=maxAge}
function trackedMarketSymbols(){const accountPositions=Array.isArray(state.pionexAccount?.futuresPositions)?state.pionexAccount.futuresPositions.map(x=>({symbol:x?.asset||String(x?.symbol||'').replace(/[-_/](USDT|USDC|USD)_?PERP$/,'').replace(/\.PERP$/,'')})):[];return [...new Set([...(state.referenceBots||[]),...(state.bots||[]),...(state.okxDcaBots||[]),...(state.unmatchedLive||[]),...accountPositions].map(x=>String(x?.symbol||'').trim().toUpperCase()).filter(Boolean))]}
function safetyReadyBot(b){return liveMatched(b)&&botFeedFresh()&&risk(b)!=null}
function decisionReadyBot(b){return safetyReadyBot(b)&&livePnlAvailable(b)&&marketIntelFresh(state.assetIntel?.[b.symbol])}
function actionableBot(b){return decisionReadyBot(b)}
function exposureIntegrity(symbol=null){
 const scope=String(symbol||'').trim().toUpperCase(),inScope=x=>!scope||String(x?.symbol||'').trim().toUpperCase()===scope,fresh=botFeedFresh();
 const matched=fresh?state.bots.filter(b=>liveMatched(b)&&inScope(b)):[],unmatched=fresh?(state.unmatchedLive||[]).filter(inScope):[],missingCapital=matched.filter(b=>!liveInvestUsdAvailable(b)).length,unknown=unmatched.length+missingCapital;
 return{fresh,matched:matched.length,unmatched:unmatched.length,missingCapital,unknown,complete:fresh&&matched.length>0&&unmatched.length===0&&missingCapital===0}
}
function pnlIntegrity(symbol=null){
 const scope=String(symbol||'').trim().toUpperCase(),inScope=x=>!scope||String(x?.symbol||'').trim().toUpperCase()===scope,fresh=botFeedFresh();
 const matched=fresh?state.bots.filter(b=>liveMatched(b)&&inScope(b)):[],unmatched=fresh?(state.unmatchedLive||[]).filter(inScope):[],missingPnl=matched.filter(b=>botPnlUsd(b).value==null).length,unknown=unmatched.length+missingPnl;
 return{fresh,matched:matched.length,unmatched:unmatched.length,missingPnl,unknown,complete:fresh&&matched.length>0&&unmatched.length===0&&missingPnl===0}
}
function botPnlUsd(b){
 if(b&&b._liveMatched===true&&b._livePnl===false)return{value:null,source:'NONE',corrected:false};
 if(b&&b._liveMatched===false)return{value:num(b.pnl),source:'REFERENCE',corrected:false};
 const raw=num(b&&b.pnl),investUsd=num(b&&b.investUsd),pct=num(b&&b.profitPct),implied=investUsd>0&&pct!=null?investUsd*pct/100:null;
 if(implied!=null){
  if(raw==null)return{value:implied,source:'PCT_X_USD_INVEST',corrected:false};
  const tolerance=Math.max(1,Math.abs(implied)*.35);
  if(Math.abs(raw-implied)>tolerance)return{value:implied,source:'PCT_X_USD_INVEST',corrected:true,raw:raw}
 }
 return{value:raw,source:raw==null?'NONE':'LIVE_USD',corrected:false}
}
function token(){try{return String(localStorage.getItem(TOKEN_KEY)||'').trim()}catch{return''}}
const FETCH_TIMEOUT_MS=10000;
async function fetchTimed(url,options={},timeoutMs=FETCH_TIMEOUT_MS){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),Math.max(1000,Number(timeoutMs)||FETCH_TIMEOUT_MS));
 try{return await fetch(url,{...options,signal:c.signal})}
 catch(e){if(e?.name==='AbortError'){let host='REMOTE';try{host=new URL(url,typeof location!=='undefined'?location.href:'http://localhost').hostname}catch{}throw new Error('FETCH_TIMEOUT '+host)}throw e}
 finally{clearTimeout(t)}
}
async function getJson(path){const r=await fetchTimed(API_BASE+path,{cache:'no-store',headers:{accept:'application/json',...(token()?{authorization:'Bearer '+token()}:{})}},10000);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
async function postJson(path,body={}){const r=await fetchTimed(API_BASE+path,{method:'POST',cache:'no-store',headers:{accept:'application/json','content-type':'application/json',...(token()?{authorization:'Bearer '+token()}:{})},body:JSON.stringify(body)},10000);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
async function manageAssetWatchShare(action='rotate'){const j=await postJson('/api/private/asset-watch-share',{action});return{...j,shareUrl:j?.sharePath?API_BASE+j.sharePath:null}}
const PORTFOLIO_TICKER_CACHE_MS=25000;
let portfolioTickerCache={at:0,rows:null};
async function portfolioSpotTickers(){
 const now=Date.now();if(Array.isArray(portfolioTickerCache.rows)&&now-portfolioTickerCache.at<PORTFOLIO_TICKER_CACHE_MS)return portfolioTickerCache.rows;
 let lastError=null;
 for(const url of ['https://api.binance.com/api/v3/ticker/price','https://data-api.binance.vision/api/v3/ticker/price']){
  try{const r=await fetchTimed(url,{cache:'no-store',headers:{accept:'application/json'}},8000);if(!r.ok)throw new Error('BINANCE SPOT '+r.status);const rows=await r.json();if(!Array.isArray(rows))throw new Error('BINANCE SPOT INVALID');portfolioTickerCache={at:now,rows};return rows}catch(e){lastError=e}
 }
 throw lastError||new Error('BINANCE SPOT UNAVAILABLE')
}
function okxDcaEquitySnapshot(){const rows=state.okxDcaBots||[],missingInvest=rows.filter(x=>num(x.investUsd)==null).length,missingPnl=rows.filter(x=>num(x.totalPnlUsd)==null).length,complete=rows.length>0&&missingInvest===0&&missingPnl===0,value=complete?rows.reduce((sum,x)=>sum+num(x.investUsd)+num(x.totalPnlUsd),0):null;return{value,complete,rows:rows.length,missingInvest,missingPnl}}function okxKnownBotEquity(){return okxDcaEquitySnapshot().value}
function portfolioModel(d,history){
 const selectedRisk=selectPionexRisk(d).risk,liveBots=Array.isArray(selectedRisk?.bots)?selectedRisk.bots.map(normalizeLive):[],botCapital=liveBots.reduce((sum,b)=>sum+(num(b.investUsd)||0)+(botPnlUsd(b).value||0),0),botRowsWithCapital=liveBots.filter(b=>b.investUsd!=null),allBotsHaveCapital=liveBots.length>0&&botRowsWithCapital.length===liveBots.length;
 const historyPoint=latestPortfolioHistorySnapshot(history),privatePionex=pionexEquitySnapshot(d),walletEquity=num(d?.pionexAccount?.wallet?.totalInUsdt),walletUpdatedAt=d?.pionexAccount?.updatedAt||d?.pionexAccount?.snapshotAt||null,walletTs=Date.parse(String(walletUpdatedAt||'')),privateTs=Date.parse(String(privatePionex?.updatedAt||'')),now=Date.now(),walletFresh=String(d?.pionexAccountSync?.status||'UNKNOWN')==='OK'&&String(d?.pionexAccount?.walletStatus||'UNKNOWN')==='OK'&&Number.isFinite(walletTs)&&walletTs<=now+5*60*1000&&now-walletTs<=15*60*1000,privateFresh=privatePionex.found&&Number.isFinite(privateTs)&&privateTs<=now+5*60*1000&&now-privateTs<=15*60*1000,walletPionex=walletFresh&&walletEquity!=null&&walletEquity>=0?{found:true,value:walletEquity,source:'PIONEX_WALLET_READ_API',updatedAt:walletUpdatedAt}:null,resolvedPionex=walletPionex&&(!privateFresh||walletTs>=privateTs)?walletPionex:privatePionex.found?privatePionex:(walletPionex||{found:false,value:0,source:'MISSING',updatedAt:null});
 const ledgerAuto=ledgerAutoState(d),venueBalances=portfolioVenueBalances(d,ledgerAuto),strictHoldings=ledgerAuto.active?ledgerAuto.rows:[],expectedExternal=ledgerAuto.active?['OKX']:EXTERNAL_VENUE_EXPECTED,requiredHoldingVenues=ledgerAuto.active?['Ledger']:[],ignoredPrivateHoldings=Math.max(0,(Array.isArray(d?.portfolio?.holdings)?d.portfolio.holdings.filter(h=>String(h?.venue||'').toLowerCase()!=='pionex').length:0)-strictHoldings.length);
 const strictPortfolio={...(d?.portfolio||{}),holdings:strictHoldings,authorityMode:'STRICT_VENUE_SNAPSHOT',externalVenueSnapshotComplete:true,externalVenueExpectedVenues:expectedExternal,requiredHoldingVenues,manualVenueBalances:venueBalances},canonicalInput=resolvedPionex.found?{...d,portfolio:{...strictPortfolio,pionexEquityUsd:resolvedPionex.value,pionexEquitySource:resolvedPionex.source,pionexEquityUpdatedAt:resolvedPionex.updatedAt}}:{...d,portfolio:{...strictPortfolio,pionexEquityUsd:state.manual.pionex,pionexEquitySource:'FALLBACK_SCREENSHOT'}},snapshot=canonicalPortfolioSnapshot(canonicalInput,Date.now()),spotAuthority=snapshot.spotAuthority||{},priceCoverage=snapshot.priceCoverage||{},pionexTime=sourceTimestampAge(resolvedPionex.updatedAt);
 const privateComplete=spotAuthority.complete===true&&resolvedPionex.found===true,total=privateComplete?snapshot.totalUsd:null,spot=spotAuthority.complete===true?snapshot.spotUsd:null,pionex=resolvedPionex.found?snapshot.tradingUsd:null,source=!privateComplete?'INCOMPLETE':resolvedPionex.source==='PIONEX_WALLET_READ_API'?'CANONICAL_MIXED':'PRIVATE_CANONICAL_SNAPSHOT',okxSnapshot=okxDcaEquitySnapshot(),okxReference=okxSnapshot.value,externalRows=Array.isArray(spotAuthority.externalRows)?spotAuthority.externalRows:[],okxVenue=externalRows.find(x=>String(x?.venue||'').toLowerCase()==='okx'),ledgerAutoUsd=ledgerAuto.active&&priceCoverage.complete?num(spotAuthority.holdingsUsd):null;
 const ledgerAssets=ledgerAuto.active?strictHoldings.map(h=>({symbol:String(h?.symbol||'').trim().toUpperCase(),quantity:num(h?.quantity),venue:String(h?.venue||'Ledger'),valueUsd:holdingUsd(canonicalInput,h),updatedAt:ledgerAuto.authorityAt||h?.updatedAt||null})).filter(x=>x.symbol&&x.quantity!=null&&x.quantity>0):[];
 const historyComparable=total!=null&&historyPoint.found&&historyPoint.complete&&historyPoint.consistent&&historyPoint?.sourceStatus?.spot==='STRICT_AUTHORITY',historyDeltaUsd=historyComparable?historyPoint.totalUsd-total:null;
 return{total,spot,pionex,okx:okxReference,okxComplete:okxSnapshot.complete,okxRows:okxSnapshot.rows,okxMissingInvest:okxSnapshot.missingInvest,okxMissingPnl:okxSnapshot.missingPnl,okxVenueUsd:num(okxVenue?.valueUsd),okxVenueUpdatedAt:okxVenue?.updatedAt||null,botCapital:allBotsHaveCapital?botCapital:null,complete:privateComplete,source,sourceAgeMs:spotAuthority.maxAgeMs,spotRequested:Number(priceCoverage.requested)||0,spotResolved:Number(priceCoverage.resolved)||0,spotCoverageComplete:!!priceCoverage.complete,externalVenueCount:Number(spotAuthority.venueCount)||0,externalVenues:Array.isArray(spotAuthority.venues)?spotAuthority.venues:[],excludedStaleHoldings:Number(spotAuthority.excludedStaleHoldings)||0,supersededHoldings:Number(spotAuthority.supersededHoldings)||0,ignoredPrivateHoldings,externalSnapshotAgeMs:spotAuthority.maxAgeMs,ledgerAutoActive:ledgerAuto.active,ledgerAutoRows:ledgerAuto.rowCount,ledgerAutoUsd,ledgerAutoAgeMs:ledgerAuto.ageMs,ledgerAutoAuthorityAt:ledgerAuto.authorityAt,ledgerAssets,ledgerAutoPriceResolved:Number(priceCoverage.resolved)||0,ledgerAutoPriceRequested:Number(priceCoverage.requested)||0,historySource:historyPoint.source,historyAgeMs:historyPoint.ageMs,historyComparable,historyDeltaUsd,livePriceMeta:d?.livePriceMeta||null,pionexSource:resolvedPionex.source,pionexProvenance:resolvedPionex.source,pionexUpdatedAt:resolvedPionex.updatedAt,pionexTimestampKnown:pionexTime.known,pionexTimestampFuture:pionexTime.future,pionexTimestampMs:pionexTime.timestampMs,pionexAgeMs:pionexTime.ageMs};
}
function pick(b,keys){for(const k of keys){const v=num(b?.[k]);if(v!=null)return v}return null}function normalizeLive(b){const nested=b?.bot||b?.position||b?.data||{},x={...nested,...b},investUsd=pick(x,['investmentUsd','investmentUSDT','investmentUsdt','usdtInvestment','investedUsd','investment_usdt']),investAny=investUsd??pick(x,['invest','investment','invested','invested_amount','initialInvestment','initial_investment']);return{id:String(x.id||x.botId||x.bot_id||x.name||x.symbol||'BOT'),symbol:String(x.symbol||x.asset||x.baseAsset||x.base_asset||'').replace(/[-_/]?(USDT|USDC|USD)$/,'').replace(/\.PERP$/,'').toUpperCase(),leverage:pick(x,['leverage','leverageX','leverage_x']),lower:pick(x,['lower','lowerRange','rangeLower','lowerPrice','lower_price','minPrice','min_price']),upper:pick(x,['upper','upperRange','rangeUpper','upperPrice','upper_price','maxPrice','max_price']),be:pick(x,['be','breakEvenPrice','breakevenPrice','break_even_price','avgEntryPrice','averageEntryPrice','breakEven','break_even','entryPrice','entry_price','positionOpenPrice','position_open_price']),liq:pick(x,['liq','pionexLiquidationPrice','liquidationPrice','liqPrice','liquidation_price']),tp:pick(x,['tp','takeProfit','tpPrice','take_profit_price']),sl:pick(x,['sl','stopLoss','stopLossPrice','lossStop','stop_loss_price']),price:pick(x,['price','currentPrice','markPrice','lastPrice','mark_price','last_price']),buffer:pick(x,['buffer','pionexLiqBufferPct','liqBufferPct','liquidationDistancePct']),pnl:pick(x,['pnl','totalProfitUsd','totalProfitUSDT','totalProfitUsdt','total_profit_usdt','pnlUsd','unrealizedPnlUsd','unrealizedPnl','unrealized_profit','totalProfit','total_profit','profit']),invest:investAny,investUsd,profitPct:pick(x,['profitPct','totalProfitPct','pnlPct','total_profit_pct','profit_rate','profitRate']),side:String(x.side||x.direction||x.positionSide||'LONG').toUpperCase()}}
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
const MATCH_MAX_SCORE=4,MATCH_MIN_GAP=.05;
function botMatchEvidence(ref,x){
  const score=botMatchScore(ref,x);if(!(score<1e9))return null;
  const levExact=x.leverage!=null&&x.leverage===ref.leverage;
  const structural=['lower','upper','be','liq'].filter(k=>{const d=relDiff(x[k],ref[k]);return d!=null&&d<.03});
  const strong=score<=MATCH_MAX_SCORE&&((levExact&&structural.length>=1)||structural.length>=2);
  return{score,levExact,structural,strong};
}
function economicSide(x){
  const be=num(x?.be),liq=num(x?.liq);
  if(!(be>0&&liq>0))return null;
  const gap=Math.abs(liq-be)/Math.max(be,liq,1e-12);
  if(gap<.002)return null;
  return liq<be?'LONG':'SHORT';
}
function matchStageDiagnostics(live,refs,candidates=[],acceptedRows=0){
  const rows=Array.isArray(live)?live:[],reference=Array.isArray(refs)?refs:[],fieldKeys=['leverage','lower','upper','be','liq','tp'],fields=Object.fromEntries(fieldKeys.map(k=>[k,0])),liveSideCounts={},referenceSideCounts={},economicSideCounts={};
  let assetPass=0,sidePass=0,leveragePass=0,structurePass=0,strongCandidate=0,assetLeveragePass=0,assetStructurePass=0,economicKnown=0,economicAgree=0,economicOpposite=0,economicReferenceSidePass=0,economicReferenceLeveragePass=0,economicReferenceStructurePass=0;
  const bump=(obj,key)=>{const k=String(key||'UNKNOWN').toUpperCase();obj[k]=(obj[k]||0)+1;};
  const structuralHit=(x,ref)=>['lower','upper','be','liq'].some(k=>{const d=relDiff(x?.[k],ref?.[k]);return d!=null&&d<.03});
  reference.forEach(ref=>bump(referenceSideCounts,ref?.side||'LONG'));
  rows.forEach((x,li)=>{
    const declared=String(x?.side||'UNKNOWN').toUpperCase(),economic=economicSide(x);
    bump(liveSideCounts,declared);bump(economicSideCounts,economic||'UNKNOWN');
    for(const k of fieldKeys)if(num(x?.[k])!=null)fields[k]++;
    const assetRefs=reference.filter(ref=>String(ref?.symbol||'').toUpperCase()===String(x?.symbol||'').toUpperCase());
    if(assetRefs.length)assetPass++;
    if(assetRefs.some(ref=>num(x?.leverage)!=null&&num(ref?.leverage)!=null&&num(x.leverage)===num(ref.leverage)))assetLeveragePass++;
    if(assetRefs.some(ref=>structuralHit(x,ref)))assetStructurePass++;
    const sideRefs=assetRefs.filter(ref=>String(ref?.side||'LONG').toUpperCase()===declared);
    if(sideRefs.length)sidePass++;
    const levRefs=sideRefs.filter(ref=>num(x?.leverage)!=null&&num(ref?.leverage)!=null&&num(x.leverage)===num(ref.leverage));
    if(levRefs.length)leveragePass++;
    if(sideRefs.some(ref=>structuralHit(x,ref)))structurePass++;
    if(candidates.some(c=>c.li===li))strongCandidate++;
    if(economic){
      economicKnown++;
      if(economic===declared)economicAgree++;else if(['LONG','SHORT'].includes(declared))economicOpposite++;
      const econRefs=assetRefs.filter(ref=>String(ref?.side||'LONG').toUpperCase()===economic);
      if(econRefs.length)economicReferenceSidePass++;
      if(econRefs.some(ref=>num(x?.leverage)!=null&&num(ref?.leverage)!=null&&num(x.leverage)===num(ref.leverage)))economicReferenceLeveragePass++;
      if(econRefs.some(ref=>structuralHit(x,ref)))economicReferenceStructurePass++;
    }
  });
  return{rows:rows.length,assetPass,sidePass,leveragePass,structurePass,strongCandidate,acceptedRows:Number(acceptedRows)||0,assetLeveragePass,assetStructurePass,economicKnown,economicAgree,economicOpposite,economicReferenceSidePass,economicReferenceLeveragePass,economicReferenceStructurePass,fields,liveSideCounts,referenceSideCounts,economicSideCounts};
}
function apiNativeIdentityEligible(feed,selected,live){
  const rows=Array.isArray(live)?live:[],ids=rows.map(x=>String(x?.id||'').trim()),supported=num(feed?.supportedRows)??rows.length,normalized=num(feed?.normalizedRows)??rows.length;
  return selected?.kind==='WALLET_DETAIL'&&feed?.detailsComplete===true&&rows.length>0&&supported===rows.length&&normalized===rows.length&&ids.every(Boolean)&&new Set(ids).size===rows.length;
}
function markApiNativeIdentity(live){
  return (Array.isArray(live)?live:[]).map(x=>({...x,_liveMatched:true,_livePrice:num(x.price)>0,_livePnl:num(x.pnl)!=null||num(x.profitPct)!=null,_livePnlUsd:num(x.pnl)!=null,_liveProfitPct:num(x.profitPct)!=null,_liveInvest:num(x.invest)!=null,_liveInvestUsd:num(x.investUsd)!=null,_liveLiq:num(x.liq)>0||num(x.buffer)>0,_liveBe:num(x.be)>0,_liveTp:num(x.tp)>0,_liveSl:num(x.sl)>0,_matchEvidence:'API_IDENTITY',_source:'LIVE_API_IDENTITY'}));
}
function mergeReference(live){
  const used=new Set,refs=FALLBACK.map(ref=>({...ref,_liveMatched:false,_livePrice:false,_livePnl:false,_liveInvest:false,_source:'REFERENCE'})),candidates=[];
  for(let ri=0;ri<refs.length;ri++)for(let li=0;li<live.length;li++){
    const ev=botMatchEvidence(refs[ri],live[li]);if(ev?.strong)candidates.push({ri,li,...ev});
  }
  const byLive=new Map,byRef=new Map;
  for(const c of candidates){
    if(!byLive.has(c.li))byLive.set(c.li,[]);byLive.get(c.li).push(c);
    if(!byRef.has(c.ri))byRef.set(c.ri,[]);byRef.get(c.ri).push(c);
  }
  for(const rows of byLive.values())rows.sort((a,b)=>a.score-b.score);
  for(const rows of byRef.values())rows.sort((a,b)=>a.score-b.score);
  const accepted=[];
  for(const c of candidates){
    const l=byLive.get(c.li)||[],r=byRef.get(c.ri)||[];
    if(l[0]!==c||r[0]!==c)continue;
    const liveGap=l[1]?l[1].score-c.score:Infinity,refGap=r[1]?r[1].score-c.score:Infinity;
    if(liveGap<MATCH_MIN_GAP||refGap<MATCH_MIN_GAP)continue;
    accepted.push({...c,liveGap,refGap});
  }
  accepted.sort((a,b)=>a.score-b.score);
  const refUsed=new Set;
  for(const m of accepted){
    if(refUsed.has(m.ri)||used.has(m.li))continue;
    const ref=refs[m.ri],x=live[m.li];
    refs[m.ri]={...ref,...Object.fromEntries(Object.entries(x).filter(([,v])=>v!=null&&v!=='')),lower:num(x.lower),upper:num(x.upper),be:num(x.be),liq:num(x.liq),tp:num(x.tp),sl:num(x.sl),buffer:num(x.buffer),price:num(x.price),pnl:num(x.pnl),profitPct:num(x.profitPct),invest:num(x.invest),investUsd:num(x.investUsd),side:x.side||ref.side||'LONG',_liveMatched:true,_livePrice:num(x.price)>0,_livePnl:num(x.pnl)!=null||num(x.profitPct)!=null,_livePnlUsd:num(x.pnl)!=null,_liveProfitPct:num(x.profitPct)!=null,_liveInvest:num(x.invest)!=null,_liveInvestUsd:num(x.investUsd)!=null,_liveLiq:num(x.liq)>0||num(x.buffer)>0,_liveBe:num(x.be)>0,_liveTp:num(x.tp)>0,_liveSl:num(x.sl)>0,_matchScore:m.score,_matchLiveGap:m.liveGap,_matchRefGap:m.refGap,_matchEvidence:m.structural.join('+')+(m.levExact?'+LEV':''),_source:'LIVE_MATCH'};
    refUsed.add(m.ri);used.add(m.li);
  }
  state.unmatchedLive=live.map((x,i)=>{
    if(used.has(i))return null;
    const rows=byLive.get(i)||[],ambiguous=rows.length>1&&(rows[1].score-rows[0].score)<MATCH_MIN_GAP;
    return{symbol:x.symbol||'?',side:x.side||'?',leverage:x.leverage,id:x.id||'?',hasPnl:num(x.pnl)!=null||num(x.profitPct)!=null,hasInvestUsd:num(x.investUsd)!=null,reason:ambiguous?'AMBIGUOUS_MATCH':'NO_CONFIDENT_MATCH'};
  }).filter(Boolean);
  state.matchAmbiguous=state.unmatchedLive.filter(x=>x.reason==='AMBIGUOUS_MATCH').length;
  state.matchDiagnostics=matchStageDiagnostics(live,refs,candidates,used.size);
  return refs;
}

function ema(v,p){if(v.length<p)return null;const k=2/(p+1);let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<v.length;i++)e=v[i]*k+e*(1-k);return e}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d)}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(0,d))/p;l=(l*(p-1)+Math.max(0,-d))/p}return l?100-100/(1+g/l):100}
function macd(v){if(v.length<35)return null;const series=p=>{const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o};const a=series(12),b=series(26),m=v.map((_,i)=>a[i]-b[i]);const k=2/10;let s=m[0];for(let i=1;i<m.length;i++)s=m[i]*k+s*(1-k);return{line:m.at(-1),signal:s,hist:m.at(-1)-s}}
function atr(rows,p=14){if(rows.length<p+1)return null;const t=[];for(let i=1;i<rows.length;i++)t.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));let a=t.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<t.length;i++)a=(a*(p-1)+t[i])/p;return a}
const MARKET_INTERVAL_MS={'15m':15*60*1000,'1h':60*60*1000,'4h':4*60*60*1000,'1d':24*60*60*1000};
function closedMarketRows(rows){
 const source=rows?.source||null,fetchedAt=num(rows?.fetchedAt),transport=rows?.transport||null,cache=rows?.cache||null,now=Date.now(),out=(Array.isArray(rows)?rows:[]).filter(x=>num(x?.closeTime)!=null&&num(x.closeTime)<now-1000);
 if(source)out.source=source;if(fetchedAt!=null)out.fetchedAt=fetchedAt;if(transport)out.transport=transport;if(cache)out.cache=cache;return out
}
function marketRowsTimestamp(...sets){
 const ts=sets.map(x=>num(x?.fetchedAt)).filter(x=>x!=null&&x<=Date.now()+30000);
 return ts.length?Math.min(...ts):Date.now()
}
function marketTransportLabel(...sets){
 const labels=[...new Set(sets.map(x=>String(x?.transport||'')).filter(Boolean))];
 return labels.join(' + ')||'DIRECT'
}
async function marketKlines(interval,limit,symbol='BTC'){
 const safeSymbol=String(symbol||'BTC').trim().toUpperCase(),safeLimit=Math.max(20,Math.min(300,Math.floor(Number(limit)||160)));
 try{
  const q=new URLSearchParams({symbol:safeSymbol,interval:String(interval),limit:String(safeLimit)}),j=await getJson('/api/private/market-klines?'+q.toString());
  if(!j?.ok||!Array.isArray(j.rows)||!j.rows.length)throw new Error(String(j?.error||'GATEWAY_INVALID'));
  const rows=j.rows.map(x=>({openTime:+x.openTime,high:+x.high,low:+x.low,close:+x.close,closeTime:+x.closeTime})).filter(x=>[x.openTime,x.high,x.low,x.close,x.closeTime].every(Number.isFinite));
  if(!rows.length)throw new Error('GATEWAY_EMPTY');
  rows.source=String(j.source||'MERIDIAN MARKET GATEWAY');rows.transport='MERIDIAN_GATEWAY';rows.fetchedAt=num(j.fetchedAt)||Date.now();rows.cache=String(j.cache||'MISS');return rows
 }catch(gatewayError){
  const barMap={'15m':'15m','1h':'1H','4h':'4H','1d':'1D'},bar=barMap[interval]||interval;
  try{
   const u='https://www.okx.com/api/v5/market/candles?instId='+safeSymbol+'-USDT-SWAP&bar='+bar+'&limit='+safeLimit,r=await fetchTimed(u,{cache:'no-store'},7000);
   if(!r.ok)throw new Error('OKX '+r.status);
   const j=await r.json();if(j.code!=='0'||!j.data?.length)throw new Error('OKX data');
   const span=MARKET_INTERVAL_MS[interval]||0,rows=j.data.map(x=>({openTime:+x[0],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[0]+Math.max(1,span)-1})).reverse();
   rows.source='OKX USDT-SWAP';rows.transport='DIRECT_FALLBACK';rows.fetchedAt=Date.now();rows.gatewayError=String(gatewayError?.message||gatewayError);return rows
  }catch(okxError){
   const r=await fetchTimed('https://fapi.binance.com/fapi/v1/klines?symbol='+safeSymbol+'USDT&interval='+interval+'&limit='+safeLimit,{cache:'no-store'},7000);
   if(!r.ok)throw new Error('MARKET GATEWAY '+String(gatewayError?.message||gatewayError)+' / BINANCE FUTURES '+r.status+' / '+String(okxError?.message||okxError));
   const rows=(await r.json()).map(x=>({openTime:+x[0],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[6]}));
   rows.source='BINANCE USD-M FUTURES';rows.transport='DIRECT_FALLBACK';rows.fetchedAt=Date.now();rows.gatewayError=String(gatewayError?.message||gatewayError);return rows
  }
 }
}
async function marketKlinesHistory(interval,bars,symbol='BTC'){
 const want=Math.max(50,Math.min(9000,Math.floor(Number(bars)||1000))),out=[];let end=Date.now(),guard=0;
 while(out.length<want&&guard++<12){
  const limit=Math.min(1000,want-out.length),u='https://api.binance.com/api/v3/klines?symbol='+symbol+'USDT&interval='+interval+'&limit='+limit+'&endTime='+Math.floor(end);
  const r=await fetchTimed(u,{cache:'no-store'},8000);if(!r.ok)throw new Error('BINANCE HISTORY '+r.status);
  const rows=(await r.json()).map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]}));
  if(!rows.length)break;out.unshift(...rows);end=rows[0].openTime-1;
  if(out.length<want)await new Promise(resolve=>setTimeout(resolve,80));
 }
 return [...new Map(out.map(x=>[x.openTime,x])).values()].filter(x=>num(x.closeTime)!=null&&num(x.closeTime)<Date.now()-1000).sort((a,b)=>a.openTime-b.openTime).slice(-want)
}
async function syncCrossPrices(){
 try{
  const [or,br]=await Promise.all([fetchTimed('https://www.okx.com/api/v5/market/tickers?instType=SWAP',{cache:'no-store'},8000),fetchTimed('https://fapi.binance.com/fapi/v1/ticker/price',{cache:'no-store'},8000)]);
  if(!or.ok||!br.ok)throw new Error('cross-price http');
  const [oj,bj]=await Promise.all([or.json(),br.json()]),om=new Map((oj.data||[]).map(x=>[x.instId,num(x.last)])),bm=new Map((Array.isArray(bj)?bj:[]).map(x=>[x.symbol,num(x.price)])),out={},now=Date.now();
  for(const symbol of trackedMarketSymbols()){const okx=om.get(symbol+'-USDT-SWAP')||null,binance=bm.get(symbol+'USDT')||null,spread=okx>0&&binance>0?Math.abs(okx-binance)/Math.min(okx,binance)*100:null;out[symbol]={okx,binance,spreadPct:spread,verified:spread!=null&&spread<=.5,updatedAt:now,sources:'OKX SWAP + BINANCE USD-M'}}
  state.priceChecks=out;state.marketPriceSyncedAt=now;state.marketPriceError=null
 }catch(e){state.priceChecks={};state.marketPriceError=String(e?.message||e)}
}
function intel(rows15,rows1h,rows4,rows1d){
 const c15=rows15.map(x=>x.close),c1h=rows1h.map(x=>x.close),c4=rows4.map(x=>x.close),c1d=rows1d.map(x=>x.close),p=c15.at(-1);
 const R15=rsi(c15),R1H=rsi(c1h),R4=rsi(c4),R1D=rsi(c1d),M15=macd(c15),M1H=macd(c1h),M4=macd(c4),M1D=macd(c1d),A=atr(rows4);
 const e20=ema(c1d,20),e50=ema(c1d,50),e100=ema(c1d,100),e200=ema(c1d,200);
 const w=rows4.slice(-90),lo=Math.min(...w.map(x=>x.low)),hi=Math.max(...w.map(x=>x.high)),loIdx=w.reduce((m,x,i)=>x.low<w[m].low?i:m,0),hiIdx=w.reduce((m,x,i)=>x.high>w[m].high?i:m,0),swingDirection=loIdx<=hiIdx?'BULL':'BEAR',span=hi-lo,fibs=[.382,.5,.618,.786].map(f=>({f,price:hi-span*f})),near=fibs.reduce((a,b)=>Math.abs(b.price-p)<Math.abs(a.price-p)?b:a);
 const dailyBull=p>e200&&e20>e50;
 const score=(dailyBull?25:0)+(R15>=40&&R15<=68?10:0)+(R1H>=42&&R1H<=68?15:0)+(R4>=42&&R4<=68?15:0)+(M15&&M15.hist>0?5:0)+(M1H&&M1H.hist>0?10:0)+(M4&&M4.hist>0?10:0)+(Math.abs(p-near.price)<=Math.max(A*.75,p*.012)?10:0);
 const status=score>=70&&dailyBull&&M1H?.hist>0?'RE-ENTRY READY':score>=55?'SETUP FORMING':'WAIT FOR RETRACE';
 return{price:p,rsi15:R15,rsi1h:R1H,rsi4:R4,rsi1d:R1D,rsi1:R1D,macd15:M15,macd1h:M1H,macd4:M4,macd1d:M1D,macd1:M1D,atr:A,ema20:e20,ema50:e50,ema100:e100,ema200:e200,lo,hi,swingDirection,near,score,status,source:rows15.source||'MARKET FEED'}
}
function signalAction(score){return score>=6?'RISK REVIEW':score>=4?'PROFIT LOCK CANDIDATE':score>=2?'WATCH PROFIT':'HOLD'}
function signalRank(action){return action==='RISK REVIEW'?3:action==='PROFIT LOCK CANDIDATE'?2:action==='WATCH PROFIT'?1:0}
function signalTone(action){return action==='RISK REVIEW'?'danger':action==='PROFIT LOCK CANDIDATE'||action==='WATCH PROFIT'?'watch':'safe'}
function actionForSide(pi,side){return side==='SHORT'?(pi?.shortAction||'SYNC'):(pi?.longAction||'SYNC')}
function reasonsForSide(pi,side){return side==='SHORT'?(pi?.shortReasons||[]):(pi?.longReasons||[])}
function profitLockIntel(rows15,rows1h,rows4){
 const c15=rows15.map(x=>x.close),c1h=rows1h.map(x=>x.close),c4=rows4.map(x=>x.close),p=c15.at(-1);
 const R15=rsi(c15),R1H=rsi(c1h),R4=rsi(c4),M15=macd(c15),M1H=macd(c1h),M4=macd(c4),e20=ema(c1h,20),e50=ema(c1h,50),w=rows4.slice(-90),swingLo=Math.min(...w.map(x=>x.low)),swingHi=Math.max(...w.map(x=>x.high)),loIdx=w.reduce((m,x,i)=>x.low<w[m].low?i:m,0),hiIdx=w.reduce((m,x,i)=>x.high>w[m].high?i:m,0),swingDirection=loIdx<=hiIdx?'BULL':'BEAR';
 let bear=0,bull=0,longReasons=[],shortReasons=[];
 if(R15>=72){bear++;longReasons.push('RSI15m heiß')}if(R1H>=70){bear++;longReasons.push('RSI1h heiß')}if(R4>=68){bear++;longReasons.push('RSI4h heiß')}
 if(M15&&M15.hist<0){bear++;longReasons.push('MACD15m ↓')}if(M1H&&M1H.hist<0){bear+=2;longReasons.push('MACD1h ↓')}if(M4&&M4.hist<0){bear+=2;longReasons.push('MACD4h ↓')}
 if(e20&&p<e20){bear+=2;longReasons.push('unter EMA20 1h')}if(e20&&e50&&e20<e50){bear++;longReasons.push('EMA20<50 1h')}
 if(R15<=28){bull++;shortReasons.push('RSI15m tief')}if(R1H<=30){bull++;shortReasons.push('RSI1h tief')}if(R4<=32){bull++;shortReasons.push('RSI4h tief')}
 if(M15&&M15.hist>0){bull++;shortReasons.push('MACD15m ↑')}if(M1H&&M1H.hist>0){bull+=2;shortReasons.push('MACD1h ↑')}if(M4&&M4.hist>0){bull+=2;shortReasons.push('MACD4h ↑')}
 if(e20&&p>e20){bull+=2;shortReasons.push('über EMA20 1h')}if(e20&&e50&&e20>e50){bull++;shortReasons.push('EMA20>50 1h')}
 const longAction=signalAction(bear),shortAction=signalAction(bull),bias=bull-bear>=3?'BULLISH':bear-bull>=3?'BEARISH':'MIXED';
 return{action:longAction,longAction,shortAction,bearish:bear,bullish:bull,bias,longReasons,shortReasons,reasons:longReasons,rsi15:R15,rsi1h:R1H,rsi4:R4,macd15:M15,macd1h:M1H,macd4:M4,ema20:e20,ema50:e50,price:p,swingLo,swingHi,swingDirection,source:rows15.source||'MARKET FEED'}
}
let syncIntelBusy=false;
async function syncIntel(){
 if(syncIntelBusy)return false;syncIntelBusy=true;
 const cross=syncCrossPrices(),out={...state.assetIntel},errors=[];let btcRows=null;
 try{
 try{
  const [m15,h1,h4,d1]=await Promise.all([marketKlines('15m',180),marketKlines('1h',200),marketKlines('4h',240),marketKlines('1d',240)]),h1c=closedMarketRows(h1),h4c=closedMarketRows(h4),d1c=closedMarketRows(d1);
  if(h1c.length<60||h4c.length<100||d1c.length<210)throw new Error('insufficient closed confirmation bars');
  const now=marketRowsTimestamp(m15,h1,h4,d1),transport=marketTransportLabel(m15,h1,h4,d1);state.intel={...intel(m15,h1c,h4c,d1c),updatedAt:now,confirmationBars:'CLOSED_1H_4H_1D',transport};out.BTC={...profitLockIntel(m15,h1c,h4c),updatedAt:marketRowsTimestamp(m15,h1,h4),confirmationBars:'CLOSED_1H_4H',transport};btcRows=true;state.marketTransport=transport
 }catch(e){state.intel=null;errors.push('BTC '+String(e?.message||e))}
 const universe=trackedMarketSymbols(),assets=universe.filter(symbol=>symbol!=='BTC');
 for(let i=0;i<assets.length;i+=4){
  const batch=assets.slice(i,i+4);
  await Promise.all(batch.map(async symbol=>{try{
   const [m15,h1,h4]=await Promise.all([marketKlines('15m',160,symbol),marketKlines('1h',180,symbol),marketKlines('4h',160,symbol)]),h1c=closedMarketRows(h1),h4c=closedMarketRows(h4);
   if(h1c.length<60||h4c.length<100)throw new Error('insufficient closed confirmation bars');
   out[symbol]={...profitLockIntel(m15,h1c,h4c),updatedAt:marketRowsTimestamp(m15,h1,h4),confirmationBars:'CLOSED_1H_4H',transport:marketTransportLabel(m15,h1,h4)}
  }catch(e){errors.push(symbol+' '+String(e?.message||e))}}));
  if(i+4<assets.length)await new Promise(r=>setTimeout(r,220))
 }
 const allowed=new Set(universe);state.assetIntel=Object.fromEntries(Object.entries(out).filter(([symbol])=>allowed.has(symbol)));if(btcRows)state.marketSyncedAt=num(state.intel?.updatedAt)||Date.now();state.marketError=errors.length?errors.slice(0,6).join(' · '):null;await cross;renderHeaderTruth();return true
 }finally{syncIntelBusy=false}
}

function risk(b){const p=botMarketPrice(b),liq=num(b.liq),api=num(b.buffer);if(api!=null&&api>0&&api<100)return api;if(!(p>0&&liq>0))return null;return b.side==='SHORT'?(liq-p)/p*100:(p-liq)/p*100}
function assetPairRisk(symbol){
 const rows=botFeedFresh()?state.bots.filter(b=>b.symbol===symbol&&liveMatched(b)):[],longs=rows.filter(b=>(b.side||'LONG')==='LONG'),shorts=rows.filter(b=>b.side==='SHORT'),integrity=exposureIntegrity(symbol);
 const notional=b=>liveInvestUsdAvailable(b)?(num(b.investUsd)||0)*(num(b.leverage)||1):null;
 const longKnown=longs.map(notional).filter(x=>x!=null),shortKnown=shorts.map(notional).filter(x=>x!=null),longUsd=longKnown.reduce((s,x)=>s+x,0),shortUsd=shortKnown.reduce((s,x)=>s+x,0),unknownExposure=integrity.unknown,hedgePct=longUsd>0&&integrity.complete?shortUsd/longUsd*100:null;
 const buffers=rows.map(risk).filter(x=>x!=null),minBuffer=buffers.length?Math.min(...buffers):null,pi=state.assetIntel[symbol];
 let score=0,reasons=[];
 if(minBuffer!=null&&minBuffer<10){score+=5;reasons.push('Liq <10%')}else if(minBuffer!=null&&minBuffer<18){score+=4;reasons.push('Liq <18%')}else if(minBuffer!=null&&minBuffer<28){score+=2;reasons.push('Liq <28%')}
 const dominantSide=shortUsd>longUsd?'SHORT':'LONG',profitAction=actionForSide(pi,dominantSide);
 if(profitAction==='RISK REVIEW'){score+=3;reasons.push('Struktur/Momentum')}else if(profitAction==='PROFIT LOCK CANDIDATE'){score+=2;reasons.push('Profit-Lock')}else if(profitAction==='WATCH PROFIT'){score+=1;reasons.push('Profit-Watch')}
 const btc=state.intel;if(symbol!=='BTC'&&btc&&btc.price<btc.ema20){score+=1;reasons.push('BTC < EMA20')}
 const label=score>=7?'LIQ RISK':score>=4?'RISK REVIEW':score>=2?'WATCH':'SAFE',tone=score>=7?'danger':score>=4?'danger':score>=2?'watch':'safe';
 return{symbol,rows,longUsd,shortUsd,netUsd:longUsd-shortUsd,hedgePct,minBuffer,unknownExposure,exposureComplete:integrity.complete,score,label,tone,reasons,profitAction,dominantSide,bias:pi?.bias||'SYNC'};
}
function riskCockpitV2(){
 const order=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];
 const pairs=order.map(assetPairRisk).filter(x=>x.rows.length).sort((a,b)=>b.score-a.score||(a.minBuffer??999)-(b.minBuffer??999));
 return '<section class="risk-v2"><div class="section-title"><h2>RISK COCKPIT V2</h2><small>Asset-Paare · Liq + Hedge + 15m/1h/4h + BTC-Regime</small></div><div class="risk-v2-grid">'+pairs.map(x=>'<article class="risk-v2-row"><div><strong>'+x.symbol+'</strong><span class="tag tone-'+x.tone+'">'+x.label+'</span></div><div><span>KNOWN NET</span><b>'+(x.unknownExposure?money(x.netUsd)+'*':money(x.netUsd))+'</b></div><div><span>HEDGE</span><b>'+(x.hedgePct==null?'—':x.hedgePct.toFixed(1)+'%')+'</b></div><div><span>MIN LIQ</span><b>'+(x.minBuffer==null?'—':x.minBuffer.toFixed(1)+'%')+'</b></div><div><span>MOMENTUM '+x.dominantSide+'</span><b class="tone-'+signalTone(x.profitAction)+'">'+x.profitAction+'</b></div><small>'+(x.reasons.join(' · ')||'kein neues Warnsignal')+(x.unknownExposure?' · Exposure partial':'')+'</small></article>').join('')+'</div></section>';
}
function tpDist(b){const p=botMarketPrice(b),tp=num(b.tp);if(!(p>0&&tp>0))return null;return b.side==='SHORT'?(p-tp)/p*100:(tp-p)/p*100}
function status(b){if(!liveMatched(b))return['REF','muted'];if(!botFeedFresh())return['STALE','muted'];const r=risk(b),t=tpDist(b);if(t!=null&&t<=5)return['TP ZONE','tp'];if(r==null)return['LIQ CHECK','muted'];if(r<5)return['LIQ URGENT','danger'];if(r<10)return['LIQ MARGIN','danger'];if(r<18)return['LIQ WATCH','watch'];return['LIQ SAFE','safe']}
function botProfitPct(b){const direct=num(b.profitPct);if(direct!=null)return direct;const pnl=botPnlUsd(b).value,investUsd=num(b.investUsd);return pnl!=null&&investUsd>0?pnl/investUsd*100:null}
function profitPlanRank(code){return code==='SAFETY'?7:code==='LOCK50'?6:code==='LOCK25'?5:code==='LOCK20'?4:code==='HEDGE'?3:code==='WATCH'?2:code==='HOLD'?1:0}
function profitLockPlan(b){
 const side=b.side||'LONG',rawPi=state.assetIntel[b.symbol],pi=marketIntelFresh(rawPi)?rawPi:null,signal=pi?actionForSide(pi,side):'SYNC',reasons=pi?reasonsForSide(pi,side):[],pnl=botProfitPct(b),t=tpDist(b),liq=risk(b),pair=assetPairRisk(b.symbol),hedgeLow=side==='LONG'&&pair.longUsd>0&&pair.hedgePct!=null&&pair.hedgePct<15;
 const why=reasons.slice(0,3).join(' · '),tpText=t==null?'TP-Distanz —':Math.max(0,t).toFixed(1)+'% zum TP',pnlText=pnl==null?'PnL —':(pnl>=0?'+':'')+pnl.toFixed(1)+'% PnL';
 if(!liveMatched(b))return{code:'SYNC',label:'REFERENCE · VERIFY',tone:'muted',reducePct:0,signal,pnl:null,tp:t,detail:'Bot nicht im privaten Bot-Snapshot bestätigt · Referenzwerte sind nicht handlungsrelevant'};
 if(!botFeedFresh())return{code:'SYNC',label:'SNAPSHOT · STALE',tone:'muted',reducePct:0,signal,pnl:null,tp:t,detail:'Bot-Snapshot '+botFeedAgeLabel()+' · keine Trading-Aktion ableiten'};
 if(liq!=null&&liq<10)return{code:'SAFETY',label:'SAFETY FIRST',tone:'danger',reducePct:0,signal,pnl,tp:t,detail:'Liq-Puffer '+liq.toFixed(1)+'% · zuerst Margin/Exposure prüfen · keine Profit-Lock-Aktion'};
 if(!pi)return{code:'SYNC',label:'MARKET · STALE',tone:'muted',reducePct:0,signal:'SYNC',pnl,tp:t,detail:'Technische 15m/1h/4h-Daten sind nicht frisch · kein Profit-Lock/Exit-Signal ableiten'};
 if(!livePnlAvailable(b))return{code:'SYNC',label:'SYNC · PNL',tone:'muted',reducePct:0,signal,pnl:null,tp:t,detail:'Snapshot-PnL fehlt · '+tpText+' · keine Aktion ableiten'};
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
function botInvestLabel(b){if(liveInvestUsdAvailable(b))return{label:'CAPITAL USD',value:money(b.investUsd)};if(num(b.invest)!=null)return{label:'INVEST RAW',value:String(num(b.invest))};return{label:'INVEST',value:'—'}}
function botCard(b){const [st,tone]=status(b),r=risk(b),t=tpDist(b),pct=botProfitPct(b),pl=profitLockPlan(b),px=botMarketPrice(b),pu=botPnlUsd(b),iv=botInvestLabel(b),truth=liveMatched(b)?(botFeedFresh()?(livePnlAvailable(b)?'FRESH SNAPSHOT':'FRESH SNAPSHOT · PNL SYNC'):'PRIVATE SNAPSHOT · STALE'):'REFERENCE';return `<article class="bot bot-v2"><div class="bothead"><div><h3>${b.symbol}</h3><small>${b.side||'LONG'} · ${b.leverage||'—'}x</small></div><span class="tag tone-${tone}">${st}</span></div><div class="truth-badge ${liveMatched(b)?'truth-live':'truth-ref'}">${truth}</div><div class="profit-lock-v2 pl-${pl.tone}"><div class="pl-top"><span>PROFIT LOCK V2</span><b class="tone-${pl.tone}">${pl.label}</b></div><small>${pl.detail}</small></div><div class="profit-row"><div><span>${iv.label}</span><b>${iv.value}</b></div><div><span>GESAMTPROFIT USD</span><b class="${pu.value>0?'profit-pos':pu.value<0?'profit-neg':''}">${pu.value==null?'—':money(pu.value)}${pct==null?'':' · '+(pct>=0?'+':'')+pct.toFixed(1)+'%'}</b>${pu.corrected?'<small class="data-guard">VALIDATED FROM % × USD INVEST</small>':''}</div></div><div class="bot-details"><span>PRICE <b>${money(px)}</b><small class="data-guard">${botPriceSource(b)}</small></span><span>BE <b>${money(b.be)}</b></span><span>LIQ <b>${money(b.liq)}</b></span><span>TP <b>${money(b.tp)}</b></span></div><div class="range-line">RANGE <b>${money(b.lower)} – ${money(b.upper)}</b></div><div class="risk"><i style="width:${Math.max(2,Math.min(100,r||0)*3)}%"></i></div><small class="distance">${r==null?'Liq —':r.toFixed(1)+'% Liq'} · ${t==null?'TP —':Math.max(0,t).toFixed(1)+'% TP'}</small></article>`}
function critical(){return botFeedFresh()?([...state.bots].filter(liveMatched).sort((a,b)=>(risk(a)??999)-(risk(b)??999))[0]||null):null}
function beDistance(b){const p=botMarketPrice(b),be=num(b.be);if(!(p>0&&be>0))return null;return b.side==='SHORT'?(be-p)/be*100:(p-be)/be*100}
function assetExposureShare(symbol){const e=exposureModel(),rows=botFeedFresh()?state.bots.filter(b=>b.symbol===symbol&&liveMatched(b)):[],complete=rows.length>0&&rows.every(liveInvestUsdAvailable);if(!complete||!(e.grossUsd>0))return null;const x=rows.reduce((sum,b)=>sum+(num(b.investUsd)||0)*(num(b.leverage)||1),0);return x/e.grossUsd*100}
function riskV2(b){const liq=risk(b),be=beDistance(b),share=assetExposureShare(b.symbol),rawMom=state.assetIntel[b.symbol],mom=marketIntelFresh(rawMom)?rawMom:null;let score=0,reasons=[];if(liq!=null&&liq<18){score+=3;reasons.push('LIQ')}else if(liq!=null&&liq<28){score+=2;reasons.push('Liq')}else if(liq!=null&&liq<38){score+=1;reasons.push('liq')}if((b.leverage||0)>=7){score+=2;reasons.push('Hebel')}else if((b.leverage||0)>=5){score+=1;reasons.push('hebel')}if(share!=null&&share>=25){score+=3;reasons.push('Konzentration')}else if(share!=null&&share>=15){score+=2;reasons.push('Exposure')}else if(share!=null&&share>=10){score+=1;reasons.push('exposure')}if(be!=null&&be<-8){score+=2;reasons.push('unter BE')}else if(be!=null&&be<0){score+=1;reasons.push('BE')}const momAction=actionForSide(mom,b.side||'LONG');if(momAction==='RISK REVIEW'){score+=3;reasons.push('Momentum')}else if(momAction==='PROFIT LOCK CANDIDATE'){score+=2;reasons.push('Momentum')}else if(momAction==='WATCH PROFIT'){score+=1;reasons.push('Momentum')}const label=score>=8?'RISK REVIEW':score>=5?'WATCH':score>=3?'ATTENTION':'HOLD',tone=score>=8?'danger':score>=5?'watch':score>=3?'watch':'safe';return{score,label,tone,reasons,liq,be,share}}

function signalSummary(){const out={hold:0,watch:0,lock:0,risk:0,sync:0};for(const b of state.bots){const p=profitLockPlan(b);if(p.code==='SYNC')out.sync++;else if(['LOCK20','LOCK25','LOCK50'].includes(p.code))out.lock++;else if(p.code==='WATCH')out.watch++;else if(['SAFETY','HEDGE'].includes(p.code))out.risk++;else out.hold++}return out}
function topSignalBot(){return botFeedFresh()?(state.bots.filter(liveMatched).map(b=>({b,action:actionForSide(state.assetIntel[b.symbol],b.side||'LONG')})).filter(x=>x.action!=='SYNC'&&x.action!=='HOLD').sort((a,b)=>signalRank(b.action)-signalRank(a.action)||((num(b.b.profitPct)||0)-(num(a.b.profitPct)||0)))[0]||null):null}
function exposureModel(){const botNotional=b=>liveInvestUsdAvailable(b)?(num(b.investUsd)||0)*(num(b.leverage)||1):null,integrity=exposureIntegrity(),confirmed=botFeedFresh()?state.bots.filter(liveMatched):[],rows=confirmed.map(b=>({...b,notional:botNotional(b)})).filter(b=>b.notional!=null),unknownBots=integrity.unknown,longUsd=rows.filter(b=>(b.side||'LONG')==='LONG').reduce((x,b)=>x+b.notional,0),shortUsd=rows.filter(b=>b.side==='SHORT').reduce((x,b)=>x+b.notional,0),grossUsd=longUsd+shortUsd,netUsd=longUsd-shortUsd,coverage=longUsd>0&&integrity.complete?shortUsd/longUsd*100:null;return{longUsd,shortUsd,hedgeUsd:shortUsd,grossUsd,netUsd,coverage,unknownBots,confirmedBots:confirmed.length,complete:integrity.complete}}
function portfolioRegime(){const e=exposureModel(),i=state.marketSyncedAt&&Date.now()-state.marketSyncedAt<=3*60*1000?state.intel:null,confirmed=botFeedFresh()?state.bots.filter(liveMatched):[];let points=0,reasons=[];if(i){if(i.price>i.ema20&&i.ema20>i.ema50){points+=2;reasons.push('BTC > EMA20/50')}else if(i.price<i.ema20){points-=2;reasons.push('BTC < EMA20')}if(i.macd4?.hist>0){points++;reasons.push('4h MACD +')}else if(i.macd4?.hist<0){points--;reasons.push('4h MACD -')}if(i.rsi4>=70){points--;reasons.push('4h RSI heiß')}else if(i.rsi4>=50){points++;reasons.push('4h RSI >50')}}const avgRisk=confirmed.length?confirmed.reduce((s,b)=>s+riskV2(b).score,0)/confirmed.length:0;if(avgRisk>=6){points-=2;reasons.push('Bot-Risiko hoch')}else if(avgRisk>=4){points--;reasons.push('Bot-Risiko erhöht')}const regime=points>=2?'RISK-ON':points<=-2?'DEFENSIVE':'NEUTRAL';const hedge=e.coverage==null?'UNVOLLSTÄNDIG':e.coverage>=15?'AUSREICHEND':e.coverage>=7?'MITTEL':'KLEIN';const tone=regime==='RISK-ON'?'safe':regime==='DEFENSIVE'?'danger':'watch';return{regime,hedge,tone,points,avgRisk,reasons,exposureComplete:e.complete,basis:e.complete?'COMPLETE':'PARTIAL_EXPOSURE'}}
function regimeStrip(){const r=portfolioRegime();return `<section class="regime-strip"><div><span>PORTFOLIO REGIME${r.exposureComplete?'':' · PARTIAL BASIS'}</span><b class="tone-${r.tone}">${r.regime}</b></div><div><span>HEDGE</span><b>${r.hedge}</b></div><div><span>AVG RISK</span><b>${r.avgRisk.toFixed(1)}</b></div><small>${r.reasons.slice(0,4).join(' · ')||'Market sync'}${r.exposureComplete?'':' · Exposure-Basis unvollständig'}</small></section>`}
function exposureStrip(){const e=exposureModel(),tone=e.coverage==null?'muted':e.coverage>=15?'safe':e.coverage>=7?'watch':'danger';return `<section class="exposure-strip"><div><span>KNOWN LIVE BOT LONG</span><b>${money(e.longUsd)}</b></div><div><span>KNOWN LIVE BOT SHORT</span><b>${money(e.hedgeUsd)}</b></div><div><span>KNOWN NET</span><b>${money(e.netUsd)}</b></div><div><span>SHORT / LONG</span><b class="tone-${tone}">${e.coverage==null?'—':e.coverage.toFixed(1)+'%'}</b></div><small class="exposure-note">${e.unknownBots?e.unknownBots+' Live-Exposure-Row(s) unbekannt/nicht sicher zugeordnet · Exposure unvollständig':'nur live bestätigte Kapitalwerte'}</small></section>`}
function manualRisk(x){const p=num(x.price),l=num(x.liq);return p>0&&l>0?(p-l)/p*100:null}
function manualStrip(){const ps=state.pionexManual||[];if(!ps.length)return'';return `<section class="manual-strip"><div class="okx-title"><span>PIONEX MANUAL · SNAPSHOT</span><b>${ps.length} POSITION</b></div>${ps.map(x=>{const bf=manualRisk(x);return `<div class="manual-row"><strong>${x.symbol} ${x.side} · ${x.leverage}x ${x.marginMode}</strong><span>Mark ${money(x.price)}</span><span>BE ${money(x.be)}</span><span>Liq ${money(x.liq)}</span><b class="${bf<10?'tone-danger':bf<18?'tone-watch':'tone-safe'}">${bf.toFixed(1)}% Puffer</b></div>`}).join('')}</section>`}
function okxAmount(x,d=4){x=num(x);return x==null?'—':x.toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:d})}
function okxDcaPrice(x){const c=state.priceChecks&&state.priceChecks[x.symbol];return c&&c.verified&&num(c.okx)>0?num(c.okx):num(x.price)}
function okxDcaTpDist(x){const p=okxDcaPrice(x),tp=num(x.tp);return p>0&&tp>0?(tp-p)/p*100:null}
function okxStrip(){const ps=state.okxDcaBots||[];if(!ps.length)return'';return `<section class="okx-strip okx-dca-strip"><div class="okx-title"><span>OKX FUTURES DCA · SCREENSHOT</span><b>${ps.length} BOTS · 3x LONG</b></div>${ps.map(x=>{const px=okxDcaPrice(x),td=okxDcaTpDist(x),pnl=num(x.totalPnlPct),tone=pnl==null?'muted':pnl>=0?'safe':'danger',src=state.priceChecks?.[x.symbol]?.verified?'OKX + BINANCE PRICE':'SCREENSHOT PRICE';return `<div class="okx-dca-row"><div class="okx-dca-head"><strong>${x.symbol} · FUTURES DCA · ${x.leverage}x</strong><b class="tone-${tone}">${pnl==null?'—':(pnl>=0?'+':'')+pnl.toFixed(2)+'%'}</b></div><div class="okx-dca-metrics"><span>INVEST <b>${okxAmount(x.investUsd,2)} ${x.quote||'USDC'}</b></span><span>PRICE <b>${money(px)}</b><small>${src}</small></span><span>AVG <b>${money(x.avgCost)}</b></span><span>TP <b>${money(x.tp)}</b><small>${td==null?'—':td.toFixed(1)+'% entfernt'}</small></span><span>PNL <b>${x.totalPnlUsd==null?'—':okxAmount(x.totalPnlUsd,4)+' '+(x.quote||'USDC')}</b></span><span>SAFETY <b>${x.safetyExecuted||0}/${x.safetyMax||0}</b></span></div><small class="okx-dca-note">Gesch. Liq: — · Snapshot 25.09.2026 06:22 · vorherige OKX Position geschlossen</small></div>`}).join('')}</section>`}
function dataTruthCard(){
 const coverage=botFeedCoverage(),matched=coverage.matched,pnl=state.bots.filter(livePnlAvailable).length,verified=Object.values(state.priceChecks||{}).filter(x=>x&&x.verified).length,portfolioSource=state.portfolio?.source||'INCOMPLETE',pSource=portfolioSource==='CANONICAL_MIXED'?'CANONICAL MIXED':portfolioSource==='CANONICAL_PARTIAL'?'CANONICAL PARTIAL':portfolioSource==='PRIVATE_CANONICAL_SNAPSHOT'?'PRIVATE SNAPSHOT':'INCOMPLETE',fresh=coverage.fresh,age=botFeedAgeLabel(),mode=coverage.coverageComplete?'FRESH':matched?'MIXED':'REFERENCE',unmatchedRows=state.unmatchedLive||[],sync=state.pionexBotSync||{},syncStatus=String(sync.status||'UNKNOWN'),feedStatus=String(state.botFeedStatus||syncStatus),walletFeed=feedStatus==='WALLET_DETAIL_OK',apiLabel=syncStatus==='OK'?'OK':syncStatus==='ERROR'?'ERROR':syncStatus==='EMPTY_GUARD'?'GUARD':syncStatus==='DISABLED_MISSING_CREDENTIALS'?'OFF':'WAIT',apiTone=apiLabel==='OK'?'safe':apiLabel==='ERROR'?'danger':'watch',detailLabel=(syncStatus==='OK'||walletFeed)?(state.botDetailRows+'/'+state.botSupportedRows):'—',detailTone=(syncStatus==='OK'||walletFeed)&&state.botDetailsComplete?'safe':syncStatus==='ERROR'?'danger':'watch',accountSync=state.pionexAccountSync||{},accountStatus=String(accountSync.status||'UNKNOWN'),accountLabel=accountStatus==='OK'?'OK':accountStatus==='ERROR'?'ERROR':accountStatus==='DISABLED_MISSING_CREDENTIALS'?'OFF':'WAIT',accountTone=accountLabel==='OK'?'safe':accountLabel==='ERROR'?'danger':'watch',futPos=Array.isArray(state.pionexAccount?.futuresPositions)?state.pionexAccount.futuresPositions.length:0;
 const guardApiRows=num(sync?.diagnostics?.listRows),apiRowsDisplay=walletFeed?state.botApiRows:(syncStatus==='EMPTY_GUARD'&&guardApiRows!=null?guardApiRows:state.botApiRows);
 let diag='';
 if(walletFeed)diag='Live-Bot-Fallback aus Wallet + Futures-Grid-Detail · '+state.botDetailRows+'/'+state.botSupportedRows+' unterstützte Detailreads validiert · klassische Bot-Liste bleibt separat im Guard.';
 else if(syncStatus==='DISABLED_MISSING_CREDENTIALS')diag='Pionex Bot API nicht konfiguriert · alter Snapshot bleibt bewusst nicht handlungsrelevant.';
 else if(syncStatus==='ERROR')diag='Pionex Bot API Sync-Fehler · '+String(sync.error||'unbekannt').slice(0,120);
 else if(syncStatus==='EMPTY_GUARD'){const d=sync.diagnostics||{},types=Object.entries(d.typeCounts||{}).map(([k,v])=>k+' '+v).join(', ')||'—',states=Object.entries(d.statusCounts||{}).map(([k,v])=>k+' '+v).join(', ')||'—';diag='Pionex Bot-Liste: '+String(d.listRows??'—')+' laufende Row(s) · Typen '+types+' · Status '+states+' · lokale Futures-Allowlist blieb leer · alter Snapshot wurde aus Sicherheitsgründen nicht überschrieben.';}
 else if(coverage.coverageComplete&&matched<state.bots.length)diag='Bot-Feed liefert aktuell '+coverage.supported+' unterstützte Rows · alle sicher gematcht · Referenzkatalog '+state.bots.length+' Rows.';
 else if(coverage.unmatched>0)diag=coverage.unmatched+' Bot-Rows nicht gematcht'+(unmatchedRows.length?' · '+unmatchedRows.slice(0,4).map(x=>x.symbol+' '+x.side+' '+(x.leverage||'—')+'x').join(' / '):'');
 else diag='Keine zusätzlichen Bot-Rows im privaten Feed.';
 return `<section class="data-truth"><div class="data-truth-head"><span>DATA TRUTH · r20</span><b class="${coverage.coverageComplete?'tone-safe':'tone-watch'}">${mode}</b></div><div class="truth-grid"><div><span>PIONEX API</span><b>${apiRowsDisplay}</b></div><div><span>BOT ROWS</span><b>${coverage.supported}</b></div><div><span>BOT DETAIL</span><b class="tone-${detailTone}">${detailLabel}</b></div><div><span>BOT MATCH</span><b>${matched}/${coverage.supported}</b></div><div><span>SNAPSHOT PNL</span><b>${pnl}</b></div><div><span>BOT SNAPSHOT AGE</span><b>${age}</b></div><div><span>ACTIONABLE</span><b>${state.bots.filter(decisionReadyBot).length}</b></div><div><span>2-SOURCE PRICE</span><b>${verified}</b></div><div><span>UNMATCHED</span><b>${coverage.unmatched}</b></div><div><span>BOT API</span><b class="tone-${apiTone}">${apiLabel}</b></div><div><span>ACCOUNT API</span><b class="tone-${accountTone}">${accountLabel}</b></div><div><span>FUT POS</span><b>${accountStatus==='OK'?futPos:'—'}</b></div><div><span>BOT SOURCE</span><b>${String(state.botFeedSource||'—').replaceAll('_',' ')}</b></div><div><span>PORTFOLIO</span><b>${pSource}</b></div></div><small>${diag}<br>ACTIONABLE = DECISION READY · benötigt Bot-Match + Liq + Snapshot-PnL + frische Asset-Marktdaten + vertrauenswürdigen Bot-Timestamp ≤15 Min.</small></section>`
}
function renderHeaderTruth(){const el=$('#data-status');if(!el)return;const coverage=botFeedCoverage(),verified=Object.values(state.priceChecks||{}).filter(x=>x&&x.verified).length;el.textContent=coverage.coverageComplete?'● FRESH':coverage.matched||verified?'● MIXED':'● REFERENCE';el.className='live '+(coverage.coverageComplete?'fresh':coverage.matched||verified?'mixed':'reference')}
function portfolioPionexAgeText(p){
 if(p?.pionexTimestampFuture)return'FUTURE TIMESTAMP';
 return p?.pionexTimestampKnown?ageText(p.pionexAgeMs):'NO TIMESTAMP'
}
function portfolioPionexSourceText(p){
 const source=String(p?.pionexProvenance||'');
 if(source==='KNOWN_SEED')return'STATIC SEED';
 if(p?.pionexSource==='PRIVATE_PORTFOLIO_SNAPSHOT')return'PRIVATE SNAPSHOT';
 if(p?.pionexSource==='PIONEX_WALLET_READ_API')return'WALLET API';
 return'SCREENSHOT SNAPSHOT'
}
function command(){
 const c=critical(),okxFallback=okxDcaEquitySnapshot(),p=state.portfolio||{total:null,spot:null,pionex:null,okx:okxFallback.value,okxComplete:okxFallback.complete,okxRows:okxFallback.rows,okxMissingInvest:okxFallback.missingInvest,okxMissingPnl:okxFallback.missingPnl,source:'INCOMPLETE',pionexSource:'SCREENSHOT_TOTAL'},e=exposureModel(),rg=portfolioRegime(),sig=signalSummary(),sa=topSignalBot(),pp=topProfitPlan(),cr=c?risk(c):null,bd=c?beDistance(c):null,matched=state.bots.filter(liveMatched),freshMatched=botFeedFresh()?matched:[],tp=freshMatched.filter(b=>{const x=tpDist(b);return x!=null&&x<=10}),watch=freshMatched.filter(b=>{const x=risk(b);return x!=null&&x<30}).length,pionexAge=portfolioPionexAgeText(p),pionexSourceText=portfolioPionexSourceText(p),externalAge=p.externalSnapshotAgeMs!=null?ageText(p.externalSnapshotAgeMs):'NO CURRENT REF',ledgerAge=p.ledgerAutoAgeMs!=null?ageText(p.ledgerAutoAgeMs):'NO CONFIRM',okxAge=p.okxVenueUpdatedAt?ageText(Math.max(0,Date.now()-Date.parse(String(p.okxVenueUpdatedAt)))):'NO CURRENT REF',excludedText=(p.excludedStaleHoldings||0)+(p.supersededHoldings||0)+(p.ignoredPrivateHoldings||0);
 let action='HALTEN · KEIN MARGIN-EINGRIFF',actionReason=rg.reasons.slice(0,3).join(' · ');
 if(cr!=null&&cr<10){action=c.symbol+' · LIQ-PUFFER PRÜFEN';actionReason='Liquidationsschutz hat Vorrang vor Profit Lock'}
 else if(pp&&['LOCK50','LOCK25','LOCK20'].includes(pp.plan.code)){action=pp.b.symbol+' '+(pp.b.side||'LONG')+' · '+pp.plan.label;actionReason=pp.plan.detail}
 else if(cr!=null&&cr<18){action=c.symbol+' · ENG BEOBACHTEN';actionReason=(cr.toFixed(1)+'% Liq-Puffer · keine hektische Profit-Realisierung')}
 else if(pp&&['HEDGE','WATCH'].includes(pp.plan.code)){action=pp.b.symbol+' '+(pp.b.side||'LONG')+' · '+pp.plan.label;actionReason=pp.plan.detail}
 else if(sa&&sa.action!=='HOLD'){action=sa.b.symbol+' '+(sa.b.side||'LONG')+' · MOMENTUM WATCH';actionReason='Kein Profit-Lock ohne bestätigten Gewinn · '+reasonsForSide(state.assetIntel[sa.b.symbol],sa.b.side||'LONG').slice(0,3).join(' · ')}
 return `<section class="portfolio-hero command-hero"><div class="hero-top"><div><span>GESAMTPORTFOLIO</span><strong>${p.total!=null?money(p.total):'PORTFOLIO SYNC'}</strong><small>${p.total!=null?'CANONICAL TOTAL · LEDGER AUTO + OKX + PIONEX':'CURRENT AUTHORITY FEHLT · LEDGER BESTÄTIGEN / OKX AKTUALISIEREN'}</small></div><div class="regime-pill tone-${rg.tone}">${rg.regime}${rg.exposureComplete?'':' · PARTIAL BASIS'}</div></div><div class="source-grid"><div><span>LEDGER AUTO</span><b>${p.ledgerAutoUsd!=null?money(p.ledgerAutoUsd):'—'}</b><small>${p.ledgerAutoActive?(p.ledgerAutoPriceResolved+'/'+p.ledgerAutoPriceRequested+' ASSETS LIVE · '+ledgerAge):'BESTAND NICHT BESTÄTIGT · FALLBACK NUR REFERENZ'}</small></div><div><span>OKX</span><b>${p.okxVenueUsd!=null?money(p.okxVenueUsd):'—'}</b><small>${p.okxVenueUsd!=null?'LOCAL REF · '+okxAge:'CURRENT REF FEHLT'}</small></div><div><span>PIONEX</span><b>${p.pionex!=null?money(p.pionex):'—'}</b><small>${pionexSourceText+' · '+pionexAge}</small></div></div><div class="portfolio-reconcile"><div class="portfolio-reconcile-actions"><button id="ledger-authority-confirm" type="button">LEDGER ASSETS BESTÄTIGEN</button><button id="okx-ref-edit" type="button">OKX WERT AKTUALISIEREN</button></div><small>Ledger wird danach aus Mengen × Live-Preis berechnet · Bestätigung 24H · ${excludedText} nicht autorisierte Alt-Holdings ausgeschlossen</small></div><div class="portfolio-legacy-note">OKX DCA OLD REF ${p.okx!=null?money(p.okx):'—'} · nur historischer Bot-Snapshot · NICHT IM TOTAL</div></section>${dataTruthCard()}<section class="risk-cockpit"><div class="cockpit-head"><div><span>RISK COCKPIT</span><b class="tone-${c?status(c)[1]:'muted'}">${c?c.symbol+' '+(c.side||'LONG')+' '+(c.leverage||'—')+'x':'SYNC'}</b></div><div class="liq-big"><small>LIQ PUFFER</small><strong>${cr==null?'—':cr.toFixed(1)+'%'}</strong></div></div><div class="risk-kpis"><div><span>PRICE</span><b>${c?money(botMarketPrice(c)):'—'}</b></div><div><span>BE</span><b>${c&&num(c.be)>0?money(c.be):'—'}</b></div><div><span>LIQ</span><b>${c?money(c.liq):'—'}</b></div><div><span>BE DIST.</span><b>${bd==null?'—':(bd>=0?'+':'')+bd.toFixed(1)+'%'}</b></div></div><div class="buffer-track"><i style="width:${Math.max(2,Math.min(100,(cr||0)*3.33))}%"></i></div><div class="cockpit-foot"><span>${watch} fresh Bots &lt;30% Puffer</span><span>Short/Long ${e.coverage==null?'—':e.coverage.toFixed(1)+'%'}</span></div></section><section class="exposure-card"><div><span>KNOWN LIVE BOT LONG</span><b>${money(e.longUsd)}</b></div><div><span>KNOWN LIVE BOT SHORT</span><b>${money(e.hedgeUsd)}</b></div><div><span>KNOWN NET</span><b>${money(e.netUsd)}</b></div><div><span>SHORT / LONG</span><b class="tone-${e.coverage==null?'muted':e.coverage>=15?'safe':e.coverage>=7?'watch':'danger'}">${e.coverage==null?'—':e.coverage.toFixed(1)+'%'}</b></div></section>${manualStrip()}${okxStrip()}${riskCockpitV2()}${profitLockRadar()}<section class="action command-action"><span>NEXT ACTION</span><b>${action}</b><small>${actionReason||'Market sync'}</small></section><div class="quick-grid"><section><span>PRIVATE MATCH</span><b>${matched.length}</b><small>${state.liveRows} API rows · ${state.bots.length} tracked</small></section><section><span>TP RADAR</span><b>${tp.length}</b><small>≤10% zum TP</small></section><section><span>AVG RISK</span><b>${rg.avgRisk.toFixed(1)}</b><small>Portfolio Score</small></section><section><span>BTC SETUP</span><b class="wait">${state.intel?state.intel.score+'/100':'SYNC'}</b><small>${state.intel?.status||'loading'}</small></section><section><span>WATCH PROFIT</span><b class="tone-watch">${sig.watch}</b><small>15m/1h Frühwarnung</small></section><section><span>PROFIT LOCK</span><b class="tone-watch">${sig.lock}</b><small>Teilgewinn prüfen</small></section><section><span>RISK REVIEW</span><b class="tone-danger">${sig.risk}</b><small>Struktur dreht</small></section><section><span>HOLD</span><b class="tone-safe">${sig.hold}</b><small>${sig.sync?'+'+sig.sync+' SYNC':'kein Lock-Signal'}</small></section></div><div class="section-title"><h2>RISK PRIORITY</h2><small>engster Liq-Puffer zuerst</small></div><div class="bots command-bots">${freshMatched.length?[...freshMatched].sort((a,b)=>(risk(a)??999)-(risk(b)??999)).slice(0,4).map(botCard).join(''):'<section class="card">Keine frischen Bot-Snapshots für Risk Priority · keine Aktion ableiten.</section>'}</div>`}
function botGroup(title,subtitle,items){if(!items.length)return '';return `<section class="bot-group"><div class="group-head"><div><h2>${title}</h2><small>${subtitle}</small></div><b>${items.length}</b></div><div class="bots">${items.map(botCard).join('')}</div></section>`}
function manualPositionCard(){return (state.manualPositions||[]).map(b=>{const p=num(b.price),l=num(b.liq),buffer=p>0&&l>0?(p-l)/p*100:null;return `<section class="bot-group"><div class="group-head"><div><h2>${b.symbol} · MANUAL ${b.side}</h2><small>${b.venue} · separate offene Position, kein Grid-Bot</small></div><b>${b.leverage}x</b></div><article class="bot bot-v2"><div class="bot-details"><span>MARK <b>${money(b.price)}</b></span><span>ENTRY <b>${money(b.entry)}</b></span><span>LIQ <b>${money(b.liq)}</b></span><span>LIQ PUFFER <b>${buffer==null?'—':buffer.toFixed(1)+'%'}</b></span></div><div class="range-line">SIZE <b>${b.investCoin.toLocaleString('de-DE')} ${b.symbol}</b> · DYN. MARGIN <b>${b.dynamicMargin||0}</b></div></article></section>`}).join('')}
function hedgeCard(){const hs=state.hedges||[state.hedge];return hs.map(h=>{const tp=(h.tps||[{price:h.tp,pct:100}]).map(x=>money(x.price)+' · '+(x.pct!=null?x.pct+'%':x.coin+' BTC')).join(' / '),runner=h.runnerPct!=null?h.runnerPct+'%':h.runnerCoin!=null?h.runnerCoin+' BTC':'—';return `<section class="bot-group hedge-group"><div class="group-head"><div><h2>BTC HEDGE · ${h.venue||'Pionex'}</h2><small>separate Versicherung · nicht als Long-Bot gezählt</small></div><b>SHORT ${h.leverage}x</b></div><article class="bot bot-v2"><div class="bot-details"><span>ENTRY <b>${money(h.entry)}</b></span><span>SL <b>${money(h.sl)}</b></span><span>LIQ <b>${money(h.liq)}</b></span><span>SIZE <b>${h.investCoin} BTC</b></span></div><div class="range-line">TP <b>${tp}</b></div><div class="profit-lock"><span>RUNNER</span><b class="tone-safe">${runner}</b><small>${h.note||''}</small></div></article></section>`}).join('')}
function assetGroup(symbol,items){const matched=items.filter(liveMatched),fresh=botFeedFresh()?matched:[],capitalComplete=fresh.length>0&&fresh.every(liveInvestUsdAvailable),exposure=capitalComplete?fresh.reduce((sum,b)=>sum+(num(b.investUsd)||0),0):null,worst=fresh.length?Math.min(...fresh.map(b=>risk(b)??999)):999,rv=fresh.length?fresh.map(riskV2).sort((a,b)=>b.score-a.score)[0]:{label:matched.length?'STALE':'REFERENCE',share:null,score:0},shareText=rv.share==null?'Exposure —':rv.share.toFixed(1)+'% Exposure';return botGroup(symbol+' · '+items.length+' TRACKED · '+matched.length+' PRIVATE · '+rv.label,(exposure!=null?money(exposure)+' known USD capital · ':'')+(worst<999?worst.toFixed(1)+'% Liq · ':'')+(fresh.length?shareText+' · Risk '+rv.score:matched.length?'Snapshot nicht frisch genug für Action':'keine Action aus Referenzdaten'),items)}
function bots(){const order=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];const groups=order.map(s=>assetGroup(s,state.bots.filter(b=>b.symbol===s))).join('');return `<section class="hero bot-hero"><div class="eyebrow">BOT CONTROL CENTER · ${state.source}</div><h1>PIONEX COIN-M</h1><p class="muted">${state.bots.length} tracked rows · ${state.bots.filter(liveMatched).length} private matched · ${state.liveRows} API rows · ${new Set(state.bots.map(b=>b.symbol)).size} Assets · Snapshot ≠ Live-API</p></section>${regimeStrip()}${exposureStrip()}${hedgeCard()}${manualPositionCard()}${groups}`}
function market(){const i=state.intel;return `<section class="hero"><div class="eyebrow">MARKET + BODEN</div><h1>BTC REGIME</h1><p class="muted">1D Regime · 4h Struktur · 1h Setup · 15m Trigger · OKX USDT-SWAP</p></section><div class="grid"><section class="metric"><span>REGIME</span><b>${state.market||'SYNC'}</b><small>${i?money(i.price):'Market sync'}</small></section><section class="metric"><span>RSI 15m / 1h</span><b>${i?i.rsi15.toFixed(1)+' · '+i.rsi1h.toFixed(1):'SYNC'}</b><small>Trigger · Setup</small></section><section class="metric"><span>RSI 4h / 1D</span><b>${i?i.rsi4.toFixed(1)+' · '+i.rsi1d.toFixed(1):'SYNC'}</b><small>Struktur · Regime</small></section><section class="metric"><span>MACD 15m / 1h</span><b>${i&&i.macd15&&i.macd1h?i.macd15.hist.toFixed(2)+' · '+i.macd1h.hist.toFixed(2):'SYNC'}</b><small>Timing momentum</small></section><section class="metric"><span>MACD 4h</span><b>${i&&i.macd4?i.macd4.hist.toFixed(2):'SYNC'}</b><small>Structure momentum</small></section><section class="metric"><span>EMA 20 / 50</span><b>${i?money(i.ema20)+' / '+money(i.ema50):'SYNC'}</b><small>1D trend</small></section><section class="metric"><span>NEAREST FIB</span><b>${i?i.near.f.toFixed(3)+' · '+money(i.near.price):'SYNC'}</b><small>90 × 4h swing</small></section><section class="metric"><span>ATR 4H</span><b>${i?money(i.atr):'SYNC'}</b><small>Range width input</small></section><section class="metric"><span>NEXT RANGE SCORE</span><b class="${i&&i.status==='RE-ENTRY READY'?'tone-safe':'wait'}">${i?i.score+'/100':'SYNC'}</b><small>${i?i.status:'loading'}</small></section></div>`}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
async function binanceHistory(interval,limit,symbol){
 let rows=[],endTime=null;const marketSymbol=symbol+'USDT';
 while(rows.length<limit){
  const take=Math.min(1000,limit-rows.length),u='https://api.binance.com/api/v3/klines?symbol='+marketSymbol+'&interval='+interval+'&limit='+take+(endTime!=null?'&endTime='+endTime:'');
  const r=await fetchTimed(u,{cache:'no-store'},8000);if(!r.ok)throw new Error('Binance history '+r.status);
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
function bindResearch(target='research'){
 const root=$('#view-'+target)||document,sel=root.querySelector('#bt-asset'),btn=root.querySelector('#bt-run');if(!sel||!btn)return;
 sel.onchange=()=>{state.backtest.symbol=sel.value};
 btn.onclick=async()=>{state.backtest.symbol=sel.value;state.backtest.running=true;state.backtest.error=null;state.backtest.result=null;go(target);try{state.backtest.result=await runProfitBacktest(state.backtest.symbol)}catch(e){state.backtest.error=e?.message||String(e)}finally{state.backtest.running=false;go(target)}}
}
function more(){return `<section class="hero"><div class="eyebrow">MORE</div><h1>PORTFOLIO + SYSTEM</h1><p class="muted">Spot/Exchanges bleiben sekundär. Live-Quelle: ${state.source}.</p></section>`}
const render={command,bots,market,research,more};let current='command';
function go(v){current=v;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+v));document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.v===v));$('#view-'+v).innerHTML=render[v]();if(v==='research')bindResearch();if(v==='command')bindPortfolioRefEditor();if(window.MERIDIAN_V10)queueMicrotask(()=>window.dispatchEvent(new CustomEvent('meridian:view',{detail:{view:v}})))}
function notifyData(){
 renderHeaderTruth();
 if(window.MERIDIAN_V10)window.dispatchEvent(new CustomEvent('meridian:data'));
 else go(current)
}
function selectPionexRisk(d={}){
 const primary=d?.pionexRisk||null,wallet=d?.pionexAccount?.walletBotRisk||null,primaryStatus=String(d?.pionexBotSync?.status||'UNKNOWN'),accountStatus=String(d?.pionexAccountSync?.status||'UNKNOWN'),freshRisk=x=>{const ts=parseTs(x?.updatedAt||x?.snapshotAt);return ts!=null&&ts<=Date.now()+5*60*1000&&Date.now()-ts<=15*60*1000};
 const primaryOk=primaryStatus==='OK'&&freshRisk(primary)&&Array.isArray(primary?.bots)&&primary.bots.length>0&&primary?.detailsComplete===true;
 const walletOk=accountStatus==='OK'&&freshRisk(wallet)&&wallet?.detailsComplete===true&&Array.isArray(wallet?.bots)&&wallet.bots.length>0;
 if(primaryOk)return{risk:primary,status:'BOT_API_OK',kind:'BOT_API'};
 if(walletOk)return{risk:wallet,status:'WALLET_DETAIL_OK',kind:'WALLET_DETAIL'};
 return{risk:primary,status:primaryStatus,kind:'BOT_API'};
}
let syncBusy=false;
async function sync(){
 if(syncBusy)return false;syncBusy=true;
 try{
 const [payload,history,tickers]=await Promise.all([getJson('/api/private/dashboard'),getJson('/api/private/portfolio-history?range=1w').catch(e=>({source:'UNAVAILABLE',points:[],error:String(e?.message||e)})),portfolioSpotTickers().catch(e=>({error:String(e?.message||e)}))]),raw=payload?.data||payload,d=Array.isArray(tickers)?buildLivePriceOverlay(raw,tickers,Date.now()):clearStaleLivePrices(raw,Date.now(),tickers?.error||'MARKET_FEED_UNAVAILABLE'),selected=selectPionexRisk(d),feed=selected.risk,live=Array.isArray(feed?.bots)?feed.bots.map(normalizeLive):[],apiNative=apiNativeIdentityEligible(feed,selected,live);
 if(apiNative){
  state.bots=markApiNativeIdentity(live);
  state.unmatchedLive=[];state.matchAmbiguous=0;state.matchDiagnostics=matchStageDiagnostics(live,FALLBACK,[],0);
  state.botIdentityMode='API_NATIVE';state.apiNativeRows=live.length;
 }else{
  state.bots=live.length?mergeReference(live):FALLBACK.map(ref=>({...ref,_liveMatched:false,_livePrice:false,_livePnl:false,_liveInvest:false,_source:'REFERENCE'}));
  state.botIdentityMode=live.length?'REFERENCE_MATCH':'REFERENCE_ONLY';state.apiNativeRows=0;
  if(!live.length){state.unmatchedLive=[];state.matchAmbiguous=0;state.matchDiagnostics=null;}
 }
 state.liveRows=live.length;
 state.botApiRows=num(feed?.apiRows)??live.length;
 state.botSupportedRows=num(feed?.supportedRows)??live.length;
 state.botDetailRows=num(feed?.detailRows)??0;
 state.botDetailsComplete=feed?.detailsComplete===true;
 state.botFeedStatus=selected.status;
 state.pionexBotSync=d?.pionexBotSync||null;
 state.pionexAccountSync=d?.pionexAccountSync||null;
 state.pionexAccount=d?.pionexAccount||null;
 const specificTs=parseTs(feed?.updatedAt||feed?.snapshotAt);
 state.botFeedUpdatedAt=specificTs||parseTs(d?.privateUpdatedAt);
 state.botFeedTimestampTrusted=!!specificTs;
 state.botFeedSource=String(feed?.source|| (specificTs?'PRIVATE_PIONEX_SNAPSHOT':'PRIVATE_STATE_LEGACY_TIMESTAMP'));
 const coverage=botFeedCoverage();
 state.source=coverage.coverageComplete?'FRESH':coverage.matched?'MIXED':'REFERENCE';
 state.market=String(d?.market?.regime||d?.btcRegime?.label||d?.regime?.label||'SYNC').toUpperCase();
 state.portfolioHistory=history;state.portfolioHistoryError=history?.error||null;state.portfolio=portfolioModel(d,history);state.syncedAt=Date.now();state.error=null
 }catch(e){state.error=e.message;state.source='REFERENCE';state.botFeedTimestampTrusted=false;return false}
 finally{syncBusy=false;notifyData()}
 return true
}
window.MERIDIAN_V10_BRIDGE={
  getState:()=>state,
  refreshNow:()=>refreshNow(),
  goView:(v)=>{if(render[v]){go(v);return true}return false},
  refreshCurrentView:()=>{
    const v=current,host=$('#view-'+v),fn=render[v];
    if(!host||typeof fn!=='function')return false;
    host.innerHTML=fn();
    if(v==='research')bindResearch();
    if(v==='command')bindPortfolioRefEditor();
    return true;
  },
  helpers:{money,num,botFeedTimeState,botFeedFresh,botFeedCoverage,botFeedAgeMs,botFeedAgeLabel,ageText,liveMatched,livePnlAvailable,liveInvestAvailable,liveInvestUsdAvailable,safetyReadyBot,decisionReadyBot,exposureIntegrity,pnlIntegrity,risk,botMarketPrice,botPnlUsd,profitLockPlan,assetPairRisk,actionForSide,reasonsForSide,signalTone,marketKlines,marketKlinesHistory,manageAssetWatchShare},
  renderResearch:()=>research(),
  bindResearch:(target='research')=>bindResearch(target)
};
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.v));
async function refreshNow(){
 await sync();
 const changed=await syncIntel();
 if(changed)notifyData();
}
go('command');void refreshNow();
setInterval(sync,30000);setInterval(()=>syncIntel().then(changed=>{if(changed)notifyData()}),60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshNow()});
window.addEventListener('online',()=>{void refreshNow()});
