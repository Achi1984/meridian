
const state = {
  data: null,
  prices: {},
  changes: {},
  priceMeta: {},
  lastUpdated: null
};

const cgMap = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', XRP:'ripple', SUI:'sui', ADA:'cardano',
  FET:'fetch-ai', HBAR:'hedera-hashgraph', DOT:'polkadot',
  ATOM:'cosmos', NEAR:'near', AVAX:'avalanche-2', TAO:'bittensor',
  INJ:'injective-protocol', PEPE:'pepe', XLM:'stellar'
};

const assetColors = ['#f59e0b','#4a90e2','#35c9bf','#8b74d8','#5bbf8a','#768190'];
const venueColors = {Bitpanda:'#34c978',OKX:'#3f83f8',Ledger:'#9b82ff',Pionex:'#ef5350'};
const HISTORY_KEY='meridian_portfolio_history_v33';
const LEGACY_HISTORY_KEY='meridian_portfolio_history_v32';
const APP_VERSION='3.5.0';
const BUILD_ID='2026-08-21-2120';
let historyRange='24h';
const VERSION_URL='./version.json';

function money(v,d=0){
  return '$'+Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
}
function eur(v){ return '≈ €'+Number(v).toLocaleString('de-DE',{maximumFractionDigits:0});}
function pct(v){ return (v>=0?'+':'−')+Math.abs(v).toFixed(1).replace('.',',')+'%';}
function shortQty(v){
  if(v>=1000) return v.toLocaleString('de-DE',{maximumFractionDigits:4});
  return v.toLocaleString('de-DE',{maximumFractionDigits:8});
}
function fmtTime(d){return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});}
function ageLabel(ts){
  const mins=Math.round((Date.now()-new Date(ts).getTime())/60000);
  if(mins<2)return 'gerade eben';
  if(mins<60)return `${mins} min`;
  const h=Math.round(mins/60); if(h<48)return `${h} h`;
  return new Date(ts).toLocaleDateString('de-DE');
}

async function load(){
  try{
    const r=await fetch('./data.json?v=32&t='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('data.json HTTP '+r.status);
    state.data=await r.json();
    restoreSnapshot();
    renderAll();
    recordHistory(false,'snapshot');
    registerSW();
    await checkBuild();
    setTimeout(()=>refreshPrices(true),700);
  }catch(err){
    console.error(err);
    document.getElementById('portfolioUsd').textContent='Datenfehler';
  }
}

function restoreSnapshot(){
  state.prices={}; state.priceMeta={};
  for(const [venueName,v] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(v.positions||{})){
      if(!state.prices[coin] && p.qty){
        state.prices[coin]=(p.snapshotUnitPrice||p.value/p.qty);
        state.priceMeta[coin]={source:'Snapshot',updatedAt:p.snapshotAt||v.snapshotAt||state.data.snapshotAt};
      }
    }
  }
  state.changes={...state.data.fallbackChanges24h};
  state.lastUpdated=new Date(state.data.snapshotAt);
}

function priceFor(coin){ return state.prices[coin]||null; }
function currentValue(coin,pos){
  const px=priceFor(coin);
  return px && pos.qty ? pos.qty*px : (pos.snapshotValue ?? pos.value);
}

function buildAggregates(){
  const assets={},venues={}; let total=0,liveValue=0,snapshotValue=0;
  for(const [venueName,venue] of Object.entries(state.data.venues)){
    let vv=venue.cash||0;
    if(venue.cash) snapshotValue+=venue.cash;
    for(const [coin,pos] of Object.entries(venue.positions||{})){
      const val=currentValue(coin,pos);
      vv+=val; assets[coin]=(assets[coin]||0)+val;
      if(state.priceMeta[coin]?.source==='Live'){liveValue+=val}else{snapshotValue+=val}
    }
    venues[venueName]=vv; total+=vv;
  }
  return {assets,venues,total,liveValue,snapshotValue};
}

function weighted24h(assets,total){
  let n=0,d=0;
  for(const [coin,val] of Object.entries(assets)){
    if(Number.isFinite(state.changes[coin])){n+=val*state.changes[coin];d+=val;}
  }
  const p=d?n/d:0; return {pct:p,usd:total*p/100,coverage:total?d/total*100:0};
}

