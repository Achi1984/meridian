// MERIDIAN v10 r6 — isolated presentation/command adapter over the validated v9 engine.
// No trading logic lives here. It consumes the read-only v9 bridge and never submits orders.
const BUILD='10.0-r6';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const bridge=()=>window.MERIDIAN_V10_BRIDGE||null;
const S=()=>bridge()?.getState?.()||null;
const H=()=>bridge()?.helpers||{};
const fibUi={symbol:'BTC',mode:'AUTO',manualHigh:null,manualLow:null,direction:'AUTO'};

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
  const risks=rows.map(b=>h.risk?.(b)).filter(x=>x!=null);
  if(rows.some(b=>!h.livePnlAvailable?.(b))||risks.length!==rows.length)return{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:'Mindestens ein Action-Feld (PnL/Liq) fehlt live'};
  const min=Math.min(...risks);
  if(min<10)return{code:'LIQ_RISK',label:'LIQ RISK',tone:'danger',rank:80,reason:'Liq-Puffer nur '+min.toFixed(1)+'%'};
  const plans=rows.map(b=>h.profitLockPlan?.(b)).filter(Boolean);
  const signals=rows.map(b=>h.actionForSide?.(s.assetIntel?.[b.symbol],b.side||'LONG'));
  if(plans.some(p=>['LOCK20','LOCK25','LOCK50'].includes(p.code)))return{code:'PROFIT_LOCK',label:'PROFIT LOCK',tone:'watch',rank:60,reason:'Technische Schwäche + ausreichendes Gewinnpolster'};
  if(signals.includes('RISK REVIEW'))return{code:'RISK_REVIEW',label:'RISK REVIEW',tone:'danger',rank:70,reason:'4h/1h Struktur dreht gegen mindestens eine Seite'};
  if(signals.includes('PROFIT LOCK CANDIDATE')||signals.includes('WATCH PROFIT'))return{code:'WATCH_PROFIT',label:'WATCH PROFIT',tone:'watch',rank:40,reason:'15m/1h Frühwarnung · 4h noch nicht als Exit bestätigt'};
  return{code:'HOLD',label:'HOLD',tone:'safe',rank:10,reason:'Kein bestätigtes Exit-/Safety-Signal'};
}
function exposure(rows,side){
  const h=H();return rows.filter(b=>(b.side||'LONG')===side&&h.liveInvestAvailable?.(b))
    .reduce((n,b)=>n+(Number(b.invest)||0)*(Number(b.leverage)||1),0);
}
function marketPrice(symbol){
  const s=S(),h=H(),c=s?.priceChecks?.[symbol],vals=c?.verified?[Number(c.okx),Number(c.binance)].filter(x=>x>0):[];
  if(vals.length===2)return{value:(vals[0]+vals[1])/2,source:'OKX + BINANCE',verified:true,spread:Number(c.spreadPct)||0};
  const p=Number(s?.assetIntel?.[symbol]?.price??(symbol==='BTC'?s?.intel?.price:null));
  return{value:p>0?p:null,source:p>0?'MARKET FEED':'UNVERIFIED',verified:false,spread:null};
}
function legRow(b){
  const h=H(),fresh=h.botFeedFresh?.(),verified=fresh&&h.liveMatched?.(b),pnl=verified&&h.livePnlAvailable?.(b)?h.botPnlUsd?.(b)?.value:null,r=verified?h.risk?.(b):null;
  if(!fresh)return '<div class="pair-leg pair-leg-stale '+((b.side||'LONG')==='SHORT'?'leg-short':'leg-long')+'"><div class="leg-head"><strong>'+(b.side||'LONG')+' · '+(b.leverage||'—')+'x</strong><span>STALE</span></div><small>Bot-Felder ausgeblendet · frischen privaten Snapshot abwarten</small></div>';
  if(!verified)return '<div class="pair-leg pair-leg-stale"><div class="leg-head"><strong>'+(b.side||'BOT')+' · '+(b.leverage||'—')+'x</strong><span>UNVERIFIED</span></div><small>Nicht handlungsrelevant</small></div>';
  return '<div class="pair-leg '+((b.side||'LONG')==='SHORT'?'leg-short':'leg-long')+'"><div class="leg-head"><strong>'+(b.side||'LONG')+' · '+(b.leverage||'—')+'x</strong><span>PRIVATE</span></div><div class="leg-grid"><span>INVEST <b>'+(h.liveInvestAvailable?.(b)?h.money(b.invest):'—')+'</b></span><span>PNL <b>'+(pnl==null?'—':h.money(pnl))+'</b></span><span>BE <b>'+(Number(b.be)>0?h.money(b.be):'—')+'</b></span><span>TP <b>'+(Number(b.tp)>0?h.money(b.tp):'—')+'</b></span><span>LIQ <b>'+(Number(b.liq)>0?h.money(b.liq):'—')+'</b></span><span>PUFFER <b>'+(r==null?'—':r.toFixed(1)+'%')+'</b></span></div></div>';
}
function pairCard(symbol,compact=false){
  const h=H(),rows=matchedRows(symbol),st=pairStatus(symbol),fresh=h.botFeedFresh?.(),longs=rows.filter(b=>(b.side||'LONG')==='LONG'),shorts=rows.filter(b=>b.side==='SHORT'),mp=marketPrice(symbol);
  if(!fresh&&!compact){
    const sides=[longs.length?longs.length+' LONG':'',shorts.length?shorts.length+' SHORT':''].filter(Boolean).join(' · ')||'BOT LINK UNKNOWN';
    const leverage=[...new Set(rows.map(b=>Number(b.leverage)).filter(x=>x>0))].map(x=>x+'x').join(' / ');
    return '<article class="asset-pair stale-pair-card"><div class="pair-head"><div><span class="asset-symbol">'+symbol+'</span><small>'+sides+(leverage?' · '+leverage:'')+'</small></div><b class="pair-status tone-muted">DATA STALE</b></div><div class="stale-pair-line"><div><span>MARKET</span><b>'+h.money?.(mp.value)+'</b><small>'+mp.source+'</small></div><p>Private Bot-Felder ausgeblendet · kein Risk/PNL/Next-Action aus altem Snapshot</p></div></article>';
  }
  const longUsd=fresh?exposure(rows,'LONG'):0,shortUsd=fresh?exposure(rows,'SHORT'):0;
  const pnl=fresh?rows.filter(b=>h.livePnlAvailable?.(b)).map(b=>h.botPnlUsd?.(b)?.value).filter(x=>x!=null).reduce((a,b)=>a+b,0):null;
  const hedge=longUsd>0?shortUsd/longUsd*100:null;
  return '<article class="asset-pair '+(compact?'pair-compact':'')+'"><div class="pair-head"><div><span class="asset-symbol">'+symbol+'</span><small>'+longs.length+' LONG · '+shorts.length+' SHORT</small></div><b class="pair-status tone-'+st.tone+'">'+st.label+'</b></div><div class="pair-summary"><div><span>MARKET PRICE</span><b>'+h.money?.(mp.value)+'</b><small>'+mp.source+'</small></div><div><span>NET EXPOSURE</span><b>'+(fresh?h.money?.(longUsd-shortUsd):'—')+'</b></div><div><span>HEDGE</span><b>'+(fresh&&hedge!=null?hedge.toFixed(1)+'%':'—')+'</b></div><div><span>PAIR PNL</span><b>'+(pnl==null?'—':h.money?.(pnl))+'</b></div></div><div class="pair-reason">'+st.reason+'</div>'+(compact?'':'<div class="pair-legs">'+rows.map(legRow).join('')+'</div>')+'</article>';
}
function criticalPair(){
  const s=S();if(!s)return null;
  const pairs=symbols().map(symbol=>({symbol,status:pairStatus(symbol)})).sort((a,b)=>b.status.rank-a.status.rank);
  if(pairs.length)return pairs[0];
  if((s.unmatchedLive||[]).length)return{symbol:'API',status:{code:'UNVERIFIED',label:'UNVERIFIED',tone:'muted',rank:90,reason:(s.unmatchedLive||[]).length+' private Bot-Rows sind nicht sicher gematcht'}};
  return null;
}
function nextAction(){
  const c=criticalPair();if(!c)return{title:'DATEN SYNC',detail:'Keine privaten Bot-Rows · keine Aktion aus Referenzdaten'};
  const s=c.status;
  if(['DATA_STALE','UNVERIFIED'].includes(s.code))return{title:'KEINE AKTION · DATEN PRÜFEN',detail:c.symbol+' · '+s.reason};
  if(s.code==='LIQ_RISK')return{title:c.symbol+' · LIQ-PUFFER PRÜFEN',detail:s.reason+' · Safety vor Profit-Lock'};
  if(s.code==='RISK_REVIEW')return{title:c.symbol+' · RISK REVIEW',detail:s.reason+' · nicht reflexartig komplett schließen'};
  if(s.code==='PROFIT_LOCK')return{title:c.symbol+' · PROFIT LOCK PRÜFEN',detail:s.reason+' · Teilgewinn/Reload-Reserve statt Komplettausstieg'};
  if(s.code==='WATCH_PROFIT')return{title:c.symbol+' · WATCH PROFIT',detail:s.reason};
  return{title:'HOLD · RUNNER WEITERLAUFEN',detail:'Kein 4h-bestätigtes Exit-Signal'};
}
function syncHealth(){
  const s=S(),h=H(),matched=(s?.bots||[]).filter(h.liveMatched||(()=>false)),raw=Number(s?.botApiRows??s?.liveRows??0),fresh=!!h.botFeedFresh?.();
  const actionable=fresh?matched.filter(b=>h.livePnlAvailable?.(b)&&h.risk?.(b)!=null).length:0;
  const status=String(s?.pionexBotSync?.status||'UNKNOWN'),age=h.ageText?.(h.botFeedAgeMs?.())||'—',unmatched=Math.max(0,raw-matched.length);
  let detail='Private Bot-Daten werden geprüft.';
  if(status==='DISABLED_MISSING_CREDENTIALS')detail='Pionex Read API fehlt am Backend · PIONEX_BOT_READ_API_KEY + PIONEX_BOT_READ_API_SECRET';
  else if(status==='ERROR')detail='Pionex Bot API Sync-Fehler · '+String(s?.pionexBotSync?.error||'unbekannt').slice(0,110);
  else if(status==='EMPTY_GUARD')detail='API meldet 0 unterstützte laufende Futures-Bots · alter Snapshot bleibt blockiert.';
  else if(status==='OK'&&!fresh)detail='API ist konfiguriert, aber der letzte Bot-Snapshot ist nicht frisch genug.';
  else if(status==='OK'&&fresh)detail='Private Pionex Bot-Daten sind frisch und entscheidungsrelevant.';
  return{raw,matched:matched.length,actionable,unmatched,status,age,fresh,detail};
}
function dataGuardCard(){
  const g=syncHealth(),tone=g.actionable>0?'safe':g.status==='ERROR'?'danger':'watch',api=g.status==='OK'?'ON':g.status==='DISABLED_MISSING_CREDENTIALS'?'OFF':g.status.replaceAll('_',' ');
  return '<section class="v10-data-guard"><div class="guard-head"><div><span>DATA GUARD</span><b>LIVE BOT INTEGRITY</b></div><strong class="tone-'+tone+'">'+(g.actionable>0?'ACTIONABLE':'BLOCKED')+'</strong></div><div class="guard-grid"><div><span>BOT API</span><b>'+api+'</b></div><div><span>PRIVATE MATCH</span><b>'+g.matched+'/'+g.raw+'</b></div><div><span>ACTIONABLE</span><b>'+g.actionable+'</b></div><div><span>SNAPSHOT AGE</span><b>'+g.age+'</b></div><div><span>UNMATCHED</span><b>'+g.unmatched+'</b></div><div><span>SOURCE</span><b>'+String(S()?.botFeedSource||'—').replaceAll('_',' ')+'</b></div></div><small>'+g.detail+'</small></section>';
}
function liveOverview(){
  const g=syncHealth(),h=H(),rows=g.actionable>0?(S()?.bots||[]).filter(b=>h.liveMatched?.(b)):[];
  if(!g.actionable)return '<section class="v10-live-blocked"><b>LIVE LAYER BLOCKED</b><small>Risk, Exposure und Profit-Lock bleiben ausgeblendet, bis private Bot-Daten frisch und vollständig sind.</small></section>';
  const long=exposure(rows,'LONG'),short=exposure(rows,'SHORT'),net=long-short;
  const plans=rows.map(b=>h.profitLockPlan?.(b)).filter(Boolean),lock=plans.filter(p=>['LOCK20','LOCK25','LOCK50'].includes(p.code)).length,watch=plans.filter(p=>['WATCH','HEDGE'].includes(p.code)).length;
  return '<section class="v10-live-overview"><div><span>LIVE LONG</span><b>'+h.money?.(long)+'</b></div><div><span>LIVE SHORT</span><b>'+h.money?.(short)+'</b></div><div><span>KNOWN NET</span><b>'+h.money?.(net)+'</b></div><div><span>PROFIT WATCH</span><b>'+watch+'</b></div><div><span>PROFIT LOCK</span><b>'+lock+'</b></div><div><span>ACTIONABLE</span><b>'+g.actionable+'</b></div></section>';
}
function snapshotDetails(){
  const s=S(),h=H(),manual=s?.pionexManual||[],okx=s?.okxDcaBots||[];
  if(!manual.length&&!okx.length)return'';
  const p=manual.map(x=>'<div class="snapshot-row"><b>'+x.symbol+' '+(x.side||'')+' · '+(x.leverage||'—')+'x</b><span>PIONEX MANUAL · REFERENCE</span></div>').join('');
  const o=okx.map(x=>'<div class="snapshot-row"><b>'+x.symbol+' '+(x.side||'')+' · '+(x.leverage||'—')+'x</b><span>OKX DCA · '+(x.snapshotAt||'SNAPSHOT')+'</span></div>').join('');
  return '<details class="v10-snapshot-details"><summary>REFERENCE SNAPSHOTS · '+(manual.length+okx.length)+'</summary><div class="snapshot-list">'+p+o+'</div><small>Nur Ansicht · keine Risk-/Next-Action-Ableitung.</small></details>';
}
function renderCommand(){
  const view=$('#view-command');if(!view||!$('.portfolio-hero',view))return;
  banner('#view-command','COMMAND','PORTFOLIO + RISK DECISION SUPPORT','Nur frische private Daten erzeugen Trading-Aktionen','live');
  dataGuardDecorate();
  $$('.v10-critical-wrap,.v10-data-guard,.v10-live-overview,.v10-live-blocked',view).forEach(x=>x.remove());
  const hero=$('.portfolio-hero',view),c=criticalPair(),a=nextAction();
  const wrap=document.createElement('section');wrap.className='v10-critical-wrap';
  wrap.innerHTML='<div class="section-title"><h2>KRITISCHSTES ASSET</h2><small>Safety/Data Guard überstimmt Trading-Signal</small></div>'+(c&&c.symbol!=='API'?pairCard(c.symbol,true):'<article class="asset-pair pair-compact"><div class="pair-head"><span class="asset-symbol">'+(c?.symbol||'SYNC')+'</span><b class="pair-status tone-muted">'+(c?.status.label||'SYNC')+'</b></div><div class="pair-reason">'+(c?.status.reason||'Keine privaten Bot-Daten')+'</div></article>');
  hero.insertAdjacentElement('afterend',wrap);
  const action=$('.command-action',view);
  if(action){action.innerHTML='<span>NEXT ACTION</span><b>'+a.title+'</b><small>'+a.detail+'</small>';wrap.insertAdjacentElement('afterend',action);}
  const live=document.createElement('div');live.innerHTML=liveOverview();const liveNode=live.firstElementChild;
  (action||wrap).insertAdjacentElement('afterend',liveNode);
  const guard=document.createElement('div');guard.innerHTML=dataGuardCard();liveNode.insertAdjacentElement('afterend',guard.firstElementChild);

  for(const sel of ['.risk-cockpit','.exposure-card','.manual-strip','.okx-strip','.risk-v2','.lock-radar','.quick-grid','.command-bots','.data-truth']) $$(sel,view).forEach(x=>x.remove());
  $$('.section-title',view).filter(x=>['RISK PRIORITY','ASSET RISK MAP'].includes($('h2',x)?.textContent||'')).forEach(x=>x.remove());
}
function renderBots(){
  const view=$('#view-bots');if(!view||$('.v10-pair-stack',view))return;
  if(!$('.bot-hero',view)&&!$('.bot-group',view))return;
  const s=S(),syms=symbols(),unmatched=(s?.unmatchedLive||[]).length,g=syncHealth();
  const api=g.status==='OK'?'ON':g.status==='DISABLED_MISSING_CREDENTIALS'?'OFF':g.status.replaceAll('_',' ');
  view.innerHTML='<section class="v10-mode-banner" data-tone="live"><div><span>LIVE</span><b>POSITION LAYER</b></div><small>Nur private Bot-Daten steuern Risk/Profit-Aktionen</small></section><section class="bot-tab-head"><div><span>BOT API</span><b>'+api+'</b></div><div><span>MATCH</span><b>'+g.matched+'/'+g.raw+'</b></div><div><span>ACTIONABLE</span><b>'+g.actionable+'</b></div><div><span>AGE</span><b>'+g.age+'</b></div></section>'+(unmatched?'<section class="v10-unverified-note">'+unmatched+' private API-Row ist UNVERIFIED und aus Actions ausgeschlossen.</section>':'')+'<div class="v10-pair-stack">'+(syms.length?syms.map(s=>pairCard(s)).join(''):'<section class="card"><b>KEINE BESTÄTIGTEN BOT-ROWS</b><p>Referenzbots bleiben aus dieser Ansicht entfernt.</p></section>')+'</div>'+snapshotDetails();
}
function marketUniverse(){
  const pref=['BTC','ETH','SOL','XRP','HBAR','PEPE','LINK','AVAX','SUI','ADA','DOT','XLM','TRX','WIF','INJ'];
  const keys=Object.keys(S()?.assetIntel||{});
  return keys.sort((a,b)=>(pref.indexOf(a)<0?999:pref.indexOf(a))-(pref.indexOf(b)<0?999:pref.indexOf(b))||a.localeCompare(b));
}
function marketSignal(i){
  if(!i)return{label:'SYNC',tone:'muted',score:0,rank:0,confirmed:false};
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
  const s=S(),h=H(),i=s?.assetIntel?.[symbol],m=marketPrice(symbol),sig=marketSignal(i);
  if(!i)return'';
  const macd4=Number(i.macd4?.hist),trend=Number(i.ema20)>Number(i.ema50)?'EMA20 > 50':'EMA20 ≤ 50';
  return '<article class="market-row"><div class="market-symbol"><strong>'+symbol+'</strong><span class="tone-'+sig.tone+'">'+sig.label+'</span></div><div><span>PRICE</span><b>'+h.money?.(m.value)+'</b><small>'+m.source+'</small></div><div><span>RSI 1h / 4h</span><b>'+i.rsi1h.toFixed(1)+' · '+i.rsi4.toFixed(1)+'</b></div><div><span>TREND 1h</span><b>'+trend+'</b></div><div><span>MACD 4h</span><b class="'+(macd4>0?'tone-safe':macd4<0?'tone-danger':'')+'">'+(Number.isFinite(macd4)?macd4.toFixed(2):'—')+'</b></div></article>';
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
function fibSource(symbol){
  const s=S(),a=s?.assetIntel?.[symbol],b=symbol==='BTC'?s?.intel:null,src=a||b||{};
  const lo=Number(src.swingLo??src.lo),hi=Number(src.swingHi??src.hi),dir=String(src.swingDirection||'BULL').toUpperCase();
  const current=marketPrice(symbol).value??Number(src.price);
  return{lo:lo>0?lo:null,hi:hi>0?hi:null,direction:dir==='BEAR'?'BEAR':'BULL',current:current>0?current:null};
}
function fibModel(){
  const auto=fibSource(fibUi.symbol);
  let lo=auto.lo,hi=auto.hi,dir=auto.direction,source='AUTO · 90×4h';
  if(fibUi.mode==='MANUAL'){
    lo=fibParse(fibUi.manualLow);hi=fibParse(fibUi.manualHigh);
    dir=fibUi.direction==='BEAR'?'BEAR':'BULL';source='MANUAL';
  }
  if(!(hi>lo&&lo>0))return{valid:false,symbol:fibUi.symbol,current:auto.current,source};
  const span=hi-lo,current=auto.current;
  const ret=[0,.236,.382,.5,.618,.786,1].map(r=>({
    ratio:r,label:r.toFixed(3),kind:'retracement',
    price:dir==='BULL'?hi-span*r:lo+span*r
  }));
  const ext=[1.272,1.414,1.618].map(r=>({
    ratio:r,label:r.toFixed(3),kind:'extension',
    price:dir==='BULL'?hi+span*(r-1):lo-span*(r-1)
  }));
  const levels=[...ret,...ext].sort((a,b)=>b.price-a.price);
  const above=current?levels.filter(x=>x.price>current).sort((a,b)=>a.price-b.price)[0]:null;
  const below=current?levels.filter(x=>x.price<current).sort((a,b)=>b.price-a.price)[0]:null;
  const vals=levels.map(x=>x.price).concat(current||[]),min=Math.min(...vals),max=Math.max(...vals),range=Math.max(max-min,span*.01);
  return{valid:true,symbol:fibUi.symbol,lo,hi,dir,current,source,levels,above,below,min,max,range};
}
function fibLine(level,m){
  const h=H(),y=Math.max(2,Math.min(98,(m.max-level.price)/m.range*100));
  return '<div class="fib-level '+(level.kind==='extension'?'fib-extension':'fib-retracement')+'" style="top:'+y.toFixed(2)+'%"><span>'+level.label+'</span><i></i><b>'+h.money?.(level.price)+'</b></div>';
}
function fibMapHtml(){
  const h=H(),m=fibModel(),assets=[...new Set(['BTC',...marketUniverse()])];
  const options=assets.map(x=>'<option value="'+x+'" '+(x===fibUi.symbol?'selected':'')+'>'+x+'</option>').join('');
  if(!m.valid)return '<section class="fib-map-shell"><div class="fib-head"><div><span>FIB MAP</span><b>RETRACEMENT + EXTENSIONS</b></div><strong>'+fibUi.symbol+'</strong></div><div class="fib-controls"><label>ASSET<select id="fib-asset">'+options+'</select></label><div class="fib-mode"><button data-fib-mode="AUTO" class="'+(fibUi.mode==='AUTO'?'active':'')+'">AUTO 4H</button><button data-fib-mode="MANUAL" class="'+(fibUi.mode==='MANUAL'?'active':'')+'">MANUAL</button></div></div>'+(fibUi.mode==='MANUAL'?fibManualControls():'')+'<div class="fib-empty">Für dieses Asset fehlen noch gültige Swing-Anker.</div></section>';
  const currentY=m.current?Math.max(2,Math.min(98,(m.max-m.current)/m.range*100)):null;
  return '<section class="fib-map-shell"><div class="fib-head"><div><span>FIB MAP</span><b>RETRACEMENT + EXTENSIONS</b><small>'+m.source+' · '+m.dir+' SWING</small></div><strong>'+m.symbol+'</strong></div><div class="fib-controls"><label>ASSET<select id="fib-asset">'+options+'</select></label><div class="fib-mode"><button data-fib-mode="AUTO" class="'+(fibUi.mode==='AUTO'?'active':'')+'">AUTO 4H</button><button data-fib-mode="MANUAL" class="'+(fibUi.mode==='MANUAL'?'active':'')+'">MANUAL</button></div></div>'+(fibUi.mode==='MANUAL'?fibManualControls():'')+'<div class="fib-anchor-row"><div><span>SWING HIGH</span><b>'+h.money?.(m.hi)+'</b></div><div><span>SWING LOW</span><b>'+h.money?.(m.lo)+'</b></div><div><span>CURRENT</span><b>'+h.money?.(m.current)+'</b></div></div><div class="fib-next"><div><span>NEXT ABOVE</span><b>'+(m.above?m.above.label+' · '+h.money?.(m.above.price):'—')+'</b></div><div><span>NEXT BELOW</span><b>'+(m.below?m.below.label+' · '+h.money?.(m.below.price):'—')+'</b></div></div><div class="fib-ladder">'+m.levels.map(x=>fibLine(x,m)).join('')+(currentY!=null?'<div class="fib-current" style="top:'+currentY.toFixed(2)+'%"><span>CURRENT</span><i></i><b>'+h.money?.(m.current)+'</b></div>':'')+'</div><div class="fib-legend"><span>0–1 = Retracement</span><span>1.272 / 1.414 / 1.618 = Extension</span></div></section>';
}
function fibManualControls(){
  const auto=fibSource(fibUi.symbol),hi=fibUi.manualHigh??auto.hi??'',lo=fibUi.manualLow??auto.lo??'',dir=fibUi.direction==='AUTO'?auto.direction:fibUi.direction;
  return '<div class="fib-manual"><label>HIGH<input id="fib-high" inputmode="decimal" value="'+hi+'"></label><label>LOW<input id="fib-low" inputmode="decimal" value="'+lo+'"></label><label>RICHTUNG<select id="fib-direction"><option value="BULL" '+(dir==='BULL'?'selected':'')+'>BULL ↑</option><option value="BEAR" '+(dir==='BEAR'?'selected':'')+'>BEAR ↓</option></select></label><button id="fib-apply">ANWENDEN</button></div>';
}
function refreshFibMap(view){
  const old=$('.fib-map-shell',view);if(!old)return;
  old.outerHTML=fibMapHtml();bindFibMap(view);
}
function bindFibMap(view){
  const asset=$('#fib-asset',view);if(asset)asset.onchange=()=>{fibUi.symbol=asset.value;fibUi.manualHigh=null;fibUi.manualLow=null;fibUi.direction='AUTO';refreshFibMap(view)};
  $('[data-fib-mode]',view).forEach(btn=>btn.onclick=()=>{const next=btn.dataset.fibMode;if(next==='MANUAL'&&fibUi.mode!=='MANUAL'){const a=fibSource(fibUi.symbol);fibUi.manualHigh=a.hi;fibUi.manualLow=a.lo;fibUi.direction=a.direction}fibUi.mode=next;refreshFibMap(view)});
  const apply=$('#fib-apply',view);if(apply)apply.onclick=()=>{fibUi.manualHigh=$('#fib-high',view)?.value;fibUi.manualLow=$('#fib-low',view)?.value;fibUi.direction=$('#fib-direction',view)?.value||'BULL';refreshFibMap(view)};
}

function renderMarket(){
  const view=$('#view-market');if(!view||$('.v10-market-board',view))return;
  if(!$('.hero',view)&&!$('.grid',view))return;
  const s=S(),h=H(),i=s?.intel,syms=marketUniverse(),age=s?.marketSyncedAt?h.ageText?.(Date.now()-s.marketSyncedAt):'—';
  const btc=i?'<section class="market-regime"><div><span>BTC REGIME</span><b>'+btcRegimeLabel(i)+'</b><small>'+h.money?.(i.price)+' · market sync '+age+'</small></div><strong class="'+(i.score>=70?'tone-safe':i.score>=55?'tone-watch':'tone-muted')+'">'+i.score+'/100 · '+i.status+'</strong></section><section class="market-kpis"><div><span>RSI 15m / 1h</span><b>'+i.rsi15.toFixed(1)+' · '+i.rsi1h.toFixed(1)+'</b></div><div><span>RSI 4h / 1D</span><b>'+i.rsi4.toFixed(1)+' · '+i.rsi1d.toFixed(1)+'</b></div><div><span>MACD 1h / 4h</span><b>'+i.macd1h.hist.toFixed(2)+' · '+i.macd4.hist.toFixed(2)+'</b></div><div><span>EMA20 / EMA50 1D</span><b>'+h.money?.(i.ema20)+' / '+h.money?.(i.ema50)+'</b></div><div><span>NEAREST FIB</span><b>'+i.near.f.toFixed(3)+' · '+h.money?.(i.near.price)+'</b></div><div><span>ATR 4h</span><b>'+h.money?.(i.atr)+'</b></div></section>':'<section class="card">BTC Markt-Sync läuft.</section>';
  view.innerHTML='<section class="v10-mode-banner" data-tone="market"><div><span>MARKET</span><b>REGIME + FIB MAP + ASSET TAPE</b></div><small>Öffentliche Marktdaten · unabhängig vom privaten Bot-Snapshot</small></section><div class="v10-market-board">'+btc+fibMapHtml()+'<div class="section-title"><h2>ASSET TAPE</h2><small>'+syms.length+' Märkte · 15m/1h/4h Momentum</small></div><div class="market-list">'+syms.map(marketRow).join('')+'</div></div>';
  bindFibMap(view);
}
function scannerCard(symbol){
  const s=S(),i=s?.assetIntel?.[symbol],sig=marketSignal(i),linked=matchedRows(symbol).length>0,fresh=H().botFeedFresh?.();
  if(!i)return'';
  const reasons=(sig.label.startsWith('BEAR')?i.longReasons:i.shortReasons)||[];
  return '<article class="scan-card compact-scan"><div class="scan-head"><div><strong>'+symbol+'</strong><small>'+(linked?'BOT LINKED · '+(fresh?'FRESH':'STALE'):'MARKET ONLY')+'</small></div><b class="tone-'+sig.tone+'">'+sig.label+'</b></div><div class="scan-grid compact"><span>RSI 15m / 1h <b>'+i.rsi15.toFixed(1)+' · '+i.rsi1h.toFixed(1)+'</b></span><span>RSI 4h <b>'+i.rsi4.toFixed(1)+'</b></span><span>MACD 1h / 4h <b>'+i.macd1h.hist.toFixed(2)+' · '+i.macd4.hist.toFixed(2)+'</b></span><span>RAW PRESSURE <b>'+sig.score+'/9</b></span></div><div class="scan-actions"><span>LONG VIEW <b>'+i.longAction+'</b></span><span>SHORT VIEW <b>'+i.shortAction+'</b></span></div><small>'+(reasons.slice(0,2).join(' · ')||'Kein starkes Momentum-Warnsignal')+' · CONFIRMED nur bei 1h + 4h Alignment</small></article>';
}
function renderScanner(){
  const view=$('#view-research');if(!view||$('.v10-scanner-stack',view))return;
  if(!$('.bt-control',view)&&!$('.hero',view))return;
  const s=S(),syms=marketUniverse().filter(x=>s?.assetIntel?.[x]).sort((a,b)=>{const A=marketSignal(s.assetIntel[a]),B=marketSignal(s.assetIntel[b]);return B.rank-A.rank||B.score-A.score});
  const confirmed=syms.filter(x=>marketSignal(s.assetIntel[x]).confirmed),top=syms.slice(0,4),rest=syms.slice(4);
  view.innerHTML='<section class="v10-mode-banner" data-tone="research"><div><span>SCANNER</span><b>MARKET SIGNALS</b></div><small>CONFIRMED braucht 1h + 4h Alignment · Marktdaten bleiben getrennt von Bot-Daten</small></section><section class="scanner-summary"><div><span>MARKETS</span><b>'+syms.length+'</b></div><div><span>CONFIRMED</span><b>'+confirmed.length+'</b></div><div><span>BOT LINKED</span><b>'+syms.filter(x=>matchedRows(x).length).length+'</b></div><div><span>BOT DATA</span><b class="'+(H().botFeedFresh?.()?'tone-safe':'tone-watch')+'">'+(H().botFeedFresh?.()?'FRESH':'STALE/OFF')+'</b></div></section><div class="section-title"><h2>TOP SETUPS</h2><small>Bestätigung vor Roh-Pressure</small></div><div class="v10-scanner-stack">'+top.map(scannerCard).join('')+'</div>'+(rest.length?'<details class="scanner-more"><summary>WEITERE '+rest.length+' MÄRKTE</summary><div class="v10-scanner-stack">'+rest.map(scannerCard).join('')+'</div></details>':'');
}
function renderLab(){
  const view=$('#view-more'),b=bridge();if(!view||!b)return;
  if(!$('.bt-control',view)&&!$('.bt-result',view)){
    view.innerHTML=b.renderResearch?.()||'<section class="card">LAB nicht verfügbar.</section>';
    b.bindResearch?.('more');
  }
  banner('#view-more','LAB','RESEARCH HUB','Paper/Research isoliert · keine automatische Promotion · keine Orders','paper');
  $('.hero',view)?.remove();
  if(!$('.lab-overview',view)){
    const bt=S()?.backtest||{},r=bt.result;
    const o=document.createElement('section');o.className='lab-overview';
    o.innerHTML='<div><span>ACTIVE LAB</span><b>PROFIT LOCK V2</b><small>Exit-Policy isoliert testen</small></div><div><span>METHOD</span><b>PAIRED TEST</b><small>gleiche Entries · andere Exit-Policy</small></div><div><span>EXECUTION</span><b>OFF</b><small>Research only</small></div><div><span>LAST RESULT</span><b>'+(r?r.symbol:'—')+'</b><small>'+(r?(r.first+' → '+r.last):'noch kein Lauf')+'</small></div>';
    const control=$('.bt-control',view);control?.insertAdjacentElement('beforebegin',o);
  }
  const why=$$('.card',view).find(x=>/Warum dieser Test/i.test(x.textContent||''));
  if(why&&!why.closest('details')){
    const d=document.createElement('details');d.className='lab-method';d.innerHTML='<summary>METHODIK & WARUM</summary><div class="lab-method-body">'+why.innerHTML+'</div>';
    why.replaceWith(d);
  }
}
function decorate(){
  document.documentElement.dataset.meridianBuild=BUILD;
  renderCommand();renderBots();renderMarket();renderScanner();renderLab();
}
let raf=0;const schedule=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;decorate();});};
new MutationObserver(schedule).observe($('#app')||document.body,{childList:true,subtree:true});
decorate();
