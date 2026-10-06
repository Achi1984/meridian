// MERIDIAN R123 — Command status owner, presentation only.
const root=()=>document.querySelector('#view-command');
let queued=false;
const tone=el=>['danger','watch','muted','safe'].find(x=>el.classList.contains('tone-'+x))||'muted';
const rank={danger:4,watch:3,muted:2,safe:1};

function apply(){
  const r=root(),health=r?.querySelector('.command-health-summary');
  if(!r||!health)return;
  const chips=[...health.querySelectorAll('.command-health-chip')];
  let clean=health.dataset.r123Clean==='true';
  if(chips.length===3){
    const items=chips.map(el=>({
      el,tone:tone(el),
      key:el.querySelector('span')?.textContent?.trim()||'STATUS',
      detail:el.querySelector('small')?.textContent?.trim()||''
    }));
    const worst=items.reduce((a,b)=>rank[b.tone]>rank[a.tone]?b:a);
    clean=items.every(x=>x.tone==='safe');
    items.filter(x=>x!==worst).forEach(x=>x.el.remove());
    worst.el.querySelector('span').textContent='STATUS';
    worst.el.querySelector('b').textContent=clean?'OK':worst.tone==='danger'?'FEHLER / AKTION':worst.tone==='watch'?'ACHTUNG':'PRÜFEN';
    worst.el.querySelector('small').textContent=clean?'PORTFOLIO · RISIKO · DATEN geprüft':worst.key+' · '+worst.detail;
    health.style.gridTemplateColumns='1fr';
    health.dataset.r123Clean=String(clean);
    health.dataset.r123StatusOwner='true';
  }
  if(clean){
    const next=r.querySelector('.command-next-decision'),title=next?.querySelector('b'),detail=next?.querySelector('small');
    if(title?.textContent.trim()==='HOLD · RUNNER WEITERLAUFEN'){
      title.textContent='NICHTS ZU TUN';
      if(detail)detail.textContent='Portfolio · Risiko · Daten geprüft';
    }
  }
}

function schedule(){
  if(queued)return;
  queued=true;
  queueMicrotask(()=>{queued=false;apply()});
}
function start(){
  const r=root();if(!r)return;
  apply();
  new MutationObserver(schedule).observe(r,{childList:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
