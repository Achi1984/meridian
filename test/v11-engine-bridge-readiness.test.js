import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const v9=readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const v11=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const goStart=v9.indexOf('function go(v){');
const goEnd=v9.indexOf('\nfunction notifyData(){',goStart);
const goSource=goStart>=0&&goEnd>goStart?v9.slice(goStart,goEnd).trim():'';
const bindStart=v9.indexOf("document.querySelectorAll('#nav button').forEach(b=>b.onclick=");
const bindEnd=bindStart>=0?v9.indexOf(';',bindStart)+1:-1;
const bindSource=bindStart>=0&&bindEnd>bindStart?v9.slice(bindStart,bindEnd):'';

assert.ok(v11,'the actual v11 inline navigation script must remain extractable');
assert.equal((v9.match(/function go\(v\)\{/g)||[]).length,1,'the production v9 go() owner must remain unique');
assert.match(goSource,/^function go\(v\)\{[\s\S]*\}$/,'production go() extraction boundary changed');
assert.equal((v9.match(/document\.querySelectorAll\('#nav button'\)\.forEach\(b=>b\.onclick=/g)||[]).length,1,
  'the production per-button navigation owner must remain unique');
assert.match(bindSource,/^document\.querySelectorAll\('#nav button'\)\.forEach\(b=>b\.onclick=\(\)=>go\(b\.dataset\.v\)\);$/,
  'production per-button navigation binding changed');

class Classes {
  constructor(active=false){this.values=new Set(active?['active']:[])}
  toggle(name,force){if(force)this.values.add(name);else this.values.delete(name)}
  contains(name){return this.values.has(name)}
}

function harness(){
  const navHTML=html.match(/<nav\b[^>]*id="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  const tabs=[...(navHTML||'').matchAll(/<button\b([^>]*data-v="([^"]+)"[^>]*)>/g)].map((match,index)=>{
    const attrs=new Map(index===0?[['aria-current','page']]:[]);
    return{
      dataset:{v:match[2]},classList:new Classes(index===0),attrs,onclick:null,
      setAttribute:(key,value)=>attrs.set(key,value),
      removeAttribute:key=>attrs.delete(key),
      getAttribute:key=>attrs.get(key)
    };
  });
  assert.deepEqual(tabs.map(tab=>tab.dataset.v),['command','depot','bots','market','research'],
    'the actual v11 nav tab mapping changed');
  const views=new Map(tabs.map((tab,index)=>[tab.dataset.v,{
    id:'view-'+tab.dataset.v,hidden:index!==0,classList:new Classes(index===0),innerHTML:'',
    querySelector:()=>null
  }]));
  const callbacks=new Map(),events=[],rendered=[];
  const nav={
    querySelectorAll:()=>tabs,contains:tab=>tabs.includes(tab),
    addEventListener:(type,callback)=>callbacks.set(type,callback)
  };
  const document={
    getElementById:id=>id==='nav'?nav:views.get(id.replace(/^view-/,''))||null,
    querySelectorAll:selector=>selector==='.view'?[...views.values()]:
      selector==='#nav button'?tabs:[]
  };
  const window={MERIDIAN_V10:true,dispatchEvent:event=>events.push(event)};
  const context={
    document,window,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},
    queueMicrotask:callback=>callback(),$:(selector)=>views.get(selector.replace('#view-',''))||null,
    render:Object.fromEntries([...views.keys()].map(key=>[key,()=>{rendered.push(key);return 'v9-render:'+key}])),
    bindResearch:()=>{},bindPortfolioRefEditor:()=>{}
  };
  vm.runInNewContext(v11,context,{timeout:250});
  vm.runInNewContext(bindSource,context,{timeout:250});
  vm.runInNewContext(goSource,context,{timeout:250});
  return{tabs,views,callbacks,events,rendered,context};
}

function click(tab,callbacks){
  const event={target:{closest:()=>tab}};
  tab.onclick();
  callbacks.get('click')(event);
}

test('actual v9 go() changes active classes but leaves the v11 visibility and ARIA state stale',()=>{
  const h=harness(),button=h.tabs.find(tab=>tab.dataset.v==='market');
  assert.equal(typeof button.onclick,'function','v9 assigns a per-button navigation handler');
  assert.equal(typeof h.callbacks.get('click'),'function','v11 installs delegated navigation');

  h.context.go('market');

  assert.equal(h.views.get('market').classList.contains('active'),true);
  assert.equal(button.classList.contains('active'),true);
  assert.equal(h.views.get('market').hidden,true,'v9 go() does not unhide the v11 destination');
  assert.equal(h.views.get('command').hidden,false,'v9 go() leaves the v11 initial view visible');
  assert.equal(button.getAttribute('aria-current'),undefined,'v9 go() does not set destination aria-current');
  assert.equal(h.tabs[0].getAttribute('aria-current'),'page','v9 go() leaves aria-current on COMMAND');
  assert.equal(h.views.get('market').innerHTML,'v9-render:market','the extracted production renderer ran');

  h.callbacks.get('click')({target:{closest:()=>button}});
  assert.equal(h.views.get('market').hidden,false,'the actual v11 delegated owner controls hidden state');
  assert.equal(h.views.get('command').hidden,true);
  assert.equal(button.getAttribute('aria-current'),'page');
  assert.equal(h.tabs[0].getAttribute('aria-current'),undefined);
});

test('actual v9 per-button and v11 delegated navigation owners both run for one tab click',()=>{
  const h=harness(),button=h.tabs.find(tab=>tab.dataset.v==='depot');
  click(button,h.callbacks);

  assert.deepEqual(h.rendered,['depot'],'the v9 onclick rendered while the v11 delegated handler also ran');
  assert.equal(h.views.get('depot').hidden,false);
  assert.equal(h.views.get('command').hidden,true);
  assert.equal(button.getAttribute('aria-current'),'page');
  assert.equal(h.events.filter(event=>event.type==='meridian:view').length,1,
    'the production v9 navigation also emits meridian:view');
});
