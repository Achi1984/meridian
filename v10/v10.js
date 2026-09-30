import {detectSwing,detectOpposingChildSwing,buildFibLevels,adjacentFibLevels,fibDistancePct,fibPlotPosition,skLongShortZones,skTargetZone,skDoubleAdvantage} from './fib-core.js?v=10.0-r97';
import {SK_PAPERBOT_V1_RULESET,SK_PAPERBOT_V1_CONFIG,replaySkPaperBot,skChronologicalStability,evaluateSkPaperGate} from '../research/sk-paperbot-v1.js?v=10.0-r97';
import {SK_RESEARCH_V2_RULESET,SK_RESEARCH_V2_ASSETS,aggregateSkResearchV2} from '../research/sk-research-v2.js?v=10.0-r97';
import {DOCUMENTED_EDGE_V1_RULESET,DOCUMENTED_EDGE_ASSETS,runTsmomClassic,runXsmom3wPriceProxy,fundingCarryEvidence} from '../research/documented-edge-v1.js?v=10.0-r97';
import {TSMOM_HOLDOUT_V1_RULESET,TSMOM_TRANSFER_ASSETS,runLegacyTimeHoldout,runTransferUniverseHoldout,evaluateCombinedTsmomHoldout} from '../research/tsmom-holdout-v1.js?v=10.0-r97';
import {PAPERBOT_PROFIT_AGENT_V1_RULESET,PAPERBOT_PROFIT_AGENT_V1_ASSETS,runPaperBotProfitAgentV1} from '../research/paperbot-profit-special-agent-v1.js?v=10.0-r97';
// MERIDIAN v10 r97 — isolated presentation/command adapter over the validated v9 engine.
// No trading logic lives here. It consumes the read-only v9 bridge and never submits orders.
const BUILD='10.0-r97';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const bridge=()=>window.MERIDIAN_V10_BRIDGE||null;
const S=()=>bridge()?.getState?.()||null;
const H=()=>bridge()?.helpers||{};
const UI_CONTEXT_KEY='meridian.v10.context.v1';
const UI_CONTEXT_ASSETS=['BTC','ETH','SOL','XRP','HBAR','PEPE','LINK','AVAX','SUI','ADA','DOT','XLM','TRX','WIF','INJ','DOGE','NEAR'];
const BOT_FILTERS=['ALL','RISK','PROFIT','HEDGE'];
function readUiContext(){
  try{
    if(typeof sessionStorage==='undefined')return{fibSymbol:'BTC',botFilter:'ALL'};
    const raw=JSON.parse(sessionStorage.getItem(UI_CONTEXT_KEY)||'{}')||{},fibSymbol=String(raw.fibSymbol||'').trim().toUpperCase(),botFilter=String(raw.botFilter||'').trim().toUpperCase();
    return{fibSymbol:UI_CONTEXT_ASSETS.includes(fibSymbol)?fibSymbol:'BTC',botFilter:BOT_FILTERS.includes(botFilter)?botFilter:'ALL'};
  }catch{return{fibSymbol:'BTC',botFilter:'ALL'}}
}
const savedUiContext=readUiContext();
const fibUi={symbol:savedUiContext.fibSymbol,window:90,mode:'AUTO',manualHigh:null,manualLow:null,direction:'AUTO',autoHigh:null,autoLow:null,lastDirection:'UP'};
const skLabUi={symbol:'BTC',days:180,running:false,result:null,stability:null,gate:null,error:null,range:null};
const skV2Ui={days:730,running:false,result:null,error:null,progress:'',completed:0,total:SK_RESEARCH_V2_ASSETS.length};
const edgeUi={days:1460,running:false,tsmom:null,xsmom:null,error:null,progress:'',completed:0,total:DOCUMENTED_EDGE_ASSETS.length,loadedAssets:[]};
const profitAgentUi={days:1460,running:false,result:null,error:null,progress:'',completed:0,total:PAPERBOT_PROFIT_AGENT_V1_ASSETS.length};
const assetWatchShareUi={busy:false,shareUrl:null,message:'',tone:'muted'};
const botViewUi={filter:savedUiContext.botFilter};
const assetDetailUi={symbol:savedUiContext.fibSymbol,returnView:'depot',navKey:'depot'};
const VIEW_LABELS=Object.freeze({command:'COMMAND',depot:'DEPOT',bots:'BOTS',market:'FORECAST',research:'SCANNER','asset-detail':'ASSET DETAIL',paper:'PAPER',more:'LAB'});
const viewContextUi={};
function persistUiContext(){
  try{
    if(typeof sessionStorage!=='undefined')sessionStorage.setItem(UI_CONTEXT_KEY,JSON.stringify({fibSymbol:String(fibUi.symbol||'BTC').toUpperCase(),botFilter:BOT_FILTERS.includes(botViewUi.filter)?botViewUi.filter:'ALL'}));
  }catch{}
}
function activeNavKey(){return String($('#nav button.active')?.dataset.v||'research')}
function contextReturnLabel(target,fallback='ZURÜCK'){return viewContextUi[target]?.label||fallback}
function restoreViewport(y=0){
  const top=Math.max(0,Number(y)||0);
  requestAnimationFrame(()=>{try{window.scrollTo({top,behavior:'auto'})}catch{window.scrollTo(0,top)}});
}
function contextualBack(target,fallbackView='research',fallbackNav='research'){
  const ctx=viewContextUi[target];delete viewContextUi[target];
  showSecondaryView(ctx?.returnView||fallbackView,ctx?.navKey||fallbackNav,false,ctx?.scrollY||0);
}
function contextBarHtml(target){
  const ctx=viewContextUi[target];if(!ctx)return'';
  return '<section class="context-return-bar"><button type="button" data-context-back="'+esc(target)+'">← '+esc(ctx.label||'ZURÜCK')+'</button><small>Kontext-Rücksprung · Auswahl bleibt in dieser Browser-Session erhalten</small></section>';
}
function bindContextBack(view,target,fallbackView='research',fallbackNav='research'){
  $('[data-context-back="'+target+'"]',view)?.addEventListener('click',()=>contextualBack(target,fallbackView,fallbackNav));
}
const paperCockpitUi={loading:false,data:null,error:null,loadedAt:0};
const holdoutUi={running:false,legacy:null,transfer:null,combined:null,error:null,progress:'',completed:0,total:DOCUMENTED_EDGE_ASSETS.length+TSMOM_TRANSFER_ASSETS.length};
const MARKET_FRESH_MS=3*60*1000;
const portfolioChartUi={range:'1d'};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(v,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'—'}
function freshTs(ts,maxAge=MARKET_FRESH_MS){const n=Number(ts);return Number.isFinite(n)&&n<=Date.now()+30000&&Date.now()-n<=maxAge}
function intelFresh(i){return !!i&&freshTs(i.updatedAt)}
function marketIntel(symbol){
  const s=S(),key=String(symbol||'').trim().toUpperCase(),asset=s?.assetIntel?.[key]||null,btc=key==='BTC'?(s?.intel||null):null;
  if(!btc)return asset;
  if(!asset)return btc;
  const btcTs=Number(btc.updatedAt)||0,assetTs=Number(asset.updatedAt)||0,primary=btcTs>=assetTs?btc:asset,secondary=primary===btc?asset:btc;
  return {...primary,near:primary?.near??(intelFresh(secondary)?secondary?.near:null),longReasons:primary?.longReasons??secondary?.longReasons,shortReasons:primary?.shortReasons??secondary?.shortReasons};
}
function referenceRows(symbol){return (S()?.referenceBots||[]).filter(b=>b.symbol===symbol)}
function referenceLinked(symbol){return referenceRows(symbol).length>0}
function marketHealth(){
  const s=S(),h=H(),universe=marketUniverse(),freshAssets=universe.filter(symbol=>intelFresh(marketIntel(symbol))).length,knownAssets=universe.filter(symbol=>!!marketIntel(symbol)).length,age=s?.marketSyncedAt?Date.now()-s.marketSyncedAt:null,totalAssets=universe.length,staleAssets=Math.max(0,knownAssets-freshAssets),missingAssets=Math.max(0,totalAssets-knownAssets);
  return{fresh:freshTs(s?.marketSyncedAt)&&intelFresh(marketIntel('BTC')),freshAssets,knownAssets,staleAssets,missingAssets,totalAssets,coverageComplete:totalAssets>0&&freshAssets===totalAssets,age,ageText:h.ageText?.(age)||'—',transport:String(s?.marketTransport||s?.intel?.transport||'UNKNOWN'),priceAge:s?.marketPriceSyncedAt?Date.now()-s.marketPriceSyncedAt:null,priceFresh:freshTs(s?.marketPriceSyncedAt),error:s?.marketError||null,priceError:s?.marketPriceError||null};
}
function stopLossIssue(b){
  const sl=Number(b?.sl),liq=Number(b?.liq);if(!(sl>0&&liq>0))return null;
  const side=b.side||'LONG',beyond=side==='SHORT'?sl>=liq:sl<=liq,gap=side==='SHORT'?(liq-sl)/liq*100:(sl-liq)/liq*100;
  if(beyond)return{critical:true,reason:'SL liegt hinter/auf Liquidation ('+H().money?.(sl)+' vs '+H().money?.(liq)+')'};
  if(gap>=0&&gap<=1.5)return{critical:false,reason:'SL nur '+gap.toFixed(2)+'% vor Liquidation'};
  return null;
}

function banner(viewId,kicker,title,note,tone='neutral'){
  const view=$(viewId);if(!view)return;
  let el=$(':scope > .v10-mode-banner',view);
  if(!el){el=document.createElement('section');el.className='v10-mode-banner';view.prepend(el);}
  const next='<div><span>'+kicker+'</span><b>'+title+'</b></div><small>'+note+'</small>';
  if(el.innerHTML!==next)el.innerHTML=next;
  el.dataset.tone=tone;
}

function dataGuardDecorate(){
  const truth=$('.data-truth .data-truth-head span');
  if(truth&&truth.textContent!=='DATA GUARD')truth.textContent='DATA GUARD';
  const note=$('.data-truth small');
  if(note&&!note.dataset.v10){
    note.dataset.v10='1';
    note.insertAdjacentHTML('afterbegin','<b class="v10-guard-note">Nur ACTIONABLE = entscheidungsrelevant.</b><br>');
  }
  const riskTitle=$('.risk-v2 .section-title h2');
  if(riskTitle)riskTitle.textContent='ASSET RISK MAP';
  const riskSub=$('.risk-v2 .section-title small');
  if(riskSub)riskSub.textContent='Long + Short je Asset gemeinsam · Liq + Hedge + 15m/1h/4h + BTC-Regime';
}