function conic(items,colors){
  const total=items.reduce((s,x)=>s+x[1],0)||1;let cur=0,parts=[];
  items.forEach((x,i)=>{const p=x[1]/total*100;parts.push(`${colors[i]} ${cur.toFixed(3)}% ${(cur+p).toFixed(3)}%`);cur+=p;});
  return `conic-gradient(${parts.join(',')})`;
}

function getHistory(){
  try{
    let h=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
    if(!h.length){h=JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY)||'[]');if(h.length)setHistory(h)}
    return h;
  }catch(e){return []}
}
function setHistory(h){
  // 30 days at max. one point / 10 min while the app is open (~4320 points).
  const cutoff=Date.now()-31*24*60*60*1000;
  localStorage.setItem(HISTORY_KEY,JSON.stringify(h.filter(x=>x.t>=cutoff).slice(-4500)));
}
function rangedHistory(h){
  const now=Date.now(), ms={"24h":864e5,"7d":7*864e5,"30d":30*864e5,all:Infinity}[historyRange]||864e5;
  return ms===Infinity?h:h.filter(x=>now-x.t<=ms);
}
function recordHistory(force=false, label=''){
  const {total}=buildAggregates(); if(!total)return;
  let h=getHistory(); const now=Date.now();

  if(!h.length){
    // Seed with a real start value and a tiny earlier timestamp so chart is never blank.
    h.push({t:now-60000,v:total,label:'start'});
    h.push({t:now,v:total,label:label||'snapshot'});
    setHistory(h);
  }else if(force || now-h[h.length-1].t>10*60*1000){
    h.push({t:now,v:total,label}); setHistory(h);
  }
  renderHistory();
}
function renderHistory(){
  const all=getHistory();
  const h=rangedHistory(all);
  const line=document.getElementById('historyLine'),area=document.getElementById('historyArea'),label=document.getElementById('historyLabel');
  const hero=document.querySelector('.hero-card');
  if(!line||!area)return;

  if(h.length<2){
    line.setAttribute('d','M0 45 L320 45');
    line.setAttribute('class','history-single-line');
    area.setAttribute('d','M0 45 L320 45 L320 90 L0 90 Z');
    label.textContent=h.length?`Startwert ${money(h[0].v)}`:'Startwert wird gespeichert';
    hero?.classList.add('history-short');
    return;
  }

  const vals=h.map(x=>x.v), min=Math.min(...vals), max=Math.max(...vals), span=(max-min)||1;
  const flat=(max-min)<0.01;
  let pts;
  if(flat){
    pts=h.map((x,i)=>[i/(h.length-1)*320,45]);
    hero?.classList.add('history-short');
  }else{
    pts=h.map((x,i)=>[i/(h.length-1)*320,82-(x.v-min)/span*70]);
    hero?.classList.remove('history-short');
  }
  const d='M'+pts.map(p=>p.map(n=>n.toFixed(1)).join(' ')).join(' L');
  line.setAttribute('class','line');
  line.setAttribute('d',d);
  area.setAttribute('d',d+` L 320 90 L 0 90 Z`);
  const diff=h[h.length-1].v-h[0].v, pctv=diff/h[0].v*100;
  label.textContent=`${diff>=0?'+':'−'}${money(Math.abs(diff))} · ${pct(pctv)} · ${h.length} Punkte`;
}

