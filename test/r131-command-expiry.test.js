import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Run the production selection, freshness policy and decision branch. Only state,
// clock and unrelated bot/portfolio summaries are fixtures; no network or orders.
const source=readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const T=1791360000000;
function line(name){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\n',start);
  assert.ok(start>=0&&end>start,'missing production function '+name);
  return source.slice(start,end);
}
const commandStart=source.indexOf('function command(){');
const decisionStart=source.indexOf(" let action='",commandStart);
const decisionEnd=source.indexOf('\n return `',decisionStart);
assert.ok(commandStart>=0&&decisionStart>commandStart&&decisionEnd>decisionStart);
const decision=source.slice(decisionStart,decisionEnd)+'\nreturn {action,actionReason};';
function harness(side='LONG'){
  const h={clock:T+180000,botFresh:true};
  const state={bots:[{symbol:'ETH',side,profitPct:0}],assetIntel:{ETH:{updatedAt:T,
    longAction:'RISK REVIEW',shortAction:'WATCH PROFIT',longReasons:['CONFIRMED_LONG'],shortReasons:['CONFIRMED_SHORT']}}};
  const Clock={now:()=>h.clock};
  const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
  const impl=[line('marketIntelFresh'),line('actionForSide'),line('reasonsForSide'),line('signalRank'),line('topSignalBot')].join('\n');
  const api=new Function('state','Date','num','botFeedFresh','liveMatched',impl+'\nreturn {topSignalBot,marketIntelFresh,reasonsForSide};')(state,Clock,num,()=>h.botFresh,()=>true);
  const decide=new Function('state','sa','marketIntelFresh','reasonsForSide','cr','c','pp','rg',decision);
  h.state=state;h.select=api.topSignalBot;
  h.decide=(sa=h.select(),cr=null)=>decide(state,sa,api.marketIntelFresh,api.reasonsForSide,cr,state.bots[0],null,{reasons:['NO_CURRENT_MARKET_ACTION']});
  return h;
}
for(const side of ['LONG','SHORT']) {
  test('R131 Command '+side+' selection expires strictly after 180000 ms',()=>{
    const h=harness(side),before=structuredClone(h.state);
    assert.equal(h.select()?.b.side,side);
    h.clock++;
    assert.equal(h.select(),null);
    assert.deepEqual(h.state,before,'expiry must not erase evidence or bots');
  });
  test('R131 Command '+side+' stale selected reason cannot leak after boundary',()=>{
    const h=harness(side),chosen=h.select();
    assert.match(h.decide(chosen).action,/MOMENTUM WATCH/);
    assert.match(h.decide(chosen).actionReason,new RegExp('CONFIRMED_'+side));
    h.clock++;
    const out=h.decide(chosen);
    assert.doesNotMatch(out.action,/MOMENTUM/);
    assert.doesNotMatch(out.actionReason,/CONFIRMED_/);
  });
}
for(const [label,stamp] of [['missing',undefined],['null',null],['future',T+30001]]) {
  test('R131 Command ignores '+label+' market evidence without changing bot count',()=>{
    const h=harness();h.clock=T;h.state.assetIntel.ETH.updatedAt=stamp;
    assert.equal(h.select(),null);assert.equal(h.state.bots.length,1);
  });
}
test('R131 Command stale strongest candidate cannot outrank valid weaker asset',()=>{
  const h=harness();h.clock++;
  h.state.bots.push({symbol:'SOL',side:'LONG',profitPct:0});
  h.state.assetIntel.SOL={updatedAt:h.clock,longAction:'WATCH PROFIT',longReasons:['VALID_SOL']};
  assert.equal(h.select()?.b.symbol,'SOL');
  assert.match(h.decide().actionReason,/VALID_SOL/);
});
test('R131 Command stale bot feed suppresses even fresh market selection',()=>{
  const h=harness();h.clock=T;h.botFresh=false;assert.equal(h.select(),null);
});
test('R131 Command verified liquidation priority survives market expiry',()=>{
  const h=harness(),chosen=h.select();h.clock++;
  const out=h.decide(chosen,8);
  assert.equal(out.action,'ETH · LIQ-PUFFER PRÜFEN');
  assert.match(out.actionReason,/Liquidationsschutz hat Vorrang/);
});
