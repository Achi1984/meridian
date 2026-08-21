
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
const APP_VERSION='3.8.2';
const BUILD_ID='2026-08-21-2135';
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
    setTimeout(()=>refreshPrices(true),500);
    setTimeout(()=>refreshTradingIntelligence(),900);
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


function fibScore(){
  const btc=liveTradeValue('price',priceFor('BTC')||state.data.daytrade.btcPrice);
  const f=fibLevels();
  const range=f.high-f.low;
  if(!range || !btc)return 50;

  const all=f.levels;
  let nearest=null;
  all.forEach(x=>{
    const d=Math.abs(btc-x.price)/btc*100;
    if(!nearest||d<nearest.d)nearest={...x,d};
  });

  let score=55;
  if(nearest){
    if(nearest.d<=0.75)score+=25;
    else if(nearest.d<=1.5)score+=15;
    else if(nearest.d<=3)score+=5;
  }

  // Prefer pullbacks inside the main retracement zone for long entries.
  const retracement=(f.high-btc)/range;
  if(retracement>=0.236 && retracement<=0.618)score+=10;
  if(btc>f.high)score-=20;
  if(btc<f.low)score-=15;

  return Math.max(0,Math.min(100,Math.round(score)));
}

function entryScore(){
  const d=state.data.daytrade;
  const rsi4=liveTradeValue('rsi4h',d.rsi4h);
  const rsi1=liveTradeValue('rsi1h',d.rsi1h);
  let score=100;
  if(rsi4>80)score-=25; else if(rsi4>70)score-=15;
  if(rsi1>75)score-=10;
  if(Math.abs(d.funding)>0.02)score-=10;
  if(!state.tradeLive)score-=15;
  return Math.max(0,Math.min(100,score));
}

function renderDecisionEngine(){
  const m=Math.round(marketScore()), n=nadirScore(), e=entryScore(), f=fibScore();
  const w=state.data.decisionEngine?.weights||{market:.30,nadir:.25,entry:.30,fib:.15};
  const total=Math.round(m*w.market+n*w.nadir+e*w.entry+f*(w.fib||0));
  let label='WAIT',text='Markt konstruktiv, aber Entry-Qualität nicht ausreichend.';
  if(total>=78 && e>=70 && f>=60){label='GO';text='Markt, Zyklus, Entry-Gate und FIB-Zone sind ausreichend ausgerichtet.'}
  if(total<45){label='DEFENSIVE';text='Risiko reduzieren; Markt-/Entry-Signale sind schwach.'}
  const staleMins=state.tradeLive?0:(Date.now()-new Date(state.data.snapshotAt).getTime())/60000;
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
  const df=document.getElementById('decisionFib');if(df)df.textContent=`${f}/100`;
  const st=document.getElementById('decisionStatus');
  if(st)st.textContent=staleMins>60?`Entry-Daten stale · ${Math.round(staleMins/60)} h alt`:'Entry-Daten frisch';
  if(ds)ds.style.color=label==='GO'?'var(--green)':label==='DEFENSIVE'?'var(--red)':'var(--amber)';
}

function fibLevels(){
  const f=state.data.fib||{};
  const low=f.swingLow,high=f.swingHigh,range=high-low;
  const levels=(f.levels||[0,0.236,0.382,0.5,0.618,0.786,1]).map(r=>({r,price:high-range*r}));
  const ext=(f.extensionLevels||[1.272,1.618]).map(r=>({r,price:high+range*(r-1),ext:true}));
  return {low,high,levels,ext};
}