function renderDepot(){
  const {assets,venues,total,liveValue}=buildAggregates();
  const sorted=Object.entries(assets).sort((a,b)=>b[1]-a[1]),day=weighted24h(assets,total);

  portfolioUsd.textContent=money(total); portfolioEur.textContent=eur(total*state.data.eurRate);
  portfolio24h.textContent=`${pct(day.pct)} (24h)`;
  portfolio24hUsd.textContent=`≈ ${day.usd>=0?'+':'−'}${money(Math.abs(day.usd))}`;
  assetCount.textContent=sorted.length;
  largestAsset.textContent=sorted.length?`${sorted[0][0]} ${(sorted[0][1]/total*100).toFixed(1)}%`:'—';
  const livePct=total?liveValue/total*100:0;
  coverageMetric.textContent=`${livePct.toFixed(0)}% live`;
  coverageMetric.className=livePct>80?'good':'warn';

  const shown=sorted.slice(0,5),rest=sorted.slice(5).reduce((s,x)=>s+x[1],0); if(rest>0)shown.push(['REST',rest]);
  assetDonut.style.background=conic(shown,assetColors); assetDonutTotal.textContent=money(total);
  assetLegend.innerHTML=shown.map((x,i)=>`<div class="legend-row"><span><i class="dot" style="background:${assetColors[i]}"></i>${x[0]}</span><b>${(x[1]/total*100).toFixed(1)}%</b></div>`).join('');

  const vi=Object.entries(venues);
  venueDonut.style.background=conic(vi,vi.map(x=>venueColors[x[0]]));
  venueLegend.innerHTML=vi.map(x=>`<div class="legend-row"><span><i class="dot" style="background:${venueColors[x[0]]}"></i>${x[0]}</span><b>${(x[1]/total*100).toFixed(1)}%</b></div>`).join('');
  venueCards.innerHTML=vi.map(x=>`<div class="venue-card"><div class="venue-name"><i class="dot" style="background:${venueColors[x[0]]}"></i>${x[0]}</div><div class="venue-value">${money(x[1])}</div><div class="venue-share" style="color:${venueColors[x[0]]}">${(x[1]/total*100).toFixed(1)}%</div><div class="bar"><i style="width:${(x[1]/total*100).toFixed(1)}%;background:${venueColors[x[0]]}"></i></div></div>`).join('');

  const dominant={};
  for(const [vn,v] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(v.positions||{})){
      const val=currentValue(coin,p);
      if(!dominant[coin]||val>dominant[coin].value)dominant[coin]={venue:vn,value:val};
    }
  }
  top5Body.innerHTML=sorted.slice(0,5).map((x,i)=>{
    const ch=state.changes[x[0]];
    return `<tr><td>${i+1}</td><td><b>${x[0]}</b></td><td>${dominant[x[0]]?.venue||'—'}</td><td>${money(x[1])}</td><td>${(x[1]/total*100).toFixed(1)}%</td><td style="color:${ch==null?'var(--dim)':ch>=0?'var(--green)':'var(--red)'}">${ch==null?'—':pct(ch)}</td></tr>`;
  }).join('');

  const moves=sorted.filter(x=>Number.isFinite(state.changes[x[0]])).map(x=>[x[0],state.changes[x[0]]]);
  const best=moves.length?moves.reduce((a,b)=>b[1]>a[1]?b:a):['—',0],worst=moves.length?moves.reduce((a,b)=>b[1]<a[1]?b:a):['—',0];
  const vals=moves.map(x=>x[1]),mean=vals.reduce((a,b)=>a+b,0)/(vals.length||1),vol=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length||1));
  mini24h.textContent=pct(day.pct); mini24hUsd.textContent=(day.usd>=0?'+':'−')+money(Math.abs(day.usd));
  bestCoin.textContent=best[0];bestMove.textContent=pct(best[1]);worstCoin.textContent=worst[0];worstMove.textContent=pct(worst[1]);volatility.textContent=vol.toFixed(2).replace('.',',')+'%';

  const rows=[];
  for(const [venueName,venue] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(venue.positions||{})){
      const meta=state.priceMeta[coin]||{source:'Snapshot',updatedAt:p.snapshotAt};
      const cls=meta.source==='Live'?'live':'snapshot';
      rows.push(`<div class="position-row"><div class="position-meta"><strong>${coin}</strong><small>${venueName}${p.label?' · '+p.label:''}</small><span class="source-chip ${cls}">${meta.source} · ${ageLabel(meta.updatedAt)}</span></div><div class="position-right"><strong>${money(currentValue(coin,p),2)}</strong><br><small>${shortQty(p.qty)} ${p.label||coin}</small></div></div>`);
    }
  }
  positionsList.innerHTML=rows.join('');

  const bots=state.data.venues.Pionex.bots||[];
  botsList.innerHTML=bots.map(b=>`<div class="bot-card"><div class="bot-head"><strong>${b.name}</strong><span class="bot-tag">${b.side} ${b.leverage}x</span></div><div class="bot-grid"><div class="bot-kpi"><span>Investition</span><b>${b.investment} USDT</b></div><div class="bot-kpi"><span>Dyn. Margin</span><b>${b.dynamicMargin} USDT</b></div><div class="bot-kpi"><span>Gesamt Profit</span><b style="color:var(--red)">${b.pnl} USDT</b></div><div class="bot-kpi"><span>Grid Profit</span><b style="color:var(--green)">+${b.gridProfit}</b></div><div class="bot-kpi"><span>Break-even</span><b>${money(b.breakEven,1)}</b></div><div class="bot-kpi"><span>Liquidation</span><b>${money(b.liq,1)}</b></div></div></div>`).join('');
  renderHistory();
}


