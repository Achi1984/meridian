// MERIDIAN v10 r2 — presentation adapter over the validated v9 engine.
// No trading logic lives here. It only separates LIVE / MARKET / RESEARCH surfaces.
const BUILD='10.0-r2';

function banner(viewId,kicker,title,note,tone='neutral'){
  const view=document.querySelector(viewId);if(!view)return;
  let el=view.querySelector(':scope > .v10-mode-banner');
  if(!el){el=document.createElement('section');el.className='v10-mode-banner';view.prepend(el);}
  const next=`<div><span>${kicker}</span><b>${title}</b></div><small>${note}</small>`;
  if(el.innerHTML!==next)el.innerHTML=next;
  el.dataset.tone=tone;
}

function decorate(){
  document.documentElement.dataset.meridianBuild=BUILD;
  const truth=document.querySelector('.data-truth .data-truth-head span');
  if(truth&&truth.textContent!=='DATA GUARD')truth.textContent='DATA GUARD';
  const truthNote=document.querySelector('.data-truth small');
  if(truthNote&&!truthNote.dataset.v10){
    truthNote.dataset.v10='1';
    truthNote.insertAdjacentHTML('afterbegin','<b class="v10-guard-note">Nur ACTIONABLE = entscheidungsrelevant.</b><br>');
  }

  const riskTitle=document.querySelector('.risk-v2 .section-title h2');
  if(riskTitle&&riskTitle.textContent!=='ASSET RISK MAP')riskTitle.textContent='ASSET RISK MAP';
  const riskSub=document.querySelector('.risk-v2 .section-title small');
  if(riskSub)riskSub.textContent='Long + Short je Asset gemeinsam · Liq + Hedge + 15m/1h/4h + BTC-Regime';

  banner('#view-command','COMMAND','PORTFOLIO + RISK DECISION SUPPORT','Data Guard vor jeder Aktion · LIVE und PAPER bleiben getrennt','live');
  banner('#view-bots','LIVE','POSITION LAYER','Pionex/OKX Positionen · nur frische gematchte Bot-Daten sind handlungsrelevant','live');
  banner('#view-market','MARKET','TECHNICAL LAYER','Preis- und Multi-Timeframe-Kontext · keine Ausführung aus diesem Layer allein','market');
  banner('#view-research','SCANNER','SIGNAL RESEARCH','Signale sind Beobachtungen · kein automatischer Trade','research');
  banner('#view-more','LAB','PAPER / RESEARCH ONLY','Keine automatische Promotion · kein Einfluss auf Live-Positionen','paper');

  const lab=document.querySelector('#view-more .hero');
  if(lab&&!lab.dataset.v10Lab){
    lab.dataset.v10Lab='1';
    lab.innerHTML='<div class="eyebrow">LAB</div><h1>PAPER / RESEARCH</h1><p class="muted">Backtests, Holdouts und Forward-Experimente bleiben strikt von Live getrennt. Promotion nur nach festem Evidence-Gate.</p>';
  }
}

let raf=0;
const schedule=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;decorate();});};
const root=document.querySelector('#app')||document.body;
new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
decorate();