function renderFib(){
  const el=document.getElementById('fibLevels'); if(!el)return;
  const btc=liveTradeValue('price',priceFor('BTC')||state.data.daytrade.btcPrice);
  const f=fibLevels(), all=[...f.levels,...f.ext];
  document.getElementById('fibRangeLabel').textContent=`${money(f.low)} → ${money(f.high)}`;

  let nearest=null;
  all.forEach(x=>{const d=Math.abs(btc-x.price);if(!nearest||d<nearest.d)nearest={...x,d}});

  el.innerHTML=all.map(x=>{
    const dist=(btc-x.price)/btc*100;
    const near=Math.abs(dist)<(state.data.fib?.nearPct||1.5);
    const role=x.price<btc?'support':'resistance';
    const ext=x.ext?'extension':'';
    const tag=x.ext?'EXT':role==='support'?'SUPPORT':'RESIST';
    return `<div class="fib-row ${near?'near active':''} ${role} ${ext}">
      <span class="fib-label">${(x.r*100).toFixed(1)}% <i class="fib-tag ${x.ext?'ext':role}">${tag}</i></span>
      <span class="fib-price">${money(x.price)}</span>
      <span class="fib-distance">${dist>=0?'+':''}${dist.toFixed(1)}%</span>
    </div>`;
  }).join('');

  const pos=document.getElementById('fibPosition');
  if(pos&&nearest){
    const retr=(f.high-btc)/(f.high-f.low);
    const zone = btc>f.high?'über Swing-High':btc<f.low?'unter Swing-Low':
      retr<0.236?'oberhalb 23,6%':retr<0.382?'23,6–38,2% Zone':
      retr<0.618?'38,2–61,8% Golden Zone':'tiefer Pullback';
    pos.innerHTML=`BTC ${money(btc)} · nächstes FIB ${(nearest.r*100).toFixed(1)}% bei ${money(nearest.price)} · Abstand ${(nearest.d/btc*100).toFixed(1)}%
      <div class="fib-summary">Zone: <b>${zone}</b> · FIB Score: <b>${fibScore()}/100</b></div>`;
  }
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


function getNadirZone(score){
  const zones=state.data.nadirZones||[];
  return zones.find(z=>score>=z.min&&score<=z.max)||zones[0]||{label:'—',tone:'amber',note:''};
}


function daysBetween(a,b){return Math.floor((b-a)/86400000)}
function renderCycleClock(){
  const c=state.data.cycleClock||{};
  if(!c.halving)return;
  const now=new Date();
  const low=new Date(c.cycleLow),halving=new Date(c.halving),next=new Date(c.nextHalvingEstimate);
  const daysLow=daysBetween(low,now);
  const daysHalving=daysBetween(halving,now);
  const remaining=Math.max(0,daysBetween(now,next));
  const total=Math.max(1,next-halving);
  const progress=Math.max(0,Math.min(100,(now-halving)/total*100));
  const phase=(c.phases||[]).find(p=>daysHalving<=p.maxDays)||{label:'—',tone:'amber'};

  const ph=document.getElementById('cyclePhase');
  if(ph){ph.textContent=phase.label;ph.style.color=phase.tone==='green'?'var(--green)':phase.tone==='red'?'var(--red)':'var(--amber)'}
  const note=document.getElementById('cycleNote');if(note)note.textContent=c.sourceNote||'Kalendermodell';
  const pr=document.getElementById('cycleProgress');if(pr)pr.textContent=`${progress.toFixed(1)}%`;
  const fill=document.getElementById('cycleTrackFill');if(fill)fill.style.width=`${progress}%`;
  const dot=document.getElementById('cycleTrackDot');if(dot)dot.style.left=`${progress}%`;
  const dl=document.getElementById('cycleDaysLow');if(dl)dl.textContent=`${daysLow} Tage`;
  const dh=document.getElementById('cycleDaysHalving');if(dh)dh.textContent=`${daysHalving} Tage`;
  const nh=document.getElementById('cycleNextHalving');if(nh)nh.textContent=next.toLocaleDateString('de-DE',{month:'short',year:'numeric'});
  const dr=document.getElementById('cycleDaysRemaining');if(dr)dr.textContent=`≈ ${remaining} Tage`;
}

function renderBoden(){
  const b=state.data.boden,valuation=Math.max(0,Math.min(100,100-((b.mvrv-0.5)/(3-0.5))*100)),capitulation=Math.max(0,Math.min(100,(75-b.fearGreed)/65*100));
  const scores=[['Bewertung',valuation],['Kapitulation',capitulation],['Holder',50],['Timing',55]];
  const total=Math.round(scores.reduce((s,x)=>s+x[1],0)/scores.length);
  nadirTotal.textContent=`${total}/100`;nadirTotalBar.style.width=total+'%';
  nadirState.textContent=total>=70?'starke Akkumulations-Evidenz':total>=45?'Akkumulations-Regime · gemischte Evidenz':'geringe Akkumulations-Evidenz';
  nadirGrid.innerHTML=scores.map(x=>`<div class="nadir-card"><span>${x[0]}</span><b>${Math.round(x[1])}/100</b><div class="score-track"><i style="width:${Math.round(x[1])}%"></i></div></div>`).join('');
}



function calcRSI(closes,period=14){
  if(!closes||closes.length<period+2)return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){
    const d=closes[i]-closes[i-1];
    if(d>=0)gain+=d; else loss-=d;
  }
  let avgGain=gain/period,avgLoss=loss/period;
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    const g=d>0?d:0,l=d<0?-d:0;
    avgGain=(avgGain*(period-1)+g)/period;
    avgLoss=(avgLoss*(period-1)+l)/period;
  }
  if(avgLoss===0)return 100;
  const rs=avgGain/avgLoss;
  return 100-(100/(1+rs));
}

