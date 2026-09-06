// MERIDIAN v8 R17 — presentation-only DEPOT source-label cleanup.
// Replaces technical backend source identifiers with a concise user-facing label.
function cleanDepotSourceLabel(){
  const root=document.getElementById('view-depot');
  if(!root)return;
  root.querySelectorAll('.perf-card small').forEach(el=>{
    const next=String(el.textContent||'').replace(/POSTGRES_[A-Z0-9_]+/g,'Canonical History');
    if(next!==el.textContent)el.textContent=next;
  });
}

const observer=new MutationObserver(()=>queueMicrotask(cleanDepotSourceLabel));
observer.observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('click',e=>{
  if(e.target.closest?.('[data-route="depot"]'))setTimeout(cleanDepotSourceLabel,0);
});
setTimeout(cleanDepotSourceLabel,0);
