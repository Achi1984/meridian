// MERIDIAN R122 — presentation-only Command layout adapter.
// Moves existing DOM nodes only. No trading, risk, scoring or research semantics.
const view=()=>document.querySelector('#view-command');
let queued=false;

function adapt(){
  const root=view();if(!root)return;
  const hub=[...root.querySelectorAll('.command-action-hub')]
    .find(x=>!x.classList.contains('command-open-navigation')&&x.querySelector('.command-next-decision'));
  const risk=root.querySelector('.v10-critical-wrap');
  if(!hub||!risk)return;

  const attention=root.querySelector('.command-attention');
  if(attention){
    attention.querySelectorAll('.attention-reference').forEach(x=>x.remove());
    const rows=[...attention.querySelectorAll('.attention-row')];
    if(!rows.length||rows.every(x=>x.classList.contains('tone-safe')))attention.remove();
  }

  const title=hub.querySelector('.section-title h2');
  const note=hub.querySelector('.section-title small');
  if(title&&title.textContent!=='NEXT ACTION')title.textContent='NEXT ACTION';
  const nextNote='Priorität · read-only · keine Trading-Aktion';
  if(note&&note.textContent!==nextNote)note.textContent=nextNote;

  if(risk.previousElementSibling!==hub)hub.insertAdjacentElement('afterend',risk);

  let open=root.querySelector('.command-open-navigation');
  if(!open){
    open=document.createElement('section');
    open.className='command-action-hub command-open-navigation';
    open.innerHTML='<div class="section-title"><h2>OPEN</h2><small>Navigation · read-only · keine Trading-Aktion</small></div>';
  }
  const grid=hub.querySelector('.command-action-grid');
  const paper=hub.querySelector('.command-paper-diagnostics');
  if(grid)open.appendChild(grid);
  if(paper)open.appendChild(paper);
  if(open.previousElementSibling!==risk)risk.insertAdjacentElement('afterend',open);

  const remaining=root.querySelector('.command-attention');
  if(remaining&&remaining.previousElementSibling!==open)open.insertAdjacentElement('afterend',remaining);
  if(root.dataset.r122Layout!=='true')root.dataset.r122Layout='true';
}

function schedule(){
  if(queued)return;queued=true;
  queueMicrotask(()=>{queued=false;adapt()});
}

function start(){
  const root=view();if(!root)return;
  adapt();
  new MutationObserver(schedule).observe(root,{childList:true});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