function calcVWAP(klines){
  if(!klines?.length)return null;
  let pv=0,vol=0;
  klines.forEach(k=>{
    const h=+k[2],l=+k[3],c=+k[4],v=+k[5];
    const tp=(h+l+c)/3;
    pv+=tp*v;vol+=v;
  });
  return vol?pv/vol:null;
}

async function fetchJsonTimeout(url,ms=8000){
  const ctrl=new AbortController();
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{try{ctrl.abort()}catch(_e){} reject(new Error('TIMEOUT'));},ms);
  });
  const request=(async()=>{
    const r=await fetch(url,{cache:'no-store',signal:ctrl.signal});
    if(!r.ok)throw new Error('HTTP '+r.status);
    return await r.json();
  })();
  try{return await Promise.race([request,timeout]);}
  finally{clearTimeout(timer);}
}

async function refreshTradingIntelligence(){
  const cfg=state.data.liveTrading||{};
  const base=cfg.baseUrl||'https://data-api.binance.vision';
  const symbol=cfg.symbol||'BTCUSDT';
  const timeout=cfg.timeoutMs||8000;
  const status=document.getElementById('tradingLiveStatus');
  if(status){status.textContent='Trading-Daten werden live geladen…';status.className='trading-live-status';}
  try{
    const [ticker,k1,k4]=await Promise.all([
      fetchJsonTimeout(`${base}/api/v3/ticker/price?symbol=${symbol}`,timeout),
      fetchJsonTimeout(`${base}/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`,timeout),
      fetchJsonTimeout(`${base}/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`,timeout)
    ]);
    const price=+ticker.price;
    const closed1=k1.slice(0,-1), closed4=k4.slice(0,-1);
    const rsi1=calcRSI(closed1.map(k=>+k[4]),cfg.rsiPeriod||14);
    const rsi4=calcRSI(closed4.map(k=>+k[4]),cfg.rsiPeriod||14);
    const vwap=calcVWAP(closed1.slice(-(cfg.vwapHours||24)));
    state.tradeLive={price,rsi1h:rsi1,rsi4h:rsi4,vwap,updatedAt:new Date(),source:'Binance'};
    if(Number.isFinite(price)){
      state.prices.BTC=price;
      state.priceMeta.BTC={source:'Live',updatedAt:new Date().toISOString()};
    }
    if(status){status.textContent=`LIVE · BTC / RSI / VWAP · ${fmtTime(state.tradeLive.updatedAt)}`;status.className='trading-live-status live';}
    renderAll();
    recordHistory(true,'trade-live');
  }catch(e){
    console.error('Trading intelligence',e);
    state.tradeLive=null;
    if(status){status.textContent='LIVE-TRADING-DATEN NICHT ERREICHBAR · Snapshot aktiv';status.className='trading-live-status error';}
    renderTrade();
    renderDecisionEngine();
    renderFib();
  }
}

function liveTradeValue(key,fallback){
  const v=state.tradeLive?.[key];
  return Number.isFinite(v)?v:fallback;
}

