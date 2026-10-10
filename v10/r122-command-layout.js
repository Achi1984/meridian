// MERIDIAN R122 transitional presentation adapter; no trading/risk/research semantics.
const V=()=>document.querySelector('#view-command');let q=false;
function N(r){const h=[...r.querySelectorAll('.command-action-hub')].find(x=>!x.classList.contains('command-open-navigation')&&x.querySelector('.command-next-decision'));return{h,k:r.querySelector('.v10-critical-wrap')}}
function adapt(){
 const r=V();if(!r)return;const{h,k}=N(r);if(!h||!k)return;
 const a=r.querySelector('.command-attention');
 if(a){a.querySelectorAll('.attention-reference').forEach(x=>x.remove());const z=[...a.querySelectorAll('.attention-row')];if(!z.length||z.every(x=>x.classList.contains('tone-safe')))a.remove()}
 h.querySelector('.section-title')?.remove();if(k.previousElementSibling!==h)h.insertAdjacentElement('afterend',k);
 let o=r.querySelector('.command-open-navigation');
 if(!o){o=document.createElement('section');o.className='command-action-hub command-open-navigation';o.innerHTML='<div class="section-title"><h2>OPEN</h2><small>Navigation · read-only · keine Trading-Aktion</small></div>'}
 const g=h.querySelector('.command-action-grid'),p=h.querySelector('.command-paper-diagnostics');if(g)o.appendChild(g);if(p)o.appendChild(p);if(o.previousElementSibling!==k)k.insertAdjacentElement('afterend',o);
 const b=r.querySelector('.command-attention');if(b&&b.previousElementSibling!==o)o.insertAdjacentElement('afterend',b);r.dataset.r122Layout='true'
}
function S(){if(q)return;q=true;queueMicrotask(()=>{q=false;adapt()})}
const W=()=>new Promise(r=>setTimeout(r,20));
async function QA(){
 if(new URLSearchParams(location.search).get('qaR122')!=='1')return;
 for(let i=0;i<100&&!document.querySelector('#visual-qa-report');i++)await new Promise(r=>setTimeout(r,20));
 adapt();await W();const r=V(),{h,k}=N(r),o=r?.querySelector('.command-open-navigation'),a=r?.querySelector('.command-attention'),n=h?.querySelector('.command-next-decision');
 // R132 successor branch checks the same behavior using its single Command Pro owner.
 // Preserve all legacy R122 checks below on the former DOM.
 const pro=r?.querySelector('.command-pro-decision[data-command-decision-owner="r132"]');
 if(pro){
  const risks=r.querySelector('.command-pro-risks'),links=r.querySelector('.command-pro-quicklinks'),
    source=r.querySelector('.command-source-details'),health=r.querySelector('.command-pro-health');
  const before=(lhs,rhs)=>!!lhs&&!!rhs&&!!(lhs.compareDocumentPosition(rhs)&Node.DOCUMENT_POSITION_FOLLOWING);
  const nr=pro.getBoundingClientRect(),navTop=document.querySelector('#nav')?.getBoundingClientRect().top??innerHeight;
  const c={
   layout:r.querySelectorAll('.command-pro-decision').length===1&&r.querySelectorAll('.command-portfolio-hero').length===1&&r.querySelectorAll('.command-pro-health').length===1&&r.querySelectorAll('.command-source-details').length===1&&r.querySelectorAll('.command-pro-risk-row').length<=3,
   next:nr.top>=0&&nr.bottom<=Math.min(innerHeight,navTop),
   risk:before(pro,risks)&&before(health,risks),
   open:before(risks,links)&&before(links,source),
   attention:!a&&r.querySelectorAll('[data-command-decision-owner="r132"]').length===1,
   refs:!r.querySelector('.attention-reference'),
   label:[...r.querySelectorAll('.command-next-decision span')].filter(x=>x.textContent.trim()==='JETZT WICHTIG').length===1,
   header:![...r.querySelectorAll('.section-title h2')].some(x=>x.textContent.trim()==='NEXT ACTION')
  };
  if(links)links.open=true;
  const bot=links?.querySelector('[data-command-go="bots"]');c.openButton=!!bot&&links.open===true;
  bot?.click();await W();c.openClick=document.querySelector('#view-bots')?.classList.contains('active')===true;
  document.querySelector('#nav [data-v="command"]')?.click();await W();adapt();await W();
  const asset=V()?.querySelector('[data-command-asset]');c.assetButton=!!asset;
  asset?.click();await W();c.assetClick=!asset||document.querySelector('#view-asset-detail')?.classList.contains('active')===true;
  const pre=document.createElement('pre');pre.id='r122-qa-report';pre.hidden=true;
  pre.textContent=JSON.stringify({checks:c,ok:Object.values(c).every(Boolean)});document.body.appendChild(pre);
  return;
 }
 const c={layout:r?.dataset.r122Layout==='true',next:!!n&&n.getBoundingClientRect().top<innerHeight,risk:!!h&&h.nextElementSibling===k,open:!!k&&k.nextElementSibling===o,attention:!a||o?.nextElementSibling===a,refs:!r?.querySelector('.attention-reference'),label:[...r?.querySelectorAll('.command-next-decision span')||[]].filter(x=>x.textContent.trim()==='NEXT ACTION').length===1,header:![...r?.querySelectorAll('.section-title h2')||[]].some(x=>x.textContent.trim()==='NEXT ACTION')};
 const b=o?.querySelector('[data-command-go="bots"]');c.openButton=!!b;b?.click();await W();c.openClick=document.querySelector('#view-bots')?.classList.contains('active')===true;
 document.querySelector('#nav [data-v="command"]')?.click();await W();adapt();await W();const x=V()?.querySelector('[data-command-asset]');c.assetButton=!!x;x?.click();await W();c.assetClick=!x||document.querySelector('#view-asset-detail')?.classList.contains('active')===true;
 const pre=document.createElement('pre');pre.id='r122-qa-report';pre.hidden=true;pre.textContent=JSON.stringify({checks:c,ok:Object.values(c).every(Boolean)});document.body.appendChild(pre)
}
function start(){const r=V();if(!r)return;adapt();new MutationObserver(S).observe(r,{childList:true});QA()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