function marketScore(){
  const {assets}=buildAggregates();
  const vals=Object.keys(assets).filter(c=>Number.isFinite(state.changes[c])).map(c=>state.changes[c]);
  if(!vals.length)return 50;
  const positive=vals.filter(v=>v>0).length/vals.length*100;
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  return Math.max(0,Math.min(100,positive*0.65 + Math.max(0,Math.min(35,avg*3))));
}

function nadirScore(){
  const b=state.data.boden;
  const valuation=Math.max(0,Math.min(100,100-((b.mvrv-0.5)/(3-0.5))*100));
  const capitulation=Math.max(0,Math.min(100,(75-b.fearGreed)/65*100));
  const holder=50, timing=55;
  return Math.round((valuation+capitulation+holder+timing)/4);
}

function entryScore(){
  const d=state.data.daytrade;
  let score=100;
  if(d.rsi4h>80)score-=25; else if(d.rsi4h>70)score-=15;
  if(d.rsi1h>75)score-=10;
  if(Math.abs(d.funding)>0.02)score-=10;
  const staleMins=(Date.now()-new Date(state.data.snapshotAt).getTime())/60000;
  if(staleMins>(state.data.decisionEngine?.staleMinutes||60))score-=15;
  return Math.max(0,Math.min(100,score));
}

function renderDecisionEngine(){
  const m=Math.round(marketScore()), n=nadirScore(), e=entryScore();
  const w=state.data.decisionEngine?.weights||{market:.35,nadir:.30,entry:.35};
  const total=Math.round(m*w.market+n*w.nadir+e*w.entry);
  let label='WAIT',text='Markt konstruktiv, aber Entry-Qualität nicht ausreichend.';
  if(total>=78 && e>=70){label='GO';text='Markt, Zyklus und Entry-Gate sind ausreichend ausgerichtet.'}
  if(total<45){label='DEFENSIVE';text='Risiko reduzieren; Markt-/Entry-Signale sind schwach.'}
  const staleMins=(Date.now()-new Date(state.data.snapshotAt).getTime())/60000;
  if(staleMins>(state.data.decisionEngine?.staleMinutes||60)){
    label='WAIT';
    text='Markt stark, aber Trading-Indikatoren sind zu alt für einen neuen Entry.';
  }
  const dl=document.getElementById('decisionLabel'),ds=document.getElementById('decisionScore');
  if(dl)dl.textContent=label;if(ds)ds.textContent=`${total}/100`;
  const dt=document.getElementById('decisionText');if(dt)dt.textContent=text;
  const dm=document.getElementById('decisionMarket');if(dm)dm.textContent=`${m}/100`;
  const dn=document.getElementById('decisionNadir');if(dn)dn.textContent=`${n}/100`;
  const de=document.getElementById('decisionEntry');if(de)de.textContent=`${e}/100`;
  const st=document.getElementById('decisionStatus');
  if(st)st.textContent=staleMins>60?`Entry-Daten stale · ${Math.round(staleMins/60)} h alt`:'Entry-Daten frisch';
  if(ds)ds.style.color=label==='GO'?'var(--green)':label==='DEFENSIVE'?'var(--red)':'var(--amber)';
}

function fibLevels(){
  const f=state.data.fib||{};
  const low=f.swingLow,high=f.swingHigh,range=high-low;
  const levels=(f.levels||[0.236,0.382,0.5,0.618,0.786]).map(r=>({r,price:high-range*r}));
  const ext=(f.extensionLevels||[1.272,1.618]).map(r=>({r,price:high+range*(r-1),ext:true}));
  return {low,high,levels,ext};
}

function renderFib(){
  const el=document.getElementById('fibLevels'); if(!el)return;
  const btc=priceFor('BTC')||state.data.daytrade.btcPrice;
  const f=fibLevels(), all=f.levels;
  document.getElementById('fibRangeLabel').textContent=`${money(f.low)} → ${money(f.high)}`;
  let nearest=null;
  all.forEach(x=>{const d=Math.abs(btc-x.price);if(!nearest||d<nearest.d)nearest={...x,d}});
  el.innerHTML=all.map(x=>{
    const dist=(btc-x.price)/btc*100;
    const near=Math.abs(dist)<1.5;
    return `<div class="fib-row ${near?'near active':''}">
      <span class="fib-label">${(x.r*100).toFixed(1)}%</span>
      <span class="fib-price">${money(x.price)}</span>
      <span class="fib-distance">${dist>=0?'+':''}${dist.toFixed(1)}%</span>
    </div>`;
  }).join('');
  const pos=document.getElementById('fibPosition');
  if(pos&&nearest)pos.textContent=`BTC ${money(btc)} · nächstes FIB ${(nearest.r*100).toFixed(1)}% bei ${money(nearest.price)} · Abstand ${(nearest.d/btc*100).toFixed(1)}%`;
}