function liveTradeLabel(){
  return state.tradeLive?'LIVE · Binance':'Snapshot';
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
  const price=liveTradeValue('price',priceFor('BTC')||d.btcPrice);
  const rsi4=liveTradeValue('rsi4h',d.rsi4h);
  const rsi1=liveTradeValue('rsi1h',d.rsi1h);
  const vwap=liveTradeValue('vwap',d.vwap);
  const mode=liveTradeLabel();

  const age=state.tradeLive?`LIVE · ${fmtTime(state.tradeLive.updatedAt)}`:tradeSnapshotAge();
  const r4s=rsi4>80?'überdehnt':rsi4>70?'erhöht':'OK';
  const r1s=rsi1>75?'erhöht':'OK';

  let score=100;
  if(rsi4>80)score-=25; else if(rsi4>70)score-=15;
  if(rsi1>75)score-=10;
  if(Math.abs(d.funding)>0.02)score-=10;
  if(!state.tradeLive)score-=15;
  score=Math.max(0,Math.min(100,score));

  const title=document.getElementById('tradeTitle');
  if(title)title.textContent=score>=80?'ENTRY FREIGEGEBEN':'ENTRY NICHT FREIGEGEBEN';
  const gs=document.getElementById('gateScore');if(gs)gs.textContent=`${score}/100`;
  const gb=document.getElementById('gateBar');if(gb)gb.style.width=`${score}%`;
  const dm=document.getElementById('tradeDataMode');if(dm)dm.textContent=state.tradeLive?'Indikatoren: LIVE':'Indikatoren: Snapshot';

  tradeGrid.innerHTML=[
    ['BTC Preis',money(price),state.tradeLive?'LIVE':'Snapshot',state.tradeLive?'live':'snapshot'],
    ['4H RSI',rsi4.toFixed(2),r4s,state.tradeLive?'live':'snapshot'],
    ['1H RSI',rsi1.toFixed(2),r1s,state.tradeLive?'live':'snapshot'],
    ['Funding',d.funding+'%','Snapshot','snapshot'],
    ['OI','$'+d.oi+'B','Snapshot','snapshot'],
    ['VWAP',money(vwap),state.tradeLive?'LIVE 24H':'Snapshot',state.tradeLive?'live':'snapshot']
  ].map(x=>`<div class="trade-kpi"><span>${x[0]}</span><b>${x[1]}</b><small class="live-note ${x[3]}">${x[2]}</small></div>`).join('');

  const liq=(state.data.venues.Pionex?.bots||[]).length?Math.min(...state.data.venues.Pionex.bots.map(b=>b.liq)):d.liq;
  const checks=[
    ['Datenfrische',age,state.tradeLive?'ok':'warn'],
    ['MTF-Konfluenz',rsi4<70&&rsi1<70?'bullish / nicht überhitzt':rsi4>80?'überhitzt':'gemischt',rsi4>80?'bad':'ok'],
    ['Entry-Streckung',rsi4>80?`4H RSI ${rsi4.toFixed(2)} → stark überdehnt`:rsi4>70?`4H RSI ${rsi4.toFixed(2)} → erhöht`:'RSI im akzeptablen Bereich',rsi4>80?'bad':rsi4>70?'warn':'ok'],
    ['Liquidationspuffer',money(liq,0),'warn']
  ];
  tradeChecks.innerHTML=checks.map(c=>`<div class="status-row"><span>${c[0]}</span><b class="${c[2]==='ok'?'system-ok':c[2]==='bad'?'system-bad':'system-warn'}">${c[1]}</b></div>`).join('');
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


function forecastCoins(){
  const {assets}=buildAggregates();
  const configured=state.data.forecast?.coins||{};
  const held=Object.keys(assets);
  const ordered=['BTC',...held.filter(c=>c!=='BTC').sort((a,b)=>(assets[b]||0)-(assets[a]||0))];
  return [...new Set(ordered)].filter(c=>configured[c]);
}

function renderForecastCoinStrip(){
  const el=document.getElementById('forecastCoinStrip'); if(!el)return;
  const coins=forecastCoins();
  if(!coins.includes(state.forecastCoin))state.forecastCoin=coins[0]||'BTC';
  el.innerHTML=coins.map(c=>`<button class="coin-chip ${c===state.forecastCoin?'active':''}" data-forecast-coin="${c}">${c}</button>`).join('');
}

function cgIdForCoin(c){
  return cgMap[c]||null;
}

function forecastFmtDate(d){
  return new Date(d).toLocaleDateString('de-DE',{month:'short',year:'numeric'});
}

function addDays(date,days){
  const d=new Date(date);d.setUTCDate(d.getUTCDate()+days);return d;
}

function computeReturn(prices,days){
  if(!prices?.length)return null;
  const end=prices[prices.length-1][1];
  const target=Date.now()-days*86400000;
  let first=prices[0][1],best=Infinity;
  prices.forEach(p=>{const diff=Math.abs(p[0]-target);if(diff<best){best=diff;first=p[1]}});
  return first?((end/first)-1)*100:null;
}

function computeForecastFromHistory(coin,coinPrices,btcPrices){
  const cfg=state.data.forecast.coins[coin];
  const values=coinPrices.map(p=>p[1]).filter(Number.isFinite);
  if(values.length<10)return null;

  const low=Math.min(...values),high=Math.max(...values);
  const current=liveTradeValue && coin==='BTC' ? liveTradeValue('price',priceFor(coin)) : (priceFor(coin)||values[values.length-1]);
  const range=Math.max(high-low,high*.001);
  const swingPct=Math.max(0,Math.min(100,(current-low)/range*100));

  const r30=computeReturn(coinPrices,30);
  const btc30=coin==='BTC'?r30:computeReturn(btcPrices,30);
  const rel=(Number.isFinite(r30)&&Number.isFinite(btc30))?r30-btc30:0;

  let topRisk=Math.round(swingPct*.62 + Math.max(0,Math.min(25,rel*.8)) + Math.max(0,Math.min(13,(state.changes[coin]||0)*.7)));
  topRisk=Math.max(0,Math.min(100,topRisk));

  const fibs=(state.data.forecast.fibExtensions||[1.272,1.618,2,2.618]).map(level=>({
    level,price:high+range*(level-1)
  }));

  let phase='AKKUMULATION',tone='amber';
  if(swingPct>82&&rel>5){phase='EXPANSION / HEISS';tone='red'}
  else if(swingPct>60&&rel>=0){phase='EXPANSION';tone='green'}
  else if(swingPct<35){phase='AKKUMULATION';tone='amber'}
  else {phase='ÜBERGANG';tone='amber'}

  const nextHalving=new Date(state.data.cycleClock.nextHalvingEstimate);
  const btcRange=state.data.forecast.macroTopAfterHalvingDays||[450,600];
  const lag=cfg.lagDays||[0,0];
  const btcStart=addDays(nextHalving,btcRange[0]),btcEnd=addDays(nextHalving,btcRange[1]);
  const coinStart=addDays(nextHalving,btcRange[0]+lag[0]),coinEnd=addDays(nextHalving,btcRange[1]+lag[1]);

  let confidence=55;
  if(values.length>=80)confidence+=10;
  if(Math.abs(rel)>4)confidence+=8;
  if(state.priceMeta[coin]?.source==='Live')confidence+=7;
  if(coin==='VSN')confidence-=25;
  confidence=Math.max(state.data.forecast.confidenceFloor||30,Math.min(85,confidence));

  return {coin,cfg,current,low,high,swingPct,r30,btc30,rel,topRisk,phase,tone,fibs,
          btcStart,btcEnd,coinStart,coinEnd,confidence};
}

async function loadForecastCoin(coin){
  state.forecastLoading=true;
  state.forecastCoin=coin;
  renderForecastCoinStrip();
  const status=document.getElementById('forecastState');
  if(status){status.textContent='LÄDT…';status.className='forecast-state'}
  const watchdog=setTimeout(()=>{
    if(state.forecastLoading && state.forecastCoin===coin){
      state.forecastLoading=false;
      renderForecastUnavailable(coin,'Historische Kursdaten konnten nicht rechtzeitig geladen werden. Bitte Forecast erneut antippen.');
    }
  },16000);
  const cached=state.forecastCache[coin];
  if(cached && Date.now()-cached.ts<30*60*1000){clearTimeout(watchdog);state.forecastLoading=false;renderForecast(cached.model);return;}

  const id=cgIdForCoin(coin),btcId=cgIdForCoin('BTC');
  if(!id){
    clearTimeout(watchdog);
    state.forecastLoading=false;
    renderForecastUnavailable(coin,'Keine historische Live-Datenquelle hinterlegt.');
    return;
  }
  try{
    const days=state.data.forecast.historyDays||90;
    const loadHistory=async(coinId,symbol)=>{
      // Primary: Binance public daily candles. More reliable in iOS PWAs than CoinGecko market_chart.
      if(symbol){
        const bases=['https://api.binance.com','https://api1.binance.com','https://api2.binance.com'];
        for(const base of bases){
          try{
            const k=await fetchJsonTimeout(`${base}/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=${days}`,4500);
            if(Array.isArray(k)&&k.length>=10){
              return {prices:k.map(x=>[+x[0],+x[4]])};
            }
          }catch(_e){}
        }
      }
      // Fallback: CoinGecko.
      const urls=[
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`
      ];
      let lastErr=null;
      for(const url of urls){
        try{
          const j=await fetchJsonTimeout(url,4500);
          if(j?.prices?.length>=10)return j;
        }catch(e){lastErr=e;}
      }
      throw lastErr||new Error('Historie nicht verfügbar');
    };
    const [cj,bj]=await Promise.all([
      loadHistory(id,coin),
      coin==='BTC'?Promise.resolve(null):loadHistory(btcId,'BTC')
    ]);
    const model=computeForecastFromHistory(coin,cj.prices,coin==='BTC'?cj.prices:bj.prices);
    if(!model)throw new Error('Zu wenig Historie');
    state.forecastCache[coin]={ts:Date.now(),model};
    clearTimeout(watchdog);
    state.forecastLoading=false;
    renderForecast(model);
  }catch(e){
    console.error('Forecast',e);
    clearTimeout(watchdog);
    state.forecastLoading=false;
    renderForecastUnavailable(coin,'90T-Historie derzeit nicht erreichbar. Keine erfundenen Zielwerte angezeigt.');
  }
}

function renderForecastUnavailable(coin,msg){
  const cfg=state.data.forecast.coins[coin]||{label:coin,class:'—'};
  document.getElementById('forecastCoinName').textContent=`${cfg.label} (${coin})`;
  document.getElementById('forecastCoinClass').textContent=cfg.class;
  document.getElementById('forecastCurrent').textContent=money(priceFor(coin)||0);
  const st=document.getElementById('forecastState');st.textContent='DATEN FEHLEN';st.className='forecast-state red';
  document.getElementById('forecastConfidence').textContent='LOW';
  document.getElementById('forecastTopRisk').textContent='—/100';
  document.getElementById('forecastRelative').textContent='—';
  document.getElementById('forecastExplain').textContent=msg;
  document.getElementById('forecastFibTargets').innerHTML='<div class="forecast-method">Forecast wird erst berechnet, wenn historische Kursdaten verfügbar sind.</div>';
  document.getElementById('forecastScenarios').innerHTML='';
  document.getElementById('forecastInterpretation').textContent='Kein belastbarer Forecast verfügbar.';
}

function renderForecast(m){
  const cfg=m.cfg;
  document.getElementById('forecastCoinName').textContent=`${cfg.label} (${m.coin})`;
  document.getElementById('forecastCoinClass').textContent=cfg.class.replaceAll('_',' · ');
  document.getElementById('forecastCurrent').textContent=money(m.current);
  const st=document.getElementById('forecastState');st.textContent=m.phase;st.className=`forecast-state ${m.tone==='green'?'green':m.tone==='red'?'red':''}`;
  document.getElementById('forecastConfidence').textContent=`${m.confidence}%`;
  document.getElementById('forecastTopRisk').textContent=`${m.topRisk}/100`;
  document.getElementById('forecastRelative').textContent=m.coin==='BTC'?'MASTER':`${m.rel>=0?'+':''}${m.rel.toFixed(1)}%`;
  document.getElementById('forecastRiskBar').style.width=`${m.topRisk}%`;
  document.getElementById('forecastExplain').textContent=
    m.coin==='BTC'
      ? `BTC dient als Master-Cycle. 90T-Position ${m.swingPct.toFixed(0)}%; 30T-Momentum ${m.r30>=0?'+':''}${m.r30.toFixed(1)}%.`
      : `${m.coin} liegt im 90T-Swing bei ${m.swingPct.toFixed(0)}% und performt über 30 Tage ${m.rel>=0?'+':''}${m.rel.toFixed(1)} Prozentpunkte relativ zu BTC.`;

  document.getElementById('forecastCycleWindow').textContent=`${forecastFmtDate(m.coinStart)} – ${forecastFmtDate(m.coinEnd)}`;
  document.getElementById('forecastCycleSub').textContent=
    m.coin==='BTC'?'Modelliertes BTC-Makrofenster':`BTC-Fenster + ${cfg.lagDays[0]}–${cfg.lagDays[1]} Tage Rotations-Offset`;
  document.getElementById('btcWindowBar').style.width='64%';
  document.getElementById('coinWindowBar').style.width=`${Math.min(92,64+(cfg.lagDays[1]||0)/5)}%`;

  document.getElementById('forecastLow').textContent=money(m.low);
  document.getElementById('forecastHigh').textContent=money(m.high);
  document.getElementById('forecastSwingPct').textContent=`${m.swingPct.toFixed(0)}%`;
  document.getElementById('forecastSwingBar').style.width=`${m.swingPct}%`;

  document.getElementById('forecastFibTargets').innerHTML=m.fibs.map(x=>{
    const move=(x.price/m.current-1)*100;
    const star=x.level===1.618;
    return `<div class="forecast-fib ${star?'star':''}">
      <span>FIB ${x.level.toFixed(3)}${star?' ★':''}</span>
      <b>${money(x.price)}</b>
      <small>${move>=0?'+':''}${move.toFixed(0)}%</small>
    </div>`;
  }).join('');

  const scenLevels=state.data.forecast.scenarioLevels;
  const scenarios=[
    ['CONSERVATIVE',scenLevels.conservative,'conservative'],
    ['BASE CASE',scenLevels.base,'base'],
    ['BLOW-OFF',scenLevels.blowoff,'blowoff']
  ];
  document.getElementById('forecastScenarios').innerHTML=scenarios.map(([name,level,cls])=>{
    const f=m.fibs.find(x=>Math.abs(x.level-level)<.001)||m.fibs[0];
    const move=(f.price/m.current-1)*100;
    return `<article class="forecast-scenario ${cls}">
      <div><div class="sc-name">${name}</div><div class="sc-price">${money(f.price)}</div></div>
      <div class="sc-move">${move>=0?'+':''}${move.toFixed(0)}%</div>
      <div class="sc-window">${forecastFmtDate(m.coinStart)} – ${forecastFmtDate(m.coinEnd)} · Modellziel FIB ${level}</div>
    </article>`;
  }).join('');

  let interpretation;
  if(m.topRisk>=80)interpretation=`${m.coin}: hohes lokales Top-Risiko. Preis liegt nahe am 90T-Hoch und Momentum/Relative Stärke sind bereits stark. Neue Long-Entries benötigen höhere Bestätigung.`;
  else if(m.swingPct<40)interpretation=`${m.coin}: eher frühe/untere Swing-Zone. FIB-Ziele sind derzeit weit entfernt; Confidence steigt erst mit bestätigter relativer Stärke.`;
  else if(m.rel>5)interpretation=`${m.coin}: positive Rotation gegenüber BTC. Das erhöht die Wahrscheinlichkeit, dass der Coin in einer Altcoin-Phase später als BTC sein lokales Hoch bildet.`;
  else interpretation=`${m.coin}: neutrales Übergangsbild. Der Forecast bleibt szenariobasiert; weder Top noch Expansion sind ausreichend bestätigt.`;
  document.getElementById('forecastInterpretation').textContent=interpretation;
  document.getElementById('forecastMethod').textContent=state.data.forecast.methodNote;
}

function renderForecast(){
  renderForecastCoinStrip();
  const cached=state.forecastCache[state.forecastCoin];
  if(cached)renderForecast(cached.model);
  else loadForecastCoin(state.forecastCoin);
}

function renderAll(){renderDepot();renderMarket();renderBoden();renderTrade();renderSettings();renderDecisionEngine();renderFib();renderPionexRisk();renderCycleClock();renderForecastCoinStrip();}

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
  if(!silent)refreshTradingIntelligence();
}

function setupTabs(){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('tab-'+tab).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(n=>n.classList.toggle('active',n.dataset.tab===tab));
    if(tab==='forecast'&&!state.forecastLoading)loadForecastCoin(state.forecastCoin);
    window.scrollTo({top:0,behavior:'smooth'});
  }));
}

function registerSW(){if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js?v=38').catch(()=>{});}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('refreshPrices').addEventListener('click',refreshPrices);
  document.getElementById('resetSnapshot').addEventListener('click',()=>{restoreSnapshot();renderAll();recordHistory(true,'snapshot');});
  document.getElementById('forceReload')?.addEventListener('click',hardRefreshApp);
  
  document.getElementById('forecastCoinStrip')?.addEventListener('click',e=>{const b=e.target.closest('[data-forecast-coin]');if(!b)return;loadForecastCoin(b.dataset.forecastCoin);});
  document.getElementById('historyRange')?.addEventListener('click',e=>{const b=e.target.closest('button[data-range]');if(!b)return;historyRange=b.dataset.range;document.querySelectorAll('#historyRange button').forEach(x=>x.classList.toggle('active',x===b));renderHistory();});
  setupTabs();load();
});
