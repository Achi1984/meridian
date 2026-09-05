import {setReadToken} from './data.js';
import {loadMore,moreHtml} from './more.js';

let model=null;
let loading=false;
const root=()=>document.getElementById('view-more');
const active=()=>document.getElementById('app')?.dataset.view==='more'||location.hash==='#more';

function bind(){
  const btn=document.getElementById('connectToken');
  if(!btn)return;
  btn.addEventListener('click',async()=>{
    const value=prompt('MERIDIAN Read Token');
    if(value===null)return;
    setReadToken(value);
    location.reload();
  });
}
function paint(){
  const el=root();
  if(!el||!active())return;
  el.innerHTML=moreHtml(model);
  bind();
}
async function hydrate(force=false){
  if(loading)return;
  if(!active()&&!force)return;
  loading=true;
  if(!model)paint();
  model=await loadMore();
  loading=false;
  paint();
}

window.addEventListener('hashchange',()=>{if(location.hash==='#more')hydrate(true)});
document.querySelector('#mainNav [data-route="more"]')?.addEventListener('click',()=>queueMicrotask(()=>hydrate(true)));
if(location.hash==='#more')queueMicrotask(()=>hydrate(true));
setInterval(()=>{if(document.visibilityState==='visible'&&active())hydrate(true)},30000);