function renderPionexRisk(){
  const el=document.getElementById('pionexRiskCard'); if(!el)return;
  const p=state.data.venues.Pionex,btc=priceFor('BTC')||state.data.daytrade.btcPrice;
  const bots=p.bots||[];
  const nearestLiq=bots.length?Math.min(...bots.map(b=>b.liq)):null;
  const liqDist=nearestLiq?((nearestLiq-btc)/btc*100):null;
  const totalPnl=bots.reduce((s,b)=>s+(b.pnl||0),0);
  const totalMargin=bots.reduce((s,b)=>s+(b.dynamicMargin||0),0);
  el.innerHTML=`<div class="pionex-risk-grid">
    <div class="pionex-risk-item"><span>KONTOWERT</span><b>${money(p.cash,2)}</b></div>
    <div class="pionex-risk-item"><span>BOT P&L</span><b class="${totalPnl<0?'risk-high':'risk-ok'}">${totalPnl.toFixed(2)} USDT</b></div>
    <div class="pionex-risk-item"><span>DYN. MARGIN</span><b>${totalMargin.toFixed(2)} USDT</b></div>
    <div class="pionex-risk-item"><span>NÄCHSTE LIQ.</span><b class="${liqDist!=null&&liqDist<8?'risk-high':'risk-warn'}">${nearestLiq?money(nearestLiq,1):'—'} ${liqDist!=null?`(${liqDist.toFixed(1)}%)`:''}</b></div>
  </div>`;
}

