import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSwingCard, swingAccounts} from '../v11/solana-meme-report.js';

const state = {start:1000,lastTick:1600,candidates:{pool:{}},positions:{},cash:{fixed:1e9,runner:1e9}};

test('reconciles closed sales and allocates the entry fee across partial fills',()=>{
  const s = structuredClone(state);
  s.positions.mint = {qty:100,arms:{
    fixed:{left:0,fills:[{qty:100,gross:31e6,fee:50000}]},
    runner:{left:50,fills:[{qty:50,gross:15.5e6,fee:50000}]}}};
  s.cash = {fixed:1010900000,runner:995400000};
  assert.deepEqual(swingAccounts(s).map(r=>[r.realized,r.open]),[[10.9,0],[5.425,1]]);
  s.cash.runner++;
  assert.throws(()=>swingAccounts(s));
});

test('keeps the last verified accounts on failure and recovers on refresh',async()=>{
  function add(parent,tag,textContent) {
    const el = {textContent,children:[],setAttribute(){},replaceChildren(){this.children=[];}};
    parent.children.push(el);
    return el;
  }
  const root = {children:[]};
  let value = null;
  const refresh = mountSwingCard(root,add,async()=>value);
  const [,status,body] = root.children[0].children;
  await refresh();
  assert.match(status.textContent,/nicht abrufbar/);
  value = state;
  await refresh();
  assert.match(status.textContent,/Wartet auf Einstieg/);
  assert.equal(body.children.length,2);
  value = null;
  await refresh();
  assert.match(status.textContent,/Abruf fehlgeschlagen/);
  assert.equal(body.children.length,2);
  value = state;
  await refresh();
  assert.doesNotMatch(status.textContent,/Abruf fehlgeschlagen/);
});

test('loads the branch checkpoint as raw JSON and resolves queued runs from the current attempt',async()=>{
  const root = {children:[]};
  function add(parent,tag,textContent) {
    const child = {textContent,children:[],setAttribute(){},replaceChildren(){this.children=[];}};
    parent.children.push(child);
    return child;
  }
  let jobs = [{name:'observe (1)',status:'in_progress'}];
  const collector = 45699000001;
  const refresh = mountSwingCard(root, add, async (url,raw) => {
    if (url.includes('/contents/studies/swing48/')) {
      assert.equal(raw,true);
      assert.equal(new URL(url).searchParams.get('ref'),'paper/second-wave-48h-data');
      return {...state,collectorRunId:collector};
    }
    assert.ok(url.includes('/runs/' + collector));
    if (url.endsWith('/attempts/2/jobs')) return {jobs};
    return {id:collector,status:'queued',run_attempt:2};
  });
  const card = root.children[0];
  await refresh();
  assert.match(card.children[1].textContent,/Wartet auf Einstieg/);
  assert.equal(card.children.at(-1).textContent,'Datensammlung · läuft');
  jobs = [{name:'observe (1)',status:'queued'}];
  await refresh();
  assert.equal(card.children.at(-1).textContent,'Datensammlung · wartet');
});
