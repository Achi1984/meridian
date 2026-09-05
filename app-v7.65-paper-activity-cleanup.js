/* MERIDIAN v7.65 R2 — Paper Activity / Opportunity Cost dedupe + honest summary. Display-only. */
(function(){
  'use strict';
  const VERSION='7.65';
  const BUILD='7.65-20260905-R2';
  const text=el=>String(el?.textContent||'').trim();
  const leafs=root=>root?[...root.querySelectorAll('*')].filter(el=>el.children.length===0):[];
  const numDe=s=>{const raw=String(s||'').replace(/\s/g,'').replace(/\$/g,'').replace(/%/g,'').replace(/−/g,'-');if(!raw)return null;const norm=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;const m=norm.match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const money=v=>{const n=Number(v);if(!Number.isFinite(n))return '—';return `${n>0?'+':n<0?'−':''}$${Math.abs(n).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`};

  function paperRoot(){return document.getElementById('view-paper')||document.querySelector('[data-view="paper"]')||document.body}
  function activityHeadings(root){return leafs(root).filter(el=>/^ACTIVITY\s*\/\s*OPPORTUNITY COST$/i.test(text(el)))}
  function activityCard(h){
    return h.closest('.card,[class*="card"],[class*="panel"],section,article,details')||h.parentElement?.parentElement||h.parentElement;
  }
  function dedupe(root){
    const heads=activityHeadings(root);if(!heads.length)return null;
    const cards=[];for(const h of heads){const c=activityCard(h);if(c&&!cards.includes(c))cards.push(c)}
    const keep=cards[0]||activityCard(heads[0]);if(!keep)return null;
    keep.dataset.v765PaperActivity='1';
    for(const c of cards.slice(1)){if(c!==keep&&c.isConnected)c.remove()}
    return keep;
  }

  function lineMetric(card,label){
    if(!card)return null;
    const row=[...card.querySelectorAll('.line')].find(x=>text(x.querySelector('span')).toLowerCase()===label.toLowerCase());
    return row?numDe(text(row.querySelector('b'))):null;
  }
  function stats(root,name){
    const card=[...root.querySelectorAll('.v731-compare-card')].find(x=>text(x.querySelector('h4'))===name);
    if(!card)return null;
    let pf=null;const wrpf=[...card.querySelectorAll('.line')].find(x=>/^WR\s*\/\s*PF$/i.test(text(x.querySelector('span'))));
    if(wrpf){const ms=text(wrpf.querySelector('b')).match(/-?\d+(?:[,.]\d+)?/g);if(ms&&ms.length>1)pf=numDe(ms[1])}
    return {name,trades:lineMetric(card,'Trades'),pnl:lineMetric(card,'P&L'),dd:lineMetric(card,'DD'),pf};
  }
  function summaryRows(root){
    const base=stats(root,'BASELINE 6.2');if(!base||!(base.trades>0))return null;
    return ['SHADOW V1','CHALLENGER V2','REGIME V1'].map(name=>{
      const s=stats(root,name);if(!s)return {name,missing:true};
      const dt=Number(s.trades)-Number(base.trades),dp=Number(s.pnl)-Number(base.pnl),coverage=base.trades>0?(Number(s.trades)/Number(base.trades))*100:0;
      return {...s,dt,dp,coverage};
    });
  }
  function renderSummary(root,card){
    let box=card.querySelector('[data-v765-activity-summary]');
    if(!box){box=document.createElement('div');box.dataset.v765ActivitySummary='1';box.className='v765-activity-summary';card.appendChild(box)}
    const rows=summaryRows(root);
    if(!rows){box.innerHTML='<div class="v765-activity-note">COVERAGE LIMITED · Vergleichsdaten noch nicht vollständig im DOM verfügbar. Keine Overfilter-Wertung.</div>';return}
    box.innerHTML=`<div class="v765-activity-grid">${rows.map(r=>{
      if(r.missing)return `<div><span>${r.name}</span><b>NO SAMPLE</b><small>Vergleich nicht verfügbar</small></div>`;
      const tone=r.dp>0?'green':r.dp<0?'red':'muted';
      const activity=`${Number(r.trades)||0} vs ${Number(stats(root,'BASELINE 6.2')?.trades)||0} (${r.dt>0?'+':''}${r.dt})`;
      const sample=(Number(r.trades)||0)>0?`P&L Δ <em class="${tone}">${money(r.dp)}</em> · ${r.coverage.toFixed(0)}% Activity`:'NO SAMPLE · keine P&L-Wertung';
      return `<div><span>${r.name}</span><b>${activity}</b><small>${sample}</small></div>`;
    }).join('')}</div><div class="v765-activity-note">COVERAGE LIMITED · aktuell nur Trade-Count und P&L-Delta vs Baseline. Avoided Losers / Missed Winners werden erst mit vollständiger Server-Coverage bewertet.</div>`;
  }
  function injectCss(){
    if(document.getElementById('v765-paper-activity-css'))return;
    const s=document.createElement('style');s.id='v765-paper-activity-css';s.textContent=`
      [data-v765-paper-activity="1"] .v765-activity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
      [data-v765-paper-activity="1"] .v765-activity-grid>div{border:1px solid #17354f;border-radius:12px;padding:10px;background:#06111b;min-width:0}
      [data-v765-paper-activity="1"] .v765-activity-grid span{display:block;color:#7f91a6;font-size:8px;letter-spacing:.08em}
      [data-v765-paper-activity="1"] .v765-activity-grid b{display:block;margin-top:5px;font-size:12px;color:#f4f7fb}
      [data-v765-paper-activity="1"] .v765-activity-grid small{display:block;margin-top:5px;color:#7f91a6;font-size:8px;line-height:1.35}
      [data-v765-paper-activity="1"] .v765-activity-grid em{font-style:normal;font-weight:800}
      [data-v765-paper-activity="1"] .v765-activity-note{margin-top:10px;color:#7f91a6;font-size:9px;line-height:1.45}
      @media(max-width:650px){[data-v765-paper-activity="1"] .v765-activity-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }
  function stamp(){window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · LIVE`;}
  let busy=false,timer=null;
  function apply(){if(busy)return;busy=true;try{const root=paperRoot();if(!root)return;injectCss();const card=dedupe(root);if(card)renderSummary(root,card);window.MERIDIAN_PAPER_ACTIVITY_STATUS={version:VERSION,build:BUILD,duplicates:Math.max(0,activityHeadings(root).length-1),appliedAt:new Date().toISOString(),executionImpact:false};}finally{busy=false}}
  function schedule(){clearTimeout(timer);timer=setTimeout(apply,80)}
  function start(){stamp();apply();setTimeout(apply,250);setTimeout(apply,900);if(typeof MutationObserver!=='undefined'){new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true})}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pageshow',apply);document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});setInterval(()=>{if(!document.hidden)apply()},3000);
})();