function renderMarket(){
  const {assets}=buildAggregates(),btc=state.changes.BTC||0,regime=btc>2?'RISK-ON':btc<-2?'RISK-OFF':'NEUTRAL';
  marketRegime.textContent=regime;regimeDot.style.left=regime==='RISK-ON'?'82%':regime==='RISK-OFF'?'18%':'50%';
  const rows=Object.keys(assets).filter(c=>Number.isFinite(state.changes[c])).sort((a,b)=>state.changes[b]-state.changes[a]);
  const adv=rows.filter(c=>state.changes[c]>0).length, dec=rows.filter(c=>state.changes[c]<0).length;
  const avg=rows.length?rows.reduce((s,c)=>s+state.changes[c],0)/rows.length:0;
  const best=rows[0]||'—', worst=rows[rows.length-1]||'—';
  marketSummary.innerHTML=[['Marktbreite',`${adv}/${rows.length} positiv`],['Ø 24H',pct(avg)],['Leader',best==='—'?'—':`${best} ${pct(state.changes[best])}`],['Laggard',worst==='—'?'—':`${worst} ${pct(state.changes[worst])}`]].map(x=>`<div class="summary-kpi"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  marketRadar.innerHTML=rows.slice(0,14).map(c=>`<div class="radar-row"><div><strong>${c}</strong><br><small>${state.changes[c]>=3?'Momentum positiv':state.changes[c]<=-3?'Momentum negativ':'Neutral'}</small></div><b style="color:${state.changes[c]>=0?'var(--green)':'var(--red)'}">${pct(state.changes[c])}</b></div>`).join('');
}

function renderBoden(){
  const b=state.data.boden,valuation=Math.max(0,Math.min(100,100-((b.mvrv-0.5)/(3-0.5))*100)),capitulation=Math.max(0,Math.min(100,(75-b.fearGreed)/65*100));
  const scores=[['Bewertung',valuation],['Kapitulation',capitulation],['Holder',50],['Timing',55]];
  const total=Math.round(scores.reduce((s,x)=>s+x[1],0)/scores.length);
  nadirTotal.textContent=`${total}/100`;nadirTotalBar.style.width=total+'%';
  nadirState.textContent=total>=70?'starke Akkumulations-Evidenz':total>=45?'Akkumulations-Regime · gemischte Evidenz':'geringe Akkumulations-Evidenz';
  nadirGrid.innerHTML=scores.map(x=>`<div class="nadir-card"><span>${x[0]}</span><b>${Math.round(x[1])}/100</b><div class="score-track"><i style="width:${Math.round(x[1])}%"></i></div></div>`).join('');
}


function tradeSnapshotAge(){
  const ts=state.data.snapshotAt?new Date(state.data.snapshotAt):null;
  if(!ts)return 'Snapshot';
  const mins=Math.max(0,Math.round((Date.now()-ts.getTime())/60000));
  if(mins<60)return `Snapshot · ${mins} min alt`;
  const h=Math.round(mins/60); return `Snapshot · ${h} h alt`;
}

function renderTrade(){
  const d=state.data.daytrade;
  const r4=Number(d.rsi4h),r1=Number(d.rsi1h),fund=Math.abs(Number(d.funding));
  const stretch=r4>=80?0:r4>=70?8:25, mtf=r1>50&&r4>50?25:10, funding=fund<0.02?25:fund<0.05?15:5, vwap=d.btcPrice>d.vwap?20:8;
  const score=Math.round(stretch+mtf+funding+vwap),allowed=score>=75&&r4<75;
  tradeScore.textContent=`${score}/100`;tradeScoreBar.style.width=score+'%';
  tradeDecision.textContent=allowed?'ENTRY FREIGEGEBEN':'ENTRY NICHT FREIGEGEBEN';
  tradeFreshness.textContent='Indikatoren: Snapshot';
  tradeGrid.innerHTML=[['BTC Preis',money(d.btcPrice),'snapshot'],['4H RSI',d.rsi4h,r4>=80?'bad':r4>=70?'warn':'good'],['1H RSI',d.rsi1h,r1>=75?'warn':'good'],['Funding',d.funding+'%',fund<0.02?'good':'warn'],['OI','$'+d.oi+'B','snapshot'],['VWAP',money(d.vwap),'snapshot']].map(x=>`<div class="trade-kpi ${x[2]}"><span>${x[0]}</span><b>${x[1]}</b><small>${x[2]==='snapshot'?'Snapshot':x[2]==='bad'?'überdehnt':x[2]==='warn'?'erhöht':'OK'}</small></div>`).join('');
  const checks=[['Datenfrische',tradeSnapshotAge(),'warn'],['MTF-Konfluenz',r1>50&&r4>50?'bullish':'gemischt',r1>50&&r4>50?'pass':'warn'],['Entry-Streckung',`4H RSI ${d.rsi4h} → ${r4>=80?'stark überdehnt':r4>=70?'überdehnt':'OK'}`,r4>=80?'fail':r4>=70?'warn':'pass'],['Liquidationspuffer',money(d.liqAbove),'warn']];
  document.getElementById('tradeDataMode')?.replaceChildren(document.createTextNode(tradeSnapshotAge()));
  tradeChecks.innerHTML=checks.map(x=>`<div class="check-row"><span>${x[0]}</span><b style="color:${x[2]==='pass'?'var(--green)':x[2]==='fail'?'var(--red)':'var(--amber)'}">${x[1]}</b></div>`).join('');
}

function setSystemStatus(id,text,cls=''){
  const el=document.getElementById(id);
  if(!el)return;
  el.textContent=text;
  el.className=cls;
}

async function checkBuild(){
  try{
    const r=await fetch(`${VERSION_URL}?t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const v=await r.json();
    setSystemStatus('cacheStatus',v.buildId===BUILD_ID?'aktuell':'Update verfügbar',
                    v.buildId===BUILD_ID?'system-ok':'system-warn');
    return v;
  }catch(e){
    setSystemStatus('cacheStatus','nicht prüfbar','system-warn');
    return null;
  }
}

async function hardRefreshApp(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){}
  location.href=`./?build=${BUILD_ID}&t=${Date.now()}`;
}


