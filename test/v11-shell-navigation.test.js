// MERIDIAN11-A0-NAV-R1: execute the exact inline navigation script without network or DOM dependencies.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const keys=['command','depot','bots','market','research'];
test('A0: all five tabs activate exactly one view and one aria-current',()=>{
 assert.ok(js);
 const classes=on=>{const s=new Set(on?['active']:[]);return {
   toggle:(k,v)=>v?s.add(k):s.delete(k),contains:k=>s.has(k)};};
 const buttons=keys.map((v,i)=>{
   const attrs=new Map(i===0?[['aria-current','page']]:[]);
   return {dataset:{v},classList:classes(i===0),
     setAttribute:(k,x)=>attrs.set(k,x),removeAttribute:k=>attrs.delete(k),
     getAttribute:k=>attrs.get(k)};
 });
 const views=new Map(keys.map((v,i)=>['view-'+v,{hidden:i!==0,classList:classes(i===0)}]));
 let click;
 const nav={querySelectorAll:()=>buttons,contains:b=>buttons.includes(b),
   addEventListener:(kind,fn)=>{if(kind==='click')click=fn;}};
 const document={getElementById:id=>id==='nav'?nav:views.get(id)};
 vm.runInNewContext(js,{document},{timeout:250});
 assert.equal(typeof click,'function');
 for(const key of [...keys,'command']){
   const button=buttons.find(b=>b.dataset.v===key);
   click({target:{closest:()=>button}});
   assert.deepEqual(buttons.filter(b=>b.classList.contains('active')).map(b=>b.dataset.v),[key]);
   assert.deepEqual(buttons.filter(b=>b.getAttribute('aria-current')==='page').map(b=>b.dataset.v),[key]);
   assert.deepEqual(keys.filter(k=>!views.get('view-'+k).hidden),[key]);
 }
 click({target:{closest:()=>({dataset:{v:'invalid'}})}});
 assert.deepEqual(keys.filter(k=>!views.get('view-'+k).hidden),['command']);
});
