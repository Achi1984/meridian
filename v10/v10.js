import {detectSwing,detectOpposingChildSwing,buildFibLevels,adjacentFibLevels,fibDistancePct,fibPlotPosition,skLongShortZones,skTargetZone,skDoubleAdvantage} from './fib-core.js?v=10.0-r58';
import {SK_PAPERBOT_V1_RULESET,SK_PAPERBOT_V1_CONFIG,replaySkPaperBot,skChronologicalStability,evaluateSkPaperGate} from '../research/sk-paperbot-v1.js?v=10.0-r58';
import {SK_RESEARCH_V2_RULESET,SK_RESEARCH_V2_ASSETS,aggregateSkResearchV2} from '../research/sk-research-v2.js?v=10.0-r58';
import {DOCUMENTED_EDGE_V1_RULESET,DOCUMENTED_EDGE_ASSETS,runTsmomClassic,runXsmom3wPriceProxy,fundingCarryEvidence} from '../research/documented-edge-v1.js?v=10.0-r58';
import {TSMOM_HOLDOUT_V1_RULESET,TSMOM_TRANSFER_ASSETS,runLegacyTimeHoldout,runTransferUniverseHoldout,evaluateCombinedTsmomHoldout} from '../research/tsmom-holdout-v1.js?v=10.0-r58';
// MERIDIAN v10 r58 — isolated presentation/command adapter over the validated v9 engine.
// No trading logic lives here. It consumes the read-only v9 bridge and never submits orders.
const BUILD='10.0-r58';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const bridge=()=>window.MERIDIAN_V10_BRIDGE||null;
const S=()=>bridge()?.getState?.()||null;
const H=()=>bridge()?.helpers||{};
const fibUi={symbol:'BTC',window:90,mode:'AUTO',manualHigh:null,manualLow:null,direction:'AUTO',autoHigh:null,autoLow:null,lastDirection:'UP'};
const skLabUi={symbol:'BTC',days:180,running:false,result:null,stability:null,gate:null,error:null,range:null};
const skV2Ui={days:730,running:false,result:null,error:null,progress:'',completed:0,total:SK_RESEARCH_V2_ASSETS.length};
const edgeUi={days:1460,running:false,tsmom:null,xsmom:null,error:null,progress:'',completed:0,total:DOCUMENTED_EDGE_ASSETS.length,loadedAssets:[]};
const holdoutUi={running:false,legacy:null,transfer:null,combined:null,error:null,progress:'',completed:0,total:DOCUMENTED_EDGE_ASSETS.length+TSMOM_TRANSFER_ASSETS.length};
const MARKET_FRESH_MS=3*60*1000;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(v,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'—'}
function freshTs(ts,maxAge=MARKET_FRESH_MS){const n=Number(ts);return Number.isFinite(n)&&n<=Date.now()+30000&&Date.now()-n<=maxAge}
function intelFresh(i){return !!i&&freshTs(i.updatedAt)}
function referenceRows(symbol){return (S()?.referenceBots||[]).filter(b=>b.symbol===symbol)}
function referenceLinked(symbol){return referenceRows(symbol).length>0}
function marketHealth(){
  const s=S(),h=H(),universe=marketUniverse(),freshAssets=universe.filter(symbol=>intelFresh(s?.assetIntel?.[symbol])).length,knownAssets=universe.filter(symbol=>!!s?.assetIntel?.[symbol]).length,age=s?.marketSyncedAt?Date.now()-s.marketSyncedAt:null,totalAssets=universe.length,staleAssets=Math.max(0,knownAssets-freshAssets),missingAssets=Math.max(0,totalAssets-knownAssets);
  return{fresh:freshTs(s?.marketSyncedAt)&&intelFresh(s?.intel),freshAssets,knownAssets,staleAssets,missingAssets,totalAssets,coverageComplete:totalAssets>0&&freshAssets===totalAssets,age,ageText:h.ageText?.(age)||'—',priceAge:s?.marketPriceSyncedAt?Date.now()-s.marketPriceSyncedAt:null,priceFresh:freshTs(s?.marketPriceSyncedAt),error:s?.marketError||null,priceError:s?.marketPriceError||null};
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
  if(hardProtection)return{code:'PROTECTION_RISK',label:'RISK REVIEW',tone:'danger',rank:130,reason:hardProtection.reason};
  const min=risks.length?Math.min(...risks):null;
  if(min!=null&&min<10)return{code:'LIQ_RISK',label:'LIQ RISK',tone:'danger',rank:120,reason:'Liq-Puffer nur '+min.toFixed(1)+'%'};
  if(nearProtection)return{code:'PROTECTION_RISK',label:'RISK REVIEW',tone:'danger',rank:115,reason:nearProtection.reason};
  if(unmatchedAsset.length)return{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:unmatchedAsset.length+' aktuelle '+assetKey+' Bot-Row(s) nicht sicher gematcht'+(ambiguousAsset?' · '+ambiguousAsset+' ambiguous':'')};
  if(rows.some(b=>!h.livePnlAvailable?.(b))||risks.length!==rows.length)return{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:'Mindestens ein Action-Feld (PnL/Liq) fehlt live'};
  if(!intelFresh(s.assetIntel?.[symbol]))return{code:'MARKET_STALE',label:'MARKET STALE',tone:'muted',rank:80,reason:'15m/1h/4h Marktdaten sind nicht frisch · nur Safety-Daten bleiben gültig'};
  const plans=rows.map(b=>h.profitLockPlan?.(b)).filter(Boolean);
  const signals=rows.map(b=>intelFresh(s.assetIntel?.[b.symbol])?h.actionForSide?.(s.assetIntel?.[b.symbol],b.side||'LONG'):'SYNC');
  if(plans.some(p=>['LOCK20','LOCK25','LOCK50'].includes(p.code)))return{code:'PROFIT_LOCK',label:'PROFIT LOCK',tone:'watch',rank:60,reason:'Technische Schwäche + ausreichendes Gewinnpolster'};
  if(signals.includes('RISK REVIEW'))return{code:'RISK_REVIEW',label:'RISK REVIEW',tone:'danger',rank:100,reason:'4h/1h Struktur dreht gegen mindestens eine Seite'};
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
  const i=s?.assetIntel?.[symbol]??(symbol==='BTC'?s?.intel:null),p=Number(i?.price),fresh=intelFresh(i);
  return{value:p>0?p:null,source:p>0?(i?.source||'MARKET FEED')+(fresh?'':' · STALE'):'UNVERIFIED',verified:false,spread:null,stale:!fresh};
}
function legRow(b){
  const h=H(),fresh=h.botFeedFresh?.(),verified=fresh&&h.liveMatched?.(b),pnl=verified&&h.livePnlAvailable?.(b)?h.botPnlUsd?.(b)?.value:null,r=verified?h.risk?.(b):null,sl=Number(b.sl)>0?h.money?.(b.sl):'—';
  if(!fresh)return '<div class="pair-leg pair-leg-stale '+((b.side||'LONG')==='SHORT'?'leg-short':'leg-long')+'"><div class="leg-head"><strong>'+(b.side||'LONG')+' · '+(b.leverage||'—')+'x</strong><span>STALE</span></div><small>Bot-Felder ausgeblendet · frischen privaten Snapshot abwarten</small></div>';
  if(!verified)return '<div class="pair-leg pair-leg-stale"><div class="leg-head"><strong>'+(b.side||'BOT')+' · '+(b.leverage||'—')+'x</strong><span>UNVERIFIED</span></div><small>Nicht handlungsrelevant</small></div>';
  return '<div class="pair-leg '+((b.side||'LONG')==='SHORT'?'leg-short':'leg-long')+'"><div class="leg-head"><strong>'+(b.side||'LONG')+' · '+(b.leverage||'—')+'x</strong><span>PRIVATE</span></div><div class="leg-grid"><span>CAPITAL USD <b>'+(h.liveInvestUsdAvailable?.(b)?h.money(b.investUsd):'—')+'</b></span><span>PNL USD <b>'+(pnl==null?'—':h.money(pnl))+'</b></span><span>BE <b>'+(Number(b.be)>0?h.money(b.be):'—')+'</b></span><span>TP <b>'+(Number(b.tp)>0?h.money(b.tp):'—')+'</b></span><span>LIQ <b>'+(Number(b.liq)>0?h.money(b.liq):'—')+'</b></span><span>SL <b>'+sl+'</b></span><span>PUFFER <b>'+(r==null?'—':r.toFixed(1)+'%')+'</b></span></div></div>';
}
function pairCard(symbol,compact=false){
  const h=H(),rows=matchedRows(symbol),st=pairStatus(symbol),fresh=h.botFeedFresh?.(),longs=rows.filter(b=>(b.side||'LONG')==='LONG'),shorts=rows.filter(b=>b.side==='SHORT'),mp=marketPrice(symbol);
  if(!fresh&&!compact)return '';
  const exposureState=h.exposureIntegrity?.(symbol),exposureComplete=exposureState?!!exposureState.complete:(fresh&&rows.length>0&&rows.every(b=>h.liveInvestUsdAvailable?.(b))),longUsd=exposureComplete?exposure(rows,'LONG'):null,shortUsd=exposureComplete?exposure(rows,'SHORT'):null;
  const pnlState=h.pnlIntegrity?.(symbol),pnlVals=fresh?rows.map(b=>h.botPnlUsd?.(b)?.value):[],pnlComplete=(pnlState?!!pnlState.complete:(fresh&&rows.length>0))&&pnlVals.length===rows.length&&pnlVals.every(x=>x!=null),pnl=pnlComplete?pnlVals.reduce((a,b)=>a+b,0):null;
  const hedge=longUsd>0&&shortUsd!=null?shortUsd/longUsd*100:null,net=longUsd!=null&&shortUsd!=null?longUsd-shortUsd:null;
  return '<article class="asset-pair '+(compact?'pair-compact':'')+'"><div class="pair-head"><div><span class="asset-symbol">'+symbol+'</span><small>'+longs.length+' LONG · '+shorts.length+' SHORT</small></div><b class="pair-status tone-'+st.tone+'">'+st.label+'</b></div><div class="pair-summary"><div><span>MARKET PRICE</span><b>'+h.money?.(mp.value)+'</b><small>'+esc(mp.source)+'</small></div><div><span>KNOWN NET USD</span><b>'+(net==null?'—':h.money?.(net))+'</b></div><div><span>HEDGE</span><b>'+(hedge!=null?hedge.toFixed(1)+'%':'—')+'</b></div><div><span>PAIR PNL USD</span><b>'+(pnl==null?'—':h.money?.(pnl))+'</b></div></div><div class="pair-reason">'+esc(st.reason)+(exposureComplete?'':' · Exposure-Einheit unvollständig')+(pnlComplete?'':' · PnL-Summe unvollständig')+'</div>'+(compact?'':'<div class="pair-legs">'+rows.map(legRow).join('')+'</div>')+'</article>';
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
  if(s.code==='PROTECTION_RISK')return{title:c.symbol+' · RISK REVIEW',detail:s.reason+' · Safety zuerst, nicht reflexartig komplett schließen'};
  if(!g.coverageComplete)return{title:'KEINE AKTION · DATEN PRÜFEN',detail:'BOT COVERAGE · '+g.matched+'/'+g.supported+' sicher gematcht · '+g.unmatched+' unmatched'+(g.ambiguous?' · '+g.ambiguous+' ambiguous':'')};
  if(s.code==='RISK_REVIEW')return{title:c.symbol+' · RISK REVIEW',detail:s.reason+' · Safety zuerst, nicht reflexartig komplett schließen'};
  if(s.code==='PROFIT_LOCK')return{title:c.symbol+' · PROFIT LOCK PRÜFEN',detail:s.reason+' · Teilgewinn/Reload-Reserve statt Komplettausstieg'};
  if(s.code==='WATCH_PROFIT')return{title:c.symbol+' · WATCH PROFIT',detail:s.reason};
  return{title:'HOLD · RUNNER WEITERLAUFEN',detail:'Kein 4h-bestätigtes Exit-Signal'};
}
function syncHealth(){
  const s=S(),h=H(),rows=(s?.bots||[]).filter(h.liveMatched||(()=>false)),shared=h.botFeedCoverage?.(),supported=Number(shared?.supported??s?.liveRows??0),matched=Number(shared?.matched??rows.length),apiRows=Number(s?.botApiRows??supported),fresh=shared?!!shared.fresh:!!h.botFeedFresh?.(),identityMode=String(s?.botIdentityMode||'REFERENCE_MATCH'),apiNative=identityMode==='API_NATIVE';
  const safetyRows=fresh?rows.filter(b=>h.safetyReadyBot?h.safetyReadyBot(b):h.risk?.(b)!=null):[],pnlRows=fresh?rows.filter(b=>h.livePnlAvailable?.(b)):[],decisionRows=fresh?rows.filter(b=>h.decisionReadyBot?h.decisionReadyBot(b):(h.risk?.(b)!=null&&h.livePnlAvailable?.(b)&&intelFresh(s?.assetIntel?.[b.symbol]))):[];
  const safetyReady=safetyRows.length,pnlReady=pnlRows.length,decisionReady=decisionRows.length,actionable=decisionReady,unmatched=Number(shared?.unmatched??Math.max(0,supported-matched)),ambiguous=Number(shared?.ambiguous??s?.matchAmbiguous??(s?.unmatchedLive||[]).filter(x=>x?.reason==='AMBIGUOUS_MATCH').length),coverageComplete=shared?!!shared.coverageComplete:(fresh&&supported>0&&unmatched===0&&ambiguous===0),decisionComplete=matched>0&&coverageComplete&&decisionReady===matched;
  const botApiStatus=String(s?.pionexBotSync?.status||'UNKNOWN'),status=String(s?.botFeedStatus||botApiStatus),walletFeed=status==='WALLET_DETAIL_OK',age=h.botFeedAgeLabel?.()||(h.ageText?.(h.botFeedAgeMs?.())||'—');
  const guardRows=Number(s?.pionexBotSync?.diagnostics?.listRows),shownApiRows=walletFeed?apiRows:(botApiStatus==='EMPTY_GUARD'&&Number.isFinite(guardRows)?guardRows:apiRows);
  let detail='Private Bot-Daten werden geprüft.';
  if(walletFeed&&!fresh)detail='Wallet-Detail-Fallback ist validiert, aber der Bot-Snapshot ist nicht frisch genug.';
  else if(walletFeed&&fresh&&apiNative&&decisionReady<matched)detail='API-native Bot-Identität ist vollständig und frisch; '+(matched-decisionReady)+' Row(s) bleiben mangels PnL oder Marktfeed nicht decision-ready.';
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
  return{apiRows:shownApiRows,supported,raw:supported,matched,safetyReady,pnlReady,decisionReady,decisionComplete,actionable,unmatched,ambiguous,status,botApiStatus,walletFeed,identityMode,apiNative,age,fresh,coverageComplete,detail};
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
function dataGuardCard(){
  const g=syncHealth(),tone=g.decisionComplete?'safe':(g.decisionReady>0||g.safetyReady>0)?'watch':g.status==='ERROR'?'danger':'muted',source=g.walletFeed?'WALLET DETAIL':g.status==='BOT_API_OK'||g.status==='OK'?'BOT API':g.status==='DISABLED_MISSING_CREDENTIALS'?'OFF':g.status.replaceAll('_',' '),label=g.decisionComplete?'DECISION READY':g.decisionReady>0?'PARTIAL READY':g.safetyReady>0?'SAFETY ONLY':'BLOCKED',identityLabel=g.apiNative?'API IDENTITY':'SUPPORTED MATCH';
  return '<section class="v10-data-guard"><div class="guard-head"><div><span>DATA GUARD</span><b>LIVE BOT INTEGRITY</b></div><strong class="tone-'+tone+'">'+label+'</strong></div><div class="guard-grid"><div><span>BOT SOURCE</span><b>'+esc(source)+'</b><small>'+g.apiRows+' source rows · Bot API '+esc(g.botApiStatus)+'</small></div><div><span>'+identityLabel+'</span><b>'+g.matched+'/'+g.supported+'</b></div><div><span>SAFETY READY</span><b>'+g.safetyReady+'</b></div><div><span>DECISION READY</span><b>'+g.decisionReady+'</b></div><div><span>SNAPSHOT AGE</span><b>'+esc(g.age)+'</b></div><div><span>UNVERIFIED</span><b>'+g.unmatched+'</b><small>'+g.ambiguous+' ambiguous</small></div></div><small>'+esc(g.detail)+' · SOURCE '+esc(String(S()?.botFeedSource||'—').replaceAll('_',' '))+'</small>'+matchStageDiagnosticsCard()+unmatchedDiagnostics()+'</section>';
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
  return '<section class="v10-account-position-layer"><div class="section-title"><h2>PIONEX ACCOUNT POSITIONS</h2><small>READ-ONLY · '+esc(p.age)+' · '+p.rows.length+' POSITION(S) · NICHT BOT-GEMATCHT</small></div><div class="'+(compact?'v10-live-overview':'v10-pair-stack')+'">'+body+'</div>'+(compact&&p.rows.length>shown?'<small>+'+(p.rows.length-shown)+' weitere Position(en) im BOTS-Tab.</small>':'')+'</section>';
}
function walletDiscoveryHealth(){
  const s=S(),account=s?.pionexAccount||{},sync=s?.pionexAccountSync||{},wallet=account?.wallet||{},status=String(account?.walletStatus||'UNKNOWN'),ts=Date.parse(String(account.updatedAt||account.snapshotAt||'')),future=Number.isFinite(ts)&&ts>Date.now()+5*60*1000,ageMs=Number.isFinite(ts)?Math.max(0,Date.now()-ts):null,fresh=String(sync.status||'UNKNOWN')==='OK'&&status==='OK'&&!future&&ageMs!=null&&ageMs<=15*60*1000,h=H(),age=future?'FUTURE TIMESTAMP':ageMs!=null?(h.ageText?.(ageMs)||'—'):'NO TIMESTAMP';
  const label=status==='OK'?(fresh?'LIVE':'STALE'):status==='ERROR'?'ERROR':'WAIT',tone=label==='LIVE'?'safe':label==='ERROR'?'danger':'watch';
  return{status,label,tone,wallet,probe:account?.walletBotProbe||null,risk:account?.walletBotRisk||null,fresh,age,error:account?.walletError||null};
}
function walletDiscoveryLayer(){
  const w=walletDiscoveryHealth(),rows=Array.isArray(w.wallet?.botCategories)?w.wallet.botCategories:[],probe=w.probe||{},risk=w.risk||{};
  if(w.status==='ERROR')return '<section class="v10-live-blocked v10-wallet-discovery"><b>BOT ACCOUNT API ERROR</b><small>'+esc(String(w.error||'Pionex Wallet API nicht verfügbar').slice(0,160))+' · Futures POSITION API bleibt davon unabhängig.</small></section>';
  if(w.status!=='OK')return '<section class="v10-live-blocked v10-wallet-discovery"><b>BOT ACCOUNT API WAIT</b><small>Wallet/Bot-Account-Read noch nicht verfügbar · Positionslayer bleibt separat.</small></section>';
  const cards=rows.map(x=>{
    const fields=Array.isArray(x?.entryFields)&&x.entryFields.length?x.entryFields.join(', '):'keine List-Felder',count=Number.isFinite(Number(x?.count))?Number(x.count):Number(x?.listCount)||0;
    return '<div><span>'+esc(String(x?.type||x?.title||'CATEGORY').toUpperCase())+'</span><b>'+count+' gemeldet · '+(Number(x?.listCount)||0)+' geladen</b><small>FELDER '+esc(fields)+'</small></div>';
  }).join('');
  const counts=obj=>Object.entries(obj||{}).map(([k,v])=>esc(k)+' '+Number(v||0)).join(' · ')||'—';
  const success=Number(probe.successCount||0),candidates=Number(probe.candidateCount||0),fail=Number(probe.failureCount||0),probeTone=candidates&&success===candidates?'safe':success>0?'watch':'muted',supported=Number(risk.supportedRows||0),normalized=Number(risk.normalizedRows||risk.botCount||0),rejected=Number(risk.rejectedCount||0),riskComplete=risk.detailsComplete===true,riskTone=riskComplete?'safe':normalized>0?'watch':'danger';
  const envFields=Array.isArray(risk.detailEnvelopeFields)&&risk.detailEnvelopeFields.length?risk.detailEnvelopeFields.join(', '):'—',dataFields=Array.isArray(risk.detailBotDataFields)&&risk.detailBotDataFields.length?risk.detailBotDataFields.join(', '):'—';
  return '<section class="v10-data-guard v10-wallet-discovery"><div class="guard-head"><div><span>BOT ACCOUNT API</span><b>WALLET + DETAIL DISCOVERY</b></div><strong class="tone-'+w.tone+'">'+esc(w.label)+'</strong></div><div class="guard-grid"><div><span>KATEGORIEN</span><b>'+Number(w.wallet?.botCategoryCount||0)+'</b></div><div><span>BOT-EINTRÄGE GELADEN</span><b>'+Number(w.wallet?.botEntryCount||0)+'</b></div><div><span>DETAIL PROBE</span><b class="tone-'+probeTone+'">'+success+'/'+candidates+'</b><small>'+fail+' fehlgeschlagen</small></div><div><span>RISK NORMALIZED</span><b class="tone-'+riskTone+'">'+normalized+'/'+supported+'</b><small>'+rejected+' verworfen · '+(riskComplete?'COMPLETE':'BLOCKED')+'</small></div></div><div class="v10-wallet-categories"><div><span>BUORDERTYPE</span><b>'+counts(w.wallet?.botBuOrderTypeCounts)+'</b><small>Private IDs bleiben verborgen</small></div><div><span>CATETYPE</span><b>'+counts(w.wallet?.botCateTypeCounts)+'</b><small>FUTURE_GRID_COIN_MARGINED = Coin-M Futures Grid</small></div><div><span>DETAIL ERFOLG CATETYPE</span><b>'+counts(probe.successCateTypeCounts)+'</b><small>Nur erfolgreiche read-only Detailreads</small></div><div><span>RISK STATUS</span><b>'+counts(risk.statusCounts)+'</b><small>TREND '+counts(risk.trendCounts)+'</small></div><div><span>NORMALIZER STAGES</span><b>TYPE '+Number(risk.typePassCount||0)+'/'+supported+' · STATUS '+Number(risk.statusPassCount||0)+'/'+supported+'</b><small>SYMBOL '+Number(risk.symbolPassCount||0)+'/'+supported+' · SIDE '+Number(risk.sidePassCount||0)+'/'+supported+' · ALL '+Number(risk.allStagePassCount||0)+'/'+supported+'</small></div><div><span>ASSET CLASS</span><b>BASE '+counts(risk.baseClassCounts)+'</b><small>QUOTE '+counts(risk.quoteClassCounts)+'</small></div><div><span>REJECT REASONS</span><b>'+counts(risk.rejectReasonCounts)+'</b><small>MISSING RAW BASE '+Number(risk.missingBaseCount||0)+'</small></div><div><span>DETAIL FIELDS</span><b>'+esc(envFields)+'</b><small>BOT DATA '+esc(dataFields)+'</small></div></div>'+(cards?'<div class="v10-wallet-categories">'+cards+'</div>':'')+'<small>Read-only Diagnose. Keine Safety-Regel wurde gelockert; Wallet-Bots werden erst bei vollständiger Normalisierung als Live-Quelle gewählt.</small></section>';
}
function liveOverview(){
  const g=syncHealth(),h=H(),rows=g.fresh?(S()?.bots||[]).filter(b=>h.liveMatched?.(b)):[];
  if(!g.safetyReady)return '<section class="v10-live-blocked"><b>LIVE LAYER BLOCKED</b><small>Keine frischen verifizierten Safety-Daten. Asset Watch ist Referenz, nicht Live-Aktion.</small></section>';
  const exposureState=h.exposureIntegrity?.(),exposureComplete=exposureState?!!exposureState.complete:(g.coverageComplete&&rows.length>0&&rows.every(b=>h.liveInvestUsdAvailable?.(b))),long=exposureComplete?exposure(rows,'LONG'):null,short=exposureComplete?exposure(rows,'SHORT'):null,net=long!=null&&short!=null?long-short:null;
  const decisionRows=rows.filter(b=>h.decisionReadyBot?h.decisionReadyBot(b):(h.risk?.(b)!=null&&h.livePnlAvailable?.(b)&&intelFresh(S()?.assetIntel?.[b.symbol]))),plans=decisionRows.map(b=>h.profitLockPlan?.(b)).filter(Boolean),lock=plans.filter(p=>['LOCK20','LOCK25','LOCK50'].includes(p.code)).length,watch=plans.filter(p=>['WATCH','HEDGE'].includes(p.code)).length;
  return '<section class="v10-live-overview"><div><span>KNOWN LONG USD</span><b>'+(long==null?'—':h.money?.(long))+'</b></div><div><span>KNOWN SHORT USD</span><b>'+(short==null?'—':h.money?.(short))+'</b></div><div><span>KNOWN NET USD</span><b>'+(net==null?'—':h.money?.(net))+'</b></div><div><span>SAFETY READY</span><b>'+g.safetyReady+'/'+g.matched+'</b></div><div><span>DECISION READY</span><b>'+g.decisionReady+'/'+g.matched+'</b></div><div><span>PROFIT WATCH / LOCK</span><b>'+(g.decisionReady?watch+' / '+lock:'— / —')+'</b></div><div><span>EXPOSURE</span><b class="tone-'+(exposureComplete?'safe':'watch')+'">'+(exposureComplete?'COMPLETE':'PARTIAL')+'</b></div></section>';
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
  return '<section class="command-source-strip"><div><span>MARKET</span><b class="tone-'+mr.tone+'">'+mr.label+'</b><small>'+esc(m.ageText)+' · '+m.freshAssets+'/'+m.totalAssets+' · '+m.staleAssets+' stale · '+m.missingAssets+' missing</small></div><div><span>BOT LAYER</span><b class="tone-'+br.tone+'">'+br.label+'</b><small>'+g.decisionReady+'/'+g.matched+' decision · '+esc(g.age)+'</small></div><div><span>ASSET WATCH</span><b>SNAPSHOT</b><small>'+esc(refAge||'—')+'</small></div><div><span>PORTFOLIO</span><b>'+portfolioLabel+'</b><small>Spot + Pionex SSOT · PIONEX '+pionexAge+histText+' · OKX DCA Ref separat</small></div></section>';
}
function renderSystemHeader(){
  const g=syncHealth(),m=marketHealth(),mr=marketReadiness(m),br=botReadiness(g),market=$('#market-status'),bot=$('#data-status');
  const set=(el,textName,className,title)=>{if(!el)return;if(el.textContent!==textName)el.textContent=textName;if(el.className!==className)el.className=className;if(el.title!==title)el.title=title};
  set(market,'● MKT '+mr.label,'live '+mr.tone,(mr.label==='READY'?'Alle erwarteten Futures-Marktdaten frisch':mr.label==='PARTIAL'?'BTC frisch, aber Markt-Coverage unvollständig':'Marktdaten nicht frisch genug')+' · '+m.freshAssets+'/'+m.totalAssets);
  set(bot,'● BOT '+br.label,'live '+br.tone,g.detail);
}
function decorateA11y(){
  for(const el of [$('#market-status'),$('#data-status')])if(el)el.setAttribute('aria-live','polite');
  $$('#nav button').forEach(b=>{b.type='button';const label=$('span',b)?.textContent||'MERIDIAN';b.setAttribute('aria-label',label);if(b.classList.contains('active'))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
}
function renderCommand(force=false){
  const view=$('#view-command');if(!view||!$('.portfolio-hero',view))return;
  if(!force&&$('.command-source-strip',view)&&$('.v10-critical-wrap',view)&&$('.v10-data-guard',view))return;
  banner('#view-command','COMMAND','PORTFOLIO + RISK DECISION SUPPORT','Market, Bot-Layer und Referenz-Snapshot werden getrennt bewertet','live');
  dataGuardDecorate();
  view.querySelectorAll('.v10-critical-wrap,.v10-data-guard,.v10-live-overview,.v10-live-blocked,.v10-account-position-layer,.v10-wallet-discovery,.command-source-strip').forEach(x=>x.remove());
  const hero=$('.portfolio-hero',view),c=criticalPair(),a=nextAction(),g=syncHealth(),source=document.createElement('div');source.innerHTML=commandDataStrip();const sourceNode=source.firstElementChild;
  hero.insertAdjacentElement('afterend',sourceNode);
  const wrap=document.createElement('section');wrap.className='v10-critical-wrap';
  const realAsset=!!(c&&g.fresh&&matchedRows(c.symbol).length&&!['DATA_STALE','MARKET_STALE','UNVERIFIED'].includes(c.status.code)),criticalHtml=realAsset?pairCard(c.symbol,true):'<article class="asset-pair pair-compact blocked-critical"><div class="pair-head"><span class="asset-symbol">'+esc(c?.symbol||'BOT DATA')+'</span><b class="pair-status tone-muted">'+esc(c?.status.label||'BLOCKED')+'</b></div><div class="pair-reason">'+esc(c?.status.reason||'Keine frischen privaten Bot-Daten')+'</div></article>';
  wrap.innerHTML='<div class="section-title"><h2>'+(realAsset?'LIVE RISK PRIORITY':'LIVE BOT STATUS')+'</h2><small>Safety/Data Guard überstimmt Trading-Signal</small></div>'+criticalHtml;
  sourceNode.insertAdjacentElement('afterend',wrap);
  const action=$('.command-action',view);
  if(action){action.innerHTML='<span>NEXT ACTION</span><b>'+esc(a.title)+'</b><small>'+esc(a.detail)+'</small>';wrap.insertAdjacentElement('afterend',action);}
  const live=document.createElement('div');live.innerHTML=liveOverview();const liveNode=live.firstElementChild;
  (action||wrap).insertAdjacentElement('afterend',liveNode);
  const guard=document.createElement('div');guard.innerHTML=dataGuardCard();liveNode.insertAdjacentElement('afterend',guard.firstElementChild);
  const account=document.createElement('div');account.innerHTML=accountPositionLayer(true);guard.firstElementChild.insertAdjacentElement('afterend',account.firstElementChild);
  const wallet=document.createElement('div');wallet.innerHTML=walletDiscoveryLayer();account.firstElementChild.insertAdjacentElement('afterend',wallet.firstElementChild);
  for(const sel of ['.risk-cockpit','.exposure-card','.manual-strip','.okx-strip','.risk-v2','.lock-radar','.quick-grid','.command-bots','.data-truth']) $$(sel,view).forEach(x=>x.remove());
  $$('.section-title',view).filter(x=>['RISK PRIORITY','ASSET RISK MAP'].includes($('h2',x)?.textContent||'')).forEach(x=>x.remove());
}
function renderBots(force=false){
  const view=$('#view-bots');if(!view)return;
  if(!force&&$('.v10-pair-stack',view))return;
  if(!force&&!$('.bot-hero',view)&&!$('.bot-group',view))return;
  const snapshotOpen=force?$('.v10-snapshot-details',view)?.open:null,unmatchedOpen=force?$('.v10-unmatched-details',view)?.open:null;
  const s=S(),g=syncHealth(),ph=accountPositionHealth(),syms=g.fresh?symbols():[],unmatched=g.unmatched;
  const source=g.walletFeed?'WALLET DETAIL':g.status==='BOT_API_OK'||g.status==='OK'?'BOT API':g.status==='DISABLED_MISSING_CREDENTIALS'?'OFF':g.status.replaceAll('_',' ');
  const liveCards=syms.map(symbol=>pairCard(symbol)).filter(Boolean).join('');
  view.innerHTML='<section class="v10-mode-banner" data-tone="live"><div><span>LIVE</span><b>POSITION LAYER</b></div><small>Account-Positionen = echte Futures-Risk-Daten · Bot-Aktionen fail-closed · Asset Watch = Referenz</small></section><section class="bot-tab-head"><div><span>POSITION API</span><b class="tone-'+ph.tone+'">'+esc(ph.label)+'</b><small>'+ph.rows.length+' positions · '+esc(ph.age)+'</small></div><div><span>BOT SOURCE</span><b>'+esc(source)+'</b><small>'+g.apiRows+' source rows · Bot API '+esc(g.botApiStatus)+'</small></div><div><span>SUPPORTED MATCH</span><b>'+g.matched+'/'+g.supported+'</b></div><div><span>SAFETY READY</span><b>'+g.safetyReady+'</b></div><div><span>DECISION READY</span><b>'+g.decisionReady+'</b></div><div><span>BOT AGE</span><b>'+esc(g.age)+'</b></div></section>'+accountPositionLayer(false)+walletDiscoveryLayer()+(unmatched?'<section class="v10-unverified-note">'+unmatched+' unterstützte private Bot-Row(s) sind UNVERIFIED und aus Actions ausgeschlossen.'+(g.ambiguous?' · '+g.ambiguous+' davon AMBIGUOUS MATCH':'')+'</section>':'')+unmatchedDiagnostics(unmatchedOpen??false)+'<div class="v10-pair-stack">'+(liveCards||'<section class="v10-live-blocked bot-live-blocked"><b>KEINE FRISCHEN LIVE-AKTIONSKARTEN</b><small>'+esc(g.detail)+' · Der aktuelle Asset-Watch-Snapshot folgt als Referenz.</small></section>')+'</div>'+snapshotDetails(snapshotOpen??!g.fresh);
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
function marketRow(symbol){
  const s=S(),h=H(),i=s?.assetIntel?.[symbol],m=marketPrice(symbol);
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
function fibZoneState(zone,current){
  const c=Number(current);if(!(c>0)||!zone)return'—';
  if(c>=zone.low&&c<=zone.high)return'IN ZONE';
  const edge=c<zone.low?zone.low:zone.high,d=Math.abs((edge-c)/c*100);
  return d.toFixed(2)+'% entfernt';
}
function fibZoneBand(zone,levels,current,kind,label,active=false){
  const y1=fibPlotPosition(zone.high,levels,current),y2=fibPlotPosition(zone.low,levels,current),top=Math.min(y1,y2),height=Math.max(2,Math.abs(y2-y1));
  return '<div class="fib-zone fib-zone-'+kind+' '+(active?'active':'')+'" style="top:'+top.toFixed(2)+'%;height:'+height.toFixed(2)+'%"><span>'+label+'</span></div>';
}
function fibSkCards(low,high,direction,current,doubleAdvantage){
  const zones=skLongShortZones(low,high),target=skTargetZone(low,high,direction),targetSide=direction==='UP'?'BULLISH TARGET / SHORT WATCH':'BEARISH TARGET / LONG WATCH';
  const da=doubleAdvantage?.candidate
    ?'<div class="sk-double '+doubleAdvantage.side.toLowerCase()+'"><span>DOPPELTER VORTEIL · '+doubleAdvantage.side+'</span><b>'+fibFmt(doubleAdvantage.overlap.low)+' – '+fibFmt(doubleAdvantage.overlap.high)+'</b><small>Gegen-Ziel ∩ GKL · '+doubleAdvantage.overlap.overlapPct.toFixed(0)+'% Überlappung · Bestätigung über Struktur nötig</small></div>'
    :'<div class="sk-double muted"><span>DOPPELTER VORTEIL</span><b>—</b><small>Keine bestätigte Gegen-Ziel ∩ GKL Überlappung</small></div>';
  return '<div class="sk-zone-grid"><div class="sk-zone bull"><span>LONG TRENDWENDE · BULLISH</span><b>'+fibFmt(zones.long.low)+' – '+fibFmt(zones.long.high)+'</b><small>GKL 0.500 / 0.559 / 0.618 / 0.667 · '+fibZoneState(zones.long,current)+'</small></div><div class="sk-zone bear"><span>SHORT TRENDWENDE · BEARISH</span><b>'+fibFmt(zones.short.low)+' – '+fibFmt(zones.short.high)+'</b><small>GKL 0.500 / 0.559 / 0.618 / 0.667 · '+fibZoneState(zones.short,current)+'</small></div><div class="sk-zone target"><span>'+targetSide+'</span><b>'+fibFmt(target.low)+' – '+fibFmt(target.high)+'</b><small>SK Zielbereich 1.618 / 1.809 / 2.000 · Reaktion beobachten, nicht automatisch handeln</small></div></div><div class="sk-double-grid">'+da+'</div>';
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
function refreshFibMap(view){
  const old=$('.fib-map-shell',view);if(!old)return;
  old.outerHTML=fibMapHtml();bindFibMap(view);
}
function bindFibMap(view){
  const asset=$('#fib-asset',view),win=$('#fib-window',view);
  if(asset)asset.onchange=()=>{fibUi.symbol=asset.value;fibUi.manualHigh=null;fibUi.manualLow=null;refreshFibMap(view)};
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
  const s=S(),h=H(),i=s?.intel,syms=marketUniverse(),mh=marketHealth(),verified=syms.filter(symbol=>{const x=s?.priceChecks?.[symbol];return x?.verified&&freshTs(x.updatedAt)}).length;
  const health='<section class="market-health"><div><span>BTC TECH FEED</span><b class="tone-'+(mh.fresh?'safe':'watch')+'">'+(mh.fresh?'FRESH':'STALE')+'</b><small>'+esc(mh.ageText)+'</small></div><div><span>TECH COVERAGE</span><b class="tone-'+(mh.coverageComplete?'safe':'watch')+'">'+mh.freshAssets+'/'+mh.totalAssets+'</b><small>'+mh.staleAssets+' stale · '+mh.missingAssets+' missing</small></div><div><span>2-SOURCE PRICE</span><b>'+verified+'/'+syms.length+'</b><small>'+(mh.priceFresh?'fresh':'stale')+'</small></div><div><span>SOURCE</span><b>FUTURES</b><small>OKX / Binance USD-M</small></div></section>';
  const btc=mh.fresh&&i?'<section class="market-regime"><div><span>BTC REGIME</span><b>'+btcRegimeLabel(i)+'</b><small>'+h.money?.(i.price)+' · '+esc(i.source||'MARKET FEED')+' · '+esc(mh.ageText)+'</small></div><strong class="'+(i.score>=70?'tone-safe':i.score>=55?'tone-watch':'tone-muted')+'">'+i.score+'/100 · '+esc(i.status)+'</strong></section><section class="market-kpis"><div><span>RSI 15m / 1h</span><b>'+fmt(i.rsi15)+' · '+fmt(i.rsi1h)+'</b></div><div><span>RSI 4h / 1D</span><b>'+fmt(i.rsi4)+' · '+fmt(i.rsi1d)+'</b></div><div><span>MACD 1h / 4h</span><b>'+fmt(i.macd1h?.hist,2)+' · '+fmt(i.macd4?.hist,2)+'</b></div><div><span>EMA20 / EMA50 1D</span><b>'+h.money?.(i.ema20)+' / '+h.money?.(i.ema50)+'</b></div><div><span>NEAREST FIB</span><b>'+fmt(i.near?.f,3)+' · '+h.money?.(i.near?.price)+'</b></div><div><span>ATR 4h</span><b>'+h.money?.(i.atr)+'</b></div></section>':'<section class="v10-live-blocked market-stale"><b>BTC REGIME BLOCKED</b><small>Technische Marktdaten sind nicht frisch genug. Keine Regime-/Setup-Aussage aus altem Feed.</small></section>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="market"><div><span>MARKET</span><b>REGIME + FIB MAP + ASSET TAPE</b></div><small>Öffentliche Futures-Marktdaten · 1h/4h/1D bestätigt nur auf geschlossenen Kerzen</small></section><div class="v10-market-board">'+health+btc+fibMapHtml()+'<div class="section-title"><h2>ASSET TAPE</h2><small>'+syms.length+' Märkte · '+mh.freshAssets+' frisch · 15m/1h/4h</small></div><div class="market-list">'+syms.map(marketRow).join('')+'</div></div>';
  bindFibMap(view);
}
function scannerCard(symbol){
  const s=S(),h=H(),i=s?.assetIntel?.[symbol],liveLinked=!!h.botFeedFresh?.()&&matchedRows(symbol).length>0,refLinked=referenceLinked(symbol),link=liveLinked?'LIVE BOT · FRESH':refLinked?'REF BOT · ASSET WATCH':'MARKET ONLY';
  if(!i)return '<article class="scan-card compact-scan scan-missing"><div class="scan-head"><div><strong>'+esc(symbol)+'</strong><small>'+link+' · NO TECH DATA</small></div><b class="tone-muted">NO DATA</b></div><div class="scan-grid compact"><span>RSI 15m / 1h <b>— · —</b></span><span>RSI 4h <b>—</b></span><span>MACD 1h / 4h <b>— · —</b></span><span>RAW PRESSURE <b>—</b></span></div><div class="scan-actions"><span>LONG VIEW <b>BLOCKED</b></span><span>SHORT VIEW <b>BLOCKED</b></span></div><small>Kein technischer Datensatz geladen · keine Ranking-/Setup-Aussage.</small></article>';
  const fresh=intelFresh(i),sig=marketSignal(i),bearReasons=i.longReasons||[],bullReasons=i.shortReasons||[],reasonSet=!fresh?[]:sig.label.startsWith('BEAR')?bearReasons:sig.label.startsWith('BULL')?bullReasons:[bearReasons[0],bullReasons[0],...bearReasons.slice(1),...bullReasons.slice(1)].filter(Boolean),reasons=[...new Set(reasonSet)],age=i.updatedAt?h.ageText?.(Date.now()-i.updatedAt):'—';
  return '<article class="scan-card compact-scan '+(fresh?'':'scan-stale')+'"><div class="scan-head"><div><strong>'+esc(symbol)+'</strong><small>'+link+' · '+esc(age)+(fresh?'':' · REFERENCE ONLY')+'</small></div><b class="tone-'+sig.tone+'">'+sig.label+'</b></div><div class="scan-grid compact"><span>RSI 15m / 1h <b>'+fmt(i.rsi15)+' · '+fmt(i.rsi1h)+'</b></span><span>RSI 4h <b>'+fmt(i.rsi4)+'</b></span><span>MACD 1h / 4h <b>'+fmt(i.macd1h?.hist,2)+' · '+fmt(i.macd4?.hist,2)+'</b></span><span>RAW PRESSURE <b>'+(fresh?sig.score+'/9':'—')+'</b></span></div><div class="scan-actions"><span>LONG VIEW <b>'+(fresh?esc(i.longAction):'BLOCKED')+'</b></span><span>SHORT VIEW <b>'+(fresh?esc(i.shortAction):'BLOCKED')+'</b></span></div><small>'+(fresh?esc(reasons.slice(0,2).join(' · ')||'Kein starkes Momentum-Warnsignal'):'Veraltete technische Werte nur als Referenz')+' · CONFIRMED nur mit frischen, geschlossenen 1h + 4h Kerzen</small></article>';
}
function renderScanner(force=false){
  const view=$('#view-research');if(!view)return;
  if(!force&&$('.v10-scanner-stack',view))return;
  if(!force&&!$('.bt-control',view)&&!$('.hero',view))return;
  const moreOpen=force?!!$('.scanner-more:not(.scanner-stale)',view)?.open:false,staleOpen=force?!!$('.scanner-more.scanner-stale',view)?.open:false;
  const s=S(),h=H(),all=marketUniverse(),fresh=all.filter(x=>intelFresh(s?.assetIntel?.[x])).sort((a,b)=>{const A=marketSignal(s.assetIntel[a]),B=marketSignal(s.assetIntel[b]);return B.rank-A.rank||B.score-A.score}),stale=all.filter(x=>!!s?.assetIntel?.[x]&&!intelFresh(s.assetIntel[x])),missing=all.filter(x=>!s?.assetIntel?.[x]),blocked=[...stale,...missing];
  const confirmed=fresh.filter(x=>marketSignal(s.assetIntel[x]).confirmed),top=fresh.slice(0,4),rest=fresh.slice(4),liveLinked=h.botFeedFresh?.()?all.filter(x=>matchedRows(x).length).length:0,refLinked=all.filter(referenceLinked).length;
  const stack=top.length?top.map(scannerCard).join(''):'<section class="v10-live-blocked market-stale"><b>SCANNER BLOCKED</b><small>Keine frischen Multi-Timeframe-Marktdaten · keine bestätigten Setups ausgeben.</small></section>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="research"><div><span>SCANNER</span><b>MARKET SIGNALS</b></div><small>CONFIRMED braucht geschlossene 1h + 4h Alignment · 15m bleibt Trigger · Bot-Referenz beeinflusst Ranking nicht</small></section><section class="scanner-summary"><div><span>FRESH MARKETS</span><b>'+fresh.length+'/'+all.length+'</b></div><div><span>CONFIRMED</span><b>'+confirmed.length+'</b></div><div><span>LIVE / REF BOT</span><b>'+liveLinked+' / '+refLinked+'</b></div><div><span>STALE / MISSING</span><b class="'+(blocked.length?'tone-watch':'tone-safe')+'">'+stale.length+' / '+missing.length+'</b></div></section><div class="section-title"><h2>TOP SETUPS</h2><small>Freshness + Bestätigung vor Roh-Pressure</small></div><div class="v10-scanner-stack">'+stack+'</div>'+(rest.length?'<details class="scanner-more" '+(moreOpen?'open':'')+'><summary>WEITERE '+rest.length+' FRISCHE MÄRKTE</summary><div class="v10-scanner-stack">'+rest.map(scannerCard).join('')+'</div></details>':'')+(blocked.length?'<details class="scanner-more scanner-stale" '+(staleOpen?'open':'')+'><summary>STALE / NO DATA · '+stale.length+' / '+missing.length+'</summary><div class="v10-scanner-stack">'+blocked.map(scannerCard).join('')+'</div></details>':'');
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
  const discovery=edgeUi.tsmom?(edgeUi.tsmom.gate?.pass?'PASS':'FAIL'):'NOT RUN',holdout=holdoutUi.combined?(holdoutUi.combined.pass?'PASS':'FAIL'):'NOT RUN',sk=skV2Ui.result?(skV2Ui.result.gate?.pass?'V2 PASS':'V2 FAIL'):'FROZEN';
  return '<div><span>TSMOM DISCOVERY</span><b class="tone-'+(discovery==='PASS'?'safe':discovery==='FAIL'?'watch':'muted')+'">'+discovery+'</b><small>interner Gate · kein Beweis</small></div><div><span>TSMOM HOLDOUT</span><b class="tone-'+(holdout==='PASS'?'safe':holdout==='FAIL'?'watch':'muted')+'">'+holdout+'</b><small>unabhängige Validierung</small></div><div><span>SK SYSTEM</span><b>'+sk+'</b><small>V1/V2 Research-Benchmark</small></div><div><span>EXECUTION</span><b>OFF</b><small>Research only · keine Orders</small></div>';
}
function renderLab(){
  const view=$('#view-more'),b=bridge();if(!view||!b)return;
  if(!$('.bt-control',view)&&!$('.bt-result',view)){
    view.innerHTML=b.renderResearch?.()||'<section class="card">LAB nicht verfügbar.</section>';
    b.bindResearch?.('more');
  }
  banner('#view-more','LAB','RESEARCH HUB','Dokumentierte Strategien + interne Hypothesen · keine Orders','paper');
  $('.hero',view)?.remove();

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
  if(!overview){overview=document.createElement('section');overview.className='lab-overview';$('.documented-edge-module',view)?.insertAdjacentElement('beforebegin',overview);}
  const nextOverview=labOverviewHtml();if(overview&&overview.innerHTML!==nextOverview)overview.innerHTML=nextOverview;
  let note=$('.lab-validation-note',view);
  if(!note){note=document.createElement('section');note.className='lab-validation-note';overview?.insertAdjacentElement('afterend',note);}
  const nextNote='<b>VALIDATION LADDER</b><small>Discovery PASS ≠ bestätigtes Edge. Deep-Audit r20 korrigiert Accounting/Lookahead; frühere TSMOM/SK-Ergebnisse müssen neu gerechnet werden. Holdout muss unabhängig bestehen; danach höchstens Paper-Shadow/Forward-Test, nie Auto-Promotion.</small>';
  if(note&&note.innerHTML!==nextNote)note.innerHTML=nextNote;
}
function activeViewKey(){return String($('.view.active')?.id||'view-command').replace(/^view-/,'')}
function decorate(forceData=false){
  document.documentElement.dataset.meridianBuild=BUILD;
  const active=activeViewKey();
  renderCommand(forceData&&active==='command');
  renderBots(forceData&&active==='bots');
  renderMarket(forceData&&active==='market');
  renderScanner(forceData&&active==='research');
  renderLab();renderSystemHeader();decorateA11y();
}
let raf=0,pendingDataRefresh=false;
const schedule=(forceData=false)=>{
  if(forceData===true)pendingDataRefresh=true;
  if(raf)return;
  raf=requestAnimationFrame(()=>{const force=pendingDataRefresh;pendingDataRefresh=false;raf=0;decorate(force);});
};
window.addEventListener('meridian:data',()=>schedule(true));
new MutationObserver(()=>schedule(false)).observe($('#app')||document.body,{childList:true,subtree:true});
decorate();