function matchedRows(symbol){
  const s=S(),h=H();if(!s||!h.liveMatched)return[];
  return (s.bots||[]).filter(b=>b.symbol===symbol&&h.liveMatched(b));
}
function symbols(){
  const pref=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF','INJ'];
  const set=[...new Set((S()?.bots||[]).filter(H().liveMatched||(()=>false)).map(b=>b.symbol).filter(Boolean))];
  return set.sort((a,b)=>(pref.indexOf(a)<0?999:pref.indexOf(a))-(pref.indexOf(b)<0?999:pref.indexOf(b))||a.localeCompare(b));
}
function pairStatus(symbol){
  const s=S(),h=H(),rows=matchedRows(symbol);
  if(!s||!rows.length)return{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:'Kein sicher gematchter privater Bot'};
  if(!h.botFeedFresh?.())return{code:'DATA_STALE',label:'DATA STALE',tone:'muted',rank:100,reason:'Privater Bot-Snapshot ist nicht frisch genug'};
  const risks=rows.map(b=>h.risk?.(b)).filter(x=>x!=null),protection=rows.map(stopLossIssue).filter(Boolean),assetKey=String(symbol||'').trim().toUpperCase(),unmatchedAsset=(s.unmatchedLive||[]).filter(x=>String(x?.symbol||'').trim().toUpperCase()===assetKey),ambiguousAsset=unmatchedAsset.filter(x=>x?.reason==='AMBIGUOUS_MATCH').length;
  const hardProtection=protection.find(x=>x.critical),nearProtection=protection.find(x=>!x.critical);
  if(hardProtection)return{code:'PROTECTION_RISK',label:'PROTECTION RISK',tone:'danger',rank:130,reason:hardProtection.reason};
  const min=risks.length?Math.min(...risks):null;
  if(min!=null&&min<10)return{code:'LIQ_RISK',label:'LIQ RISK',tone:'danger',rank:120,reason:'Liq-Puffer nur '+min.toFixed(1)+'%'};
  if(nearProtection)return{code:'PROTECTION_RISK',label:'PROTECTION RISK',tone:'danger',rank:115,reason:nearProtection.reason};
  if(unmatchedAsset.length)return{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:unmatchedAsset.length+' aktuelle '+assetKey+' Bot-Row(s) nicht sicher gematcht'+(ambiguousAsset?' · '+ambiguousAsset+' ambiguous':'')};
  if(rows.some(b=>!h.livePnlAvailable?.(b))||risks.length!==rows.length)return{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:'Mindestens ein Action-Feld (PnL/Liq) fehlt live'};
  if(!intelFresh(s.assetIntel?.[symbol]))return{code:'MARKET_STALE',label:'MARKET STALE',tone:'muted',rank:80,reason:'15m/1h/4h Marktdaten sind nicht frisch · nur Safety-Daten bleiben gültig'};
  const plans=rows.map(b=>h.profitLockPlan?.(b)).filter(Boolean);
  const signals=rows.map(b=>intelFresh(s.assetIntel?.[b.symbol])?h.actionForSide?.(s.assetIntel?.[b.symbol],b.side||'LONG'):'SYNC');
  if(plans.some(p=>['LOCK20','LOCK25','LOCK50'].includes(p.code)))return{code:'PROFIT_LOCK',label:'PROFIT LOCK',tone:'watch',rank:60,reason:'Technische Schwäche + ausreichendes Gewinnpolster'};
  if(signals.includes('RISK REVIEW'))return{code:'RISK_REVIEW',label:'STRUCTURE REVIEW',tone:'watch',rank:70,reason:'4h/1h Struktur dreht gegen mindestens eine Seite'};
  if(signals.includes('PROFIT LOCK CANDIDATE')||signals.includes('WATCH PROFIT'))return{code:'WATCH_PROFIT',label:'WATCH PROFIT',tone:'watch',rank:40,reason:'15m/1h Frühwarnung · 4h noch nicht als Exit bestätigt'};
  return{code:'HOLD',label:'HOLD',tone:'safe',rank:10,reason:'Kein bestätigtes Exit-/Safety-Signal'};
}
function exposure(rows,side){
  const h=H();return rows.filter(b=>(b.side||'LONG')===side&&h.liveInvestUsdAvailable?.(b))
    .reduce((n,b)=>n+(Number(b.investUsd)||0)*(Number(b.leverage)||1),0);
}
function marketPrice(symbol){
  const s=S(),c=s?.priceChecks?.[symbol],crossFresh=freshTs(c?.updatedAt),vals=c?.verified&&crossFresh?[Number(c.okx),Number(c.binance)].filter(x=>x>0):[];
  if(vals.length===2)return{value:(vals[0]+vals[1])/2,source:'OKX SWAP + BINANCE USD-M',verified:true,spread:Number(c.spreadPct)||0,stale:false};
  const i=marketIntel(symbol),p=Number(i?.price),fresh=intelFresh(i);
  return{value:p>0?p:null,source:p>0?(i?.source||'MARKET FEED')+(fresh?'':' · STALE'):'UNVERIFIED',verified:false,spread:null,stale:!fresh};
}
function botTypeLabel(b){
  const raw=String(b?.botType||'').trim().toLowerCase();
  if(raw.includes('grid'))return'GRID';
  if(raw.includes('dca'))return'DCA';
  if(raw.includes('lite'))return'LITE';
  return raw?raw.replaceAll('_',' ').toUpperCase().slice(0,18):'BOT';
}
function botTypeSummary(rows){
  const types=[...new Set((rows||[]).map(botTypeLabel).filter(Boolean))];
  return types.length?types.join(' + '):'BOT';
}
function botRangeState(b,mp=marketPrice(b?.symbol)){
  const lower=Number(b?.lower),upper=Number(b?.upper),price=Number(mp?.value),available=lower>0&&upper>lower;
  if(!available)return{available:false,positionFresh:false,inRange:null,positionPct:null,label:'—'};
  const positionFresh=Number.isFinite(price)&&price>0&&!mp?.stale;
  if(!positionFresh)return{available:true,positionFresh:false,inRange:null,positionPct:null,label:'MKT STALE'};
  const raw=(price-lower)/(upper-lower)*100,positionPct=Math.max(0,Math.min(100,raw)),inRange=price>=lower&&price<=upper;
  return{available:true,positionFresh:true,inRange,positionPct,label:inRange?'IN RANGE':price<lower?'BELOW RANGE':'ABOVE RANGE'};
}
function botRangeSummary(rows,mp){
  const states=(rows||[]).map(b=>botRangeState(b,mp)).filter(x=>x.available),positionFresh=states.length>0&&states.every(x=>x.positionFresh),inRange=positionFresh?states.filter(x=>x.inRange).length:null;
  return{known:states.length,positionFresh,inRange,label:states.length?(positionFresh?inRange+'/'+states.length:'MKT STALE'):'—'};
}
function botFilterMatch(symbol,filter=botViewUi.filter){
  const st=pairStatus(symbol),rows=matchedRows(symbol),key=String(filter||'ALL').toUpperCase();
  if(key==='RISK')return['LIQ_RISK','PROTECTION_RISK','RISK_REVIEW','UNVERIFIED','MARKET_STALE'].includes(st.code);
  if(key==='PROFIT')return['PROFIT_LOCK','WATCH_PROFIT'].includes(st.code);
  if(key==='HEDGE')return rows.some(b=>String(b?.side||'').toUpperCase()==='SHORT');
  return true;
}
function botFilterBar(allSyms){
  const defs=[['ALL','ALLE'],['RISK','RISIKO'],['PROFIT','PROFIT'],['HEDGE','HEDGE']];
  return '<section class="bot-filter-bar"><div><span>ANSICHT</span><small>Nur Darstellung · Risk-Ranking bleibt unverändert</small></div><div class="bot-filter-actions">'+defs.map(([key,label])=>'<button type="button" data-bot-filter="'+key+'" class="'+(botViewUi.filter===key?'active':'')+'">'+label+' <b>'+allSyms.filter(s=>botFilterMatch(s,key)).length+'</b></button>').join('')+'</div></section>';
}
function legRow(b){
  const h=H(),fresh=h.botFeedFresh?.(),verified=fresh&&h.liveMatched?.(b),pnl=verified&&h.livePnlAvailable?.(b)?h.botPnlUsd?.(b)?.value:null,r=verified?h.risk?.(b):null,sl=Number(b.sl)>0?h.money?.(b.sl):'—';
  if(!fresh)return '<div class="pair-leg pair-leg-stale '+((b.side||'LONG')==='SHORT'?'leg-short':'leg-long')+'"><div class="leg-head"><strong>'+(b.side||'LONG')+' · '+(b.leverage||'—')+'x</strong><span>STALE</span></div><small>Bot-Felder ausgeblendet · frischen privaten Snapshot abwarten</small></div>';
  if(!verified)return '<div class="pair-leg pair-leg-stale"><div class="leg-head"><strong>'+(b.side||'BOT')+' · '+(b.leverage||'—')+'x</strong><span>UNVERIFIED</span></div><small>Nicht handlungsrelevant</small></div>';
  const mp=marketPrice(b.symbol),range=botRangeState(b,mp),type=botTypeLabel(b),grids=Number(b.grids),rangeText=range.available?h.money?.(b.lower)+' — '+h.money?.(b.upper):'—',rangeTone=!range.positionFresh?'muted':range.inRange?'safe':'watch',marker=range.positionFresh?'<i style="--range-pos:'+range.positionPct.toFixed(1)+'%"></i>':'';
  return '<div class="pair-leg '+((b.side||'LONG')==='SHORT'?'leg-short':'leg-long')+'"><div class="leg-head"><strong>'+(b.side||'LONG')+' · '+(b.leverage||'—')+'x</strong><span>'+esc(type)+(grids>0?' · '+Math.round(grids)+' GRIDS':'')+'</span></div><div class="leg-range"><div><span>RANGE</span><b>'+rangeText+'</b><small class="tone-'+rangeTone+'">'+esc(range.label)+(range.positionFresh?' · '+range.positionPct.toFixed(0)+'%':'')+'</small></div><div class="leg-range-track">'+marker+'</div></div><div class="leg-grid"><span>CAPITAL USD <b>'+(h.liveInvestUsdAvailable?.(b)?h.money(b.investUsd):'—')+'</b></span><span>PNL USD <b>'+(pnl==null?'—':h.money(pnl))+'</b></span><span>BE <b>'+(Number(b.be)>0?h.money(b.be):'—')+'</b></span><span>TP <b>'+(Number(b.tp)>0?h.money(b.tp):'—')+'</b></span><span>LIQ <b>'+(Number(b.liq)>0?h.money(b.liq):'—')+'</b></span><span>SL <b>'+sl+'</b></span><span>PUFFER <b>'+(r==null?'—':r.toFixed(1)+'%')+'</b></span></div></div>';
}
function pairCard(symbol,compact=false,open=false,assetLink=false){
  const h=H(),rows=matchedRows(symbol),st=pairStatus(symbol),fresh=h.botFeedFresh?.(),longs=rows.filter(b=>(b.side||'LONG')==='LONG'),shorts=rows.filter(b=>b.side==='SHORT'),mp=marketPrice(symbol);
  if(!fresh&&!compact)return '';
  const exposureState=h.exposureIntegrity?.(symbol),exposureComplete=exposureState?!!exposureState.complete:(fresh&&rows.length>0&&rows.every(b=>h.liveInvestUsdAvailable?.(b))),longUsd=exposureComplete?exposure(rows,'LONG'):null,shortUsd=exposureComplete?exposure(rows,'SHORT'):null;
  const pnlState=h.pnlIntegrity?.(symbol),pnlVals=fresh?rows.map(b=>h.botPnlUsd?.(b)?.value):[],pnlComplete=(pnlState?!!pnlState.complete:(fresh&&rows.length>0))&&pnlVals.length===rows.length&&pnlVals.every(x=>x!=null),pnl=pnlComplete?pnlVals.reduce((a,b)=>a+b,0):null;
  const risks=fresh?rows.map(b=>h.risk?.(b)).filter(x=>x!=null):[],minRisk=risks.length?Math.min(...risks):null,riskTone=minRisk==null?'muted':minRisk<10?'danger':minRisk<18?'watch':'safe';
  const hedge=longUsd>0&&shortUsd!=null?shortUsd/longUsd*100:null,net=longUsd!=null&&shortUsd!=null?longUsd-shortUsd:null,pnlTone=pnl==null?'muted':pnl>0?'safe':pnl<0?'danger':'muted',range=botRangeSummary(rows,mp),rangeTone=!range.positionFresh?'muted':range.inRange===range.known?'safe':'watch',types=botTypeSummary(rows);
  const reason=esc(st.reason)+(exposureComplete?'':' · Exposure-Einheit unvollständig')+(pnlComplete?'':' · PnL-Summe unvollständig');
  const identityMeta=longs.length+' LONG · '+shorts.length+' SHORT · '+types;
  if(compact)return '<article class="asset-pair pair-compact"><div class="pair-head"><div><span class="asset-symbol">'+symbol+'</span><small>'+identityMeta+'</small></div><b class="pair-status tone-'+st.tone+'">'+st.label+'</b></div><div class="pair-summary"><div><span>MARKET PRICE</span><b>'+h.money?.(mp.value)+'</b><small>'+esc(mp.source)+'</small></div><div><span>KNOWN NET NOTIONAL</span><b>'+(net==null?'—':h.money?.(net))+'</b></div><div><span>HEDGE</span><b>'+(hedge!=null?hedge.toFixed(1)+'%':'—')+'</b></div><div><span>PAIR PNL USD</span><b class="tone-'+pnlTone+'">'+(pnl==null?'—':h.money?.(pnl))+'</b></div></div><div class="pair-reason">'+reason+'</div></article>';
  return '<details class="asset-pair asset-pair-details pair-tone-'+st.tone+'" data-symbol="'+esc(symbol)+'" '+(open?'open':'')+'><summary class="asset-pair-summary"><div class="asset-pair-identity"><span class="asset-symbol">'+symbol+'</span><small>'+identityMeta+'</small></div><div class="asset-glance"><span>PNL <b class="tone-'+pnlTone+'">'+(pnl==null?'—':h.money?.(pnl))+'</b></span><span>MIN LIQ <b class="tone-'+riskTone+'">'+(minRisk==null?'—':minRisk.toFixed(1)+'%')+'</b></span><span>HEDGE <b>'+(hedge!=null?hedge.toFixed(1)+'%':'—')+'</b></span><span>RANGE <b class="tone-'+rangeTone+'">'+esc(range.label)+'</b></span></div><div class="asset-pair-status-wrap"><b class="pair-status tone-'+st.tone+'">'+st.label+'</b><i class="asset-chevron" aria-hidden="true"></i></div></summary><div class="asset-pair-body"><div class="pair-summary"><div><span>MARKET PRICE</span><b>'+h.money?.(mp.value)+'</b><small>'+esc(mp.source)+'</small></div><div><span>LONG NOTIONAL</span><b>'+(longUsd==null?'—':h.money?.(longUsd))+'</b></div><div><span>SHORT NOTIONAL</span><b>'+(shortUsd==null?'—':h.money?.(shortUsd))+'</b></div><div><span>NET NOTIONAL</span><b>'+(net==null?'—':h.money?.(net))+'</b></div></div><div class="pair-reason">'+reason+'</div><div class="pair-legs">'+rows.map(legRow).join('')+'</div>'+(assetLink?'<div class="pair-detail-action">'+assetDetailButton(symbol,'ASSET DETAIL')+'</div>':'')+'</div></details>';
}
function criticalPair(){
  const s=S(),h=H();if(!s)return null;
  if(!h.botFeedFresh?.())return{symbol:'BOT DATA',status:{code:'DATA_STALE',label:'DATA STALE',tone:'muted',rank:100,reason:'Live-Bot-Layer ist nicht frisch · Asset Watch bleibt nur Referenz'}};
  const candidates=symbols().map(symbol=>({symbol,status:pairStatus(symbol)})),unmatched=s.unmatchedLive||[];
  if(unmatched.length)candidates.push({symbol:'API',status:{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:unmatched.length+' private Bot-Rows sind nicht sicher gematcht'+(Number(s.matchAmbiguous||0)?' · '+Number(s.matchAmbiguous)+' ambiguous':'')}});
  return candidates.sort((a,b)=>b.status.rank-a.status.rank)[0]||null;
}
function nextAction(){
  const c=criticalPair();if(!c)return{title:'DATEN SYNC',detail:'Keine privaten Bot-Rows · keine Aktion aus Referenzdaten'};
  const s=c.status,g=syncHealth();
  if(['DATA_STALE','MARKET_STALE','UNVERIFIED'].includes(s.code))return{title:'KEINE AKTION · DATEN PRÜFEN',detail:c.symbol+' · '+s.reason};
  if(s.code==='LIQ_RISK')return{title:c.symbol+' · LIQ-PUFFER PRÜFEN',detail:s.reason+' · Safety vor Profit-Lock'};
  if(s.code==='PROTECTION_RISK')return{title:c.symbol+' · PROTECTION PRÜFEN',detail:s.reason+' · Safety zuerst, nicht reflexartig komplett schließen'};
  if(!g.coverageComplete)return{title:'KEINE AKTION · DATEN PRÜFEN',detail:'BOT COVERAGE · '+g.matched+'/'+g.supported+' sicher gematcht · '+g.unmatched+' unmatched'+(g.ambiguous?' · '+g.ambiguous+' ambiguous':'')};
  if(s.code==='RISK_REVIEW')return{title:c.symbol+' · STRUCTURE REVIEW',detail:s.reason+' · MTF-Konflikt prüfen · keine automatische Exit-Freigabe'};
  if(s.code==='PROFIT_LOCK')return{title:c.symbol+' · PROFIT LOCK PRÜFEN',detail:s.reason+' · Teilgewinn/Reload-Reserve statt Komplettausstieg'};
  if(s.code==='WATCH_PROFIT')return{title:c.symbol+' · WATCH PROFIT',detail:s.reason};
  return{title:'HOLD · RUNNER WEITERLAUFEN',detail:'Kein 4h-bestätigtes Exit-Signal'};
}
function syncHealth(){
  const s=S(),h=H(),rows=(s?.bots||[]).filter(h.liveMatched||(()=>false)),shared=h.botFeedCoverage?.(),supported=Number(shared?.supported??s?.liveRows??0),matched=Number(shared?.matched??rows.length),apiRows=Number(s?.botApiRows??supported),fresh=shared?!!shared.fresh:!!h.botFeedFresh?.(),identityMode=String(s?.botIdentityMode||'REFERENCE_MATCH'),apiNative=identityMode==='API_NATIVE';
  const safetyRows=fresh?rows.filter(b=>h.safetyReadyBot?h.safetyReadyBot(b):h.risk?.(b)!=null):[],pnlRows=fresh?rows.filter(b=>h.livePnlAvailable?.(b)):[],marketRows=fresh?rows.filter(b=>intelFresh(s?.assetIntel?.[b.symbol])):[],decisionRows=fresh?rows.filter(b=>h.decisionReadyBot?h.decisionReadyBot(b):(h.risk?.(b)!=null&&h.livePnlAvailable?.(b)&&intelFresh(s?.assetIntel?.[b.symbol]))):[];
  const safetyReady=safetyRows.length,pnlReady=pnlRows.length,marketReady=marketRows.length,decisionReady=decisionRows.length,pnlMissing=Math.max(0,matched-pnlReady),marketMissing=Math.max(0,matched-marketReady),safetyMissing=Math.max(0,matched-safetyReady),actionable=decisionReady,unmatched=Number(shared?.unmatched??Math.max(0,supported-matched)),ambiguous=Number(shared?.ambiguous??s?.matchAmbiguous??(s?.unmatchedLive||[]).filter(x=>x?.reason==='AMBIGUOUS_MATCH').length),coverageComplete=shared?!!shared.coverageComplete:(fresh&&supported>0&&unmatched===0&&ambiguous===0),decisionComplete=matched>0&&coverageComplete&&decisionReady===matched;
  const botApiStatus=String(s?.pionexBotSync?.status||'UNKNOWN'),status=String(s?.botFeedStatus||botApiStatus),walletFeed=status==='WALLET_DETAIL_OK',age=h.botFeedAgeLabel?.()||(h.ageText?.(h.botFeedAgeMs?.())||'—');
  const guardRows=Number(s?.pionexBotSync?.diagnostics?.listRows),shownApiRows=walletFeed?apiRows:(botApiStatus==='EMPTY_GUARD'&&Number.isFinite(guardRows)?guardRows:apiRows);
  let detail='Private Bot-Daten werden geprüft.';
  if(walletFeed&&!fresh)detail='Wallet-Detail-Fallback ist validiert, aber der Bot-Snapshot ist nicht frisch genug.';
  else if(walletFeed&&fresh&&apiNative&&decisionReady<matched)detail='API-native Bot-Identität vollständig · Blocker: PnL '+pnlMissing+'/'+matched+' · Market '+marketMissing+'/'+matched+' · Safety '+safetyMissing+'/'+matched+'.';
  else if(walletFeed&&fresh&&apiNative)detail='API-native Bot-Identität ist vollständig und frisch · '+decisionReady+'/'+matched+' decision-ready.';
  else if(walletFeed&&fresh&&ambiguous)detail=ambiguous+' Wallet-Detail-Row(s) haben mehrere nahezu gleich gute Referenztreffer · keine automatische Zuordnung.';
  else if(walletFeed&&fresh&&unmatched)detail=unmatched+' Wallet-Detail-Row(s) nicht sicher gematcht · nur gematchte Rows werden verwendet.';
  else if(walletFeed&&fresh&&decisionReady<matched)detail='Wallet-Detail-Botdaten sind frisch; '+(matched-decisionReady)+' gematchte Row(s) bleiben mangels PnL oder Marktfeed nicht decision-ready.';
  else if(walletFeed&&fresh)detail='Wallet + Futures-Grid-Detail ist der aktive Live-Bot-Feed · '+decisionReady+'/'+matched+' decision-ready.';
  else if(botApiStatus==='DISABLED_MISSING_CREDENTIALS')detail='Pionex Read API fehlt am Backend · letzter Asset-Watch-Snapshot bleibt nur Referenz';
  else if(botApiStatus==='ERROR')detail='Pionex Bot API Sync-Fehler · '+String(s?.pionexBotSync?.error||'unbekannt').slice(0,110);
  else if(botApiStatus==='EMPTY_GUARD'){
    const d=s?.pionexBotSync?.diagnostics||{},types=Object.entries(d.typeCounts||{}).map(([k,v])=>k+' '+v).join(', ')||'—',states=Object.entries(d.statusCounts||{}).map(([k,v])=>k+' '+v).join(', ')||'—';
    detail='Pionex Bot-Liste lieferte '+String(d.listRows??'—')+' laufende Row(s) · Typen '+types+' · Status '+states+' · lokale Futures-Allowlist blieb leer · alter Snapshot bleibt blockiert.';
  }
  else if(botApiStatus==='OK'&&!fresh)detail='API ist konfiguriert, aber der letzte Bot-Snapshot ist nicht frisch genug.';
  else if(botApiStatus==='OK'&&fresh&&ambiguous)detail=ambiguous+' Bot-Row(s) haben mehrere nahezu gleich gute Referenztreffer · keine automatische Zuordnung.';
  else if(botApiStatus==='OK'&&fresh&&unmatched)detail=unmatched+' unterstützte Bot-Row(s) nicht sicher gematcht · nur gematchte Rows werden verwendet.';
  else if(botApiStatus==='OK'&&fresh&&decisionReady<matched)detail='Bot-Safety ist frisch, aber '+(matched-decisionReady)+' Row(s) sind noch nicht decision-ready (PnL oder Marktfeed fehlt/stale).';
  else if(botApiStatus==='OK'&&fresh)detail='Private Pionex Bot-Daten und zugehörige Marktdaten sind decision-ready · '+decisionReady+'/'+matched+'.';
  return{apiRows:shownApiRows,supported,raw:supported,matched,safetyReady,pnlReady,marketReady,pnlMissing,marketMissing,safetyMissing,decisionReady,decisionComplete,actionable,unmatched,ambiguous,status,botApiStatus,walletFeed,identityMode,apiNative,age,fresh,coverageComplete,detail};
}
function marketReadiness(m){
  if(m.fresh&&m.coverageComplete)return{label:'READY',tone:'safe'};
  if(m.fresh)return{label:'PARTIAL',tone:'watch'};
  return{label:'STALE',tone:'watch'};
}
function botReadiness(g){
  if(g.status==='ERROR')return{label:'ERROR',tone:'danger'};
  if(!g.fresh)return{label:'REF',tone:'muted'};
  if(g.decisionComplete)return{label:'READY',tone:'safe'};
  if(g.decisionReady>0)return{label:'PARTIAL',tone:'watch'};
  if(g.safetyReady>0)return{label:'SAFETY',tone:'watch'};
  return{label:'BLOCKED',tone:'muted'};
}
function portfolioAuthorityDetail(p=S()?.portfolio||{}){
  const ledger=p.ledgerAutoActive?'Ledger aktuell':p.ledgerAutoUsd!=null?'Ledger vorhanden':'Ledger unbestätigt',okx=p.okxVenueUsd!=null?'OKX vorhanden':'OKX fehlt',pionex=p.pionex!=null?'Pionex vorhanden':'Pionex fehlt';
  return ledger+' · '+okx+' · '+pionex;
}
function portfolioReadiness(){
  const p=S()?.portfolio||{};
  if(p.complete===true)return{key:'PORTFOLIO',label:'READY',tone:'safe',detail:'Kanonischer Venue-SSOT vollständig'};
  const known=[p.ledgerAutoUsd,p.okxVenueUsd,p.pionex].filter(v=>v!=null&&Number.isFinite(Number(v))).length;
  return{key:'PORTFOLIO',label:known?'PARTIAL':'BLOCKED',tone:known?'watch':'muted',detail:portfolioAuthorityDetail(p)};
}
function marketStateItem(){
  const m=marketHealth(),r=marketReadiness(m);
  return{key:'MARKET',label:r.label,tone:r.tone,detail:String(m.ageText||'—')+' · '+m.freshAssets+'/'+m.totalAssets+' frisch'};
}
function botStateItem(){
  const g=syncHealth(),r=botReadiness(g);
  return{key:'BOTS',label:r.label,tone:r.tone,detail:String(g.age||'—')+' · '+g.decisionReady+'/'+g.matched+' decision-ready'};
}
function paperReadiness(){
  const d=paperCockpitUi.data;
  if(paperCockpitUi.loading&&!d)return{key:'PAPER',label:'LOADING',tone:'watch',detail:'Geschützter Paper Overview wird geladen'};
  if(!d)return{key:'PAPER',label:paperCockpitUi.error?'ERROR':'NOT LOADED',tone:paperCockpitUi.error?'danger':'muted',detail:paperCockpitUi.error||'Noch kein Paper Overview geladen'};
  if(!paperOverviewTrusted(d))return{key:'PAPER',label:'BLOCKED',tone:'danger',detail:'Paper Safety-/Schema-Vertrag ungültig'};
  const ageMs=Date.now()-Date.parse(String(d.generatedAt||'')),age=Number.isFinite(ageMs)?H().ageText?.(Math.max(0,ageMs))||'—':'—';
  if(paperCockpitUi.error)return{key:'PAPER',label:'LAST GOOD',tone:'watch',detail:age+' · Refresh-Fehler, letzter gültiger Snapshot'};
  return{key:'PAPER',label:Number.isFinite(ageMs)&&ageMs<=2*60*1000?'READY':'STALE',tone:Number.isFinite(ageMs)&&ageMs<=2*60*1000?'safe':'watch',detail:age+' · protected Paper Overview'};
}
function researchSessionReadiness(){
  const running=[skLabUi.running,skV2Ui.running,edgeUi.running,profitAgentUi.running,holdoutUi.running].filter(Boolean).length;
  const errors=[skLabUi.error,skV2Ui.error,edgeUi.error,profitAgentUi.error,holdoutUi.error].filter(Boolean).length;
  const results=[skLabUi.result,skV2Ui.result,edgeUi.tsmom||edgeUi.xsmom,profitAgentUi.result,holdoutUi.combined].filter(Boolean).length;
  if(running)return{key:'RESEARCH',label:'LOADING',tone:'watch',detail:running+' Modul(e) laufen · '+results+' Ergebnis(se) im Session-State'};
  if(errors)return{key:'RESEARCH',label:results?'PARTIAL':'ERROR',tone:results?'watch':'danger',detail:errors+' Modulfehler · '+results+' Ergebnis(se) verfügbar'};
  return{key:'RESEARCH',label:results?'LOADED':'IDLE',tone:results?'safe':'muted',detail:results+' Ergebnis(se) im lokalen Research-Session-State'};
}
function dataStateStripHtml(scope){
  const sources={portfolio:portfolioReadiness,bots:botStateItem,market:marketStateItem,paper:paperReadiness,research:researchSessionReadiness};
  const map={
    command:['portfolio','bots','market'],
    depot:['portfolio','bots'],
    bots:['bots','market'],
    market:['market'],
    research:['market','bots'],
    asset:['portfolio','bots','market'],
    paper:['paper'],
    lab:['research']
  },items=(map[scope]||[]).map(key=>sources[key]());
  const notes={command:'Portfolio, Bots und Markt separat',depot:'Authority + Bot-Verknüpfung',bots:'Private Bots + öffentlicher Marktfeed',market:'Nur öffentlicher Marktfeed ist Forecast-Grundlage',research:'Bot-Status beeinflusst Scanner-Ranking nicht',asset:'Holdings, Bots und Markt bleiben getrennt',paper:'Geschützter Paper Overview · read-only',lab:'Nur lokaler Research-Session-Status'};
  return '<section class="data-state-strip" data-data-scope="'+esc(scope)+'"><div class="data-state-label"><span>DATA STATE</span><small>'+esc(notes[scope]||'Vorhandene Guards')+'</small></div><div class="data-state-items">'+items.map(x=>'<div class="data-state-item tone-'+esc(x.tone)+'"><span>'+esc(x.key)+'</span><b>'+esc(x.label)+'</b><small>'+esc(x.detail)+'</small></div>').join('')+'</div></section>';
}
function matchStageDiagnosticsCard(){
  const s=S(),d=s?.matchDiagnostics;
  if(String(s?.botIdentityMode||'')==='API_NATIVE'){
    const rows=Number(s?.apiNativeRows||s?.liveRows||0);
    return rows?'<div class="v10-wallet-categories v10-match-stage-diagnostics"><div><span>IDENTITY MODE</span><b>API NATIVE '+rows+'/'+rows+'</b><small>Eindeutige private Bot-ID + vollständiger Wallet-Detail-Snapshot · Asset Watch bleibt historische Referenz.</small></div></div>':'';
  }
  if(!d||!Number(d.rows))return'';
  const counts=obj=>Object.entries(obj||{}).map(([k,v])=>esc(k)+' '+Number(v||0)).join(' · ')||'—',f=d.fields||{},rows=Number(d.rows||0);
  return '<div class="v10-wallet-categories v10-match-stage-diagnostics"><div><span>MATCH STAGES</span><b>ASSET '+Number(d.assetPass||0)+'/'+rows+' · SIDE '+Number(d.sidePass||0)+'/'+rows+'</b><small>LEVERAGE '+Number(d.leveragePass||0)+'/'+rows+' · STRUCTURE '+Number(d.structurePass||0)+'/'+rows+' · STRONG '+Number(d.strongCandidate||0)+' · ACCEPTED '+Number(d.acceptedRows||0)+'</small></div><div><span>SIDE SANITY</span><b>ECON '+counts(d.economicSideCounts)+'</b><small>TREND↔ECON AGREE '+Number(d.economicAgree||0)+'/'+Number(d.economicKnown||0)+' · OPPOSITE '+Number(d.economicOpposite||0)+'</small></div><div><span>IGNORE DECLARED SIDE</span><b>LEV '+Number(d.assetLeveragePass||0)+'/'+rows+' · STRUCT '+Number(d.assetStructurePass||0)+'/'+rows+'</b><small>Asset ist bereits '+Number(d.assetPass||0)+'/'+rows+' vollständig erkannt</small></div><div><span>ECONOMIC SIDE → REFERENCE</span><b>SIDE '+Number(d.economicReferenceSidePass||0)+'/'+rows+' · LEV '+Number(d.economicReferenceLeveragePass||0)+'/'+rows+'</b><small>STRUCT '+Number(d.economicReferenceStructurePass||0)+'/'+rows+' · Diagnose only, keine automatische Side-Änderung</small></div><div><span>SIDE DISTRIBUTION</span><b>LIVE '+counts(d.liveSideCounts)+'</b><small>REFERENCE '+counts(d.referenceSideCounts)+'</small></div><div><span>LIVE MATCH FIELDS</span><b>LEV '+Number(f.leverage||0)+' · LOWER '+Number(f.lower||0)+' · UPPER '+Number(f.upper||0)+'</b><small>BE '+Number(f.be||0)+' · LIQ '+Number(f.liq||0)+' · TP '+Number(f.tp||0)+' · von '+rows+'</small></div></div>';
}
function unmatchedDiagnostics(open=false){
  const rows=S()?.unmatchedLive||[];if(!rows.length)return'';
  const body=rows.map(x=>{const symbol=esc(String(x?.symbol||'?').toUpperCase()),side=esc(String(x?.side||'?').toUpperCase()),lev=Number(x?.leverage),leverage=Number.isFinite(lev)&&lev>0?lev+'x':'—',reason=x?.reason==='AMBIGUOUS_MATCH'?'AMBIGUOUS MATCH':'NO CONFIDENT MATCH',fields=(x?.hasPnl?'PNL ✓':'PNL —')+' · '+(x?.hasInvestUsd?'USD CAPITAL ✓':'USD CAPITAL —');return '<div class="unmatched-row"><b>'+symbol+' · '+side+' · '+leverage+'</b><span>'+reason+'</span><small>'+fields+'</small></div>'}).join('');
  return '<details class="v10-unmatched-details" '+(open?'open':'')+'><summary>UNMATCHED DETAILS · '+rows.length+'</summary><div class="unmatched-list">'+body+'</div><small>Nur Diagnose-Metadaten · keine Bot-ID oder privaten Beträge.</small></details>';
}
function dataGuardCard(compact=false){
  const g=syncHealth(),tone=g.decisionComplete?'safe':(g.decisionReady>0||g.safetyReady>0)?'watch':g.status==='ERROR'?'danger':'muted',source=g.walletFeed?'WALLET DETAIL':g.status==='BOT_API_OK'||g.status==='OK'?'BOT API':g.status==='DISABLED_MISSING_CREDENTIALS'?'OFF':g.status.replaceAll('_',' '),label=g.decisionComplete?'DECISION READY':g.decisionReady>0?'PARTIAL READY':g.safetyReady>0?'SAFETY ONLY':'BLOCKED',identityLabel=g.apiNative?'API IDENTITY':'SUPPORTED MATCH';
  if(compact){
    const diagnostics='<details class="v10-command-tech-details"><summary><span>TECHNISCHE DETAILS</span><b>SAFETY '+g.safetyReady+'/'+g.matched+' · UNVERIFIED '+g.unmatched+'</b></summary><div class="v10-command-tech-details-body"><div class="guard-grid"><div><span>SAFETY READY</span><b>'+g.safetyReady+'</b></div><div><span>UNVERIFIED</span><b>'+g.unmatched+'</b><small>'+g.ambiguous+' ambiguous</small></div></div><small>'+esc(g.detail)+' · SOURCE '+esc(String(S()?.botFeedSource||'—').replaceAll('_',' '))+'</small>'+matchStageDiagnosticsCard()+unmatchedDiagnostics()+'</div></details>';
    return '<section class="v10-data-guard command-compact"><div class="guard-head"><div><span>DATA GUARD</span><b>LIVE BOT INTEGRITY</b></div><strong class="tone-'+tone+'">'+label+'</strong></div><div class="guard-grid"><div><span>BOT SOURCE</span><b>'+esc(source)+'</b><small>'+g.apiRows+' source rows</small></div><div><span>'+identityLabel+'</span><b>'+g.matched+'/'+g.supported+'</b></div><div><span>DECISION READY</span><b>'+g.decisionReady+'/'+g.matched+'</b><small>PNL miss '+g.pnlMissing+' · MKT miss '+g.marketMissing+'</small></div><div><span>SNAPSHOT AGE</span><b>'+esc(g.age)+'</b></div></div>'+diagnostics+'</section>';
  }
  return '<section class="v10-data-guard"><div class="guard-head"><div><span>DATA GUARD</span><b>LIVE BOT INTEGRITY</b></div><strong class="tone-'+tone+'">'+label+'</strong></div><div class="guard-grid"><div><span>BOT SOURCE</span><b>'+esc(source)+'</b><small>'+g.apiRows+' source rows · Bot API '+esc(g.botApiStatus)+'</small></div><div><span>'+identityLabel+'</span><b>'+g.matched+'/'+g.supported+'</b></div><div><span>SAFETY READY</span><b>'+g.safetyReady+'</b></div><div><span>DECISION READY</span><b>'+g.decisionReady+'</b><small>PNL miss '+g.pnlMissing+' · MKT miss '+g.marketMissing+'</small></div><div><span>SNAPSHOT AGE</span><b>'+esc(g.age)+'</b></div><div><span>UNVERIFIED</span><b>'+g.unmatched+'</b><small>'+g.ambiguous+' ambiguous</small></div></div><small>'+esc(g.detail)+' · SOURCE '+esc(String(S()?.botFeedSource||'—').replaceAll('_',' '))+'</small>'+matchStageDiagnosticsCard()+unmatchedDiagnostics()+'</section>';
}
function accountPositionHealth(){
  const s=S(),sync=s?.pionexAccountSync||{},snap=s?.pionexAccount||{},rows=Array.isArray(snap?.futuresPositions)?snap.futuresPositions:[],status=String(sync.status||'UNKNOWN'),ts=Date.parse(String(snap.updatedAt||snap.snapshotAt||'')),future=Number.isFinite(ts)&&ts>Date.now()+5*60*1000,ageMs=Number.isFinite(ts)?Math.max(0,Date.now()-ts):null,fresh=status==='OK'&&!future&&ageMs!=null&&ageMs<=15*60*1000,h=H(),age=future?'FUTURE TIMESTAMP':ageMs!=null?(h.ageText?.(ageMs)||'—'):'NO TIMESTAMP';
  const label=status==='OK'?(fresh?'LIVE':'STALE'):status==='ERROR'?'ERROR':status==='DISABLED_MISSING_CREDENTIALS'?'OFF':'WAIT',tone=label==='LIVE'?'safe':label==='ERROR'?'danger':'watch';
  return{status,label,tone,rows,fresh,age,ageMs};
}
function positionNumber(v,d=4){const n=Number(v);return Number.isFinite(n)?n.toLocaleString('de-DE',{maximumFractionDigits:d}):'—'}
function accountPositionLayer(compact=false){
  const p=accountPositionHealth(),h=H();
  if(p.status!=='OK')return '<section class="v10-live-blocked v10-account-position-layer"><b>POSITION API '+esc(p.label)+'</b><small>'+esc(String(S()?.pionexAccountSync?.error||'Pionex Futures-Positionen noch nicht verfügbar').slice(0,140))+'</small></section>';
  if(!p.fresh)return '<section class="v10-live-blocked v10-account-position-layer"><b>POSITION API STALE</b><small>Letzter Account-Positionssnapshot '+esc(p.age)+' · keine Bot-Aktion daraus ableiten.</small></section>';
  if(!p.rows.length)return '<section class="v10-data-guard v10-account-position-layer"><div class="guard-head"><div><span>POSITION API</span><b>ACCOUNT FUTURES</b></div><strong class="tone-watch">0 POSITIONS</strong></div><small>Read-only Account API ist frisch, meldet aber keine offenen Futures-Positionen. Bot-Snapshot bleibt Referenz.</small></section>';
  const cards=p.rows.map(x=>{
    const asset=esc(String(x?.asset||x?.symbol||'?').toUpperCase()),side=esc(String(x?.side||'?').toUpperCase()),lev=Number(x?.leverage),mark=Number(x?.markPrice),avg=Number(x?.avgPrice),liq=Number(x?.liquidationPrice),upnl=Number(x?.unrealizedPnl),size=Number(x?.netSize),buffer=Number.isFinite(mark)&&mark>0&&Number.isFinite(liq)&&liq>0?(String(x?.side||'').toUpperCase()==='SHORT'?(liq-mark)/mark*100:(mark-liq)/mark*100):null,tone=buffer==null?'muted':buffer<10?'danger':buffer<20?'watch':'safe';
    return '<article class="asset-pair pair-compact"><div class="pair-head"><span class="asset-symbol">'+asset+'</span><b class="pair-status tone-'+tone+'">'+side+' · '+(Number.isFinite(lev)?lev+'x':'—')+'</b></div><div class="guard-grid"><div><span>AVG</span><b>'+h.money?.(avg)+'</b></div><div><span>MARK</span><b>'+h.money?.(mark)+'</b></div><div><span>LIQ</span><b>'+h.money?.(liq)+'</b></div><div><span>LIQ BUFFER</span><b class="tone-'+tone+'">'+(buffer==null?'—':buffer.toFixed(1)+'%')+'</b></div><div><span>SIZE</span><b>'+positionNumber(size,8)+'</b></div><div><span>UPNL</span><b>'+(Number.isFinite(upnl)?(upnl>=0?'+':'')+positionNumber(upnl,6):'—')+'</b></div></div><small>ACCOUNT POSITION · nicht einem einzelnen Bot zugeordnet · keine Grid-/TP-/Profit-Lock-Aktion daraus.</small></article>';
  }).join('');
  const shown=compact?p.rows.slice(0,4).length:p.rows.length,body=compact?p.rows.slice(0,4).map(x=>{
    const asset=esc(String(x?.asset||x?.symbol||'?').toUpperCase()),side=esc(String(x?.side||'?').toUpperCase()),lev=Number(x?.leverage),mark=Number(x?.markPrice),liq=Number(x?.liquidationPrice);
    return '<div><span>'+asset+' '+side+'</span><b>'+(Number.isFinite(lev)?lev+'x':'—')+'</b><small>MARK '+(h.money?.(mark)||'—')+' · LIQ '+(h.money?.(liq)||'—')+'</small></div>';
  }).join(''):cards;
  if(compact)return '<details class="v10-account-position-layer command-position-details"><summary><span>ACCOUNT FUTURES</span><b>'+p.rows.length+' POSITION(S) · '+esc(p.age)+'</b></summary><div class="command-position-details-body"><div class="v10-live-overview">'+body+'</div>'+(p.rows.length>shown?'<small>+'+(p.rows.length-shown)+' weitere Position(en) im BOTS-Tab.</small>':'')+'</div></details>';
  return '<section class="v10-account-position-layer"><div class="section-title"><h2>PIONEX ACCOUNT POSITIONS</h2><small>READ-ONLY · '+esc(p.age)+' · '+p.rows.length+' POSITION(S) · NICHT BOT-GEMATCHT</small></div><div class="v10-pair-stack">'+body+'</div></section>';
}
function walletDiscoveryHealth(){
  const s=S(),account=s?.pionexAccount||{},sync=s?.pionexAccountSync||{},wallet=account?.wallet||{},status=String(account?.walletStatus||'UNKNOWN'),ts=Date.parse(String(account.updatedAt||account.snapshotAt||'')),future=Number.isFinite(ts)&&ts>Date.now()+5*60*1000,ageMs=Number.isFinite(ts)?Math.max(0,Date.now()-ts):null,fresh=String(sync.status||'UNKNOWN')==='OK'&&status==='OK'&&!future&&ageMs!=null&&ageMs<=15*60*1000,h=H(),age=future?'FUTURE TIMESTAMP':ageMs!=null?(h.ageText?.(ageMs)||'—'):'NO TIMESTAMP';
  const label=status==='OK'?(fresh?'LIVE':'STALE'):status==='ERROR'?'ERROR':'WAIT',tone=label==='LIVE'?'safe':label==='ERROR'?'danger':'watch';
  return{status,label,tone,wallet,probe:account?.walletBotProbe||null,risk:account?.walletBotRisk||null,fresh,age,error:account?.walletError||null};
}
function walletDiscoveryLayer(){return walletDiscoveryLayerMode(false)}
function walletDiscoveryLayerCompact(){return walletDiscoveryLayerMode(true)}
function walletDiscoveryLayerMode(compact=false){
  const w=walletDiscoveryHealth(),rows=Array.isArray(w.wallet?.botCategories)?w.wallet.botCategories:[],probe=w.probe||{},risk=w.risk||{},h=H();
  const walletAmount=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const walletTotal=walletAmount(w.wallet?.totalInUsdt),botTotal=walletAmount(w.wallet?.botAccountTotalInUsdt),traderTotal=walletAmount(w.wallet?.traderAccountTotalInUsdt);
  const walletMoney=v=>v==null?'—':(h.money?.(v)||String(v));
  if(w.status==='ERROR')return '<section class="v10-live-blocked v10-wallet-discovery"><b>BOT ACCOUNT API ERROR</b><small>'+esc(String(w.error||'Pionex Wallet API nicht verfügbar').slice(0,160))+' · Futures POSITION API bleibt davon unabhängig.</small></section>';
  if(w.status!=='OK')return '<section class="v10-live-blocked v10-wallet-discovery"><b>BOT ACCOUNT API WAIT</b><small>Wallet/Bot-Account-Read noch nicht verfügbar · Positionslayer bleibt separat.</small></section>';
  const cards=rows.map(x=>{
    const fields=Array.isArray(x?.entryFields)&&x.entryFields.length?x.entryFields.join(', '):'keine List-Felder',count=Number.isFinite(Number(x?.count))?Number(x.count):Number(x?.listCount)||0;
    return '<div><span>'+esc(String(x?.type||x?.title||'CATEGORY').toUpperCase())+'</span><b>'+count+' gemeldet · '+(Number(x?.listCount)||0)+' geladen</b><small>FELDER '+esc(fields)+'</small></div>';
  }).join('');
  const counts=obj=>Object.entries(obj||{}).map(([k,v])=>esc(k)+' '+Number(v||0)).join(' · ')||'—';
  const success=Number(probe.successCount||0),candidates=Number(probe.candidateCount||0),fail=Number(probe.failureCount||0),probeTone=candidates&&success===candidates?'safe':success>0?'watch':'muted',supported=Number(risk.supportedRows||0),normalized=Number(risk.normalizedRows||risk.botCount||0),rejected=Number(risk.rejectedCount||0),pnlUsdRows=Number(risk.pnlUsdRows||0),walletProfitRows=Number(risk.walletProfitRows||0),riskComplete=risk.detailsComplete===true,riskTone=riskComplete?'safe':normalized>0?'watch':'danger';
  const envFields=Array.isArray(risk.detailEnvelopeFields)&&risk.detailEnvelopeFields.length?risk.detailEnvelopeFields.join(', '):'—',dataFields=Array.isArray(risk.detailBotDataFields)&&risk.detailBotDataFields.length?risk.detailBotDataFields.join(', '):'—';
  const technical='<div class="v10-wallet-categories"><div><span>BUORDERTYPE</span><b>'+counts(w.wallet?.botBuOrderTypeCounts)+'</b><small>Private IDs bleiben verborgen</small></div><div><span>CATETYPE</span><b>'+counts(w.wallet?.botCateTypeCounts)+'</b><small>FUTURE_GRID_COIN_MARGINED = Coin-M Futures Grid</small></div><div><span>DETAIL ERFOLG CATETYPE</span><b>'+counts(probe.successCateTypeCounts)+'</b><small>Nur erfolgreiche read-only Detailreads</small></div><div><span>RISK STATUS</span><b>'+counts(risk.statusCounts)+'</b><small>RAW API TREND '+counts(risk.trendCounts)+'</small></div><div><span>PNL SOURCES</span><b>'+counts(risk.pnlSourceCounts)+'</b><small>Inverse-PnL wird nur mit passendem Investment-Token × Pionex Wallet USD-Preis normalisiert.</small></div><div><span>NORMALIZER STAGES</span><b>TYPE '+Number(risk.typePassCount||0)+'/'+supported+' · STATUS '+Number(risk.statusPassCount||0)+'/'+supported+'</b><small>SYMBOL '+Number(risk.symbolPassCount||0)+'/'+supported+' · SIDE '+Number(risk.sidePassCount||0)+'/'+supported+' · ALL '+Number(risk.allStagePassCount||0)+'/'+supported+'</small></div><div><span>ASSET CLASS</span><b>BASE '+counts(risk.baseClassCounts)+'</b><small>QUOTE '+counts(risk.quoteClassCounts)+'</small></div><div><span>REJECT REASONS</span><b>'+counts(risk.rejectReasonCounts)+'</b><small>MISSING RAW BASE '+Number(risk.missingBaseCount||0)+'</small></div><div><span>DETAIL FIELDS</span><b>'+esc(envFields)+'</b><small>BOT DATA '+esc(dataFields)+'</small></div></div>'+(cards?'<div class="v10-wallet-categories">'+cards+'</div>':'');
  if(compact){
    const details='<details class="v10-command-tech-details"><summary><span>TECHNISCHE DETAILS</span><b>'+esc(w.age)+' · '+Number(w.wallet?.botEntryCount||0)+' BOTS · PROBE '+success+'/'+candidates+'</b></summary><div class="v10-command-tech-details-body"><div class="guard-grid"><div><span>TRADER ACCOUNT</span><b>'+walletMoney(traderTotal)+'</b></div><div><span>KATEGORIEN</span><b>'+Number(w.wallet?.botCategoryCount||0)+'</b></div><div><span>BOT-EINTRÄGE</span><b>'+Number(w.wallet?.botEntryCount||0)+'</b></div><div><span>DETAIL PROBE</span><b class="tone-'+probeTone+'">'+success+'/'+candidates+'</b><small>'+fail+' fehlgeschlagen</small></div></div>'+technical+'<small>Read-only Diagnose. Keine Safety-Regel wurde gelockert; Wallet-Bots werden erst bei vollständiger Normalisierung als Live-Quelle gewählt.</small></div></details>';
    return '<section class="v10-data-guard v10-wallet-discovery command-compact"><div class="guard-head"><div><span>BOT ACCOUNT API</span><b>PIONEX WALLET + BOTS</b></div><strong class="tone-'+w.tone+'">'+esc(w.label)+'</strong></div><div class="guard-grid wallet-total-grid"><div><span>WALLET TOTAL</span><b>'+walletMoney(walletTotal)+'</b><small>'+esc(w.age)+'</small></div><div><span>BOT ACCOUNT</span><b>'+walletMoney(botTotal)+'</b><small>botAccount.totalInUsdt</small></div><div><span>RISK NORMALIZED</span><b class="tone-'+riskTone+'">'+normalized+'/'+supported+'</b><small>'+rejected+' verworfen · '+(riskComplete?'COMPLETE':'BLOCKED')+'</small></div><div><span>PNL USD READY</span><b class="tone-'+(pnlUsdRows===supported&&supported?'safe':'watch')+'">'+pnlUsdRows+'/'+supported+'</b><small>Wallet profit '+walletProfitRows+'/'+supported+'</small></div></div>'+details+'</section>';
  }
  return '<section class="v10-data-guard v10-wallet-discovery"><div class="guard-head"><div><span>BOT ACCOUNT API</span><b>WALLET + DETAIL DISCOVERY</b></div><strong class="tone-'+w.tone+'">'+esc(w.label)+'</strong></div><div class="guard-grid wallet-total-grid"><div><span>WALLET TOTAL</span><b>'+walletMoney(walletTotal)+'</b><small>totalInUsdt · portfolio candidate</small></div><div><span>BOT ACCOUNT</span><b>'+walletMoney(botTotal)+'</b><small>botAccount.totalInUsdt</small></div><div><span>TRADER ACCOUNT</span><b>'+walletMoney(traderTotal)+'</b><small>traderAccount.totalInUsdt</small></div><div><span>WALLET AGE</span><b>'+esc(w.age)+'</b><small>PIONEX WALLET READ API</small></div></div><div class="guard-grid"><div><span>KATEGORIEN</span><b>'+Number(w.wallet?.botCategoryCount||0)+'</b></div><div><span>BOT-EINTRÄGE GELADEN</span><b>'+Number(w.wallet?.botEntryCount||0)+'</b></div><div><span>DETAIL PROBE</span><b class="tone-'+probeTone+'">'+success+'/'+candidates+'</b><small>'+fail+' fehlgeschlagen</small></div><div><span>RISK NORMALIZED</span><b class="tone-'+riskTone+'">'+normalized+'/'+supported+'</b><small>'+rejected+' verworfen · '+(riskComplete?'COMPLETE':'BLOCKED')+'</small></div><div><span>PNL USD READY</span><b class="tone-'+(pnlUsdRows===supported&&supported?'safe':'watch')+'">'+pnlUsdRows+'/'+supported+'</b><small>Wallet profit '+walletProfitRows+'/'+supported+'</small></div></div>'+technical+'<small>Read-only Diagnose. Keine Safety-Regel wurde gelockert; Wallet-Bots werden erst bei vollständiger Normalisierung als Live-Quelle gewählt.</small></section>';
}
function liveOverview(){
  const g=syncHealth(),h=H(),rows=g.fresh?(S()?.bots||[]).filter(b=>h.liveMatched?.(b)):[];
  if(!g.safetyReady)return '<section class="v10-live-blocked"><b>LIVE LAYER BLOCKED</b><small>Keine frischen verifizierten Safety-Daten. Asset Watch ist Referenz, nicht Live-Aktion.</small></section>';
  const exposureState=h.exposureIntegrity?.(),exposureComplete=exposureState?!!exposureState.complete:(g.coverageComplete&&rows.length>0&&rows.every(b=>h.liveInvestUsdAvailable?.(b))),long=exposureComplete?exposure(rows,'LONG'):null,short=exposureComplete?exposure(rows,'SHORT'):null,net=long!=null&&short!=null?long-short:null;
  const decisionRows=rows.filter(b=>h.decisionReadyBot?h.decisionReadyBot(b):(h.risk?.(b)!=null&&h.livePnlAvailable?.(b)&&intelFresh(S()?.assetIntel?.[b.symbol]))),plans=decisionRows.map(b=>h.profitLockPlan?.(b)).filter(Boolean),lock=plans.filter(p=>['LOCK20','LOCK25','LOCK50'].includes(p.code)).length,watch=plans.filter(p=>['WATCH','HEDGE'].includes(p.code)).length;
  return '<section class="v10-live-overview"><div><span>KNOWN LONG NOTIONAL</span><b>'+(long==null?'—':h.money?.(long))+'</b></div><div><span>KNOWN SHORT NOTIONAL</span><b>'+(short==null?'—':h.money?.(short))+'</b></div><div><span>KNOWN NET NOTIONAL</span><b>'+(net==null?'—':h.money?.(net))+'</b></div><div><span>SAFETY READY</span><b>'+g.safetyReady+'/'+g.matched+'</b></div><div><span>DECISION READY</span><b>'+g.decisionReady+'/'+g.matched+'</b></div><div><span>PROFIT WATCH / LOCK</span><b>'+(g.decisionReady?watch+' / '+lock:'— / —')+'</b></div><div><span>EXPOSURE</span><b class="tone-'+(exposureComplete?'safe':'watch')+'">'+(exposureComplete?'COMPLETE':'PARTIAL')+'</b></div></section>';
}
function snapshotBotLine(x){
  const h=H(),side=x.side||'LONG',sl=Number(x.sl)>0?' · SL '+h.money?.(x.sl):'',dm=Number(x.dynamicMargin)>0?' · DM '+Number(x.dynamicMargin).toLocaleString('de-DE',{maximumFractionDigits:8})+' '+x.symbol:'';
  return '<div class="snapshot-bot-line"><div><b>'+side+' · '+(x.leverage||'—')+'x</b><small>'+Number(x.investCoin||0).toLocaleString('de-DE',{maximumFractionDigits:8})+' '+x.symbol+'</small></div><span>BE '+h.money?.(x.be)+' · LIQ '+h.money?.(x.liq)+' · TP '+h.money?.(x.tp)+sl+dm+'</span></div>';
}
function snapshotDetails(openByDefault=false){
  const s=S(),refs=s?.referenceBots||[],manual=s?.pionexManual||[],okx=s?.okxDcaBots||[],stamp=s?.referenceSnapshotAt||'SNAPSHOT';
  if(!refs.length&&!manual.length&&!okx.length)return'';
  const pref=['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF'];
  const groups=[...new Set(refs.map(x=>x.symbol))].sort((a,b)=>(pref.indexOf(a)<0?999:pref.indexOf(a))-(pref.indexOf(b)<0?999:pref.indexOf(b))||a.localeCompare(b))
    .map(symbol=>{const rows=refs.filter(x=>x.symbol===symbol),l=rows.filter(x=>(x.side||'LONG')==='LONG').length,sh=rows.filter(x=>x.side==='SHORT').length;return '<section class="snapshot-asset"><div class="snapshot-asset-head"><b>'+symbol+'</b><span>'+l+' LONG · '+sh+' SHORT</span></div>'+rows.map(snapshotBotLine).join('')+'</section>'}).join('');
  const p=manual.map(x=>'<div class="snapshot-row"><b>'+x.symbol+' '+(x.side||'')+' · '+(x.leverage||'—')+'x</b><span>PIONEX MANUAL · REFERENCE</span></div>').join('');
  const o=okx.map(x=>'<div class="snapshot-row"><b>'+x.symbol+' '+(x.side||'')+' · '+(x.leverage||'—')+'x</b><span>OKX DCA · '+(x.snapshotAt||'SNAPSHOT')+'</span></div>').join('');
  return '<details class="v10-snapshot-details asset-watch-reference" '+(openByDefault?'open':'')+'><summary>ASSET WATCH SNAPSHOT · '+refs.length+' PIONEX BOTS</summary><div class="snapshot-meta"><b>27.09.2026 · ca. 19:47–19:52</b><span>'+stamp+'</span></div><div class="snapshot-assets">'+groups+'</div>'+(p||o?'<div class="snapshot-list">'+p+o+'</div>':'')+'<small>Autoritativer letzter Screenshot-Stand. Nur Referenz, solange BOT API nicht frisch ist · keine Risk-/Next-Action-Ableitung.</small></details>';
}
function commandDataStrip(){
  const g=syncHealth(),m=marketHealth(),br=botReadiness(g),mr=marketReadiness(m),s=S(),h=H(),refTs=Date.parse(String(s?.referenceSnapshotAt||'')),refAge=Number.isFinite(refTs)?h.ageText?.(Date.now()-refTs):'—',ps=s?.portfolio?.source||'INCOMPLETE',portfolioLabel=ps==='CANONICAL_MIXED'?'CANONICAL MIXED':ps==='CANONICAL_PARTIAL'?'CANONICAL PARTIAL':ps==='PRIVATE_CANONICAL_SNAPSHOT'?'PRIVATE SNAPSHOT':'INCOMPLETE',histDelta=Number(s?.portfolio?.historyDeltaUsd),histText=Number.isFinite(histDelta)?' · HIST Δ '+(h.money?.(histDelta)||histDelta.toFixed(2)):' · HIST Δ —',pionexAge=s?.portfolio?.pionexTimestampFuture?'FUTURE TS':s?.portfolio?.pionexTimestampKnown?(h.ageText?.(s.portfolio.pionexAgeMs)||'—'):'NO TIMESTAMP';
  return '<section class="command-source-strip"><div><span>MARKET</span><b class="tone-'+mr.tone+'">'+mr.label+'</b><small>'+esc(m.ageText)+' · '+m.freshAssets+'/'+m.totalAssets+' · '+m.staleAssets+' stale · '+m.missingAssets+' missing · '+esc(m.transport)+(m.error?' · '+esc(String(m.error).slice(0,90)):'')+'</small></div><div><span>BOT LAYER</span><b class="tone-'+br.tone+'">'+br.label+'</b><small>'+g.decisionReady+'/'+g.matched+' decision · '+esc(g.age)+'</small></div><div><span>ASSET WATCH</span><b>SNAPSHOT</b><small>'+esc(refAge||'—')+'</small></div><div><span>PORTFOLIO</span><b>'+portfolioLabel+'</b><small>Ledger auto + OKX ref + Pionex SSOT · PIONEX '+pionexAge+histText+' · stale Holdings fail-closed</small></div></section>';
}
function commandDataDisclosure(){
  const g=syncHealth(),m=marketHealth(),br=botReadiness(g),mr=marketReadiness(m),p=portfolioReadiness();
  return '<details class="command-source-details"><summary><div><span>DATA SOURCES</span><b>MKT '+esc(mr.label)+' · BOT '+esc(br.label)+' · PORTFOLIO '+esc(p.label)+'</b></div><small>Provenance, Asset Watch und Historie</small></summary>'+commandDataStrip()+'</details>';
}
function commandSystemDiagnostics(){
  const g=syncHealth(),w=walletDiscoveryHealth(),ph=accountPositionHealth(),ready=g.decisionComplete&&w.status==='OK'&&ph.status==='OK'&&ph.fresh,details=document.createElement('details');
  details.className='command-system-diagnostics';
  details.innerHTML='<summary><div><span>SYSTEM STATUS</span><b class="tone-'+(ready?'safe':'watch')+'">'+(ready?'READY':'CHECK')+'</b></div><small>BOT '+g.decisionReady+'/'+g.matched+' · WALLET '+esc(w.label)+' · FUTURES '+esc(ph.label)+'</small></summary><div class="command-system-diagnostics-body"></div>';
  const body=$('.command-system-diagnostics-body',details),live=document.createElement('div');live.innerHTML=liveOverview();const liveNode=live.firstElementChild;if(liveNode)body.append(liveNode);
  const guard=document.createElement('div');guard.innerHTML=dataGuardCard(true);const guardNode=guard.firstElementChild;if(guardNode)body.append(guardNode);
  const account=document.createElement('div');account.innerHTML=accountPositionLayer(true);const accountNode=account.firstElementChild;if(accountNode)body.append(accountNode);
  const wallet=document.createElement('div');wallet.innerHTML=walletDiscoveryLayerCompact();const walletNode=wallet.firstElementChild;if(walletNode)body.append(walletNode);
  return details;
}
function renderSystemHeader(){
  const g=syncHealth(),m=marketHealth(),mr=marketReadiness(m),br=botReadiness(g),market=$('#market-status'),bot=$('#data-status');
  const set=(el,textName,className,title)=>{if(!el)return;if(el.textContent!==textName)el.textContent=textName;if(el.className!==className)el.className=className;if(el.title!==title)el.title=title};
  set(market,'● MKT '+mr.label,'live '+mr.tone,(mr.label==='READY'?'Alle erwarteten Futures-Marktdaten frisch':mr.label==='PARTIAL'?'BTC frisch, aber Markt-Coverage unvollständig':'Marktdaten nicht frisch genug')+' · '+m.freshAssets+'/'+m.totalAssets);
  set(bot,'● BOT '+br.label,'live '+br.tone,g.detail);
}
function decorateA11y(){
  for(const el of [$('#market-status'),$('#data-status')])if(el)el.setAttribute('aria-live','polite');
  $$('.v10-shell button').forEach(b=>{if(!b.getAttribute('type'))b.type='button'});
  $$('.v10-live-blocked,.paper-cockpit-state,.paper-refresh-warning,.v10-unverified-note,.data-state-strip').forEach(el=>{el.setAttribute('role','status');el.setAttribute('aria-live','polite')});
  $$('#nav button').forEach(b=>{b.type='button';const label=$('span',b)?.textContent||'MERIDIAN';b.setAttribute('aria-label',label);if(b.classList.contains('active'))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
}

function selectHistoryAnchor(points,target,toleranceMs=15*60*1000){
  const xs=(Array.isArray(points)?points:[]).filter(x=>Number.isFinite(Number(x?.timestamp))&&Number.isFinite(Number(x?.totalUsd))&&Number(x.totalUsd)>=0&&String(x?.sourceStatus?.spot||'').startsWith('STRICT_'));
  if(!xs.length||!Number.isFinite(Number(target)))return null;
  const nearest=[...xs].sort((a,b)=>Math.abs(Number(a.timestamp)-Number(target))-Math.abs(Number(b.timestamp)-Number(target)))[0]||null;
  return nearest&&Math.abs(Number(nearest.timestamp)-Number(target))<=Math.max(0,Number(toleranceMs)||0)?nearest:null;
}
function historyDelta(windowMs){
  const s=S(),current=Number(s?.portfolio?.total),points=Array.isArray(s?.portfolioHistory?.points)?s.portfolioHistory.points:[];
  if(!(current>=0))return{available:false,delta:null,pct:null,ageMs:null};
  const target=Date.now()-windowMs,prior=selectHistoryAnchor(points,target);
  if(!prior||!(Number(prior.totalUsd)>0))return{available:false,delta:null,pct:null,ageMs:null};
  const delta=current-Number(prior.totalUsd);
  return{available:true,delta,pct:delta/Number(prior.totalUsd)*100,ageMs:Date.now()-Number(prior.timestamp),anchorOffsetMs:Number(prior.timestamp)-target};
}
function deltaHtml(d,label){
  if(!d.available)return '<div><span>'+label+'</span><b>—</b><small>noch keine volle Vergleichsperiode</small></div>';
  const tone=d.delta>0?'safe':d.delta<0?'danger':'muted',sign=d.delta>0?'+':'';
  return '<div><span>'+label+'</span><b class="tone-'+tone+'">'+sign+fmt(d.pct,2)+'%</b><small>'+sign+H().money?.(d.delta)+'</small></div>';
}
const PORTFOLIO_CHART_WINDOWS=Object.freeze({ '1h':60*60*1000,'1d':24*60*60*1000,'1w':7*24*60*60*1000 });
function strictPortfolioHistoryPoints(){
  const rows=Array.isArray(S()?.portfolioHistory?.points)?S().portfolioHistory.points:[],now=Date.now()+30000;
  const clean=rows.filter(x=>{
    const ts=Number(x?.timestamp),spot=Number(x?.spotUsd),trading=Number(x?.tradingUsd),total=Number(x?.totalUsd);
    return Number.isFinite(ts)&&ts<=now&&Number.isFinite(spot)&&spot>=0&&Number.isFinite(trading)&&trading>=0&&Number.isFinite(total)&&total>=0&&Math.abs(total-(spot+trading))<=1&&String(x?.sourceStatus?.spot||'')==='STRICT_AUTHORITY';
  }).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
  const unique=[];for(const x of clean){if(unique.length&&Number(unique.at(-1).timestamp)===Number(x.timestamp))unique[unique.length-1]=x;else unique.push(x)}
  return unique;
}
function downsamplePortfolioSeries(rows,maxPoints=180){
  const xs=Array.isArray(rows)?rows:[];if(xs.length<=maxPoints)return xs;
  const out=[xs[0]],step=(xs.length-1)/(maxPoints-1);
  for(let i=1;i<maxPoints-1;i++)out.push(xs[Math.min(xs.length-2,Math.round(i*step))]);
  out.push(xs.at(-1));return out;
}
function portfolioChartSeries(range=portfolioChartUi.range){
  const key=PORTFOLIO_CHART_WINDOWS[range]?range:'1d',windowMs=PORTFOLIO_CHART_WINDOWS[key],now=Date.now(),start=now-windowMs,strict=strictPortfolioHistoryPoints(),p=S()?.portfolio||{};
  let rows=strict.filter(x=>Number(x.timestamp)>=start&&Number(x.timestamp)<=now+30000);
  const anchor=selectHistoryAnchor(strict,start,15*60*1000);
  if(anchor&&!rows.some(x=>Number(x.timestamp)===Number(anchor.timestamp)))rows.unshift(anchor);
  const current=Number(p.total),currentIncluded=p.complete===true&&Number.isFinite(current)&&current>=0;
  if(currentIncluded){
    const last=rows.at(-1),lastTs=Number(last?.timestamp);
    const point={timestamp:now,totalUsd:current,spotUsd:Number(p.spot),tradingUsd:Number(p.pionex),sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY'},_current:true};
    if(Number.isFinite(lastTs)&&Math.abs(now-lastTs)<=5*60*1000)rows[rows.length-1]=point;else rows.push(point);
  }
  rows=rows.filter(x=>Number(x.timestamp)>=start-15*60*1000).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
  return{key,windowMs,start,now,currentIncluded,rows:downsamplePortfolioSeries(rows)};
}
function portfolioChartGeometry(rows){
  const xs=Array.isArray(rows)?rows:[];if(xs.length<2)return null;
  const width=1000,height=260,padX=16,padY=18,t0=Number(xs[0].timestamp),t1=Number(xs.at(-1).timestamp),vals=xs.map(x=>Number(x.totalUsd)),rawMin=Math.min(...vals),rawMax=Math.max(...vals),rawSpan=rawMax-rawMin,baseSpan=rawSpan>0?rawSpan:Math.max(1,rawMax*.01),min=rawMin-baseSpan*.08,max=rawMax+baseSpan*.08,span=max-min;
  if(!(Number.isFinite(t0)&&Number.isFinite(t1)&&t1>t0&&Number.isFinite(span)&&span>0))return null;
  const coords=xs.map(x=>({x:padX+(Number(x.timestamp)-t0)/(t1-t0)*(width-padX*2),y:padY+(max-Number(x.totalUsd))/span*(height-padY*2)}));
  const line=coords.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' '),first=coords[0],last=coords.at(-1),baseY=height-padY,area=line+' L '+last.x.toFixed(1)+' '+baseY+' L '+first.x.toFixed(1)+' '+baseY+' Z';
  return{width,height,line,area,rawMin,rawMax};
}
function portfolioChartTimeLabel(ts,range){
  const d=new Date(Number(ts));if(!Number.isFinite(d.getTime()))return'—';
  try{return new Intl.DateTimeFormat('de-DE',range==='1w'?{day:'2-digit',month:'2-digit'}:{hour:'2-digit',minute:'2-digit'}).format(d)}catch{return'—'}
}
function portfolioChartModel(range=portfolioChartUi.range){
  const series=portfolioChartSeries(range),rows=series.rows,geometry=portfolioChartGeometry(rows),first=rows[0],last=rows.at(-1),firstVal=Number(first?.totalUsd),lastVal=Number(last?.totalUsd),delta=Number.isFinite(firstVal)&&firstVal>0&&Number.isFinite(lastVal)?lastVal-firstVal:null,startCovered=Number.isFinite(Number(first?.timestamp))&&Math.abs(Number(first.timestamp)-series.start)<=15*60*1000,endCovered=series.currentIncluded||(Number.isFinite(Number(last?.timestamp))&&series.now-Number(last.timestamp)<=15*60*1000),deltaAvailable=delta!=null&&startCovered&&endCovered,pct=deltaAvailable?delta/firstVal*100:null;
  return{...series,geometry,delta:deltaAvailable?delta:null,pct,deltaAvailable,startCovered,endCovered,points:rows.length,first,last};
}
function portfolioChartRangeLabel(range){return range==='1h'?'1H':range==='1w'?'1W':'1D'}
// Legacy Command semantic contract: GESAMTVERMÖGEN is now rendered as the dominant GESAMTPORTFOLIO hero.
function portfolioChartHeroHtml(){
  const s=S(),p=s?.portfolio||{},h=H(),range=PORTFOLIO_CHART_WINDOWS[portfolioChartUi.range]?portfolioChartUi.range:'1d',m=portfolioChartModel(range),strictHistory=strictPortfolioHistoryPoints(),storedPoints=strictHistory.length,total=Number(p.total),ready=p.complete===true&&Number.isFinite(total)&&total>=0,totalText=ready?(h.money?.(total)||String(total)):'—',tone=!m.deltaAvailable?'muted':m.delta>0?'safe':m.delta<0?'danger':'muted',sign=m.delta!=null&&m.delta>0?'+':'',rangeLabel=portfolioChartRangeLabel(range),historySource=String(s?.portfolioHistory?.source||'STRICT HISTORY').replaceAll('_',' ');
  const ageLabel=ms=>Number.isFinite(Number(ms))?(h.ageText?.(Math.max(0,Number(ms)))||'—'):'—',okxTs=Date.parse(String(p.okxVenueUpdatedAt||'')),okxAge=Number.isFinite(okxTs)?Math.max(0,Date.now()-okxTs):null;
  const sourceMoney=v=>Number.isFinite(Number(v))?(h.money?.(Number(v))||String(v)):'—',sourceCard=(label,value,detail,toneName='safe')=>'<div class="portfolio-venue-card tone-'+toneName+'"><span>'+esc(label)+'</span><b>'+sourceMoney(value)+'</b><small>'+esc(detail)+'</small></div>';
  const ledgerDetail=p.ledgerAutoUsd!=null?'AUTHORITY · '+ageLabel(p.ledgerAutoAgeMs):'AUTHORITY FEHLT',okxDetail=p.okxVenueUsd!=null?(String(p.okxVenueSource||'SERVER_PORTFOLIO_AUTHORITY').includes('SERVER')?'SERVER AUTH':'AUTHORITY')+' · '+ageLabel(okxAge):'AUTHORITY FEHLT',pionexDetail=p.pionex!=null?String(p.pionexSource||'PIONEX').replaceAll('_',' ')+' · '+ageLabel(p.pionexAgeMs):'FEHLT';
  const venueStrip='<div class="portfolio-venue-strip">'+sourceCard('LEDGER',p.ledgerAutoUsd,ledgerDetail,p.ledgerAutoUsd!=null?'safe':'danger')+sourceCard('OKX',p.okxVenueUsd,okxDetail,p.okxVenueUsd!=null?'safe':'danger')+sourceCard('PIONEX',p.pionex,pionexDetail,p.pionex!=null?'safe':'danger')+'</div>';
  const buttons=['1h','1d','1w'].map(key=>'<button type="button" data-portfolio-range="'+key+'" aria-pressed="'+(key===range?'true':'false')+'" class="'+(key===range?'active':'')+'">'+portfolioChartRangeLabel(key)+'</button>').join('');
  const bootstrap=storedPoints===0?(ready?'STARTPUNKT WIRD GESPEICHERT':'HISTORIE WARTET AUF PORTFOLIO AUTHORITY'):storedPoints===1?'1. MESSPUNKT GESPEICHERT · KURVE STARTET MIT DEM NÄCHSTEN':'';
  const change=m.deltaAvailable?'<b class="tone-'+tone+'">'+sign+fmt(m.pct,2)+'%</b><small>'+sign+(h.money?.(m.delta)||fmt(m.delta,2))+' · '+m.points+' PUNKTE</small>':'<b class="tone-muted">—</b><small>'+(m.points>=2?'TEILVERLAUF · ZEITFENSTER NICHT VOLL':bootstrap)+'</small>';
  const historyAge=Number.isFinite(Number(p.historyAgeMs))?ageLabel(p.historyAgeMs):'—',historyBadge='<div class="portfolio-history-status"><span>HISTORY</span><b>'+storedPoints+' PUNKTE</b><small>'+esc(storedPoints?historyAge:'START')+'</small></div>';
  let chart='<div class="portfolio-chart-empty portfolio-chart-bootstrap"><b>'+esc(bootstrap||'VERLAUF NOCH NICHT VERFÜGBAR')+'</b><small>'+(ready?'Kanonische History läuft automatisch weiter. Spätestens mit dem nächsten Messpunkt wird die Kurve sichtbar.':'Es werden ausschließlich vollständige STRICT_AUTHORITY-Punkte gezeichnet.')+'</small>'+(storedPoints===1?'<div class="portfolio-history-progress"><span class="done"></span><span></span><em>1 / 2</em></div>':'')+'</div>';
  if(m.geometry){
    const g=m.geometry,minLabel=h.money?.(g.rawMin)||fmt(g.rawMin,2),maxLabel=h.money?.(g.rawMax)||fmt(g.rawMax,2),startLabel=portfolioChartTimeLabel(m.first?.timestamp,range),endLabel=portfolioChartTimeLabel(m.last?.timestamp,range);
    chart='<div class="portfolio-chart-plot"><svg viewBox="0 0 '+g.width+' '+g.height+'" preserveAspectRatio="none" role="img" aria-label="Gesamtportfolio Verlauf '+rangeLabel+'"><line class="portfolio-chart-grid" x1="16" y1="18" x2="984" y2="18"></line><line class="portfolio-chart-grid" x1="16" y1="130" x2="984" y2="130"></line><line class="portfolio-chart-grid" x1="16" y1="242" x2="984" y2="242"></line><path class="portfolio-chart-area" d="'+g.area+'"></path><path class="portfolio-chart-line" d="'+g.line+'"></path></svg><div class="portfolio-chart-axis"><span>'+esc(startLabel)+'</span><span>'+esc(minLabel)+' – '+esc(maxLabel)+'</span><span>'+esc(endLabel)+'</span></div></div>';
  }
  return '<section class="command-portfolio-hero"><div class="portfolio-hero-primary"><div><span>GESAMTPORTFOLIO</span><strong>'+totalText+'</strong><small>'+(ready?'KANONISCHER VENUE-TOTAL · LEDGER + OKX + PIONEX':'AUTHORITY UNVOLLSTÄNDIG · GESAMTWERT BEWUSST AUSGEBLENDET')+'</small></div><div class="portfolio-range-switch" role="group" aria-label="Portfolio Verlauf">'+buttons+'</div></div>'+venueStrip+'<div class="portfolio-chart-meta"><div><span>'+rangeLabel+' VERLAUF</span>'+change+'</div><div class="portfolio-chart-meta-right">'+historyBadge+'<small>'+esc(historySource)+' · '+(m.currentIncluded?'AKTUELLER TOTAL EINGEBUNDEN':'NUR VALIDIERTE HISTORIE')+'</small></div></div>'+chart+'</section>';
}
function bindCommandPortfolioHero(view){
  view.querySelectorAll('[data-portfolio-range]').forEach(btn=>btn.addEventListener('click',()=>{
    const next=String(btn.dataset.portfolioRange||'').toLowerCase();if(!PORTFOLIO_CHART_WINDOWS[next]||next===portfolioChartUi.range)return;
    portfolioChartUi.range=next;const current=$('.command-portfolio-hero',view);if(!current)return;
    const box=document.createElement('div');box.innerHTML=portfolioChartHeroHtml();current.replaceWith(box.firstElementChild);bindCommandPortfolioHero(view);
  }));
}
function commandOverviewHtml(){
  const s=S(),h=H(),p=s?.portfolio||{},g=syncHealth(),m=marketHealth(),crit=criticalPair(),d24=historyDelta(24*60*60*1000),d7=historyDelta(7*24*60*60*1000);
  const risk=crit?.status||{label:'SYNC',tone:'muted',reason:'Noch keine bewertbare Bot-Priorität'};
  const portfolioReady=p.complete===true,feedReady=g.decisionComplete&&m.coverageComplete;
  const dataTone=feedReady?'safe':g.fresh||m.fresh?'watch':'danger',dataLabel=feedReady?'READY':g.fresh||m.fresh?'PARTIAL':'STALE';
  // DATA FRESHNESS semantic contract: LIVE DATA covers feed freshness only; portfolio authority remains separate.
  const cards='<section class="command-kpi-grid">'+deltaHtml(d24,'24H Δ')+deltaHtml(d7,'7T Δ')+'<div><span>RISK STATUS</span><b class="tone-'+esc(risk.tone)+'">'+esc(risk.label)+'</b><small>'+esc(crit?.symbol||'Portfolio')+'</small></div><div><span>LIVE DATA</span><b class="tone-'+dataTone+'">'+dataLabel+'</b><small>MKT '+m.freshAssets+'/'+m.totalAssets+' · BOT '+g.decisionReady+'/'+g.matched+'</small></div></section>';
  return '<section class="command-overview-v2">'+cards+'</section>';
}
function commandAttentionHtml(){
  const s=S(),p=s?.portfolio||{},g=syncHealth(),m=marketHealth(),crit=criticalPair(),portfolioReady=p.complete===true,items=[];
  if(!portfolioReady)items.push({tone:'danger',title:'PORTFOLIO AUTHORITY',detail:portfolioAuthorityDetail(p)});
  if(crit&&['LIQ_RISK','PROTECTION_RISK','RISK_REVIEW','UNVERIFIED','DATA_STALE','MARKET_STALE'].includes(crit.status.code))items.push({tone:crit.status.tone,title:(crit.symbol||'BOT')+' · '+crit.status.label,detail:crit.status.reason});
  if(!g.decisionComplete)items.push({tone:'watch',title:'BOT COVERAGE',detail:g.decisionReady+'/'+g.matched+' decision-ready · '+g.unmatched+' unmatched'+(g.ambiguous?' · '+g.ambiguous+' ambiguous':'')});
  if(!m.coverageComplete)items.push({tone:'watch',title:'MARKET COVERAGE',detail:m.freshAssets+'/'+m.totalAssets+' frisch · '+m.staleAssets+' stale · '+m.missingAssets+' missing'});
  const shown=items.slice(0,3);
  return '<section class="command-attention"><div class="section-title"><h2>ATTENTION</h2><small>maximal drei Punkte · Safety und Datenqualität zuerst</small></div>'+(shown.length?shown.map(x=>'<article class="attention-row tone-'+x.tone+'"><b>'+esc(x.title)+'</b><small>'+esc(x.detail)+'</small></article>').join(''):'<article class="attention-row tone-safe"><b>KEIN KRITISCHER PUNKT</b><small>Portfolio-, Bot- und Marktquellen sind aktuell ohne priorisierten Blocker.</small></article>')+'</section>';
}
function commandActionHubHtml(){
  const p=portfolioReadiness(),b=botStateItem(),m=marketStateItem(),paper=paperReadiness(),crit=criticalPair(),asset=crit&&marketUniverse().includes(String(crit.symbol||'').toUpperCase())?String(crit.symbol).toUpperCase():null,next=nextAction();
  const item=(target,kicker,label,detail,tone='muted')=>'<button type="button" class="command-hub-card tone-'+esc(tone)+'" data-command-go="'+esc(target)+'"><span>'+esc(kicker)+'</span><b>'+esc(label)+'</b><small>'+esc(detail)+'</small></button>';
  const nextHtml=asset?'<button type="button" class="command-next-decision command-next-action-open" data-command-asset="'+esc(asset)+'" aria-label="CRITICAL ASSET '+esc(asset)+' · '+esc(crit.status.label)+'"><span>NEXT ACTION</span><b>'+esc(next.title)+'</b><small>'+esc(next.detail)+'</small></button>':'<div class="command-next-decision"><span>NEXT ACTION</span><b>'+esc(next.title)+'</b><small>'+esc(next.detail)+'</small></div>';
  return '<section class="command-action-hub"><div class="section-title"><h2>NEXT / OPEN</h2><small>Priorität + Navigation · read-only · keine Trading-Aktion</small></div>'+nextHtml+'<div class="command-action-grid">'+
    item('depot','DEPOT',p.label,p.detail,p.tone)+
    item('bots','BOT CONTROL',b.label,b.detail,b.tone)+
    item('market','FORECAST',m.label,m.detail,m.tone)+
    item('paper','PAPER COCKPIT',paper.label,paper.detail,paper.tone)+
  '</div></section>';
}
function bindCommandActionHub(view){
  $$('[data-command-go]',view).forEach(btn=>btn.addEventListener('click',()=>{
    const target=String(btn.dataset.commandGo||'');
    if(target==='paper'){showSecondaryView('paper','research',{returnView:'command',navKey:'command',label:'COMMAND'});return}
    $('#nav button[data-v="'+target+'"]')?.click();
  }));
  $('[data-command-asset]',view)?.addEventListener('click',e=>{const symbol=String(e.currentTarget?.dataset?.commandAsset||'').toUpperCase();if(symbol)openAssetDetail(symbol,'command','command')});
}
function pionexDetailAssets(){
  const s=S(),account=s?.pionexAccount||{},prices=account?.wallet?.prices||{},rows=[...(account.spotBalances||[]),...(account.futuresBalances||[])],map=new Map();
  for(const row of rows){
    const symbol=String(row?.coin||'').trim().toUpperCase();if(!symbol)continue;
    const qty=Math.max(0,(Number(row?.free)||0)+(Number(row?.frozen)||0)-(Number(row?.debts)||0));if(!(qty>0))continue;
    const price=['USDT','USDC','USD'].includes(symbol)?1:Number(prices?.[symbol]?.priceInUsd);
    const value=Number.isFinite(price)&&price>0?qty*price:null,prev=map.get(symbol)||{symbol,quantity:0,valueUsd:0,valueKnown:true,venue:'Pionex',source:'READ API BALANCE'};
    prev.quantity+=qty;if(value==null)prev.valueKnown=false;else prev.valueUsd+=value;map.set(symbol,prev);
  }
  return [...map.values()].map(x=>({...x,valueUsd:x.valueKnown?x.valueUsd:null}));
}
function depotAssetRows(){
  const s=S(),p=s?.portfolio||{},map=new Map(),add=row=>{
    const symbol=String(row?.symbol||'').trim().toUpperCase();if(!symbol)return;
    const x=map.get(symbol)||{symbol,sources:[],valueUsd:0,valueKnown:false,botCount:0};
    x.sources.push(row);if(Number.isFinite(Number(row?.valueUsd))){x.valueUsd+=Number(row.valueUsd);x.valueKnown=true}map.set(symbol,x);
  };
  (p.ledgerAssets||[]).forEach(x=>add({...x,source:'LEDGER LIVE DETAIL'}));
  pionexDetailAssets().forEach(add);
  for(const symbol of symbols()){const x=map.get(symbol)||{symbol,sources:[],valueUsd:0,valueKnown:false,botCount:0};x.botCount=matchedRows(symbol).length;map.set(symbol,x)}
  return [...map.values()].sort((a,b)=>(b.valueKnown?b.valueUsd:-1)-(a.valueKnown?a.valueUsd:-1)||b.botCount-a.botCount||a.symbol.localeCompare(b.symbol));
}
function assetDetailButton(symbol,label='ASSET DETAIL'){
  return '<button type="button" class="asset-detail-open" data-asset-detail="'+esc(symbol)+'">'+esc(label)+'</button>';
}
function bindAssetDetailLinks(view,returnView='depot',navKey=returnView){
  $$('[data-asset-detail]',view).forEach(btn=>btn.addEventListener('click',e=>{
    e?.preventDefault?.();e?.stopPropagation?.();
    openAssetDetail(btn.dataset.assetDetail,returnView,navKey);
  }));
}
function openAssetDetail(symbol,returnView='depot',navKey=returnView){
  const key=String(symbol||'').trim().toUpperCase();if(!key)return;
  assetDetailUi.symbol=key;assetDetailUi.returnView=returnView;assetDetailUi.navKey=navKey;
  fibUi.symbol=key;fibUi.mode='AUTO';fibUi.manualHigh=null;fibUi.manualLow=null;persistUiContext();
  showSecondaryView('asset-detail',navKey,{returnView,navKey,label:VIEW_LABELS[returnView]||String(returnView).toUpperCase()});
}
function closeAssetDetail(){
  contextualBack('asset-detail',assetDetailUi.returnView||'depot',assetDetailUi.navKey||'depot');
}
function assetDetailHoldingHtml(symbol){
  const h=H(),p=S()?.portfolio||{},row=depotAssetRows().find(x=>x.symbol===symbol),known=row?.valueKnown?Number(row.valueUsd):null,share=known!=null&&Number(p.total)>0?known/Number(p.total)*100:null;
  const sources=row?.sources||[];
  const sourceRows=sources.length?sources.map(x=>'<div class="asset-detail-source"><span>'+esc(x.venue||'SOURCE')+'</span><b>'+(Number.isFinite(Number(x.valueUsd))?h.money?.(Number(x.valueUsd)):'—')+'</b><small>'+esc(x.quantity!=null?Number(x.quantity).toLocaleString('de-DE',{maximumFractionDigits:8})+' '+symbol:x.source||'Detail')+'</small></div>').join(''):'<div class="asset-detail-source"><span>DETAIL SOURCE</span><b>—</b><small>Kein autoritativer Asset-Bestand aus den verfügbaren Detailquellen.</small></div>';
  return '<section class="asset-detail-section"><div class="section-title"><h2>DEPOT + VENUES</h2><small>Detailwerte sind nicht der Portfolio-Total und werden nicht mit Bot-Exposure addiert</small></div><div class="asset-detail-holding-summary"><div><span>KNOWN DETAIL VALUE</span><b>'+(known==null?'—':h.money?.(known))+'</b></div><div><span>PORTFOLIO-ANTEIL</span><b>'+(share==null?'—':share.toFixed(1)+'%')+'</b></div><div><span>DETAILQUELLEN</span><b>'+sources.length+'</b></div></div><div class="asset-detail-sources">'+sourceRows+'</div></section>';
}
function assetDetailBotHtml(symbol){
  const h=H(),rows=matchedRows(symbol);
  if(!h.botFeedFresh?.())return '<section class="asset-detail-section"><div class="section-title"><h2>LIVE BOTS + RISK</h2><small>private Bot-Daten</small></div><section class="v10-live-blocked"><b>BOT DATA STALE</b><small>Keine Bot-Risk-Ableitung aus einem veralteten privaten Snapshot.</small></section></section>';
  if(!rows.length)return '<section class="asset-detail-section"><div class="section-title"><h2>LIVE BOTS + RISK</h2><small>private Bot-Daten</small></div><section class="v10-live-blocked"><b>KEIN LIVE BOT</b><small>Für '+esc(symbol)+' ist aktuell kein sicher gematchter privater Bot vorhanden.</small></section></section>';
  return '<section class="asset-detail-section"><div class="section-title"><h2>LIVE BOTS + RISK</h2><small>'+rows.length+' sicher gematchte Bot-Row(s) · bestehende Safety-Regeln unverändert</small></div>'+pairCard(symbol,false,true,false)+'</section>';
}
function assetDetailMarketHtml(symbol){
  const i=S()?.assetIntel?.[symbol],fresh=intelFresh(i);
  return '<section class="asset-detail-section"><div class="section-title"><h2>MARKT + OPPORTUNITY</h2><small>Kontext statt Renditeversprechen · geschlossene höhere Timeframes</small></div>'+forecastContextHtml(symbol)+(i?marketRow(symbol):'<section class="v10-live-blocked market-stale"><b>NO TECH DATA</b><small>Keine technische Historie für '+esc(symbol)+' geladen.</small></section>')+'<div class="asset-detail-fib-head"><span>FIB / SK MAP</span><small>'+(fresh?'frischer Markt-Kontext':'Markt-Kontext stale/fehlend · FIB kann separat laden')+'</small></div>'+fibMapHtml()+'</section>';
}
function renderAssetDetail(force=false){
  const view=$('#view-asset-detail');if(!view)return;
  if(!force&&$('.asset-detail-topbar',view))return;
  const symbol=String(assetDetailUi.symbol||'BTC').trim().toUpperCase();
  if(force&&fibUi.mode==='MANUAL'){
    const lo=fibParse($('#fib-low',view)?.value),hi=fibParse($('#fib-high',view)?.value),dir=$('#fib-direction',view)?.value;
    if(lo)fibUi.manualLow=lo;if(hi)fibUi.manualHigh=hi;if(dir)fibUi.direction=dir;
  }
  fibUi.symbol=symbol;
  const h=H(),row=depotAssetRows().find(x=>x.symbol===symbol),rows=matchedRows(symbol),mp=marketPrice(symbol),ctx=opportunityContext(symbol),st=rows.length?pairStatus(symbol):{label:'NO LIVE BOT',tone:'muted',reason:'Kein sicher gematchter privater Bot'},known=row?.valueKnown?Number(row.valueUsd):null;
  view.innerHTML='<section class="asset-detail-topbar"><button type="button" data-asset-back data-context-back="asset-detail">← '+esc(contextReturnLabel('asset-detail','ZURÜCK'))+'</button><div><span>ASSET DETAIL</span><b>'+esc(symbol)+'</b><small>Depot · Bots · Risk · Forecast · FIB/SK</small></div><strong class="tone-'+esc(st.tone)+'">'+esc(st.label)+'</strong></section>'+dataStateStripHtml('asset')+
    '<section class="asset-detail-hero"><div><span>MARKET</span><b>'+h.money?.(mp.value)+'</b><small>'+esc(mp.source)+'</small></div><div><span>KNOWN HOLDING DETAIL</span><b>'+(known==null?'—':h.money?.(known))+'</b><small>nicht mit Bot-Exposure addieren</small></div><div><span>LIVE BOTS</span><b>'+rows.length+'</b><small>'+esc(st.reason)+'</small></div><div><span>OPPORTUNITY QUALITY</span><b class="tone-'+esc(ctx.tone)+'">'+(ctx.available?ctx.score+'/100':'—')+'</b><small>'+(ctx.available?esc(ctx.label):'NO FRESH CONTEXT')+'</small></div></section>'+
    '<section class="asset-detail-accounting-guard"><b>READ-ONLY DETAIL</b><small>Holdings, Bot-Exposure und Markt-Kontext bleiben getrennte Ebenen. Keine Orders, keine automatische Promotion, keine Doppelzählung.</small></section>'+
    assetDetailHoldingHtml(symbol)+assetDetailBotHtml(symbol)+assetDetailMarketHtml(symbol);
  $('[data-asset-back]',view)?.addEventListener('click',closeAssetDetail);
  bindFibMap(view);
  const selector=$('#fib-asset',view);if(selector){selector.value=symbol;selector.disabled=true;selector.title='Asset ist im Asset Detail fixiert';}
}
function depotAssetCard(row,open=false){
  const h=H(),p=S()?.portfolio||{},share=row.valueKnown&&Number(p.total)>0?row.valueUsd/Number(p.total)*100:null,venues=[...new Set(row.sources.map(x=>x.venue).filter(Boolean))],mp=marketPrice(row.symbol);
  const sourceRows=row.sources.length?row.sources.map(x=>'<div class="depot-source-row"><span>'+esc(x.venue||'SOURCE')+'</span><b>'+(Number.isFinite(Number(x.valueUsd))?h.money?.(Number(x.valueUsd)):'—')+'</b><small>'+esc(x.quantity!=null?Number(x.quantity).toLocaleString('de-DE',{maximumFractionDigits:8})+' '+row.symbol: x.source||'Detail')+'</small></div>').join(''):'<div class="depot-source-row"><span>HOLDING DETAIL</span><b>—</b><small>Kein autoritativer Asset-Bestand verfügbar · Bot-Verknüpfung separat</small></div>';
  return '<details class="depot-asset-card" data-symbol="'+esc(row.symbol)+'" '+(open?'open':'')+'><summary><div class="depot-asset-id"><b>'+esc(row.symbol)+'</b><small>'+esc(venues.join(' + ')||'BOT LINK')+'</small></div><div class="depot-asset-glance"><span>HOLDING <b>'+(row.valueKnown?h.money?.(row.valueUsd):'—')+'</b></span><span>ANTEIL <b>'+(share==null?'—':share.toFixed(1)+'%')+'</b></span><span>BOTS <b>'+row.botCount+'</b></span></div><i class="asset-chevron" aria-hidden="true"></i></summary><div class="depot-asset-body"><div class="depot-market-row"><span>MARKET</span><b>'+h.money?.(mp.value)+'</b><small>'+esc(mp.source)+'</small></div>'+sourceRows+(row.botCount?'<div class="depot-bot-note"><b>'+row.botCount+' LIVE BOT'+(row.botCount===1?'':'S')+'</b><small>Bot-Exposure wird im BOTS-Tab bewertet und nicht zum Depotwert addiert.</small></div>':'')+'<div class="depot-asset-action">'+assetDetailButton(row.symbol)+'</div></div></details>';
}
// Legacy r69 semantic contract: CANONICAL VENUE TOTAL
function renderDepot(force=false){
  const view=$('#view-depot');if(!view)return;
  const openAssets=new Set($('.depot-asset-card[open]',view).map(x=>x.dataset.symbol).filter(Boolean)),had=!!$('.depot-asset-card',view),s=S(),h=H(),p=s?.portfolio||{},rows=depotAssetRows(),age=ms=>Number.isFinite(Number(ms))?(h.ageText?.(Math.max(0,Number(ms)))||'—'):'—',okxTs=Date.parse(String(p.okxVenueUpdatedAt||'')),okxAge=Number.isFinite(okxTs)?Math.max(0,Date.now()-okxTs):null;
  const okxSource=String(p.okxVenueSource||'SERVER_PORTFOLIO_AUTHORITY').includes('SERVER')?'SERVER AUTH':'AUTHORITY';
  const venue='<section class="depot-venue-grid"><div class="depot-total"><span>GESAMTPORTFOLIO</span><b>'+(p.complete?h.money?.(p.total):'—')+'</b><small>'+(p.complete?'KANONISCHER VENUE-TOTAL':'AUTHORITY UNVOLLSTÄNDIG')+'</small></div><div><span>LEDGER</span><b>'+(p.ledgerAutoUsd!=null?h.money?.(p.ledgerAutoUsd):'—')+'</b><small>'+(p.ledgerAutoActive?'AUTO · '+(p.ledgerAutoRows||0)+' ASSETS · '+age(p.ledgerAutoAgeMs):'BESTÄTIGUNG FEHLT')+'</small></div><div><span>OKX</span><b>'+(p.okxVenueUsd!=null?h.money?.(p.okxVenueUsd):'—')+'</b><small>'+(p.okxVenueUsd!=null?okxSource+' · '+age(okxAge):'AUTHORITY FEHLT')+'</small></div><div><span>PIONEX</span><b>'+(p.pionex!=null?h.money?.(p.pionex):'—')+'</b><small>'+(p.pionex!=null?esc(String(p.pionexSource||'PIONEX').replaceAll('_',' '))+' · '+age(p.pionexAgeMs):'FEHLT')+'</small></div></section>';
  const note='<details class="depot-accounting-details"><summary><div><span>ACCOUNTING GUARD</span><b>KEIN DOUBLE COUNTING</b></div><small>Details</small></summary><div class="depot-accounting-body">Asset-Karten zeigen verfügbare Detailquellen. Der Gesamtwert wird ausschließlich aus dem kanonischen Venue-SSOT gebildet; Bot-Exposure und Detail-Balances werden nicht doppelt addiert.</div></details>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="live"><div><span>DEPOT</span><b>PORTFOLIO + VENUE HOLDINGS</b></div><small>Gesamtwert zuerst · Assets kompakt · Details nur bei Bedarf</small></section>'+dataStateStripHtml('depot')+venue+note+'<section class="depot-assets-head"><div><span>ASSETS</span><b>'+rows.length+' ASSETS</b><small>Wertsortiert · Ledger + Pionex Detail · Bot-Verknüpfung separat</small></div><div class="asset-toggle-actions"><button type="button" data-depot-action="close">ALLE ZU</button><button type="button" data-depot-action="open">ALLE AUF</button></div></section><div class="depot-asset-stack">'+(rows.length?rows.map(row=>depotAssetCard(row,had?openAssets.has(row.symbol):false)).join(''):'<section class="v10-live-blocked"><b>DEPOT DETAILS NICHT VERFÜGBAR</b><small>Der kanonische Venue-Total bleibt maßgeblich; Detailquellen sind derzeit leer.</small></section>')+'</div>';
  const setOpen=open=>$('.depot-asset-card',view).forEach(x=>{x.open=open});
  $('[data-depot-action="open"]',view)?.addEventListener('click',()=>setOpen(true));
  $('[data-depot-action="close"]',view)?.addEventListener('click',()=>setOpen(false));
  bindAssetDetailLinks(view,'depot','depot');
}
function showSecondaryView(v,navKey='research',context=null,scrollY=0){
  const from=activeViewKey();
  if(context!==false&&['asset-detail','paper','more','market'].includes(v)&&from!==v){
    const meta=context&&typeof context==='object'?context:{},returnView=meta.returnView||from,returnNav=meta.navKey||activeNavKey();
    viewContextUi[v]={returnView,navKey:returnNav,label:meta.label||VIEW_LABELS[returnView]||String(returnView||'ZURÜCK').toUpperCase(),scrollY:Math.max(0,Number(window.scrollY)||0)};
  }
  $$('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+v));
  $$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.v===navKey));
  renderActiveView(v,true);decorateA11y();restoreViewport(scrollY);
}
let feedRefreshBusy=false;
async function refreshFeeds(){
  if(feedRefreshBusy)return;const btn=$('#refresh-feeds');feedRefreshBusy=true;
  if(btn){btn.disabled=true;btn.classList.add('busy');btn.querySelector('span').textContent='SYNC…'}
  try{await bridge()?.refreshNow?.();schedule(true)}
  finally{feedRefreshBusy=false;if(btn){btn.disabled=false;btn.classList.remove('busy');btn.querySelector('span').textContent='UPDATE'}}
}
function bindRefreshControl(){
  const btn=$('#refresh-feeds');if(btn&&!btn.dataset.bound){btn.dataset.bound='1';btn.addEventListener('click',refreshFeeds)}
}

function renderCommand(force=false){
  const view=$('#view-command');if(!view||!$('.portfolio-hero',view))return;
  const legacyCommandSelectors=['.risk-cockpit','.exposure-card','.manual-strip','.okx-strip','.risk-v2','.lock-radar','.quick-grid','.command-bots','.data-truth'];
  const legacyCommandPresent=legacyCommandSelectors.some(sel=>$(sel,view))||!$('.command-portfolio-hero',view);
  if(!force&&!legacyCommandPresent&&$('.command-source-strip',view)&&$('.v10-critical-wrap',view)&&$('.v10-data-guard',view))return;
  banner('#view-command','COMMAND','PORTFOLIO + RISK DECISION SUPPORT','Was braucht Aufmerksamkeit? Gesamtvermögen, Risiko und Datenstatus zuerst','live');
  dataGuardDecorate();
  view.querySelectorAll('.command-portfolio-hero,.data-state-strip,.command-overview-v2,.command-action-hub,.command-attention,.v10-critical-wrap,.command-system-diagnostics,.v10-data-guard,.v10-live-overview,.v10-live-blocked,.v10-account-position-layer,.v10-wallet-discovery,.command-source-details,.command-source-strip').forEach(x=>x.remove());
  const hero=$('.portfolio-hero',view),portfolioBox=document.createElement('div');portfolioBox.innerHTML=portfolioChartHeroHtml();const portfolioNode=portfolioBox.firstElementChild;$('.v10-mode-banner',view)?.insertAdjacentElement('afterend',portfolioNode);const stateBox=document.createElement('div');stateBox.innerHTML=dataStateStripHtml('command');const stateNode=stateBox.firstElementChild;portfolioNode.insertAdjacentElement('afterend',stateNode);const overview=document.createElement('div');overview.innerHTML=commandOverviewHtml();const overviewNode=overview.firstElementChild;stateNode.insertAdjacentElement('afterend',overviewNode);const hubWrap=document.createElement('div');hubWrap.innerHTML=commandActionHubHtml();const hubNode=hubWrap.firstElementChild;overviewNode.insertAdjacentElement('afterend',hubNode);const attentionWrap=document.createElement('div');attentionWrap.innerHTML=commandAttentionHtml();const attentionNode=attentionWrap.firstElementChild;hubNode.insertAdjacentElement('afterend',attentionNode);if(hero)hero.classList.add('command-source-authority');const c=criticalPair(),a=nextAction(),g=syncHealth(),source=document.createElement('div');source.innerHTML=commandDataDisclosure();const sourceNode=source.firstElementChild;
  (hero||overviewNode).insertAdjacentElement('afterend',sourceNode);
  const wrap=document.createElement('section');wrap.className='v10-critical-wrap';
  const realAsset=!!(c&&g.fresh&&matchedRows(c.symbol).length&&!['DATA_STALE','MARKET_STALE','UNVERIFIED'].includes(c.status.code)),criticalHtml=realAsset?pairCard(c.symbol,true):'<article class="asset-pair pair-compact blocked-critical"><div class="pair-head"><span class="asset-symbol">'+esc(c?.symbol||'BOT DATA')+'</span><b class="pair-status tone-muted">'+esc(c?.status.label||'BLOCKED')+'</b></div><div class="pair-reason">'+esc(c?.status.reason||'Keine frischen privaten Bot-Daten')+'</div></article>';
  wrap.innerHTML='<div class="section-title"><h2>'+(realAsset?'LIVE RISK PRIORITY':'LIVE BOT STATUS')+'</h2><small>Safety/Data Guard überstimmt Trading-Signal</small></div>'+criticalHtml;
  sourceNode.insertAdjacentElement('afterend',wrap);
  const action=$('.command-action',view);if(action)action.remove(); // NEXT ACTION is consolidated in the r80 Command Action Hub.
  const systemDiagnostics=commandSystemDiagnostics();wrap.insertAdjacentElement('afterend',systemDiagnostics);
  for(const sel of legacyCommandSelectors) $$(sel,view).forEach(x=>x.remove());
  $$('.section-title',view).filter(x=>['RISK PRIORITY','ASSET RISK MAP'].includes($('h2',x)?.textContent||'')).forEach(x=>x.remove());
  bindCommandActionHub(view);
  bindCommandPortfolioHero(view);
}
function assetWatchShareCard(){
  const h=H(),available=typeof h.manageAssetWatchShare==='function',msg=assetWatchShareUi.message||'Erstellt einen eigenen widerrufbaren Read-only-Link nur für den bereinigten Asset-Watch-Bot-Snapshot.';
  return '<section class="asset-watch-share-card"><div><span>ASSET WATCH API LINK</span><b class="tone-'+esc(assetWatchShareUi.tone)+'">'+(assetWatchShareUi.busy?'ARBEITET…':assetWatchShareUi.shareUrl?'AKTIV · LINK IM SPEICHER':'BEREIT')+'</b><small>'+esc(msg)+'</small></div><div class="asset-watch-share-actions"><button type="button" data-asset-watch-share="rotate" '+(!available||assetWatchShareUi.busy?'disabled':'')+'>'+(assetWatchShareUi.shareUrl?'NEUEN LINK ERSTELLEN':'LINK ERSTELLEN')+'</button><button type="button" data-asset-watch-share="copy" '+(!assetWatchShareUi.shareUrl||assetWatchShareUi.busy?'disabled':'')+'>LINK KOPIEREN</button><button type="button" data-asset-watch-share="revoke" '+(!available||assetWatchShareUi.busy?'disabled':'')+'>WIDERRUFEN</button></div><small>Der Link enthält einen separaten, auf Asset Watch begrenzten Token. Er erlaubt keine Trades und keinen Zugriff auf das übrige private Dashboard.</small></section>';
}
async function assetWatchShareAction(action){
  const h=H();
  if(typeof h.manageAssetWatchShare!=='function')return;
  if(action==='copy'){
    if(!assetWatchShareUi.shareUrl)return;
    try{await navigator.clipboard.writeText(assetWatchShareUi.shareUrl);assetWatchShareUi.message='Link in Zwischenablage kopiert.';assetWatchShareUi.tone='safe'}
    catch{assetWatchShareUi.message='Kopieren fehlgeschlagen. Link neu erstellen und Browser-Zugriff auf die Zwischenablage erlauben.';assetWatchShareUi.tone='watch'}
    renderBots(true);return;
  }
  assetWatchShareUi.busy=true;assetWatchShareUi.message=action==='revoke'?'Asset-Watch-Link wird widerrufen…':'Neuer Asset-Watch-Link wird erstellt…';assetWatchShareUi.tone='muted';renderBots(true);
  try{
    const result=await h.manageAssetWatchShare(action);
    if(action==='revoke'){
      assetWatchShareUi.shareUrl=null;assetWatchShareUi.message='Asset-Watch-Link widerrufen. Der bisherige Link ist ungültig.';assetWatchShareUi.tone='safe';
    }else{
      assetWatchShareUi.shareUrl=result?.shareUrl||null;
      if(!assetWatchShareUi.shareUrl)throw new Error('share_url_missing');
      try{await navigator.clipboard.writeText(assetWatchShareUi.shareUrl);assetWatchShareUi.message='Neuer Link erstellt und kopiert. Diesen Link nur für den MERIDIAN Asset Watch verwenden.';assetWatchShareUi.tone='safe'}
      catch{assetWatchShareUi.message='Link erstellt. Mit „LINK KOPIEREN“ in die Zwischenablage übernehmen.';assetWatchShareUi.tone='watch'}
    }
  }catch(e){
    assetWatchShareUi.message='Asset-Watch-Link fehlgeschlagen: '+String(e?.message||e).slice(0,100);assetWatchShareUi.tone='danger';
  }finally{assetWatchShareUi.busy=false;renderBots(true)}
}
function bindBotOverviewControls(view){
  const setOpen=open=>[...view.querySelectorAll('.asset-pair-details')].forEach(x=>{x.open=open});
  const openBtn=$('[data-assets-action="open"]',view),closeBtn=$('[data-assets-action="close"]',view);
  if(openBtn)openBtn.onclick=()=>setOpen(true);
  if(closeBtn)closeBtn.onclick=()=>setOpen(false);
  [...view.querySelectorAll('[data-bot-filter]')].forEach(btn=>{btn.onclick=()=>{botViewUi.filter=String(btn.dataset.botFilter||'ALL').toUpperCase();persistUiContext();renderBots(true)}});
  [...view.querySelectorAll('[data-asset-watch-share]')].forEach(btn=>{btn.onclick=()=>assetWatchShareAction(btn.dataset.assetWatchShare)});
  bindAssetDetailLinks(view,'bots','bots');
}
function renderBots(force=false){
  const view=$('#view-bots');if(!view)return;
  if(!force&&$('.asset-accordion-stack',view))return;
  if(!force&&!$('.bot-hero',view)&&!$('.bot-group',view))return;
  const hadAssetAccordion=!!$('.asset-pair-details',view),openAssets=new Set($$('.asset-pair-details[open]',view).map(x=>x.dataset.symbol).filter(Boolean));
  const snapshotOpen=force?$('.v10-snapshot-details',view)?.open:null,unmatchedOpen=force?$('.v10-unmatched-details',view)?.open:null,diagOpenExisting=$('.v10-bot-diagnostics',view)?.open;
  const s=S(),g=syncHealth(),ph=accountPositionHealth(),unmatched=g.unmatched,criticalSymbol=criticalPair()?.symbol;
  const allSyms=(g.fresh?symbols():[]).slice().sort((a,b)=>pairStatus(b).rank-pairStatus(a).rank||a.localeCompare(b)),syms=allSyms.filter(symbol=>botFilterMatch(symbol));
  const liveCards=syms.map(symbol=>pairCard(symbol,false,hadAssetAccordion?openAssets.has(symbol):symbol===criticalSymbol,true)).filter(Boolean).join('');
  const source=g.walletFeed?'WALLET DETAIL':g.status==='BOT_API_OK'||g.status==='OK'?'BOT API':g.status==='DISABLED_MISSING_CREDENTIALS'?'OFF':g.status.replaceAll('_',' '),healthy=g.matched===g.supported&&g.safetyReady===g.matched&&g.decisionReady===g.matched&&unmatched===0;
  const headCards='<div><span>OPEN FUTURES</span><b class="tone-'+ph.tone+'">'+esc(ph.label)+'</b><small>'+ph.rows.length+' account position'+(ph.rows.length===1?'':'s')+' · '+esc(ph.age)+'</small></div><div><span>BOT IDENTITIES</span><b>'+g.matched+'/'+g.supported+'</b><small>'+esc(source)+' · '+g.apiRows+' wallet rows · '+esc(g.age)+'</small></div><div><span>DECISION READY</span><b class="tone-'+(g.decisionReady===g.matched&&g.matched?'safe':'watch')+'">'+g.decisionReady+'/'+g.matched+'</b><small>PNL miss '+g.pnlMissing+' · MKT miss '+g.marketMissing+'</small></div><div><span>BOT AGE</span><b>'+esc(g.age)+'</b><small>'+(healthy?'DATA COMPLETE':'CHECK DETAILS')+'</small></div>'+(healthy?'':'<div><span>SUPPORTED MATCH</span><b>'+g.matched+'/'+g.supported+'</b></div><div><span>SAFETY READY</span><b>'+g.safetyReady+'/'+g.matched+'</b></div>');
  const diagnosticsOpen=diagOpenExisting??(!healthy||!ph.fresh||unmatched>0);
  const diagnostics='<details class="v10-bot-diagnostics" '+(diagnosticsOpen?'open':'')+'><summary><div><span>TECHNISCHE DETAILS</span><b>'+g.matched+'/'+g.supported+' Bots · PnL '+g.pnlReady+'/'+g.matched+' · Market '+g.marketReady+'/'+g.matched+'</b></div><small>Account API · Wallet Discovery · Normalizer · historische Referenz</small></summary><div class="v10-bot-diagnostics-body">'+accountPositionLayer(false)+walletDiscoveryLayer()+assetWatchShareCard()+unmatchedDiagnostics(unmatchedOpen??false)+snapshotDetails(snapshotOpen??!g.fresh)+'</div></details>';
  const assetHead='<section class="asset-overview-head"><div><span>ASSET OVERVIEW</span><b>'+syms.length+' / '+allSyms.length+' ASSETS · '+g.matched+' BOTS</b><small>Risk-first · Range + Hedge + PnL direkt sichtbar · Karte antippen für Bot-Details</small></div><div class="asset-toggle-actions"><button type="button" data-assets-action="close">ALLE ZU</button><button type="button" data-assets-action="open">ALLE AUF</button></div></section>';
  const emptyFilter=allSyms.length&&botViewUi.filter!=='ALL'?'<section class="v10-live-blocked bot-live-blocked"><b>KEIN ASSET IM FILTER '+esc(botViewUi.filter)+'</b><small>Filter ändern; die zugrunde liegenden Live-Bots bleiben unverändert.</small></section>':'<section class="v10-live-blocked bot-live-blocked"><b>KEINE FRISCHEN LIVE-AKTIONSKARTEN</b><small>'+esc(g.detail)+' · Technische Details öffnen.</small></section>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="live"><div><span>LIVE</span><b>POSITION LAYER · BOT CONTROL CENTER 2.0</b></div><small>Risk-first Übersicht · Details nur bei Bedarf öffnen · Range/Typ sichtbar · Asset Watch = Referenz</small></section>'+dataStateStripHtml('bots')+'<section class="bot-tab-head bot-tab-head-compact">'+headCards+'</section>'+(unmatched?'<section class="v10-unverified-note">'+unmatched+' unterstützte private Bot-Row(s) sind UNVERIFIED und aus Actions ausgeschlossen.'+(g.ambiguous?' · '+g.ambiguous+' davon AMBIGUOUS MATCH':'')+'</section>':'')+botFilterBar(allSyms)+assetHead+'<div class="v10-pair-stack asset-accordion-stack">'+(liveCards||emptyFilter)+'</div>'+diagnostics;
  bindBotOverviewControls(view);
}
function marketUniverse(){
  const s=S(),pref=['BTC','ETH','SOL','XRP','HBAR','PEPE','LINK','AVAX','SUI','ADA','DOT','XLM','TRX','WIF','INJ'];
  const accountRows=Array.isArray(s?.pionexAccount?.futuresPositions)?s.pionexAccount.futuresPositions.map(x=>({symbol:x?.asset||String(x?.symbol||'').replace(/[-_/](USDT|USDC|USD)_?PERP$/,'').replace(/\.PERP$/,'')})):[],rows=[...(s?.referenceBots||[]),...(s?.bots||[]),...(s?.okxDcaBots||[]),...(s?.unmatchedLive||[]),...accountRows],set=new Set();
  rows.forEach(x=>{if(x?.symbol)set.add(String(x.symbol).toUpperCase())});
  return [...set].sort((a,b)=>(pref.indexOf(a)<0?999:pref.indexOf(a))-(pref.indexOf(b)<0?999:pref.indexOf(b))||a.localeCompare(b));
}
function marketSignal(i){
  if(!i)return{label:'SYNC',tone:'muted',score:0,rank:0,confirmed:false};
  if(!intelFresh(i))return{label:'DATA STALE',tone:'muted',score:0,rank:0,confirmed:false};
  const bull=Number(i.bullish)||0,bear=Number(i.bearish)||0,peak=Math.max(bull,bear);
  const m1=Number(i.macd1h?.hist),m4=Number(i.macd4?.hist),r1=Number(i.rsi1h),r4=Number(i.rsi4);
  const bear1=m1<0&&r1<50,bear4=m4<0&&r4<50,bull1=m1>0&&r1>50,bull4=m4>0&&r4>50;
  if(Math.abs(bull-bear)<=1&&peak>=4)return{label:'CONFLICT',tone:'watch',score:peak,rank:2,confirmed:false};
  if(bear>=6&&bear1&&bear4)return{label:'BEAR CONFIRMED',tone:'danger',score:bear,rank:4,confirmed:true};
  if(bull>=6&&bull1&&bull4)return{label:'BULL CONFIRMED',tone:'safe',score:bull,rank:4,confirmed:true};
  if(bear>=5&&(bear1||bear4))return{label:'BEAR WATCH',tone:'watch',score:bear,rank:3,confirmed:false};
  if(bull>=5&&(bull1||bull4))return{label:'BULL WATCH',tone:'safe',score:bull,rank:3,confirmed:false};
  if(bear>=4)return{label:'BEAR EARLY',tone:'muted',score:bear,rank:2,confirmed:false};
  if(bull>=4)return{label:'BULL EARLY',tone:'muted',score:bull,rank:2,confirmed:false};

  return{label:'NEUTRAL',tone:'muted',score:peak,rank:1,confirmed:false};
}
function opportunityContext(symbol){
  const i=marketIntel(symbol),sig=marketSignal(i);
  if(!i||!intelFresh(i))return{available:false,score:0,label:'NO FRESH CONTEXT',tone:'muted',signal:sig.label,momentum:'—',fib:'—',reasons:['Frische technische Marktdaten fehlen']};
  let score=25;const reasons=['Fresh market feed'];
  if(sig.confirmed){score+=25;reasons.push('1h + 4h bestätigt')}
  else if(sig.rank>=3){score+=18;reasons.push('Multi-Timeframe Watch')}
  else if(sig.rank>=2){score+=10;reasons.push('Früher technischer Kontext')}
  else{score+=5;reasons.push('Neutraler technischer Kontext')}
  const m1=Number(i.macd1h?.hist),m4=Number(i.macd4?.hist),r1=Number(i.rsi1h),r4=Number(i.rsi4);
  const bullMomentum=m1>0&&m4>0&&r1>=50&&r4>=50,bearMomentum=m1<0&&m4<0&&r1<50&&r4<50,sameMacd=(m1>0&&m4>0)||(m1<0&&m4<0);
  let momentum='MIXED';
  if(bullMomentum){score+=20;momentum='BULL ALIGNED';reasons.push('Momentum 1h/4h bull aligned')}
  else if(bearMomentum){score+=20;momentum='BEAR ALIGNED';reasons.push('Momentum 1h/4h bear aligned')}
  else if(sameMacd){score+=10;momentum='MACD ALIGNED';reasons.push('MACD 1h/4h aligned')}
  const p=Number(i.price),e20=Number(i.ema20),e50=Number(i.ema50),bullTrend=p>e20&&e20>e50,bearTrend=p<e20&&e20<e50,dir=sig.label.startsWith('BULL')?1:sig.label.startsWith('BEAR')?-1:0;
  if((dir===1&&bullTrend)||(dir===-1&&bearTrend)){score+=15;reasons.push('Trendstruktur bestätigt Richtung')}
  else if(bullTrend||bearTrend){score+=8;reasons.push('Trendstruktur vorhanden')}
  const nearPrice=Number(i.near?.price),nearRatio=Number(i.near?.f),fibDistance=p>0&&nearPrice>0?Math.abs(nearPrice-p)/p*100:null;
  if(fibDistance!=null){
    if(fibDistance<=1){score+=15;reasons.push('Nahe relevantem FIB-Level')}
    else if(fibDistance<=2.5){score+=10;reasons.push('FIB-Kontext in Reichweite')}
    else if(fibDistance<=5){score+=5;reasons.push('FIB-Kontext sichtbar')}
  }
  if(sig.label==='CONFLICT'){score-=15;reasons.push('Bull/Bear-Konflikt')}
  score=Math.max(0,Math.min(100,Math.round(score)));
  const label=score>=80?'A · HIGH CONTEXT':score>=65?'B · GOOD CONTEXT':score>=50?'C · MIXED CONTEXT':'D · LOW CONTEXT',tone=score>=80?'safe':score>=60?'watch':'muted';
  const fib=Number.isFinite(nearRatio)&&nearPrice>0?fmt(nearRatio,3)+' · '+H().money?.(nearPrice)+(fibDistance!=null?' · '+fmt(fibDistance,2)+'%':''):'—';
  return{available:true,score,label,tone,signal:sig.label,momentum,fib,fibDistance,reasons};
}
function forecastContextHtml(symbol){
  const h=H(),ctx=opportunityContext(symbol),i=marketIntel(symbol),m=marketPrice(symbol);
  if(!ctx.available)return '<section class="forecast-focus forecast-focus-blocked"><div><span>FORECAST FOCUS · '+esc(symbol)+'</span><b>NO FRESH CONTEXT</b><small>FIB-/SK-Map kann separat laden; Opportunity Quality bleibt ohne frische Multi-Timeframe-Daten blockiert.</small></div></section>';
  return '<section class="forecast-focus"><div class="forecast-focus-head"><div><span>FORECAST FOCUS · '+esc(symbol)+'</span><b>'+esc(ctx.signal)+'</b><small>'+h.money?.(m.value)+' · '+esc(m.source)+'</small></div><strong class="tone-'+ctx.tone+'">OPPORTUNITY '+ctx.score+'/100 · '+esc(ctx.label)+'</strong></div><div class="forecast-focus-grid"><span>MOMENTUM <b>'+esc(ctx.momentum)+'</b></span><span>NEAREST FIB <b>'+esc(ctx.fib)+'</b></span><span>RSI 1h / 4h <b>'+fmt(i?.rsi1h)+' · '+fmt(i?.rsi4)+'</b></span><span>MACD 1h / 4h <b>'+fmt(i?.macd1h?.hist,2)+' · '+fmt(i?.macd4?.hist,2)+'</b></span></div><small class="forecast-context-note">'+esc(ctx.reasons.slice(0,3).join(' · '))+' · Opportunity Quality ist Markt-Kontext, keine Renditeprognose oder Order-Freigabe.</small></section>';
}
function marketRow(symbol){
  const s=S(),h=H(),i=marketIntel(symbol),m=marketPrice(symbol);
  if(!i)return '<article class="market-row market-row-missing"><div class="market-symbol"><strong>'+esc(symbol)+'</strong><span class="tone-muted">NO TECH DATA</span><small>keine 15m/1h/4h Historie geladen</small></div><div><span>PRICE</span><b>'+h.money?.(m.value)+'</b><small>'+esc(m.source)+'</small></div><div><span>RSI 1h / 4h</span><b>— · —</b></div><div><span>TREND 1h</span><b>—</b></div><div><span>MACD 4h</span><b>—</b></div></article>';
  const fresh=intelFresh(i),sig=marketSignal(i),macd4=Number(i.macd4?.hist),trend=Number(i.ema20)>Number(i.ema50)?'EMA20 > 50':'EMA20 ≤ 50',age=i.updatedAt?h.ageText?.(Date.now()-i.updatedAt):'—';
  return '<article class="market-row '+(fresh?'':'market-row-stale')+'"><div class="market-symbol"><strong>'+esc(symbol)+'</strong><span class="tone-'+sig.tone+'">'+sig.label+'</span><small>'+esc(age)+(fresh?'':' · REFERENCE ONLY')+'</small></div><div><span>PRICE</span><b>'+h.money?.(m.value)+'</b><small>'+esc(m.source)+'</small></div><div><span>RSI 1h / 4h</span><b>'+fmt(i.rsi1h)+' · '+fmt(i.rsi4)+'</b></div><div><span>TREND 1h</span><b>'+trend+'</b></div><div><span>MACD 4h</span><b class="'+(fresh?(macd4>0?'tone-safe':macd4<0?'tone-danger':''):'tone-muted')+'">'+fmt(macd4,2)+'</b></div></article>';
}
function btcRegimeLabel(i){
  if(!i)return'SYNC';
  const p=Number(i.price),e20=Number(i.ema20),e50=Number(i.ema50),e200=Number(i.ema200),r=Number(i.rsi1d),m=Number(i.macd4?.hist);
  if(p>e20&&e20>e50&&p>e200&&r>=55)return m>=0?'BULL TREND':'BULL PULLBACK';
  if(p<e20&&e20<e50&&p<e200&&r<=45)return m<=0?'BEAR TREND':'BEAR BOUNCE';
  if(p>e50&&p>e200)return'RISK-ON / TRANSITION';
  if(p<e50&&p<e200)return'RISK-OFF / TRANSITION';
  return'NEUTRAL / RANGE';
}

function fibParse(v){
  const n=Number(String(v??'').trim().replace(',','.'));return Number.isFinite(n)&&n>0?n:null;
}
function fibFmt(v){
  const n=Number(v);if(!Number.isFinite(n))return'—';
  const d=Math.abs(n)>=1000?2:Math.abs(n)>=1?4:Math.abs(n)>=.01?5:8;
  return '$'+new Intl.NumberFormat('de-DE',{maximumFractionDigits:d}).format(n);
}
function fibPct(v){
  const n=Number(v);return Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(2)+'%':'—';
}
function fibAssets(){
  return [...new Set(['BTC',...marketUniverse()])];
}
function fibManualControls(){
  const hi=fibUi.manualHigh??fibUi.autoHigh??'',lo=fibUi.manualLow??fibUi.autoLow??'',dir=fibUi.direction==='AUTO'?fibUi.lastDirection:fibUi.direction;
  return '<div class="fib-manual" id="fib-manual"><label>SWING LOW<input id="fib-low" inputmode="decimal" value="'+lo+'" placeholder="Low"></label><label>SWING HIGH<input id="fib-high" inputmode="decimal" value="'+hi+'" placeholder="High"></label><label>RICHTUNG<select id="fib-direction"><option value="UP" '+(dir==='UP'?'selected':'')+'>UP SWING ↑</option><option value="DOWN" '+(dir==='DOWN'?'selected':'')+'>DOWN SWING ↓</option></select></label><button id="fib-apply" type="button">BERECHNEN</button></div>';
}
function fibMapHtml(){
  const options=fibAssets().map(x=>'<option value="'+x+'" '+(x===fibUi.symbol?'selected':'')+'>'+x+'</option>').join('');
  return '<section class="fib-map-shell"><div class="fib-head"><div><span>FIB MAP · SK OVERLAY</span><b>RETRACEMENT + TURN AREAS</b><small>Auto-Swing aus öffentlichen 4h-Kerzen · keine Orders</small></div><strong>'+fibUi.symbol+'</strong></div>'+
  '<div class="fib-controls"><label>ASSET<select id="fib-asset">'+options+'</select></label><label>SWING-FENSTER<select id="fib-window"><option value="30" '+(fibUi.window===30?'selected':'')+'>30 × 4h</option><option value="60" '+(fibUi.window===60?'selected':'')+'>60 × 4h</option><option value="90" '+(fibUi.window===90?'selected':'')+'>90 × 4h</option><option value="180" '+(fibUi.window===180?'selected':'')+'>180 × 4h</option></select></label><div class="fib-mode"><button type="button" data-fib-mode="AUTO" class="'+(fibUi.mode==='AUTO'?'active':'')+'">AUTO</button><button type="button" data-fib-mode="MANUAL" class="'+(fibUi.mode==='MANUAL'?'active':'')+'">MANUAL</button></div></div>'+
  (fibUi.mode==='MANUAL'?fibManualControls():'')+'<div id="fib-output" class="fib-output"><div class="fib-loading">Fib-Level und SK-Zonen werden geladen …</div></div></section>';
}
function fibLevelRow(level,next,current,levels){
  const top=fibPlotPosition(level.price,levels,current);
  const up=next.above&&Math.abs(next.above.price-level.price)<1e-12,down=next.below&&Math.abs(next.below.price-level.price)<1e-12;
  const sk=[.5,.559,.618,.667].some(x=>Math.abs(level.ratio-x)<1e-12),gate=Math.abs(level.ratio-.382)<1e-12;
  const label=(sk?'SK ':'')+level.label+(gate?' · GATE':'')+(up?' · NEXT ↑':down?' · NEXT ↓':'');
  return '<div class="fib-level '+(level.kind==='extension'?'fib-extension':'fib-retracement')+' '+(sk?'fib-sk-core ':'')+(up?'fib-next-up ':'')+(down?'fib-next-down':'')+'" style="top:'+top.toFixed(2)+'%"><span>'+label+'</span><i></i><b>'+fibFmt(level.price)+'</b></div>';
}
function fibZonePosition(zone,current){
  const c=Number(current);if(!(c>0)||!zone)return'unknown';
  if(c<zone.low)return'below';
  if(c>zone.high)return'above';
  return'inside';
}
function fibZoneState(zone,current){
  const c=Number(current),position=fibZonePosition(zone,current);if(!(c>0)||position==='unknown')return'—';
  if(position==='inside')return'INSIDE';
  const edge=position==='below'?zone.low:zone.high,d=Math.abs((edge-c)/c*100);
  return position.toUpperCase()+' · '+d.toFixed(2)+'% entfernt';
}
function fibZoneBand(zone,levels,current,kind,label,active=false){
  const y1=fibPlotPosition(zone.high,levels,current),y2=fibPlotPosition(zone.low,levels,current),top=Math.min(y1,y2),height=Math.max(2,Math.abs(y2-y1));
  return '<div class="fib-zone fib-zone-'+kind+' '+(active?'active':'')+'" style="top:'+top.toFixed(2)+'%;height:'+height.toFixed(2)+'%"><span>'+label+'</span></div>';
}
function fibSkCards(low,high,direction,current,doubleAdvantage){
  const zones=skLongShortZones(low,high),target=skTargetZone(low,high,direction),targetSide=direction==='UP'?'BULLISH TARGET / SHORT WATCH':'BEARISH TARGET / LONG WATCH',longPosition=fibZonePosition(zones.long,current),shortPosition=fibZonePosition(zones.short,current);
  const da=doubleAdvantage?.candidate
    ?'<div class="sk-double '+doubleAdvantage.side.toLowerCase()+'"><span>DOPPELTER VORTEIL · '+doubleAdvantage.side+'</span><b>'+fibFmt(doubleAdvantage.overlap.low)+' – '+fibFmt(doubleAdvantage.overlap.high)+'</b><small>Gegen-Ziel ∩ GKL · '+doubleAdvantage.overlap.overlapPct.toFixed(0)+'% Überlappung · Bestätigung über Struktur nötig</small></div>'
    :'<div class="sk-double muted"><span>DOPPELTER VORTEIL</span><b>—</b><small>Keine bestätigte Gegen-Ziel ∩ GKL Überlappung</small></div>';
  return '<div class="sk-zone-grid"><div class="sk-zone bull state-'+longPosition+'"><span>LONG TRENDWENDE · BULLISH</span><b>'+fibFmt(zones.long.low)+' – '+fibFmt(zones.long.high)+'</b><small>GKL 0.500 / 0.559 / 0.618 / 0.667 · '+fibZoneState(zones.long,current)+'</small></div><div class="sk-zone bear state-'+shortPosition+'"><span>SHORT TRENDWENDE · BEARISH</span><b>'+fibFmt(zones.short.low)+' – '+fibFmt(zones.short.high)+'</b><small>GKL 0.500 / 0.559 / 0.618 / 0.667 · '+fibZoneState(zones.short,current)+'</small></div><div class="sk-zone target"><span>'+targetSide+'</span><b>'+fibFmt(target.low)+' – '+fibFmt(target.high)+'</b><small>SK Zielbereich 1.618 / 1.809 / 2.000 · Reaktion beobachten, nicht automatisch handeln</small></div></div><div class="sk-double-grid">'+da+'</div>';
}
function fibResultHtml(model){
  const {symbol,low,high,direction,current,levels,source,bars,doubleAdvantage=null}=model,next=adjacentFibLevels(levels,current),currentTop=fibPlotPosition(current,levels,current),zones=skLongShortZones(low,high),target=skTargetZone(low,high,direction);
  const doubleBand=doubleAdvantage?.candidate?fibZoneBand(doubleAdvantage.overlap,levels,current,'double','DOPPELTER VORTEIL',true):'';
  return '<div class="fib-anchor-row"><div><span>SWING LOW</span><b>'+fibFmt(low)+'</b></div><div><span>SWING HIGH</span><b>'+fibFmt(high)+'</b></div><div><span>CURRENT</span><b>'+fibFmt(current)+'</b></div></div>'+
  '<div class="fib-next"><div><span>NEXT ↑</span><b>'+(next.above?next.above.label+' · '+fibFmt(next.above.price):'—')+'</b><small>'+fibPct(fibDistancePct(next.above,current))+'</small></div><div><span>NEXT ↓</span><b>'+(next.below?next.below.label+' · '+fibFmt(next.below.price):'—')+'</b><small>'+fibPct(fibDistancePct(next.below,current))+'</small></div></div>'+
  fibSkCards(low,high,direction,current,doubleAdvantage)+
  '<div class="fib-meta"><span>'+direction+' SWING</span><span>'+source+(bars?' · '+bars+' Bars':'')+'</span></div>'+
  '<div class="fib-ladder">'+
    fibZoneBand(zones.long,levels,current,'long','LONG TRENDWENDE',direction==='UP')+
    fibZoneBand(zones.short,levels,current,'short','SHORT TRENDWENDE',direction==='DOWN')+
    fibZoneBand(target,levels,current,'target','1.618–2.000 TARGET',true)+doubleBand+
    levels.map(x=>fibLevelRow(x,next,current,levels)).join('')+
    '<div class="fib-current" style="top:'+currentTop.toFixed(2)+'%"><span>CURRENT · '+symbol+'</span><i></i><b>'+fibFmt(current)+'</b></div></div>'+
  '<div class="fib-legend"><span>GKL: .500 · .559 · .618 · .667</span><span>Targets: 1.618 · 1.809 · 2.000 · Double = Gegen-Ziel ∩ GKL</span></div>';
}
async function updateFibMap(view){
  const out=$('#fib-output',view);if(!out)return;
  fibUi.symbol=$('#fib-asset',view)?.value||fibUi.symbol;
  fibUi.window=Number($('#fib-window',view)?.value)||fibUi.window||90;
  out.setAttribute('aria-busy','true');out.innerHTML='<div class="fib-loading">4h-Swings, SK-Zonen und Fib-Level werden berechnet …</div>';
  try{
    const fetchRows=H().marketKlines;
    let rows=null;
    if(typeof fetchRows==='function'){
      try{rows=await fetchRows('4h',Math.min(300,Math.max(180,fibUi.window+5)),fibUi.symbol)}catch(e){if(fibUi.mode==='AUTO')throw e}
    }
    const swingRows=(Array.isArray(rows)?rows:[]).filter(x=>Number(x?.closeTime)>0&&Number(x.closeTime)<Date.now()-1000);if(rows?.source)swingRows.source=rows.source;
    let low,high,direction,bars=0,source='MANUAL';
    if(fibUi.mode==='AUTO'){
      if(!swingRows.length)throw new Error('Keine geschlossenen 4h-Kerzen verfügbar');
      const sw=detectSwing(swingRows,fibUi.window);
      low=sw.low;high=sw.high;bars=sw.bars;direction=sw.direction;source='AUTO '+fibUi.window+'×4h CLOSED · '+(swingRows.source||'PUBLIC FUTURES');
      fibUi.autoLow=low;fibUi.autoHigh=high;fibUi.lastDirection=direction;
    }else{
      low=fibParse($('#fib-low',view)?.value??fibUi.manualLow);
      high=fibParse($('#fib-high',view)?.value??fibUi.manualHigh);
      direction=$('#fib-direction',view)?.value||fibUi.lastDirection||'UP';
      fibUi.manualLow=low;fibUi.manualHigh=high;fibUi.direction=direction;
      source='MANUAL SWING · '+(rows?.source||'PRICE FEED');
    }
    if(!(low>0&&high>0&&high>low))throw new Error('Swing High muss über Swing Low liegen');
    let current=rows?.length?Number(rows.at(-1)?.close):null;
    if(!(current>0))current=marketPrice(fibUi.symbol).value;
    if(!(current>0))throw new Error('Aktueller Marktpreis fehlt');
    const levels=buildFibLevels(low,high,direction);
    let doubleAdvantage=null;
    if(fibUi.mode==='AUTO'&&swingRows.length){
      const parent=detectSwing(swingRows,fibUi.window),child=detectOpposingChildSwing(swingRows,parent,fibUi.window);
      if(child)doubleAdvantage=skDoubleAdvantage(parent,child);
    }
    out.innerHTML=fibResultHtml({symbol:fibUi.symbol,low,high,direction,current,levels,source,bars,doubleAdvantage});
  }catch(e){
    out.innerHTML='<div class="fib-error"><b>FIB NICHT VERFÜGBAR</b><small>'+esc(e?.message||e)+'</small></div>';
  }finally{out.setAttribute('aria-busy','false')}
}
function refreshForecastFocus(view){
  const old=$('.forecast-focus',view);if(old)old.outerHTML=forecastContextHtml(fibUi.symbol);
}
function refreshFibMap(view){
  const old=$('.fib-map-shell',view);if(!old)return;
  old.outerHTML=fibMapHtml();refreshForecastFocus(view);bindFibMap(view);
}
function bindFibMap(view){
  const asset=$('#fib-asset',view),win=$('#fib-window',view),assetLocked=view?.id==='view-asset-detail';
  if(asset){
    if(assetLocked){asset.value=assetDetailUi.symbol;asset.disabled=true;asset.title='Asset ist im Asset Detail fixiert';}
    else asset.onchange=()=>{fibUi.symbol=asset.value;fibUi.manualHigh=null;fibUi.manualLow=null;persistUiContext();refreshFibMap(view)};
  }
  if(win)win.onchange=()=>{fibUi.window=Number(win.value)||90;if(fibUi.mode==='AUTO')updateFibMap(view)};
  $$('[data-fib-mode]',view).forEach(btn=>btn.onclick=()=>{
    const next=btn.dataset.fibMode;
    if(next==='MANUAL'&&fibUi.mode!=='MANUAL'){fibUi.manualHigh=fibUi.autoHigh;fibUi.manualLow=fibUi.autoLow;fibUi.direction=fibUi.lastDirection}
    fibUi.mode=next;refreshFibMap(view);
  });
  const apply=$('#fib-apply',view);if(apply)apply.onclick=()=>updateFibMap(view);
  updateFibMap(view);
}

function renderMarket(force=false){
  const view=$('#view-market');if(!view)return;
  if(!force&&$('.v10-market-board',view))return;
  if(!force&&!$('.hero',view)&&!$('.grid',view))return;
  if(force&&fibUi.mode==='MANUAL'){
    const lo=fibParse($('#fib-low',view)?.value),hi=fibParse($('#fib-high',view)?.value),dir=$('#fib-direction',view)?.value;
    if(lo)fibUi.manualLow=lo;if(hi)fibUi.manualHigh=hi;if(dir)fibUi.direction=dir;
  }
  const s=S(),h=H(),i=marketIntel('BTC'),syms=marketUniverse(),mh=marketHealth(),verified=syms.filter(symbol=>{const x=s?.priceChecks?.[symbol];return x?.verified&&freshTs(x.updatedAt)}).length;
  const btcCtx=opportunityContext('BTC'),btcTone=i?.score>=70&&btcCtx.available&&btcCtx.score>=60?'safe':i?.score>=55?'watch':'muted';
  const health='<section class="market-health"><div><span>BTC TECH FEED</span><b class="tone-'+(mh.fresh?'safe':'watch')+'">'+(mh.fresh?'FRESH':'STALE')+'</b><small>'+esc(mh.ageText)+' · '+esc(mh.transport)+'</small></div><div><span>TECH COVERAGE</span><b class="tone-'+(mh.coverageComplete?'safe':'watch')+'">'+mh.freshAssets+'/'+mh.totalAssets+'</b><small>'+mh.staleAssets+' stale · '+mh.missingAssets+' missing</small></div><div><span>2-SOURCE PRICE</span><b>'+verified+'/'+syms.length+'</b><small>'+(mh.priceFresh?'fresh':'stale')+'</small></div><div><span>SOURCE</span><b>FUTURES</b><small>OKX / Binance USD-M</small></div></section>';
  const btc=mh.fresh&&i?'<section class="market-regime"><div><span>BTC REGIME</span><b>'+btcRegimeLabel(i)+'</b><small>'+h.money?.(i.price)+' · '+esc(i.source||'MARKET FEED')+' · '+esc(mh.ageText)+' · OPPORTUNITY '+(btcCtx.available?btcCtx.score+'/100 · '+esc(btcCtx.label):'BLOCKED')+'</small></div><strong class="tone-'+btcTone+'">REGIME '+i.score+'/100 · '+esc(i.status)+'</strong></section><section class="market-kpis"><div><span>RSI 15m / 1h</span><b>'+fmt(i.rsi15)+' · '+fmt(i.rsi1h)+'</b></div><div><span>RSI 4h / 1D</span><b>'+fmt(i.rsi4)+' · '+fmt(i.rsi1d)+'</b></div><div><span>MACD 1h / 4h</span><b>'+fmt(i.macd1h?.hist,2)+' · '+fmt(i.macd4?.hist,2)+'</b></div><div><span>EMA20 / EMA50 1D</span><b>'+h.money?.(i.ema20)+' / '+h.money?.(i.ema50)+'</b></div><div><span>NEAREST FIB</span><b>'+fmt(i.near?.f,3)+' · '+h.money?.(i.near?.price)+'</b></div><div><span>ATR 4h</span><b>'+h.money?.(i.atr)+'</b></div></section>':'<section class="v10-live-blocked market-stale"><b>BTC REGIME BLOCKED</b><small>Technische Marktdaten sind nicht frisch genug. Keine Regime-/Setup-Aussage aus altem Feed.</small></section>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="market"><div><span>FORECAST</span><b>REGIME + OPPORTUNITY CONTEXT + FIB MAP</b></div><small>Öffentliche Futures-Marktdaten · Kontext statt Renditeversprechen · 1h/4h/1D nur auf geschlossenen Kerzen</small></section>'+contextBarHtml('market')+dataStateStripHtml('market')+'<div class="v10-market-board">'+health+forecastContextHtml(fibUi.symbol)+btc+fibMapHtml()+'<div class="section-title"><h2>ASSET TAPE</h2><small>'+syms.length+' Märkte · '+mh.freshAssets+' frisch · 15m/1h/4h</small></div><div class="market-list">'+syms.map(marketRow).join('')+'</div></div>';
  bindContextBack(view,'market','research','research');bindFibMap(view);
}
function scannerCard(symbol){
  const s=S(),h=H(),i=marketIntel(symbol),ctx=opportunityContext(symbol),liveLinked=!!h.botFeedFresh?.()&&matchedRows(symbol).length>0,refLinked=referenceLinked(symbol),link=liveLinked?'LIVE BOT · FRESH':refLinked?'REF BOT · ASSET WATCH':'MARKET ONLY';
  const open='<div class="scan-drill-actions"><button type="button" class="scan-forecast-open" data-forecast-asset="'+esc(symbol)+'">IM FORECAST ÖFFNEN</button>'+assetDetailButton(symbol,'ASSET DETAIL')+'</div>';
  if(!i)return '<article class="scan-card compact-scan scan-missing"><div class="scan-head"><div><strong>'+esc(symbol)+'</strong><small>'+link+' · NO TECH DATA</small></div><b class="tone-muted">NO DATA</b></div><div class="scan-grid compact"><span>OPPORTUNITY QUALITY <b>—</b></span><span>MOMENTUM <b>—</b></span><span>NEAREST FIB <b>—</b></span><span>MTF STATUS <b>BLOCKED</b></span></div><small>Kein technischer Datensatz geladen · keine Ranking-/Setup-Aussage.</small>'+open+'</article>';
  const fresh=intelFresh(i),sig=marketSignal(i),bearReasons=i.longReasons||[],bullReasons=i.shortReasons||[],reasonSet=!fresh?[]:sig.label.startsWith('BEAR')?bearReasons:sig.label.startsWith('BULL')?bullReasons:[bearReasons[0],bullReasons[0],...bearReasons.slice(1),...bullReasons.slice(1)].filter(Boolean),reasons=[...new Set(reasonSet)],age=i.updatedAt?h.ageText?.(Date.now()-i.updatedAt):'—';
  return '<article class="scan-card compact-scan '+(fresh?'':'scan-stale')+'"><div class="scan-head"><div><strong>'+esc(symbol)+'</strong><small>'+link+' · '+esc(age)+(fresh?'':' · REFERENCE ONLY')+'</small></div><div class="scan-score-wrap"><b class="tone-'+sig.tone+'">'+sig.label+'</b><strong class="opportunity-score tone-'+ctx.tone+'">'+(ctx.available?ctx.score+'/100':'—')+'</strong></div></div><div class="scan-grid compact scan-context-grid"><span>OPPORTUNITY QUALITY <b>'+(ctx.available?esc(ctx.label):'BLOCKED')+'</b></span><span>MOMENTUM <b>'+esc(ctx.momentum)+'</b></span><span>NEAREST FIB <b>'+esc(ctx.fib)+'</b></span><span>MTF STATUS <b>'+(sig.confirmed?'CONFIRMED':sig.rank>=3?'WATCH':'UNCONFIRMED')+'</b></span></div><div class="scan-actions"><span>LONG VIEW <b>'+(fresh?esc(i.longAction):'BLOCKED')+'</b></span><span>SHORT VIEW <b>'+(fresh?esc(i.shortAction):'BLOCKED')+'</b></span></div><small>'+(fresh?esc(reasons.slice(0,2).join(' · ')||ctx.reasons.slice(0,2).join(' · ')||'Kein starkes Momentum-Warnsignal'):'Veraltete technische Werte nur als Referenz')+' · Quality Score = Kontext, kein Renditeversprechen</small>'+open+'</article>';
}
function renderScanner(force=false){
  const view=$('#view-research');if(!view)return;
  if(!force&&$('.v10-scanner-stack',view))return;
  if(!force&&!$('.bt-control',view)&&!$('.hero',view))return;
  const moreOpen=force?!!$('.scanner-more:not(.scanner-stale)',view)?.open:false,staleOpen=force?!!$('.scanner-more.scanner-stale',view)?.open:false;
  const s=S(),h=H(),all=marketUniverse(),fresh=all.filter(x=>intelFresh(marketIntel(x))).sort((a,b)=>{const A=opportunityContext(a),B=opportunityContext(b),sa=marketSignal(marketIntel(a)),sb=marketSignal(marketIntel(b));return B.score-A.score||sb.rank-sa.rank||sb.score-sa.score}),stale=all.filter(x=>!!marketIntel(x)&&!intelFresh(marketIntel(x))),missing=all.filter(x=>!marketIntel(x)),blocked=[...stale,...missing];
  const confirmed=fresh.filter(x=>marketSignal(marketIntel(x)).confirmed),top=fresh.slice(0,4),rest=fresh.slice(4),liveLinked=h.botFeedFresh?.()?all.filter(x=>matchedRows(x).length).length:0,refLinked=all.filter(referenceLinked).length,best=top[0]?opportunityContext(top[0]):null;
  const stack=top.length?top.map(scannerCard).join(''):'<section class="v10-live-blocked market-stale"><b>SCANNER BLOCKED</b><small>Keine frischen Multi-Timeframe-Marktdaten · keine bestätigten Setups ausgeben.</small></section>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="research"><div><span>SCANNER</span><b>OPPORTUNITY SCANNER · FORECAST BRIDGE</b></div><small>Quality = Daten + MTF + Momentum + Trend + FIB-Kontext · Bot-Verknüpfung beeinflusst Ranking nicht</small></section>'+dataStateStripHtml('research')+'<section class="scanner-toolbar"><div><span>RESEARCH TOOLS</span><small>Paper Cockpit und Strategie-Lab bleiben sekundär. Jede Marktkarte kann direkt im Forecast/FIB-Kontext geöffnet werden.</small></div><div class="scanner-toolbar-actions"><button type="button" data-open-paper>PAPER COCKPIT</button><button type="button" data-open-lab>LAB ÖFFNEN</button></div></section><section class="scanner-summary"><div><span>FRESH MARKETS</span><b>'+fresh.length+'/'+all.length+'</b></div><div><span>CONFIRMED</span><b>'+confirmed.length+'</b></div><div><span>TOP QUALITY</span><b>'+(best?best.score+'/100':'—')+'</b><small>'+(top[0]?esc(top[0]):'—')+'</small></div><div><span>STALE / MISSING</span><b class="'+(blocked.length?'tone-watch':'tone-safe')+'">'+stale.length+' / '+missing.length+'</b></div></section><div class="section-title"><h2>TOP MARKET CONTEXTS</h2><small>Opportunity Quality ist ein transparenter Kontext-Score, keine erwartete Rendite</small></div><div class="v10-scanner-stack">'+stack+'</div>'+(rest.length?'<details class="scanner-more" '+(moreOpen?'open':'')+'><summary>WEITERE '+rest.length+' FRISCHE MÄRKTE</summary><div class="v10-scanner-stack">'+rest.map(scannerCard).join('')+'</div></details>':'')+(blocked.length?'<details class="scanner-more scanner-stale" '+(staleOpen?'open':'')+'><summary>STALE / NO DATA · '+stale.length+' / '+missing.length+'</summary><div class="v10-scanner-stack">'+blocked.map(scannerCard).join('')+'</div></details>':'');
  $('[data-open-paper]',view)?.addEventListener('click',()=>showSecondaryView('paper','research'));
  $('[data-open-lab]',view)?.addEventListener('click',()=>showSecondaryView('more','research'));
  $$('[data-forecast-asset]',view).forEach(btn=>btn.addEventListener('click',()=>{fibUi.symbol=String(btn.dataset.forecastAsset||'BTC').toUpperCase();fibUi.mode='AUTO';fibUi.manualHigh=null;fibUi.manualLow=null;persistUiContext();showSecondaryView('market','market')}));
  bindAssetDetailLinks(view,'research','research');
}
function skNum(v,d=2){
  const n=Number(v);
  return Number.isFinite(n)?new Intl.NumberFormat('de-DE',{minimumFractionDigits:0,maximumFractionDigits:d}).format(n):'—';
}
function skMoney(v){
  const n=Number(v);
  return Number.isFinite(n)?(n>=0?'+':'−')+'$'+new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(Math.abs(n)):'—';
}
function skBotStateLabel(r){
  const state=String(r?.latestState||'WAITING_DATA');
  const map={SEQUENCE:'SEQUENCE',B_FORMING:'B FORMING',ACTIVE:'ACTIVE PAPER',TP1:'TP1 HIT',TP2:'TP2 HIT',COMPLETE:'COMPLETE',INVALID:'INVALID',WAITING_DATA:'WAITING DATA',SEARCH:'SEARCH'};
  return map[state]||state.replaceAll('_',' ');
}
function skRulesCard(){
  const c=SK_PAPERBOT_V1_CONFIG;
  return '<details class="sk-rules"><summary>FROZEN RULESET · '+SK_PAPERBOT_V1_RULESET+'</summary><div class="sk-rule-grid"><div><span>TIMEFRAME</span><b>4H</b></div><div><span>GATE</span><b>0.382</b></div><div><span>ENTRIES</span><b>'+c.entryRatios.join(' · ')+'</b></div><div><span>TARGETS</span><b>'+c.targetRatios.join(' · ')+'</b></div><div><span>INVALIDATION</span><b>ORIGIN 0</b></div><div><span>RISK</span><b>'+c.riskPct+'% TOTAL</b></div><div><span>FEES</span><b>'+c.feeBps+' BPS</b></div><div><span>SLIPPAGE</span><b>'+c.slippageBps+' BPS</b></div></div><small>Vier Entry-Tranchen teilen das Gesamtrisiko. Doppelter Vorteil wird gemessen, aber ist in V1 kein Pflichtfilter. Keine automatische Promotion.</small></details>';
}

function skV2Metric(summary,label){
  if(!summary)return '<div><span>'+label+'</span><b>—</b></div>';
  return '<div><span>'+label+'</span><b>'+summary.trades+' T · PF '+skNum(summary.profitFactor,2)+'</b><small>'+skMoney(summary.pnl)+' · Exp '+skMoney(summary.expectancy)+'</small></div>';
}
function skV2DepthHtml(depth){
  return Object.values(depth||{}).map(x=>'<div><span>'+x.ratio.toFixed(3)+'</span><b>'+x.trades+' T</b><small>PF '+skNum(x.summary?.profitFactor,2)+' · '+skMoney(x.summary?.pnl)+'</small></div>').join('');
}
function skV2AssetRows(assets){
  return (assets||[]).map(a=>'<div class="sk-v2-asset-row"><strong>'+a.symbol+'</strong><span>CORE '+a.core.trades+'T · PF '+skNum(a.core.profitFactor,2)+' · '+skMoney(a.core.pnl)+'</span><span>2×ADV '+a.double.trades+'T · PF '+skNum(a.double.profitFactor,2)+' · '+skMoney(a.double.pnl)+'</span></div>').join('');
}
function skV2ResultHtml(){
  if(skV2Ui.running)return '<div class="sk-v2-loading"><b>'+skV2Ui.progress+'</b><small>'+skV2Ui.completed+'/'+skV2Ui.total+' Assets · öffentliche 4h-Historie · sequenziell</small></div>';
  if(skV2Ui.error)return '<div class="sk-paper-error"><b>V2 BATCH FEHLER</b><small>'+esc(skV2Ui.error)+'</small></div>';
  const r=skV2Ui.result;
  if(!r)return '<div class="sk-paper-empty"><b>NOCH KEIN V2-BATCH</b><small>Core V1 bleibt unverändert. V2 vergleicht nur Core vs. vor Entry bestätigten Double Advantage.</small></div>';
  const g=r.gate,st=r.stability||{},core=r.pooled?.core,double=r.pooled?.double,depth=r.pooled?.entryDepth||{};
  const windows=(st.windows||[]).map(w=>'<div class="'+(w.positive?'positive':'negative')+'"><span>W'+w.i+' · '+w.trades+'T</span><b>'+skMoney(w.pnl)+'</b><small>PF '+skNum(w.profitFactor,2)+'</small></div>').join('');
  return '<div class="sk-v2-ab"><div><span>A · SK CORE V1</span><b>'+core.trades+' Trades</b><small>PF '+skNum(core.profitFactor,2)+' · '+skMoney(core.pnl)+' · Exp '+skMoney(core.expectancy)+'</small></div><div class="'+(double?.expectancy>core?.expectancy?'candidate':'')+'"><span>B · DOUBLE ADV ONLY</span><b>'+double.trades+' Trades</b><small>PF '+skNum(double.profitFactor,2)+' · '+skMoney(double.pnl)+' · Exp '+skMoney(double.expectancy)+'</small></div></div>'+
    '<div class="sk-v2-metrics">'+
      skV2Metric(core,'CORE')+skV2Metric(double,'DOUBLE ADV')+
      '<div><span>LONG / SHORT · DA</span><b>'+double.longTrades+' / '+double.shortTrades+'</b><small>'+skMoney(double.longPnl)+' / '+skMoney(double.shortPnl)+'</small></div>'+
      '<div><span>CLOSED DD · DA</span><b>'+skNum(double.maxDrawdownPct,2)+'%</b><small>Trade-sequence DD, kein Portfolio-DD</small></div>'+
      '<div><span>POSITIVE ASSETS</span><b>'+g.positiveAssets+'/'+r.assets.length+'</b><small>Breite vor Promotion</small></div>'+
      '<div><span>PNL CONCENTRATION</span><b>'+skNum(g.positivePnlConcentrationPct,1)+'%</b><small>max. positiver Asset-Anteil</small></div>'+
    '</div>'+
    '<div class="sk-gate"><span>V2 FROZEN GATE</span><b>'+(g.pass?'PASS · KEINE AUTO-PROMOTION':'FAIL / INSUFFICIENT')+'</b><small>'+((g.reasons||[]).join(' · ')||'Alle V2 Research-Gates erfüllt; Forward-/Paper-Shadow wäre trotzdem Pflicht.')+'</small></div>'+
    '<div class="sk-section-title"><b>ENTRY-TIEFE · CORE</b><small>tiefster gefüllter SK-Level</small></div><div class="sk-v2-depth">'+skV2DepthHtml(depth)+'</div>'+
    '<div class="sk-section-title"><b>ASSET BREITE</b><small>'+r.assets.length+' Assets · '+skV2Ui.days+' Tage angefordert</small></div><div class="sk-v2-assets">'+skV2AssetRows(r.assets)+'</div>'+
    '<div class="sk-section-title"><b>DOUBLE ADV · 5 ZEITFENSTER</b><small>'+((st.positiveWindows||0))+'/5 positiv</small></div><div class="sk-window-grid">'+windows+'</div>'+
    '<div class="sk-source-note">V2 zählt Double Advantage nur, wenn es bereits auf einer früheren 4h-Kerze bestätigt war. Same-Bar-OHLC zählt nicht · '+esc(r.engineRevision||'ENGINE')+' · keine Auto-Promotion · keine Orders.</div>';
}
function skV2Panel(){
  return '<section class="sk-v2-shell"><div class="sk-paper-head"><div><span>SK RESEARCH V2</span><b>CORE vs DOUBLE ADVANTAGE</b><small>A/B-Test · Multi-Asset · Frozen Gate</small></div><strong>RESEARCH ONLY</strong></div>'+
    '<div class="sk-paper-controls sk-v2-controls"><label>HISTORY<select id="sk-v2-days"><option value="365" '+(skV2Ui.days===365?'selected':'')+'>365 TAGE</option><option value="730" '+(skV2Ui.days===730?'selected':'')+'>730 TAGE</option><option value="1460" '+(skV2Ui.days===1460?'selected':'')+'>1460 TAGE</option></select></label><div class="sk-v2-universe"><span>UNIVERSE</span><b>'+SK_RESEARCH_V2_ASSETS.join(' · ')+'</b></div><button id="sk-v2-run" type="button" '+(skV2Ui.running?'disabled':'')+'>'+(skV2Ui.running?'BATCH LÄUFT …':'V2 MULTI-ASSET STARTEN')+'</button></div>'+
    '<details class="sk-rules"><summary>V2 FROZEN GATE · '+SK_RESEARCH_V2_RULESET+'</summary><small>Mind. 20 Double-Advantage-Trades · PF ≥1,2 · positive Expectancy · Closed-Trade-DD ≤10% · 3/5 positive Zeitfenster · ≥3 positive Assets · max. 50% positive PnL-Konzentration.</small></details>'+
    '<div id="sk-v2-result">'+skV2ResultHtml()+'</div></section>';
}
async function runSkV2Batch(view){
  if(skV2Ui.running)return;
  skV2Ui.days=Number($('#sk-v2-days',view)?.value)||730;skV2Ui.running=true;skV2Ui.error=null;skV2Ui.result=null;skV2Ui.completed=0;
  const out=$('#sk-v2-result',view),btn=$('#sk-v2-run',view),loader=H().marketKlinesHistory;
  if(typeof loader!=='function'){skV2Ui.running=false;skV2Ui.error='Historical 4h data bridge fehlt';if(out)out.innerHTML=skV2ResultHtml();return}
  if(btn){btn.disabled=true;btn.textContent='BATCH LÄUFT …'}
  const runs=[],failures=[],bars=Math.min(9000,skV2Ui.days*6+40);
  try{
    for(const symbol of SK_RESEARCH_V2_ASSETS){
      skV2Ui.progress='LADE '+symbol; if(out)out.innerHTML=skV2ResultHtml();
      try{
        const rows=await loader('4h',bars,symbol);
        if(Array.isArray(rows)&&rows.length>=200)runs.push({symbol,replay:replaySkPaperBot(rows),bars:rows.length,first:rows[0].openTime,last:rows.at(-1).openTime});
        else failures.push(symbol+' <200 Bars');
      }catch(e){failures.push(symbol+' '+String(e?.message||e).slice(0,60))}
      skV2Ui.completed++;skV2Ui.progress='ANALYSIERE '+symbol;if(out)out.innerHTML=skV2ResultHtml();
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(failures.length||runs.length!==SK_RESEARCH_V2_ASSETS.length)throw new Error('V2 DATA GATE · '+(failures.join(' · ')||('geladen '+runs.length+'/'+SK_RESEARCH_V2_ASSETS.length)));
    skV2Ui.result=aggregateSkResearchV2(runs);
  }catch(e){skV2Ui.error=String(e?.message||e)}
  finally{
    skV2Ui.running=false;skV2Ui.progress='';
    if(out)out.innerHTML=skV2ResultHtml();
    if(btn){btn.disabled=false;btn.textContent='V2 MULTI-ASSET STARTEN'}
  }
}
function bindSkV2(view){
  const d=$('#sk-v2-days',view),b=$('#sk-v2-run',view);
  if(d)d.onchange=()=>{skV2Ui.days=Number(d.value)||730};
  if(b)b.onclick=()=>runSkV2Batch(view);
}
function skPaperPanel(){
  const assets=fibAssets(),opts=assets.map(x=>'<option value="'+x+'" '+(x===skLabUi.symbol?'selected':'')+'>'+x+'</option>').join('');
  return '<section class="sk-paper-shell"><div class="sk-paper-head"><div><span>SK PAPERBOT V1</span><b>SEQUENCE BOT · CORE</b><small>0→A→B→C · frozen research rules · 4h</small></div><strong>PAPER ONLY</strong></div>'+
    '<div class="sk-paper-controls"><label>ASSET<select id="sk-asset">'+opts+'</select></label><label>HISTORY<select id="sk-days"><option value="90" '+(skLabUi.days===90?'selected':'')+'>90 TAGE</option><option value="180" '+(skLabUi.days===180?'selected':'')+'>180 TAGE</option><option value="365" '+(skLabUi.days===365?'selected':'')+'>365 TAGE</option></select></label><button id="sk-run" type="button" '+(skLabUi.running?'disabled':'')+'>'+(skLabUi.running?'LÄUFT …':'SK BACKTEST STARTEN')+'</button></div>'+
    skRulesCard()+'<div id="sk-result" class="sk-paper-result">'+skPaperResultHtml()+'</div></section>';
}
function skPaperResultHtml(){
  if(skLabUi.running)return '<div class="sk-paper-loading"><b>SK CORE V1</b><small>4h-Historie laden · Sequenzen chronologisch replayen · Kosten anwenden …</small></div>';
  if(skLabUi.error)return '<div class="sk-paper-error"><b>BACKTEST FEHLER</b><small>'+esc(skLabUi.error)+'</small></div>';
  const r=skLabUi.result,s=r?.summary,g=skLabUi.gate,st=skLabUi.stability;
  if(!r||!s)return '<div class="sk-paper-empty"><b>NOCH KEIN LAUF</b><small>Backtest startet nur nach Klick. Keine API-Abfragen im normalen COMMAND.</small></div>';
  const daPnl=s.doubleAdvantageTrades?skMoney(s.doubleAdvantagePnl):'—',gateTone=g?.pass?'safe':'watch';
  const state=skBotStateLabel(r),seq=r.latestSequence;
  const stateDetail=seq?seq.side+' · 0 '+fibFmt(seq.zero)+' · A '+fibFmt(seq.a)+(seq.gateTouched?' · GATE ✓':' · GATE offen'):'Keine offene Sequenz am Stichprobenende';
  const windows=(st?.windows||[]).map(w=>'<div class="'+(w.positive?'positive':'negative')+'"><span>W'+w.i+' · '+w.trades+' Trades</span><b>'+skMoney(w.pnl)+'</b><small>PF '+skNum(w.profitFactor,2)+'</small></div>').join('');
  const recent=(r.trades||[]).slice(-5).reverse().map(t=>'<div class="sk-trade-row"><span>'+t.side+(t.doubleAdvantage?' · 2×ADV':'')+'</span><b>'+skMoney(t.realizedPnl)+'</b><small>'+t.entryRatios.map(x=>x.toFixed(3)).join('/')+' → '+(t.exitReason||'—')+'</small></div>').join('');
  return '<div class="sk-state-card"><div><span>CURRENT STATE</span><b>'+state+'</b><small>'+stateDetail+'</small></div><strong class="tone-'+gateTone+'">'+(g?.label||'RESEARCH')+'</strong></div>'+
    '<div class="sk-metrics"><div><span>TRADES</span><b>'+s.trades+'</b></div><div><span>PNL</span><b>'+skMoney(s.pnl)+'</b></div><div><span>PF</span><b>'+skNum(s.profitFactor,2)+'</b></div><div><span>WIN RATE</span><b>'+skNum(s.winRate,1)+'%</b></div><div><span>EXPECTANCY</span><b>'+skMoney(s.expectancy)+'</b></div><div><span>MAX DD</span><b>'+skNum(s.maxDrawdownPct,2)+'%</b></div><div><span>LONG / SHORT</span><b>'+s.longTrades+' / '+s.shortTrades+'</b></div><div><span>DOUBLE ADV</span><b>'+s.doubleAdvantageTrades+'</b><small>'+daPnl+'</small></div></div>'+
    '<div class="sk-gate"><span>RESEARCH GATE</span><b>'+(g?.pass?'PASS · KEINE AUTO-PROMOTION':'FAIL / INSUFFICIENT')+'</b><small>'+((g?.reasons||[]).join(' · ')||'Frozen Mindestkriterien erfüllt; unabhängiger Forward-Test bleibt Pflicht.')+'</small></div>'+
    '<div class="sk-section-title"><b>5 ZEITFENSTER</b><small>'+((st?.positiveWindows||0))+'/5 positiv · kein Parameter-Refit</small></div><div class="sk-window-grid">'+windows+'</div>'+
    '<details class="sk-trades"><summary>LETZTE TRADES · '+Math.min(5,s.trades)+'</summary><div>'+recent+'</div></details>'+
    '<div class="sk-source-note">'+(skLabUi.range||'')+' · Gebühren + Slippage aktiv · Ergebnis ist Research, kein Profitabilitätsnachweis.</div>';
}
async function runSkPaperBacktest(view){
  if(skLabUi.running)return;
  skLabUi.symbol=$('#sk-asset',view)?.value||skLabUi.symbol;
  skLabUi.days=Number($('#sk-days',view)?.value)||180;
  skLabUi.running=true;skLabUi.error=null;
  const out=$('#sk-result',view),btn=$('#sk-run',view);
  if(out)out.innerHTML=skPaperResultHtml();
  if(btn){btn.disabled=true;btn.textContent='LÄUFT …'}
  try{
    const loader=H().marketKlinesHistory;
    if(typeof loader!=='function')throw new Error('Historical 4h data bridge fehlt');
    const bars=Math.min(2500,skLabUi.days*6+40),rows=await loader('4h',bars,skLabUi.symbol);
    if(!Array.isArray(rows)||rows.length<100)throw new Error('Zu wenige 4h-Kerzen: '+(rows?.length||0));
    const result=replaySkPaperBot(rows),stability=skChronologicalStability(result.trades,5),gate=evaluateSkPaperGate(result.summary,stability);
    skLabUi.result=result;skLabUi.stability=stability;skLabUi.gate=gate;
    skLabUi.range=new Date(rows[0].openTime).toLocaleDateString('de-DE')+' → '+new Date(rows.at(-1).openTime).toLocaleDateString('de-DE')+' · '+rows.length+'×4h';
  }catch(e){
    skLabUi.error=String(e?.message||e);
  }finally{
    skLabUi.running=false;
    if(out)out.innerHTML=skPaperResultHtml();
    if(btn){btn.disabled=false;btn.textContent='SK BACKTEST STARTEN'}
  }
}
function bindSkPaper(view){
  const a=$('#sk-asset',view),d=$('#sk-days',view),b=$('#sk-run',view);
  if(a)a.onchange=()=>{skLabUi.symbol=a.value};
  if(d)d.onchange=()=>{skLabUi.days=Number(d.value)||180};
  if(b)b.onclick=()=>runSkPaperBacktest(view);
}

function edgeWindowGrid(stability){
  return '<div class="edge-window-grid">'+(stability?.windows||[]).map(w=>'<div class="'+(w.positive?'positive':'negative')+'"><span>W'+w.i+' · '+w.periods+' P</span><b>'+skNum(w.totalReturnPct,2)+'%</b><small>PF '+skNum(w.profitFactor,2)+'</small></div>').join('')+'</div>';
}
function edgeAssetRows(rows){
  return '<div class="edge-asset-list">'+(rows||[]).map(a=>'<div><strong>'+a.symbol+'</strong><span>'+a.periods+' P</span><b>'+skMoney(a.summary?.pnl)+'</b><small>PF '+skNum(a.summary?.profitFactor,2)+'</small></div>').join('')+'</div>';
}
function tsmomEdgeHtml(){
  if(edgeUi.running)return '<div class="edge-loading"><b>'+edgeUi.progress+'</b><small>'+edgeUi.completed+'/'+edgeUi.total+' Assets · Daily public candles</small></div>';
  if(edgeUi.error)return '<div class="sk-paper-error"><b>EDGE BATCH FEHLER</b><small>'+esc(edgeUi.error)+'</small></div>';
  const r=edgeUi.tsmom;if(!r)return '<div class="sk-paper-empty"><b>NOCH KEIN LAUF</b><small>TSMOM startet nur nach Klick. 30/90/365d Signal · monatliches Rebalancing · Vol-Sizing.</small></div>';
  const g=r.gate,s=r.summary;
  return '<div class="edge-ab"><div><span>TSMOM CLASSIC</span><b>'+s.periods+' Perioden</b><small>Return '+skNum(s.totalReturnPct,2)+'% · PF '+skNum(s.profitFactor,2)+' · '+esc(r.engineRevision||'ENGINE')+'</small></div><strong class="tone-'+(g.pass?'safe':'watch')+'">'+g.label+'</strong></div>'+
    '<div class="edge-metrics"><div><span>PNL</span><b>'+skMoney(s.pnl)+'</b></div><div><span>MAX DD</span><b>'+skNum(s.maxDrawdownPct,2)+'%</b></div><div><span>POSITIVE ASSETS</span><b>'+g.positiveAssets+'/'+r.assets.length+'</b></div><div><span>PNL CONCENTRATION</span><b>'+skNum(r.positivePnlConcentrationPct,1)+'%</b></div><div><span>5 WINDOWS</span><b>'+r.stability.positiveWindows+'/5</b></div><div><span>MODEL COST</span><b>'+r.config.costBps+' bps</b><small>pro Exposure-Turnover</small></div></div>'+
    '<div class="edge-gate"><span>FROZEN INTERNAL GATE</span><b>'+(g.pass?'PASS · RESEARCH ONLY':'FAIL / INSUFFICIENT')+'</b><small>'+((g.reasons||[]).join(' · ')||'Keine Live-Freigabe; separater Holdout bleibt Pflicht.')+'</small></div>'+
    '<div class="edge-section-title"><b>ASSET ROBUSTHEIT</b><small>kein Asset-Dropping nach Ergebnis</small></div>'+edgeAssetRows(r.assets)+
    '<div class="edge-section-title"><b>5 ZEITFENSTER</b><small>chronologisch</small></div>'+edgeWindowGrid(r.stability);
}
function xsmomEdgeHtml(){
  if(edgeUi.running)return '<div class="edge-loading"><b>WARTET AUF BATCH</b><small>Gleicher Daily-Datensatz wie TSMOM</small></div>';
  const r=edgeUi.xsmom;if(!r)return '<div class="sk-paper-empty"><b>NOCH KEIN LAUF</b><small>3-Wochen Cross-Sectional Momentum wird im selben Batch berechnet.</small></div>';
  const s=r.summary;
  return '<div class="edge-ab"><div><span>XSMOM 3W · PRICE PROXY</span><b>'+s.periods+' Wochen</b><small>Return '+skNum(s.totalReturnPct,2)+'% · PF '+skNum(s.profitFactor,2)+'</small></div><strong class="tone-watch">PROXY ONLY</strong></div>'+
    '<div class="edge-metrics"><div><span>PNL</span><b>'+skMoney(s.pnl)+'</b></div><div><span>MAX DD</span><b>'+skNum(s.maxDrawdownPct,2)+'%</b></div><div><span>POSITIVE WINDOWS</span><b>'+r.stability.positiveWindows+'/5</b></div><div><span>REBALANCE</span><b>7D</b></div></div>'+
    '<div class="edge-gate"><span>DATA GATE</span><b>NO PROMOTION</b><small>'+r.limitation+' · publizierter Krypto-Faktor benötigt historische Market-Cap-Gewichtung.</small></div>'+
    edgeWindowGrid(r.stability);
}
function fundingEdgeHtml(){
  const e=fundingCarryEvidence();
  const rows=e.evidence.map(x=>'<div><strong>'+x.asset+' · '+x.window+'</strong><b>'+skMoney(x.netUsd)+'</b><small>'+skNum(x.capitalReturnPct,3)+'% Kapitalreturn</small></div>').join('');
  return '<div class="edge-ab"><div><span>FUNDING CARRY</span><b>EXISTING MERIDIAN EVIDENCE</b><small>'+e.ruleset+'</small></div><strong class="tone-watch">'+(e.newEntriesAllowed?'ENTRY ON':'NEW ENTRIES OFF')+'</strong></div>'+
    '<div class="edge-funding-list">'+rows+'</div><div class="edge-gate"><span>STATUS</span><b>'+e.retirementReason.replaceAll('_',' ')+'</b><small>'+e.note+'</small></div>';
}

function holdoutDiagHtml(d){
  if(!d)return'';
  return '<div class="holdout-diag"><div><span>LONG CONTRIB</span><b>'+skNum(d.longContributionPct,2)+'%</b></div><div><span>SHORT CONTRIB</span><b>'+skNum(d.shortContributionPct,2)+'%</b></div><div><span>LONG / SHORT SIGNAL</span><b>'+skNum(d.longSignalSharePct,0)+' / '+skNum(d.shortSignalSharePct,0)+'%</b></div><div><span>AVG EXPOSURE</span><b>'+skNum(d.avgAbsPosition,2)+'×</b></div><div><span>AVG LEVERAGE</span><b>'+skNum(d.avgLeverage,2)+'×</b></div><div><span>COST / |GROSS|</span><b>'+skNum(d.modeledCostVsGrossAbsPct,1)+'%</b></div></div>';
}
function holdoutResultCard(title,subtitle,r){
  if(!r)return '<section class="holdout-card"><div class="holdout-card-head"><div><span>'+title+'</span><b>'+subtitle+'</b></div><strong>NO RUN</strong></div></section>';
  const g=r.gate,s=r.summary;
  return '<section class="holdout-card"><div class="holdout-card-head"><div><span>'+title+'</span><b>'+subtitle+'</b><small>'+r.assets.length+' Assets · '+s.periods+' Perioden · '+esc(r.engineRevision||'ENGINE')+'</small></div><strong class="tone-'+(g.pass?'safe':'watch')+'">'+g.label+'</strong></div>'+
    '<div class="holdout-metrics"><div><span>RETURN</span><b>'+skNum(s.totalReturnPct,2)+'%</b></div><div><span>PF</span><b>'+skNum(s.profitFactor,2)+'</b></div><div><span>PNL</span><b>'+skMoney(s.pnl)+'</b></div><div><span>MAX DD</span><b>'+skNum(s.maxDrawdownPct,2)+'%</b></div><div><span>POS ASSETS</span><b>'+g.positiveAssets+'/'+r.assets.length+'</b></div><div><span>WINDOWS</span><b>'+r.stability.positiveWindows+'/5</b></div></div>'+
    '<div class="holdout-gate"><b>'+(g.pass?'PASS · HOLDOUT TEILBESTANDEN':'FAIL / INSUFFICIENT')+'</b><small>'+((g.reasons||[]).join(' · ')||'Frozen TSMOM Gate erfüllt.')+'</small></div>'+
    holdoutDiagHtml(r.diagnostics)+edgeWindowGrid(r.stability)+'</section>';
}
function tsmomHoldoutHtml(){
  if(holdoutUi.running)return '<div class="edge-loading"><b>'+holdoutUi.progress+'</b><small>'+holdoutUi.completed+'/'+holdoutUi.total+' Asset-Ladevorgänge · Regeln unverändert</small></div>';
  if(holdoutUi.error)return '<div class="sk-paper-error"><b>HOLDOUT FEHLER</b><small>'+esc(holdoutUi.error)+'</small></div>';
  if(!holdoutUi.legacy||!holdoutUi.transfer)return '<div class="sk-paper-empty"><b>NOCH KEIN HOLDOUT</b><small>H1: 05/2020–07/2022 · H2: neues 8-Asset-Universum über 1460 Tage.</small></div>';
  const c=holdoutUi.combined;
  return '<div class="holdout-combined '+(c.pass?'pass':'fail')+'"><span>COMBINED HOLDOUT</span><b>'+c.label+'</b><small>'+(c.reasons.length?c.reasons.join(' · '):'Beide unabhängigen Gates bestanden · trotzdem keine Auto-Promotion.')+'</small></div>'+
    holdoutResultCard('H1 · TIME HOLDOUT','2020-05 → 2022-07',holdoutUi.legacy)+
    holdoutResultCard('H2 · TRANSFER HOLDOUT',TSMOM_TRANSFER_ASSETS.join(' · '),holdoutUi.transfer);
}
function tsmomHoldoutPanel(){
  return '<section class="holdout-shell"><div class="edge-strategy-head"><div><span>01B · TSMOM HOLDOUT V1</span><b>INDEPENDENT VALIDATION</b></div><small>gleiche Regeln · neue Zeit / neue Assets</small></div>'+
    '<div class="holdout-protocol"><span>FROZEN</span><b>'+TSMOM_HOLDOUT_V1_RULESET+'</b><small>H1 und H2 müssen beide denselben TSMOM-Gate bestehen. Kein Asset-Dropping.</small></div>'+
    '<button id="holdout-run" class="holdout-run" type="button" '+(holdoutUi.running?'disabled':'')+'>'+(holdoutUi.running?'HOLDOUT LÄUFT …':'TSMOM HOLDOUT STARTEN')+'</button>'+
    '<div id="holdout-result">'+tsmomHoldoutHtml()+'</div></section>';
}
async function runTsmomHoldout(view){
  if(holdoutUi.running)return;
  holdoutUi.running=true;holdoutUi.error=null;holdoutUi.legacy=null;holdoutUi.transfer=null;holdoutUi.combined=null;holdoutUi.completed=0;
  const out=$('#holdout-result',view),btn=$('#holdout-run',view),loader=H().marketKlinesHistory;
  if(typeof loader!=='function'){holdoutUi.running=false;holdoutUi.error='Historical daily data bridge fehlt';if(out)out.innerHTML=tsmomHoldoutHtml();return}
  if(btn){btn.disabled=true;btn.textContent='HOLDOUT LÄUFT …'}
  const legacyData={},transferData={},h1Failures=[],h2Failures=[];
  try{
    for(const symbol of DOCUMENTED_EDGE_ASSETS){
      holdoutUi.progress='H1 ALTZEIT · '+symbol;if(out)out.innerHTML=tsmomHoldoutHtml();
      try{
        const rows=await loader('1d',2800,symbol);
        if(Array.isArray(rows)&&rows.length>=500)legacyData[symbol]=rows;
        else h1Failures.push(symbol+' <500 Bars');
      }catch(e){h1Failures.push(symbol+' '+String(e?.message||e).slice(0,60))}
      holdoutUi.completed++;await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(h1Failures.length||Object.keys(legacyData).length!==DOCUMENTED_EDGE_ASSETS.length)throw new Error('H1 SOURCE GATE · '+(h1Failures.join(' · ')||('geladen '+Object.keys(legacyData).length+'/'+DOCUMENTED_EDGE_ASSETS.length)));
    holdoutUi.legacy=runLegacyTimeHoldout(legacyData);

    for(const symbol of TSMOM_TRANSFER_ASSETS){
      holdoutUi.progress='H2 TRANSFER · '+symbol;if(out)out.innerHTML=tsmomHoldoutHtml();
      try{
        const rows=await loader('1d',1860,symbol);
        if(Array.isArray(rows)&&rows.length>=1700)transferData[symbol]=rows;
        else h2Failures.push(symbol+' <1700 Bars');
      }catch(e){h2Failures.push(symbol+' '+String(e?.message||e).slice(0,60))}
      holdoutUi.completed++;await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(h2Failures.length||Object.keys(transferData).length!==TSMOM_TRANSFER_ASSETS.length)throw new Error('H2 SOURCE GATE · '+(h2Failures.join(' · ')||('geladen '+Object.keys(transferData).length+'/'+TSMOM_TRANSFER_ASSETS.length)));
    holdoutUi.transfer=runTransferUniverseHoldout(transferData);
    holdoutUi.combined=evaluateCombinedTsmomHoldout({legacy:holdoutUi.legacy,transfer:holdoutUi.transfer});
  }catch(e){holdoutUi.error=String(e?.message||e)}
  finally{
    holdoutUi.running=false;holdoutUi.progress='';
    if(out)out.innerHTML=tsmomHoldoutHtml();
    if(btn){btn.disabled=false;btn.textContent='TSMOM HOLDOUT STARTEN'}
  }
}
function bindTsmomHoldout(view){
  const b=$('#holdout-run',view);if(b)b.onclick=()=>runTsmomHoldout(view);
}

function profitAgentCandidateHtml(name,result){
  if(!result)return '<article class="profit-agent-candidate empty"><div><span>'+esc(name)+'</span><b>NOT RUN</b></div><small>Keine Discovery-Auswertung.</small></article>';
  const m=result.summary||{},g=result.profitGate||result.gate||{},assets=result.assets||[],positiveAssets=g.positiveAssets??assets.filter(x=>x?.summary?.pnl>0).length,conc=result.positivePnlConcentrationPct;
  return '<article class="profit-agent-candidate '+(g.pass?'pass':'fail')+'"><div class="profit-agent-candidate-head"><div><span>'+esc(name)+'</span><b>'+esc(g.label||'PROFIT GATE')+'</b></div><strong class="tone-'+(g.pass?'safe':'watch')+'">'+(g.pass?'PASS':'FAIL')+'</strong></div><div class="profit-agent-metrics"><div><span>NET RETURN</span><b>'+skNum(m.totalReturnPct,2)+'%</b></div><div><span>PF</span><b>'+skNum(m.profitFactor,2)+'</b></div><div><span>MAX DD</span><b>'+skNum(m.maxDrawdownPct,2)+'%</b></div><div><span>WINDOWS</span><b>'+Number(result.stability?.positiveWindows||0)+'/5</b></div><div><span>POS ASSETS</span><b>'+positiveAssets+'/'+assets.length+'</b></div><div><span>CONCENTRATION</span><b>'+skNum(conc,1)+'%</b></div></div><small>'+((g.reasons||[]).join(' · ')||'Frozen Profit Gate erfüllt · nur Discovery, keine Promotion.')+'</small></article>';
}
function profitAgentResultHtml(){
  if(profitAgentUi.running)return '<div class="edge-loading"><b>'+esc(profitAgentUi.progress||'PROFIT BATCH')+'</b><small>'+profitAgentUi.completed+'/'+profitAgentUi.total+' Assets geladen · keine Parameteränderung</small></div>';
  if(profitAgentUi.error)return '<div class="sk-paper-error"><b>PROFIT AGENT FEHLER</b><small>'+esc(profitAgentUi.error)+'</small></div>';
  const r=profitAgentUi.result;if(!r)return '<div class="sk-paper-empty"><b>NOCH KEIN PROFIT BATCH</b><small>TSMOM Classic vs Persistent TSMOM vs Donchian Trend · identische Research-only Safety-Grenzen.</small></div>';
  const leader=r.discoveryLeader||'KEIN PASS',leaderTone=r.discoveryLeader?'safe':'watch';
  return '<div class="profit-agent-decision"><span>DISCOVERY LEADER</span><b class="tone-'+leaderTone+'">'+esc(leader)+'</b><small>'+esc(r.decision)+' · NEXT '+esc(r.nextStage)+'</small></div><div class="profit-agent-grid">'+
    profitAgentCandidateHtml('TSMOM CLASSIC',r.candidates?.TSMOM_CLASSIC)+
    profitAgentCandidateHtml('PERSISTENT TSMOM V1',r.candidates?.PERSISTENT_TSMOM_V1)+
    profitAgentCandidateHtml('DONCHIAN TREND V1',r.candidates?.DONCHIAN_TREND_V1)+
    '</div><small class="profit-agent-note">Gewinnrang erst nach Profit/Risk-Gate. Kein Auto-Promotion- oder Live-Pfad.</small>';
}
function profitAgentPanel(){
  return '<section class="profit-agent-shell"><div class="edge-head"><div><span>SPECIAL AGENT · PAPER BOTS</span><b>PROFIT DISCOVERY V1</b><small>Gewinnmaximierung nach Kosten · mit harten Drawdown/Breadth-Gates</small></div><strong>RESEARCH ONLY</strong></div><div class="edge-controls"><label>HISTORY<select id="profit-agent-days"><option value="730" '+(profitAgentUi.days===730?'selected':'')+'>730 TAGE</option><option value="1460" '+(profitAgentUi.days===1460?'selected':'')+'>1460 TAGE</option></select></label><div><span>UNIVERSE</span><b>'+PAPERBOT_PROFIT_AGENT_V1_ASSETS.join(' · ')+'</b></div><button id="profit-agent-run" type="button" '+(profitAgentUi.running?'disabled':'')+'>'+(profitAgentUi.running?'BATCH LÄUFT …':'PROFIT BATCH STARTEN')+'</button></div><details class="edge-rules"><summary>FROZEN PROTOCOL · '+PAPERBOT_PROFIT_AGENT_V1_RULESET+'</summary><small>Classic 30/90/365d TSMOM · Persistent TSMOM nur bei 3/3 Horizont-Alignment · Donchian 55/20 · Vol-Sizing · Kosten · keine Martingale-/Live-Änderung.</small></details><div id="profit-agent-result">'+profitAgentResultHtml()+'</div></section>';
}
async function runProfitAgentBatch(view){
  if(profitAgentUi.running)return;
  profitAgentUi.days=Number($('#profit-agent-days',view)?.value)||1460;profitAgentUi.running=true;profitAgentUi.error=null;profitAgentUi.result=null;profitAgentUi.completed=0;
  const out=$('#profit-agent-result',view),btn=$('#profit-agent-run',view),loader=H().marketKlinesHistory;
  if(typeof loader!=='function'){profitAgentUi.running=false;profitAgentUi.error='Historical daily data bridge fehlt';if(out)out.innerHTML=profitAgentResultHtml();return}
  if(btn){btn.disabled=true;btn.textContent='BATCH LÄUFT …'}
  const data={},failures=[],bars=Math.min(9000,profitAgentUi.days+420);
  try{
    for(const symbol of PAPERBOT_PROFIT_AGENT_V1_ASSETS){
      profitAgentUi.progress='LADE '+symbol;if(out)out.innerHTML=profitAgentResultHtml();
      try{
        const rows=await loader('1d',bars,symbol);
        if(Array.isArray(rows)&&rows.length>=500)data[symbol]=rows;
        else failures.push(symbol+' <500 Bars');
      }catch(e){failures.push(symbol+' '+String(e?.message||e).slice(0,60))}
      profitAgentUi.completed++;await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(failures.length||Object.keys(data).length!==PAPERBOT_PROFIT_AGENT_V1_ASSETS.length)throw new Error('PROFIT DATA GATE · '+(failures.join(' · ')||('geladen '+Object.keys(data).length+'/'+PAPERBOT_PROFIT_AGENT_V1_ASSETS.length)));
    profitAgentUi.progress='BERECHNE 3 KANDIDATEN';if(out)out.innerHTML=profitAgentResultHtml();
    profitAgentUi.result=runPaperBotProfitAgentV1(data);
  }catch(e){profitAgentUi.error=String(e?.message||e)}
  finally{
    profitAgentUi.running=false;profitAgentUi.progress='';
    if(out)out.innerHTML=profitAgentResultHtml();
    if(btn){btn.disabled=false;btn.textContent='PROFIT BATCH STARTEN'}
  }
}
function bindProfitAgent(view){
  const d=$('#profit-agent-days',view),b=$('#profit-agent-run',view);
  if(d)d.onchange=()=>{profitAgentUi.days=Number(d.value)||1460};
  if(b)b.onclick=()=>runProfitAgentBatch(view);
}

function documentedEdgePanel(){
  return '<section class="documented-edge-shell"><div class="edge-head"><div><span>DOCUMENTED EDGE LAB</span><b>PUBLISHED STRATEGY REPLICATIONS</b><small>Evidenz ≠ Garantie · Regeln vor Ergebnis eingefroren</small></div><strong>RESEARCH ONLY</strong></div>'+
    '<div class="edge-controls"><label>HISTORY<select id="edge-days"><option value="730" '+(edgeUi.days===730?'selected':'')+'>730 TAGE</option><option value="1460" '+(edgeUi.days===1460?'selected':'')+'>1460 TAGE</option></select></label><div><span>UNIVERSE</span><b>'+DOCUMENTED_EDGE_ASSETS.join(' · ')+'</b></div><button id="edge-run" type="button" '+(edgeUi.running?'disabled':'')+'>'+(edgeUi.running?'BATCH LÄUFT …':'EDGE BATCH STARTEN')+'</button></div>'+
    '<details class="edge-rules"><summary>FROZEN PROTOCOL · '+DOCUMENTED_EDGE_V1_RULESET+'</summary><small>TSMOM: 30/90/365d, monatlich, Vol-Sizing, Kosten. XSMOM: 21d + 1d Skip, wöchentlich, Price-only Proxy. Funding Carry: bestehender Meridian-Pfad bleibt eingefroren.</small></details>'+
    '<section class="edge-strategy"><div class="edge-strategy-head"><div><span>01 · TIME-SERIES MOMENTUM</span><b>TSMOM CLASSIC</b></div><small>höchste Replikationsqualität</small></div><div id="edge-tsmom">'+tsmomEdgeHtml()+'</div></section>'+tsmomHoldoutPanel()+
    '<section class="edge-strategy"><div class="edge-strategy-head"><div><span>02 · FUNDING / CARRY</span><b>DELTA-NEUTRAL EVIDENCE</b></div><small>bestehender Research-Pfad</small></div>'+fundingEdgeHtml()+'</section>'+
    '<section class="edge-strategy"><div class="edge-strategy-head"><div><span>03 · CROSS-SECTIONAL MOMENTUM</span><b>3W PRICE-SORT</b></div><small>Proxy bis Market-Cap-Historie verfügbar</small></div><div id="edge-xsmom">'+xsmomEdgeHtml()+'</div></section>';
}
async function runDocumentedEdgeBatch(view){
  if(edgeUi.running)return;
  edgeUi.days=Number($('#edge-days',view)?.value)||1460;edgeUi.running=true;edgeUi.error=null;edgeUi.tsmom=null;edgeUi.xsmom=null;edgeUi.completed=0;edgeUi.loadedAssets=[];
  const t=$('#edge-tsmom',view),x=$('#edge-xsmom',view),btn=$('#edge-run',view),loader=H().marketKlinesHistory;
  if(typeof loader!=='function'){edgeUi.running=false;edgeUi.error='Historical daily data bridge fehlt';if(t)t.innerHTML=tsmomEdgeHtml();return}
  if(btn){btn.disabled=true;btn.textContent='BATCH LÄUFT …'}
  const data={},failures=[],bars=Math.min(9000,edgeUi.days+400);
  try{
    for(const symbol of DOCUMENTED_EDGE_ASSETS){
      edgeUi.progress='LADE '+symbol; if(t)t.innerHTML=tsmomEdgeHtml();if(x)x.innerHTML=xsmomEdgeHtml();
      try{
        const rows=await loader('1d',bars,symbol);
        if(Array.isArray(rows)&&rows.length>=400){data[symbol]=rows;edgeUi.loadedAssets.push(symbol)}
        else failures.push(symbol+' <400 Bars');
      }catch(e){failures.push(symbol+' '+String(e?.message||e).slice(0,60))}
      edgeUi.completed++;await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(failures.length||Object.keys(data).length!==DOCUMENTED_EDGE_ASSETS.length)throw new Error('EDGE DATA GATE · '+(failures.join(' · ')||('geladen '+Object.keys(data).length+'/'+DOCUMENTED_EDGE_ASSETS.length)));
    edgeUi.progress='BERECHNE TSMOM';if(t)t.innerHTML=tsmomEdgeHtml();
    edgeUi.tsmom=runTsmomClassic(data);
    edgeUi.progress='BERECHNE XSMOM';if(x)x.innerHTML=xsmomEdgeHtml();
    edgeUi.xsmom=runXsmom3wPriceProxy(data);
  }catch(e){edgeUi.error=String(e?.message||e)}
  finally{
    edgeUi.running=false;edgeUi.progress='';
    if(t)t.innerHTML=tsmomEdgeHtml();if(x)x.innerHTML=xsmomEdgeHtml();
    if(btn){btn.disabled=false;btn.textContent='EDGE BATCH STARTEN'}
  }
}
function bindDocumentedEdge(view){
  const d=$('#edge-days',view),b=$('#edge-run',view);
  if(d)d.onchange=()=>{edgeUi.days=Number(d.value)||1460};
  if(b)b.onclick=()=>runDocumentedEdgeBatch(view);
}

function labOverviewHtml(){
  const discovery=edgeUi.tsmom?(edgeUi.tsmom.gate?.pass?'PASS':'FAIL'):'NOT RUN',holdout=holdoutUi.combined?(holdoutUi.combined.pass?'PASS':'FAIL'):'NOT RUN',sk=skV2Ui.result?(skV2Ui.result.gate?.pass?'V2 PASS':'V2 FAIL'):'FROZEN',profit=profitAgentUi.result?(profitAgentUi.result.discoveryLeader||'NO PASS'):'NOT RUN';
  return '<div><span>PROFIT AGENT</span><b class="tone-'+(profitAgentUi.result?.discoveryLeader?'safe':profitAgentUi.result?'watch':'muted')+'">'+esc(profit)+'</b><small>3 frozen candidates · profit-first gate</small></div><div><span>TSMOM DISCOVERY</span><b class="tone-'+(discovery==='PASS'?'safe':discovery==='FAIL'?'watch':'muted')+'">'+discovery+'</b><small>interner Gate · kein Beweis</small></div><div><span>TSMOM HOLDOUT</span><b class="tone-'+(holdout==='PASS'?'safe':holdout==='FAIL'?'watch':'muted')+'">'+holdout+'</b><small>unabhängige Validierung</small></div><div><span>SK SYSTEM</span><b>'+sk+'</b><small>V1/V2 Research-Benchmark</small></div><div><span>EXECUTION</span><b>OFF</b><small>Research only · keine Orders</small></div>';
}
function paperOverviewTrusted(d){
  return !!d&&d.schemaVersion==='8.0-PAPER-OVERVIEW-V1'&&d.researchOnly===true&&d.executionImpact===false&&d?.status?.safety?.paperTrading===true&&d?.status?.safety?.liveTrading===false;
}
function paperTradePf(trades){
  const xs=(Array.isArray(trades)?trades:[]).filter(x=>Number.isFinite(Number(x?.realized))),wins=xs.filter(x=>Number(x.realized)>0),losses=xs.filter(x=>Number(x.realized)<0),gp=wins.reduce((a,x)=>a+Number(x.realized),0),gl=Math.abs(losses.reduce((a,x)=>a+Number(x.realized),0));
  return gl>0?gp/gl:gp>0?99:null;
}
function paperLifecycle(src,baseline=false){
  if(baseline)return'BASELINE REFERENCE';
  const raw=typeof src?.lifecycle==='string'?src.lifecycle:String(src?.lifecycle?.status||src?.status||'').toUpperCase();
  if(raw.includes('STOPPED'))return'STOPPED REVIEW';
  if(raw.includes('WAITING'))return'WAITING';
  if(raw.includes('RETIRED'))return'RETIRED';
  if(raw.includes('ACTIVE_PAPER'))return'PROSPECTIVE PAPER';
  if(src?.enabled===false)return'INACTIVE';
  return raw||'PAPER / RESEARCH';
}
function paperNum(v){return v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null}
function paperModelStats(name,src,baseline=false){
  const a=src?.account||{},start=paperNum(a.startEquity),equity=paperNum(a.equity),peak=paperNum(a.peakEquity),realized=paperNum(a.realizedPnl),unrealized=paperNum(a.unrealizedPnl),tradesPresent=Array.isArray(src?.trades),trades=tradesPresent?src.trades:[],closedRaw=src?.closedCount??(tradesPresent?trades.length:null)??(Array.isArray(src?.closedCycles)?src.closedCycles.length:null),openRaw=src?.openCount??(Array.isArray(src?.openPositions)?src.openPositions.length:null)??(Array.isArray(src?.positions)?src.positions.length:null);
  const pnl=start!=null&&equity!=null?equity-start:realized!=null||unrealized!=null?(realized??0)+(unrealized??0):null;
  const explicitDd=paperNum(a.drawdownPct),dd=explicitDd!=null?explicitDd:peak!=null&&peak>0&&equity!=null?Math.max(0,(peak-equity)/peak*100):null;
  const explicitPf=paperNum(src?.profitFactor),pf=explicitPf!=null?explicitPf:baseline&&tradesPresent?paperTradePf(trades):null;
  const explicitWr=paperNum(src?.winRate),wr=explicitWr!=null?explicitWr:tradesPresent&&trades.length?trades.filter(x=>Number(x?.realized)>0).length/trades.length*100:null;
  return{name,baseline,src,equity,pnl,dd,closed:paperNum(closedRaw),open:paperNum(openRaw),pf,wr,phase:paperLifecycle(src,baseline),ruleset:src?.ruleset||null,updatedAt:src?.updatedAt||src?.lastScanAt||null};
}
function paperModelCard(m){
  const h=H(),pnlTone=m.pnl==null?'muted':m.pnl>0?'safe':m.pnl<0?'danger':'muted',ddTone=m.dd==null?'muted':m.dd>=8?'danger':m.dd>=5?'watch':'safe';
  return '<article class="paper-model-card"><div class="paper-model-head"><div><span>'+esc(m.name)+'</span><b>'+esc(m.phase)+'</b><small>'+esc(m.ruleset||'independent paper ledger')+'</small></div><strong class="tone-'+pnlTone+'">'+(m.pnl==null?'P&L —':h.money?.(m.pnl))+'</strong></div><div class="paper-model-grid"><span>EQUITY <b>'+(m.equity==null?'—':h.money?.(m.equity))+'</b></span><span>MAX DD <b class="tone-'+ddTone+'">'+(m.dd==null?'—':skNum(m.dd,2)+'%')+'</b></span><span>CLOSED <b>'+(m.closed==null?'—':m.closed)+'</b></span><span>OPEN <b>'+(m.open==null?'—':m.open)+'</b></span><span>PF <b>'+(m.pf==null?'—':skNum(m.pf,2))+'</b></span><span>WIN RATE <b>'+(m.wr==null?'—':skNum(m.wr,1)+'%')+'</b></span></div></article>';
}
function paperR42Html(rows){
  const xs=Array.isArray(rows)?rows:[];
  if(!xs.length)return '<section class="paper-cohort-empty"><b>R42 · NO DATA</b><small>Noch keine Research-Runtime-Zusammenfassung verfügbar.</small></section>';
  return '<section class="paper-cohort-grid">'+xs.map(x=>'<article><div><span>'+esc(x.id||'R42')+'</span><b>'+esc(x.lifecycle||'UNKNOWN')+'</b></div><strong>'+(x.pnl==null?'P&L —':skMoney(x.pnl))+'</strong><small>CLOSED '+(x.closedTrades??'—')+' · OPEN '+(x.openTrades??'—')+' · PF '+(x.profitFactor==null?'—':skNum(x.profitFactor,2))+'</small></article>').join('')+'</section>';
}
function paperCockpitHtml(){
  const d=paperCockpitUi.data,h=H();
  if(paperCockpitUi.loading&&!d)return '<section class="paper-cockpit-state"><b>PAPER OVERVIEW WIRD GELADEN …</b><small>Geschützte Read-only Engine-Daten · keine Order-Aktion.</small></section>';
  if(!d)return '<section class="paper-cockpit-state tone-watch"><b>PAPER OVERVIEW NICHT VERFÜGBAR</b><small>'+esc(paperCockpitUi.error||'Noch kein geschützter Paper-Snapshot geladen.')+'</small></section>';
  if(!paperOverviewTrusted(d))return '<section class="paper-cockpit-state tone-danger"><b>PAPER SAFETY GUARD BLOCKED</b><small>Schema/Safety-Flags entsprechen nicht dem erwarteten Research-only Paper-Vertrag. Keine Performance-Aussage.</small></section>';
  const ageMs=Date.now()-Date.parse(String(d.generatedAt||'')),age=Number.isFinite(ageMs)?h.ageText?.(Math.max(0,ageMs))||'—':'—',fresh=Number.isFinite(ageMs)&&ageMs<=2*60*1000;
  const models=[
    paperModelStats('BASELINE 6.2',d.baseline,true),
    paperModelStats('CHALLENGER V2',d.challengerV2),
    paperModelStats('CHALLENGER V3',d.challengerV3),
    paperModelStats('DIRECTIONAL V4',d.directionalV4),
    paperModelStats('FUNDING CARRY V2',d.fundingCarryV2)
  ];
  const active=models.filter(x=>!['WAITING','INACTIVE','RETIRED'].includes(x.phase)).length,engine=d?.status?.engine||{},db=d?.status?.db||{};
  const warning=paperCockpitUi.error?'<section class="paper-refresh-warning"><b>REFRESH FEHLER</b><small>'+esc(paperCockpitUi.error)+' · letzter gültiger Snapshot bleibt sichtbar.</small></section>':'';
  return '<section class="paper-summary-grid"><div><span>ENGINE</span><b class="tone-'+(engine.running?'safe':'watch')+'">'+(engine.running?'RUNNING':'CHECK')+'</b><small>'+esc(engine.marketFresh===false?'Market stale':'Paper engine')+'</small></div><div><span>SAFETY</span><b class="tone-safe">PAPER ONLY</b><small>liveTrading=false</small></div><div><span>MODELS</span><b>'+active+' / '+models.length+'</b><small>aktive/auswertbare Ledger</small></div><div><span>SNAPSHOT</span><b class="tone-'+(fresh?'safe':'watch')+'">'+esc(age)+'</b><small>'+esc(d.generatedAt||'—')+'</small></div><div><span>DB</span><b class="tone-'+(db.ok?'safe':'watch')+'">'+(db.ok?'READY':'CHECK')+'</b><small>'+esc(db.mode||db.status||'protected state')+'</small></div></section>'+warning+
    '<section class="paper-safety-note"><b>VALIDATION ONLY</b><small>Equity, P&L, DD und Trades stammen aus unabhängigen Paper-Ledgern. Das Cockpit bewertet keinen Gewinner und autorisiert keine Promotion oder Live-Ausführung.</small></section>'+
    '<div class="section-title"><h2>PAPER MODELS</h2><small>feste Reihenfolge · keine Performance-Sortierung</small></div><section class="paper-model-stack">'+models.map(paperModelCard).join('')+'</section>'+
    '<div class="section-title"><h2>R42 RESEARCH COHORTS</h2><small>separate Research-Runtime · keine Vermischung mit Paper-Equity</small></div>'+paperR42Html(d.researchR42);
}
async function loadPaperCockpit(force=false){
  const b=bridge(),now=Date.now();
  if(paperCockpitUi.loading)return;
  if(!force&&paperCockpitUi.data&&now-paperCockpitUi.loadedAt<30000)return;
  if(typeof b?.paperOverview!=='function'){paperCockpitUi.error='Paper overview bridge fehlt';renderPaperCockpit(true);return}
  paperCockpitUi.loading=true;paperCockpitUi.error=null;renderPaperCockpit(true);
  try{
    const d=await b.paperOverview();
    if(!paperOverviewTrusted(d))throw new Error('PAPER_OVERVIEW_CONTRACT_INVALID');
    paperCockpitUi.data=d;paperCockpitUi.loadedAt=Date.now();
  }catch(e){paperCockpitUi.error=String(e?.message||e).slice(0,140)}
  finally{paperCockpitUi.loading=false;if(activeViewKey()==='paper')renderPaperCockpit(true)}
}
function renderPaperCockpit(force=false){
  const view=$('#view-paper');if(!view)return;
  view.innerHTML='<section class="v10-mode-banner" data-tone="paper"><div><span>PAPER</span><b>BOT VALIDATION COCKPIT</b></div><small>Echte geschützte Paper-Ledger · Equity + DD + Trades · read-only</small></section>'+dataStateStripHtml('paper')+'<section class="paper-cockpit-toolbar"><button type="button" data-paper-back>← '+esc(contextReturnLabel('paper','SCANNER'))+'</button><div><span>PAPER OVERVIEW V1</span><small>keine Auto-Promotion · keine Live-Orders</small></div><div class="paper-cockpit-actions"><button type="button" data-paper-lab>LAB</button><button type="button" data-paper-refresh '+(paperCockpitUi.loading?'disabled':'')+'>'+(paperCockpitUi.loading?'SYNC…':'AKTUALISIEREN')+'</button></div></section>'+paperCockpitHtml();
  $('[data-paper-back]',view)?.addEventListener('click',()=>contextualBack('paper','research','research'));
  $('[data-paper-lab]',view)?.addEventListener('click',()=>showSecondaryView('more','research'));
  $('[data-paper-refresh]',view)?.addEventListener('click',()=>loadPaperCockpit(true));
  if(!paperCockpitUi.loading&&(!paperCockpitUi.data||Date.now()-paperCockpitUi.loadedAt>=30000))queueMicrotask(()=>loadPaperCockpit(false));
}
function renderLab(){
  const view=$('#view-more'),b=bridge();if(!view||!b)return;
  if(!$('.bt-control',view)&&!$('.bt-result',view)){
    view.innerHTML=b.renderResearch?.()||'<section class="card">LAB nicht verfügbar.</section>';
    b.bindResearch?.('more');
  }
  banner('#view-more','LAB','RESEARCH HUB','Dokumentierte Strategien + interne Hypothesen · keine Orders','paper');
  let dataState=$(':scope > .data-state-strip',view);
  const dataStateHtml=dataStateStripHtml('lab');
  if(!dataState){const box=document.createElement('div');box.innerHTML=dataStateHtml;dataState=box.firstElementChild;$('.v10-mode-banner',view)?.insertAdjacentElement('afterend',dataState)}
  else if(dataState.outerHTML!==dataStateHtml)dataState.outerHTML=dataStateHtml;
  let back=$('.lab-backbar',view);if(!back){back=document.createElement('section');back.className='lab-backbar';$('.v10-mode-banner',view)?.insertAdjacentElement('afterend',back)}
  back.innerHTML='<button type="button" data-lab-back>← '+esc(contextReturnLabel('more','SCANNER'))+'</button><small>LAB ist Research-only und kein Haupttab · Rücksprung folgt dem Aufrufkontext.</small>';$('[data-lab-back]',back)?.addEventListener('click',()=>contextualBack('more','research','research'));
  $('.hero',view)?.remove();

  if(!$('.profit-agent-module',view)){
    const module=document.createElement('details');module.className='research-module profit-agent-module';module.open=true;
    module.innerHTML='<summary><span>PROFIT SPECIAL AGENT</span><small>TSMOM · Persistent Trend · Donchian · frozen discovery</small></summary><div class="research-module-body">'+profitAgentPanel()+'</div>';
    const host=$('.bt-control',view);(host||view.firstElementChild)?.insertAdjacentElement(host?'beforebegin':'afterend',module);
    bindProfitAgent(view);
  }

  if(!$('.documented-edge-module',view)){
    const module=document.createElement('details');module.className='research-module documented-edge-module';module.open=true;
    module.innerHTML='<summary><span>DOCUMENTED EDGE LAB</span><small>TSMOM · Funding Carry · XSMOM</small></summary><div class="research-module-body">'+documentedEdgePanel()+'</div>';
    const host=$('.bt-control',view);(host||view.firstElementChild)?.insertAdjacentElement(host?'beforebegin':'afterend',module);
    bindDocumentedEdge(view);bindTsmomHoldout(view);
  }

  if(!$('.sk-system-module',view)){
    const module=document.createElement('details');module.className='research-module sk-system-module';
    module.innerHTML='<summary><span>SK SYSTEM LAB</span><small>Core V1 + Research V2 A/B · eingefroren</small></summary><div class="research-module-body">'+skPaperPanel()+skV2Panel()+'</div>';
    const host=$('.bt-control',view);(host||view.firstElementChild)?.insertAdjacentElement(host?'beforebegin':'afterend',module);
    bindSkPaper(view);bindSkV2(view);
  }

  if(!$('.profit-lock-module',view)){
    const control=$('.bt-control',view);
    if(control){
      const mod=document.createElement('details');mod.className='research-module profit-lock-module';
      mod.innerHTML='<summary><span>PROFIT LOCK LAB</span><small>Paired Exit-Policy Test</small></summary><div class="research-module-body"></div>';
      control.insertAdjacentElement('beforebegin',mod);
      const body=$('.research-module-body',mod);
      const nodes=[control,$('.bt-error',view),$('.bt-result',view),...$$('.card',view).filter(x=>/Warum dieser Test/i.test(x.textContent||''))].filter(Boolean);
      nodes.forEach(n=>body.appendChild(n));
    }
  }

  let overview=$('.lab-overview',view);
  if(!overview){overview=document.createElement('section');overview.className='lab-overview';$('.profit-agent-module',view)?.insertAdjacentElement('beforebegin',overview);}
  const nextOverview=labOverviewHtml();if(overview&&overview.innerHTML!==nextOverview)overview.innerHTML=nextOverview;
  let note=$('.lab-validation-note',view);
  if(!note){note=document.createElement('section');note.className='lab-validation-note';overview?.insertAdjacentElement('afterend',note);}
  const nextNote='<b>VALIDATION LADDER</b><small>Discovery PASS ≠ bestätigtes Edge. Deep-Audit r20 korrigiert Accounting/Lookahead; frühere TSMOM/SK-Ergebnisse müssen neu gerechnet werden. Holdout muss unabhängig bestehen; danach höchstens Paper-Shadow/Forward-Test, nie Auto-Promotion.</small>';
  if(note&&note.innerHTML!==nextNote)note.innerHTML=nextNote;
}
function localVisualQaConfig(){
  if(!['127.0.0.1','localhost'].includes(location.hostname))return null;
  const q=new URLSearchParams(location.search);if(q.get('visualQa')!=='1')return null;
  const allowed=['command','depot','bots','market','research'],flows=['primary-reset','asset-return','bot-toggle','bot-filter-return','scanner-forecast-return','stale-recovery'],dataModes=['fresh','stale','error'],view=allowed.includes(q.get('qaView'))?q.get('qaView'):'command',scroll=Math.max(0,Math.min(6000,Number(q.get('qaScroll'))||0)),flow=flows.includes(q.get('qaFlow'))?q.get('qaFlow'):null,dataMode=dataModes.includes(q.get('qaData'))?q.get('qaData'):'fresh';
  return{view,scroll,flow,dataMode};
}
function setLocalVisualQaDataMode(mode,s=S(),now=Date.now()){
  if(!s)return;
  const staleAt=now-20*60*1000,setTimes=ts=>{
    s.botFeedUpdatedAt=ts;s.syncedAt=ts;s.marketSyncedAt=ts;s.marketPriceSyncedAt=ts;
    Object.values(s.assetIntel||{}).forEach(x=>{if(x)x.updatedAt=ts});
    Object.values(s.priceChecks||{}).forEach(x=>{if(x)x.updatedAt=ts});
    if(s.pionexAccount){s.pionexAccount.updatedAt=new Date(ts).toISOString();s.pionexAccount.snapshotAt=new Date(ts).toISOString()}
  };
  if(mode==='stale'){
    setTimes(staleAt);s.botFeedTimestampTrusted=true;s.botFeedStatus='WALLET_DETAIL_OK';s.source='STALE';s.marketError=null;s.marketPriceError=null;
    s.pionexBotSync={status:'OK',diagnostics:{listRows:Number(s.bots?.length||0)}};s.pionexAccountSync={status:'OK'};return;
  }
  if(mode==='error'){
    setTimes(staleAt);s.botFeedTimestampTrusted=true;s.botFeedStatus='ERROR';s.source='ERROR';s.error='VISUAL_QA_FORCED_ERROR';s.marketError='VISUAL_QA_FORCED_ERROR';s.marketPriceError='VISUAL_QA_FORCED_ERROR';
    s.pionexBotSync={status:'ERROR',error:'VISUAL_QA_FORCED_ERROR',diagnostics:{listRows:Number(s.bots?.length||0)}};s.pionexAccountSync={status:'ERROR'};return;
  }
  setTimes(now);s.botFeedTimestampTrusted=true;s.botFeedStatus='WALLET_DETAIL_OK';s.source='FRESH';s.error=null;s.marketError=null;s.marketPriceError=null;
  s.pionexBotSync={status:'OK',diagnostics:{listRows:Number(s.bots?.length||0)}};s.pionexAccountSync={status:'OK'};
}
function applyLocalVisualQaFixture(){
  const cfg=localVisualQaConfig(),s=S();if(!cfg||!s)return null;
  const now=Date.now(),prices={BTC:83747.5,ETH:2689.1,SOL:122.05,XRP:1.5243,HBAR:.09397,PEPE:.0000043853,DOT:1.242,ADA:.414,SUI:1.15,AVAX:16.8,LINK:13.9,XLM:.291,TRX:.337,WIF:.76,INJ:7.82};
  const refs=Array.isArray(s.referenceBots)?s.referenceBots:[];
  s.bots=refs.map((b,i)=>({...b,_liveMatched:true,_livePrice:true,_livePnl:true,_liveInvest:true,_liveInvestUsd:true,_apiNativeIdentity:true,price:prices[b.symbol]||Number(b.price)||1,pnlUsd:Number(((i%5)-2)*25.33).toFixed(2),investUsd:Number((180+i*37.5).toFixed(2)),gridCount:Number(b.gridCount||180+(i%7)*31)}));
  s.liveRows=s.bots.length;s.botApiRows=s.bots.length;s.botSupportedRows=s.bots.length;s.botDetailRows=s.bots.length;s.botDetailsComplete=true;s.unmatchedLive=[];s.matchAmbiguous=0;s.botIdentityMode='API_NATIVE';s.apiNativeRows=s.bots.length;
  s.botFeedUpdatedAt=now;s.botFeedTimestampTrusted=true;s.botFeedSource='VISUAL_QA_FIXTURE';s.botFeedStatus='WALLET_DETAIL_OK';s.source='FRESH';s.error=null;s.syncedAt=now;
  const universe=['BTC','ETH','SOL','XRP','HBAR','PEPE','LINK','AVAX','SUI','ADA','DOT','XLM','TRX','WIF','INJ'];
  s.assetIntel={};s.priceChecks={};
  universe.forEach((symbol,i)=>{
    const price=prices[symbol]||1,bull=i%3!==1,bullish=bull?7:4,bearish=bull?3:7,ema50=price*.94,ema20=price*(bull?0.98:1.02);
    s.assetIntel[symbol]={symbol,price,source:'VISUAL_QA',updatedAt:now,rsi15:54+(i%8),rsi1h:bull?58+(i%5):44-(i%3),rsi4:bull?55+(i%4):46-(i%3),rsi1d:52+(i%7),ema20,ema50,atr:price*.012,macd1h:{hist:bull?31.2+i:-22.4-i},macd4:{hist:bull?18.1+i:-28.9-i},bullish,bearish,score:bull?80:58,status:bull?'RE-ENTRY READY':'WATCH',near:{f:.382,price:price*.986},longReasons:['Momentum bestätigt','EMA-Struktur positiv'],shortReasons:['MTF Gegenprüfung aktiv']};
    s.priceChecks[symbol]={okx:price,binance:price*1.0003,verified:true,updatedAt:now};
  });
  s.intel=s.assetIntel.BTC;s.marketSyncedAt=now;s.marketPriceSyncedAt=now;s.marketTransport='VISUAL_QA';s.marketError=null;s.marketPriceError=null;
  s.portfolio={complete:false,total:null,ledgerAutoUsd:null,ledgerAutoActive:false,ledgerAutoRows:0,ledgerAssets:[],okxVenueUsd:null,pionex:34705.93,pionexSource:'VISUAL_QA_FIXTURE'};
  s.pionexAccount={updatedAt:new Date(now).toISOString(),snapshotAt:new Date(now).toISOString(),walletStatus:'OK',spotBalances:[{coin:'USDT',free:33.01,frozen:0,debts:0},{coin:'BTC',free:.0000011,frozen:0,debts:0},{coin:'SOL',free:.00074,frozen:0,debts:0},{coin:'LINK',free:.0043,frozen:0,debts:0},{coin:'AVAX',free:.0024,frozen:0,debts:0}],futuresBalances:[],futuresPositions:[{asset:'SUI',symbol:'SUI_USDT_PERP',side:'LONG',leverage:3,markPrice:1.15,avgPrice:1.12,liquidationPrice:.66,unrealizedPnl:12.34,netSize:7689,positionAmt:1}],wallet:{prices:Object.fromEntries(universe.map(x=>[x,{priceInUsd:prices[x]||1}]))}};
  s.pionexBotSync={status:'OK',diagnostics:{listRows:s.bots.length}};s.pionexAccountSync={status:'OK'};
  setLocalVisualQaDataMode(cfg.dataMode,s,now);
  fibUi.symbol='BTC';fibUi.mode='MANUAL';fibUi.manualLow=74896.6;fibUi.manualHigh=87374.3;fibUi.direction='UP';
  window.MERIDIAN_VISUAL_QA=true;
  return cfg;
}
function visualQaVisible(el){
  if(!el||el.hidden||el.closest?.('[hidden]'))return false;
  for(let node=el.parentElement;node;node=node.parentElement){
    if(node.tagName==='DETAILS'&&!node.open){
      const summary=[...node.children].find(x=>x.tagName==='SUMMARY');
      if(!summary?.contains(el))return false;
    }
    if(node===document.body)break;
  }
  const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
  const r=el.getBoundingClientRect();return r.width>0&&r.height>0;
}
function writeLocalVisualQaReport(cfg){
  const active=$('#view-'+cfg.view),keys=['.v10-mode-banner','.data-state-strip','.section-title','.command-action-grid','.depot-venue-grid','.bot-filter-bar','.forecast-focus-head','.market-regime','.scanner-summary','.fib-map-shell'];
  const overflow=keys.flatMap(sel=>[...active.querySelectorAll(sel)].filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>sel+':'+Math.ceil(el.scrollWidth-el.clientWidth)));
  const shortButtons=[...active.querySelectorAll('button')].filter(b=>visualQaVisible(b)&&b.getBoundingClientRect().height<42).map(b=>(b.textContent||b.getAttribute('aria-label')||'button').trim().slice(0,40));
  const nav=$('#nav')?.getBoundingClientRect(),root=document.documentElement,main=$('main'),mainRect=main?.getBoundingClientRect(),scannerButtons=[...active.querySelectorAll('.scanner-toolbar-actions button')].map(x=>x.getBoundingClientRect());
  const scannerActionsSameRow=cfg.view!=='research'||scannerButtons.length<2||Math.max(...scannerButtons.map(x=>x.top))-Math.min(...scannerButtons.map(x=>x.top))<=4;
  const commandHubCards=active.querySelectorAll('.command-hub-card').length,commandHubInvariant=cfg.view!=='command'||(commandHubCards>=4&&!!active.querySelector('.command-next-decision'));
  const botSummaries=[...active.querySelectorAll('.asset-pair-details>summary')].map(x=>x.getBoundingClientRect());let botAccordionInvariant=cfg.view!=='bots'||(botSummaries.length>0&&botSummaries.every(r=>r.height>=44));
  const botErrorSurfaceInvariant=cfg.view!=='bots'||cfg.dataMode!=='error'||!!active.querySelector('.bot-live-blocked');if(cfg.view==='bots'&&cfg.dataMode==='error')botAccordionInvariant=botErrorSurfaceInvariant;
  const forecastFibInvariant=cfg.view!=='market'||(!!active.querySelector('.fib-map-shell')&&!!active.querySelector('.fib-output'));
  const nearBottom=scrollY+innerHeight>=root.scrollHeight-4,bottomClearance=!nearBottom||!nav||!mainRect||mainRect.bottom<=nav.top+1;
  const navCandidates=nearBottom?[...active.querySelectorAll('button,summary,input,select,.fib-level,.fib-current,.sk-zone')].filter(visualQaVisible):[],navOcclusions=!nav?[]:navCandidates.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>nav.top+1&&r.top<nav.bottom-1}).map(el=>(el.textContent||el.getAttribute('aria-label')||el.className||el.tagName).trim().replace(/\s+/g,' ').slice(0,70));
  const dataStates=Object.fromEntries([...active.querySelectorAll('.data-state-item')].map(el=>[String(el.querySelector('span')?.textContent||'').trim(),String(el.querySelector('b')?.textContent||'').trim()])),dataStateInvariant=cfg.dataMode==='stale'?dataStates.BOTS==='REF'&&dataStates.MARKET==='STALE':cfg.dataMode==='error'?dataStates.BOTS==='ERROR'&&dataStates.MARKET==='STALE':true;
  const viewport={w:innerWidth,h:innerHeight},viewportMatch=viewport.w===390&&viewport.h===844;
  const layout={scannerActionsSameRow,commandHubInvariant,botAccordionInvariant,botErrorSurfaceInvariant,forecastFibInvariant,nearBottom,bottomClearance,dataStateInvariant,commandHubCards,botSummaryCount:botSummaries.length};
  const report={build:BUILD,view:cfg.view,scroll:cfg.scroll,actualScroll:Math.round(scrollY),dataMode:cfg.dataMode,dataStates,viewport,viewportMatch,layout,documentHeight:root.scrollHeight,documentWidth:root.scrollWidth,bodyOverflow:root.scrollWidth>innerWidth+2,activeOverflow:active?active.scrollWidth>active.clientWidth+2:true,keyOverflow:overflow,shortButtons,navOcclusions,navInside:!!nav&&nav.left>=-2&&nav.right<=innerWidth+2,ok:false};
  report.ok=viewportMatch&&layout.scannerActionsSameRow&&layout.commandHubInvariant&&layout.botAccordionInvariant&&layout.forecastFibInvariant&&layout.bottomClearance&&!report.bodyOverflow&&layout.dataStateInvariant&&layout.botErrorSurfaceInvariant&&!report.activeOverflow&&!overflow.length&&!shortButtons.length&&!navOcclusions.length&&report.navInside;
  let pre=$('#visual-qa-report');if(!pre){pre=document.createElement('pre');pre.id='visual-qa-report';pre.hidden=true;document.body.appendChild(pre)}pre.textContent=JSON.stringify(report);
  document.documentElement.dataset.visualQaReady=report.ok?'pass':'fail';
  return report;
}
function writeLocalVisualQaError(cfg,error){
  const report={build:BUILD,view:cfg?.view||'unknown',scroll:cfg?.scroll||0,ok:false,error:String(error?.stack||error?.message||error||'VISUAL_QA_ERROR').slice(0,1800)};
  let pre=$('#visual-qa-report');if(!pre){pre=document.createElement('pre');pre.id='visual-qa-report';pre.hidden=true;document.body.appendChild(pre)}
  pre.textContent=JSON.stringify(report);document.documentElement.dataset.visualQaReady='fail';return report;
}
function writeLocalInteractionQaReport(cfg,checks){
  const finalView=activeViewKey(),report={build:BUILD,flow:cfg.flow,view:cfg.view,finalView,scroll:cfg.scroll,actualScroll:Math.round(scrollY),dataMode:cfg.dataMode,checks,ok:Object.values(checks).every(Boolean)};
  let pre=$('#visual-qa-report');if(!pre){pre=document.createElement('pre');pre.id='visual-qa-report';pre.hidden=true;document.body.appendChild(pre)}
  pre.textContent=JSON.stringify(report);document.documentElement.dataset.visualQaReady=report.ok?'pass':'fail';return report;
}
function visualQaSettle(){
  return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,0))));
}
async function runLocalInteractionQa(cfg){
  try{
    const checks={};
    if(cfg.flow==='primary-reset'){
      window.scrollTo(0,cfg.scroll);await visualQaSettle();
      checks.startedScrolled=scrollY>100;
      $('#nav button[data-v="bots"]')?.click();await visualQaSettle();
      checks.botsActive=activeViewKey()==='bots';
      checks.botsNavActive=$('#nav button[data-v="bots"]')?.classList.contains('active')===true;
      checks.scrollReset=scrollY<=2;
    }else if(cfg.flow==='asset-return'){
      window.scrollTo(0,cfg.scroll);await visualQaSettle();
      const origin=Math.round(scrollY),open=$('#view-depot [data-asset-detail]');
      checks.startedScrolled=origin>100;
      checks.assetTrigger=!!open;
      open?.click();await visualQaSettle();
      checks.assetOpened=activeViewKey()==='asset-detail';
      const back=$('#view-asset-detail [data-context-back="asset-detail"]');
      checks.backControl=!!back;
      back?.click();await visualQaSettle();
      checks.depotRestored=activeViewKey()==='depot';
      checks.depotNavActive=$('#nav button[data-v="depot"]')?.classList.contains('active')===true;
      checks.scrollRestored=Math.abs(Math.round(scrollY)-origin)<=8;
    }else if(cfg.flow==='bot-toggle'){
      const details=[...$('#view-bots')?.querySelectorAll('.asset-pair-details')||[]],close=$('#view-bots [data-assets-action="close"]'),open=$('#view-bots [data-assets-action="open"]');
      checks.botCardsPresent=details.length>0;
      checks.controlsPresent=!!close&&!!open;
      close?.click();await visualQaSettle();
      checks.allClosed=details.length>0&&details.every(x=>!x.open);
      open?.click();await visualQaSettle();
      checks.allOpened=details.length>0&&details.every(x=>x.open);
    }else if(cfg.flow==='bot-filter-return'){
      const risk=$('#view-bots [data-bot-filter="RISK"]');
      checks.riskControl=!!risk;
      risk?.click();await visualQaSettle();
      checks.filterSet=botViewUi.filter==='RISK';
      checks.filterActive=$('#view-bots [data-bot-filter="RISK"]')?.classList.contains('active')===true;
      $('#nav button[data-v="command"]')?.click();await visualQaSettle();
      checks.commandVisited=activeViewKey()==='command';
      $('#nav button[data-v="bots"]')?.click();await visualQaSettle();
      checks.botsReturned=activeViewKey()==='bots';
      checks.filterRetained=botViewUi.filter==='RISK'&&$('#view-bots [data-bot-filter="RISK"]')?.classList.contains('active')===true;
      const saved=JSON.parse(sessionStorage.getItem(UI_CONTEXT_KEY)||'{}');
      checks.sessionFilterRetained=String(saved.botFilter||'').toUpperCase()==='RISK';
    }else if(cfg.flow==='scanner-forecast-return'){
      window.scrollTo(0,cfg.scroll);await visualQaSettle();
      const origin=Math.round(scrollY),open=$('#view-research [data-forecast-asset]'),target=String(open?.dataset.forecastAsset||'').toUpperCase();
      checks.startedScrolled=origin>100;
      checks.forecastTrigger=!!open&&!!target;
      open?.click();await visualQaSettle();
      checks.forecastOpened=activeViewKey()==='market';
      checks.assetSelected=!!target&&fibUi.symbol===target;
      checks.contextBack=!!$('#view-market [data-context-back="market"]');
      const saved=JSON.parse(sessionStorage.getItem(UI_CONTEXT_KEY)||'{}');
      checks.sessionAssetRetained=String(saved.fibSymbol||'').toUpperCase()===target;
      $('#view-market [data-context-back="market"]')?.click();await visualQaSettle();
      checks.scannerRestored=activeViewKey()==='research';
      checks.scannerNavActive=$('#nav button[data-v="research"]')?.classList.contains('active')===true;
      checks.scrollRestored=Math.abs(Math.round(scrollY)-origin)<=8;
    }else if(cfg.flow==='stale-recovery'){
      const labels=()=>Object.fromEntries([...$('#view-command')?.querySelectorAll('.data-state-item')||[]].map(el=>[String(el.querySelector('span')?.textContent||'').trim(),String(el.querySelector('b')?.textContent||'').trim()]));
      const before=labels();
      checks.startsStale=before.BOTS==='REF'&&before.MARKET==='STALE';
      checks.headersStale=String($('#data-status')?.textContent||'').includes('BOT REF')&&String($('#market-status')?.textContent||'').includes('MKT STALE');
      checks.failClosedBefore=!!$('#view-command .blocked-critical');
      setLocalVisualQaDataMode('fresh',S(),Date.now());
      renderActiveView('command',true);renderSystemHeader();decorateA11y();await visualQaSettle();
      const after=labels();
      checks.botRecovered=after.BOTS==='READY';
      checks.marketRecovered=after.MARKET==='READY';
      checks.headersRecovered=String($('#data-status')?.textContent||'').includes('BOT READY')&&String($('#market-status')?.textContent||'').includes('MKT READY');
    }else checks.knownFlow=false;
    writeLocalInteractionQaReport(cfg,checks);
  }catch(error){writeLocalVisualQaError(cfg,error)}
}
function renderLocalVisualQa(cfg){
  try{
    $$('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+cfg.view));
    $$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.v===cfg.view));
    renderActiveView(cfg.view,true);renderSystemHeader();decorateA11y();
    window.scrollTo(0,cfg.scroll);
    if(cfg.flow){void runLocalInteractionQa(cfg);return}
    writeLocalVisualQaReport(cfg);
  }catch(error){writeLocalVisualQaError(cfg,error)}
}
function activeViewKey(){return String($('.view.active')?.id||'view-command').replace(/^view-/,'')}
function renderActiveView(active,force=true){
  if(active==='command')return renderCommand(force);
  if(active==='depot')return renderDepot(force);
  if(active==='bots')return renderBots(force);
  if(active==='market')return renderMarket(force);
  if(active==='research')return renderScanner(force);
  if(active==='asset-detail')return renderAssetDetail(force);
  if(active==='paper')return renderPaperCockpit(force);
  if(active==='more')return renderLab();
}
function decorate(forceData=false){
  document.documentElement.dataset.meridianBuild=BUILD;
  const active=activeViewKey();
  renderCommand(forceData&&active==='command');
  renderDepot(forceData&&active==='depot');
  renderBots(forceData&&active==='bots');
  renderMarket(forceData&&active==='market');
  renderScanner(forceData&&active==='research');
  if(active==='asset-detail')renderAssetDetail(forceData);
  if(active==='paper')renderPaperCockpit(forceData);
  renderLab();renderSystemHeader();decorateA11y();
}
function bindV10NavigationAuthority(){
  $$('#nav button[data-v]').forEach(b=>{
    b.onclick=e=>{
      e?.preventDefault?.();
      const v=String(b.dataset.v||'command');
      delete viewContextUi[v];
      const ok=bridge()?.goView?.(v);
      if(!ok){
        $$('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+v));
        $$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.v===v));
      }
      queueMicrotask(()=>{
        try{renderActiveView(v,true);renderSystemHeader();decorateA11y();restoreViewport(0);}
        catch(err){
          const host=$('#view-'+v);
          if(host)host.innerHTML='<section class="v10-live-blocked"><b>V10 VIEW RENDER ERROR</b><small>'+esc(String(err?.message||err).slice(0,180))+'</small></section>';
        }
      });
    };
  });
}
let raf=0,pendingDataRefresh=false;
const schedule=(forceData=false)=>{
  if(forceData===true)pendingDataRefresh=true;
  if(raf)return;
  raf=requestAnimationFrame(()=>{const force=pendingDataRefresh;pendingDataRefresh=false;raf=0;decorate(force);});
};
window.addEventListener('meridian:data',()=>{
  if(activeViewKey()==='command')bridge()?.refreshCurrentView?.();
  schedule(true);
});
window.addEventListener('meridian:view',()=>schedule(true));
new MutationObserver(()=>schedule(false)).observe($('#app')||document.body,{childList:true,subtree:true});
bindV10NavigationAuthority();bindRefreshControl();
const visualQa=applyLocalVisualQaFixture();
if(visualQa){
  try{renderLocalVisualQa(visualQa)}
  catch(err){
    let pre=$('#visual-qa-report');if(!pre){pre=document.createElement('pre');pre.id='visual-qa-report';pre.hidden=true;document.body.appendChild(pre)}
    pre.textContent=JSON.stringify({build:BUILD,view:visualQa.view,scroll:visualQa.scroll,ok:false,error:String(err?.stack||err?.message||err)});
    document.documentElement.dataset.visualQaReady='error';
  }
}else decorate();
