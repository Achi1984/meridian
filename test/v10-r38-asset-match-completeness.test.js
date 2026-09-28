import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function pairStatusRuntime({unmatched=[],riskValue=25,protection=null,planCode='LOCK20',signal='HOLD',livePnl=true,marketFresh=true}={}){
  const a=v10.indexOf('function pairStatus(symbol){'),b=v10.indexOf('function exposure(rows,side)',a);
  assert.ok(a>=0&&b>a,'pairStatus source missing');
  const src=v10.slice(a,b),row={symbol:'BTC',side:'LONG'};
  const state={unmatchedLive:unmatched,assetIntel:{BTC:{updatedAt:Date.now()}}};
  const S=()=>state;
  const H=()=>({
    botFeedFresh:()=>true,
    risk:()=>riskValue,
    livePnlAvailable:()=>livePnl,
    profitLockPlan:()=>({code:planCode}),
    actionForSide:()=>signal
  });
  const matchedRows=()=>[row];
  const stopLossIssue=()=>protection;
  const intelFresh=()=>marketFresh;
  return new Function('S','H','matchedRows','stopLossIssue','intelFresh','symbol',
    src+';return pairStatus(symbol);')(S,H,matchedRows,stopLossIssue,intelFresh,'BTC');
}

test('r38 same-asset unmatched live rows block non-safety pair decisions',()=>{
  const row={symbol:'BTC',reason:'NO_CONFIDENT_MATCH'};
  assert.equal(pairStatusRuntime({unmatched:[row],planCode:'LOCK20'}).code,'UNVERIFIED');
  assert.equal(pairStatusRuntime({unmatched:[row],planCode:'HOLD',signal:'RISK REVIEW'}).code,'UNVERIFIED');
  assert.equal(pairStatusRuntime({unmatched:[row],planCode:'HOLD',signal:'WATCH PROFIT'}).code,'UNVERIFIED');
  const st=pairStatusRuntime({unmatched:[{symbol:'btc',reason:'AMBIGUOUS_MATCH'}]});
  assert.equal(st.code,'UNVERIFIED');
  assert.match(st.reason,/1 aktuelle BTC Bot-Row\(s\) nicht sicher gematcht · 1 ambiguous/);
});

test('r38 unmatched rows from another asset do not block a complete BTC pair',()=>{
  const st=pairStatusRuntime({unmatched:[{symbol:'ETH',reason:'NO_CONFIDENT_MATCH'}],planCode:'LOCK20'});
  assert.equal(st.code,'PROFIT_LOCK');
});

test('r38 same-asset incompleteness never suppresses known liquidation or SL safety',()=>{
  const unmatched=[{symbol:'BTC',reason:'NO_CONFIDENT_MATCH'}];
  assert.equal(pairStatusRuntime({unmatched,riskValue:8,planCode:'HOLD'}).code,'LIQ_RISK');
  const hard={critical:true,reason:'SL liegt hinter/auf Liquidation'};
  assert.equal(pairStatusRuntime({unmatched,riskValue:25,protection:hard,planCode:'HOLD'}).code,'PROTECTION_RISK');
  const near={critical:false,reason:'SL nur 1.00% vor Liquidation'};
  assert.equal(pairStatusRuntime({unmatched,riskValue:25,protection:near,planCode:'HOLD'}).code,'PROTECTION_RISK');
});

test('r38 pair-status ordering keeps safety before match completeness and trading decisions after it',()=>{
  const block=v10.slice(v10.indexOf('function pairStatus(symbol){'),v10.indexOf('function exposure(rows,side)'));
  const guard=block.indexOf('if(unmatchedAsset.length)');
  assert.ok(block.indexOf("if(hardProtection)")<guard);
  assert.ok(block.indexOf("min!=null&&min<10")<guard);
  assert.ok(block.indexOf("if(nearProtection)")<guard);
  assert.ok(guard<block.indexOf("if(plans.some"));
  assert.ok(guard<block.indexOf("signals.includes('RISK REVIEW')"));
  assert.match(block,/ambiguousAsset=unmatchedAsset\.filter/);
});

test('r38 keeps trading thresholds, global coverage guard and execution neutral',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  const next=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  assert.match(next,/if\(!g\.coverageComplete\)/);
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=38);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
