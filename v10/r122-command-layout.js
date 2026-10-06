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
const W=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,0))));
async function QA(){
 if(new URLSearchParams(location.search).get('qaR122')!=='1')return;
 for(let i=0;i<100&&!document.querySelector('#visual-qa-report');i++)await new Promise(r=>setTimeout(r,20));
 adapt();await W();const r=V(),{h,k}=N(r),o=r?.querySelector('.command-open-navigation'),a=r?.querySelector('.command-attention'),n=h?.querySelector('.command-next-decision');
 const c={layout:r?.dataset.r122Layout==='true',next:!!n&&n.getBoundingClientRect().top<innerHeight,risk:!!h&&h.nextElementSibling===k,open:!!k&&k.nextElementSibling===o,attention:!a||o?.nextElementSibling===a,refs:!r?.querySelector('.attention-reference'),label:[...r?.querySelectorAll('.command-next-decision span')||[]].filter(x=>x.textContent.trim()==='NEXT ACTION').length===1,header:![...r?.querySelectorAll('.section-title h2')||[]].some(x=>x.textContent.trim()==='NEXT ACTION')};
 const b=o?.querySelector('[data-command-go="bots"]');c.openButton=!!b;b?.click();await W();c.openClick=document.querySelector('#view-bots')?.classList.contains('active')===true;
 document.querySelector('#nav [data-v="command"]')?.click();await W();adapt();await W();const x=V()?.querySelector('[data-command-asset]');c.assetButton=!!x;x?.click();await W();c.assetClick=!x||document.querySelector('#view-asset-detail')?.classList.contains('active')===true;
 const pre=document.createElement('pre');pre.id='r122-qa-report';pre.hidden=true;pre.textContent=JSON.stringify({checks:c,ok:Object.values(c).every(Boolean)});document.body.appendChild(pre)
}
function start(){const r=V();if(!r)return;adapt();new MutationObserver(S).observe(r,{childList:true});QA()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