function getMissingLiveAssets(){
  const expected=state.data.liveDiagnostics?.expectedLiveMappedAssets||Object.keys(cgMap);
  return expected.filter(c=>state.priceMeta[c]?.source!=='Live');
}
function renderLiveDiagnostics(){
  const missing=getMissingLiveAssets();
  const el=document.getElementById('missingLiveAssets');
  const reason=document.getElementById('missingLiveReason');
  if(!el||!reason)return;
  if(!missing.length){
    el.textContent='keine';
    el.className='data-fresh';
    reason.textContent='alle gemappten Assets live';
    reason.className='data-fresh';
  }else{
    el.textContent=missing.join(', ');
    el.className=missing.length<=1?'data-stale':'data-missing';
    const snapshotOnly=(state.data.liveDiagnostics?.snapshotOnlyAssets||[]);
    const knownSnapshot=missing.filter(x=>snapshotOnly.includes(x));
    reason.textContent=knownSnapshot.length===missing.length?'Snapshot-only / kein Live-Mapping':'Live-API oder Mapping fehlt';
    reason.className='data-stale';
  }
}

function renderSettings(){
  const {total,liveValue}=buildAggregates();
  const rows=[
    ['App-Version',state.data.appVersion||'3.1.0'],
    ['Letzter Refresh',state.lastUpdated.toLocaleString('de-DE')],
    ['Live bewertet',`${(total?liveValue/total*100:0).toFixed(0)}%`],
    ['Bitpanda','Screenshot + Live-Kurse'],
    ['OKX','Screenshot + Live-Kurse'],
    ['Ledger','Screenshot + Live-Kurse'],
    ['Pionex','Snapshot gebundenes Kapital']
  ];
  dataStatus.innerHTML=rows.map(x=>`<div class="status-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  updatedPill.textContent='↻ '+fmtTime(state.lastUpdated);
  renderLiveDiagnostics();
  setSystemStatus('systemBuild',`v${APP_VERSION} · ${BUILD_ID}`,'system-ok');
  const expected=(state.data.diagnostics?.expectedLiveMappedAssets||Object.keys(cgMap)).length;
  const liveNow=Object.values(state.priceMeta).filter(x=>x.source==='Live').length;
  setSystemStatus('liveAssetCount',`${liveNow}/${expected}`,liveNow===expected?'system-ok':liveNow>0?'system-warn':'system-bad');
}

function renderAll(){renderDepot();renderMarket();renderBoden();renderTrade();renderSettings();renderDecisionEngine();renderFib();renderPionexRisk();}

async function refreshPrices(silent=false){
  const btn=document.getElementById('refreshPrices');
  if(btn && !silent){btn.disabled=true;btn.textContent='Aktualisiere…';}
  setSystemStatus('liveApiStatus','verbinde…','system-warn');
  try{
    const ids=[...new Set(Object.values(cgMap))].join(',');
    const url=`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const j=await res.json(); const now=new Date().toISOString();
    let liveCount=0;
    for(const [coin,id] of Object.entries(cgMap)){
      if(j[id]?.usd){
        state.prices[coin]=j[id].usd;
        state.priceMeta[coin]={source:'Live',updatedAt:now};
        liveCount++;
      }
      if(Number.isFinite(j[id]?.usd_24h_change))state.changes[coin]=j[id].usd_24h_change;
    }
    state.lastUpdated=new Date();
    setSystemStatus('liveApiStatus',`online · ${liveCount} Assets`,'system-ok');
    renderAll();
    recordHistory(true,'live');
    if(btn && !silent)btn.textContent=`✓ ${liveCount} Assets live`;
  }catch(e){
    console.error(e);
    setSystemStatus('liveApiStatus','nicht erreichbar · Snapshot aktiv','system-bad');
    if(btn && !silent)btn.textContent='Fehler – Snapshot aktiv';
  }
  if(btn && !silent)setTimeout(()=>{btn.disabled=false;btn.textContent='Live-Kurse aktualisieren'},1800);
}

function setupTabs(){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('tab-'+tab).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(n=>n.classList.toggle('active',n.dataset.tab===tab));
    window.scrollTo({top:0,behavior:'smooth'});
  }));
}

function registerSW(){if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js?v=35').catch(()=>{});}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('refreshPrices').addEventListener('click',refreshPrices);
  document.getElementById('resetSnapshot').addEventListener('click',()=>{restoreSnapshot();renderAll();recordHistory(true,'snapshot');});
  document.getElementById('forceReload')?.addEventListener('click',hardRefreshApp);
  document.getElementById('historyRange')?.addEventListener('click',e=>{const b=e.target.closest('button[data-range]');if(!b)return;historyRange=b.dataset.range;document.querySelectorAll('#historyRange button').forEach(x=>x.classList.toggle('active',x===b));renderHistory();});
  setupTabs();load();
});
