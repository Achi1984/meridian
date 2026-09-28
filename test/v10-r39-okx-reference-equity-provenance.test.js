import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function okxRuntime(rows){
  const a=v9.indexOf('function okxDcaEquitySnapshot()'),b=v9.indexOf('function portfolioModel',a);
  assert.ok(a>=0&&b>a,'OKX equity source missing');
  const src=v9.slice(a,b);
  const state={okxDcaBots:rows};
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  return new Function('state','num',src+';return {snapshot:okxDcaEquitySnapshot(),known:okxKnownBotEquity()};')(state,num);
}

test('r39 OKX reference equity requires complete investment and USD PnL fields',()=>{
  const full=okxRuntime([
    {investUsd:65.32,totalPnlUsd:.1729},
    {investUsd:65.32,totalPnlUsd:-.014}
  ]);
  assert.equal(full.snapshot.complete,true);
  assert.equal(full.snapshot.rows,2);
  assert.equal(full.snapshot.missingInvest,0);
  assert.equal(full.snapshot.missingPnl,0);
  assert.ok(Math.abs(full.known-130.7989)<1e-9);

  const missingPnl=okxRuntime([
    {investUsd:65.32,totalPnlUsd:.1729},
    {investUsd:65.32,totalPnlUsd:null}
  ]);
  assert.equal(missingPnl.snapshot.complete,false);
  assert.equal(missingPnl.snapshot.missingPnl,1);
  assert.equal(missingPnl.known,null);

  const missingInvest=okxRuntime([{investUsd:null,totalPnlUsd:0}]);
  assert.equal(missingInvest.snapshot.complete,false);
  assert.equal(missingInvest.snapshot.missingInvest,1);
  assert.equal(missingInvest.known,null);
});

test('r39 explicit zero PnL remains valid and is not treated as missing',()=>{
  const zero=okxRuntime([{investUsd:100,totalPnlUsd:0}]);
  assert.deepEqual(zero.snapshot,{value:100,complete:true,rows:1,missingInvest:0,missingPnl:0});
  assert.equal(zero.known,100);
});

test('r39 COMMAND does not fall back to stale manual OKX equity',()=>{
  const model=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(model,/okxSnapshot=okxDcaEquitySnapshot\(\),okxReference=okxSnapshot\.value/);
  assert.match(model,/okxComplete:okxSnapshot\.complete/);
  assert.doesNotMatch(model,/okxKnownBotEquity\(\)\?\?state\.manual\.okx/);

  const command=v9.slice(v9.indexOf('function command(){'),v9.indexOf('function botGroup'));
  assert.match(command,/OKX DCA OLD REF/);
  assert.match(command,/nur historischer Bot-Snapshot/);
  assert.match(command,/NICHT IM TOTAL/);
});

test('r39 preserves r37 global and r38 per-asset coverage guards',()=>{
  const next=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  assert.match(next,/if\(!g\.coverageComplete\)return\{title:'KEINE AKTION · DATEN PRÜFEN'/);

  const pair=v10.slice(v10.indexOf('function pairStatus(symbol){'),v10.indexOf('function exposure(rows,side)'));
  assert.match(pair,/if\(unmatchedAsset\.length\)return\{code:'UNVERIFIED'/);

  const command=v9.slice(v9.indexOf('function command(){'),v9.indexOf('function botGroup'));
  assert.match(command,/CANONICAL TOTAL · LEDGER AUTO \+ OKX \+ PIONEX/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
});

test('r39 release identity remains canonical and execution-neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=39);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
