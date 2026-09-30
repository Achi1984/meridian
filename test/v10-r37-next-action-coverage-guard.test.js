import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const terminalRevision=Number(String(release.terminalBuild||'').match(/r(\d+)$/)?.[1]||0);

function nextActionRuntime(code,{coverageComplete=true,matched=3,supported=3,unmatched=0,ambiguous=0}={}){
  const a=v10.indexOf('function nextAction(){'),b=v10.indexOf('function syncHealth(){',a);
  assert.ok(a>=0&&b>a,'nextAction source missing');
  const src=v10.slice(a,b);
  const criticalPair=()=>({symbol:'BTC',status:{
    code,
    reason:code==='LIQ_RISK'?'Liq-Puffer nur 8.0%':
      code==='PROTECTION_RISK'?'SL nur 1.0% vor Liquidation':
      code==='RISK_REVIEW'?'4h/1h Struktur dreht gegen mindestens eine Seite':
      code==='PROFIT_LOCK'?'Technische Schwäche + ausreichendes Gewinnpolster':
      code==='WATCH_PROFIT'?'15m/1h Frühwarnung':'Kein bestätigtes Exit-/Safety-Signal'
  }});
  const syncHealth=()=>({coverageComplete,matched,supported,unmatched,ambiguous});
  return new Function('criticalPair','syncHealth',src+';return nextAction();')(criticalPair,syncHealth);
}

test('r37 incomplete global bot coverage blocks non-safety trading actions',()=>{
  const partial={coverageComplete:false,matched:2,supported:3,unmatched:1,ambiguous:0};
  for(const code of ['RISK_REVIEW','PROFIT_LOCK','WATCH_PROFIT','HOLD']){
    const a=nextActionRuntime(code,partial);
    assert.equal(a.title,'KEINE AKTION · DATEN PRÜFEN',code);
    assert.match(a.detail,/BOT COVERAGE · 2\/3 sicher gematcht · 1 unmatched/);
  }
});

test('r37 incomplete coverage never suppresses liquidation or stop-protection safety',()=>{
  const partial={coverageComplete:false,matched:2,supported:3,unmatched:1,ambiguous:1};
  const liq=nextActionRuntime('LIQ_RISK',partial);
  assert.equal(liq.title,'BTC · LIQ-PUFFER PRÜFEN');
  assert.match(liq.detail,/Safety vor Profit-Lock/);
  const sl=nextActionRuntime('PROTECTION_RISK',partial);
  assert.equal(sl.title,'BTC · RISK REVIEW');
  assert.match(sl.detail,/Safety zuerst/);
});

test('r37 complete coverage preserves existing decision actions',()=>{
  assert.equal(nextActionRuntime('RISK_REVIEW').title,terminalRevision>=80?'BTC · STRUCTURE REVIEW':'BTC · RISK REVIEW');
  assert.equal(nextActionRuntime('PROFIT_LOCK').title,'BTC · PROFIT LOCK PRÜFEN');
  assert.equal(nextActionRuntime('WATCH_PROFIT').title,'BTC · WATCH PROFIT');
  assert.equal(nextActionRuntime('HOLD').title,'HOLD · RUNNER WEITERLAUFEN');
});

test('r37 coverage guard is ordered after safety and before non-safety decisions',()=>{
  const block=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  const guard=block.indexOf("if(!g.coverageComplete)");
  assert.ok(block.indexOf("s.code==='LIQ_RISK'")<guard);
  assert.ok(block.indexOf("s.code==='PROTECTION_RISK'")<guard);
  assert.ok(guard<block.indexOf("s.code==='RISK_REVIEW'"));
  assert.ok(guard<block.indexOf("s.code==='PROFIT_LOCK'"));
  assert.ok(guard<block.indexOf("s.code==='WATCH_PROFIT'"));
  assert.match(block,/g\.matched\+'\/'\+g\.supported/);
  assert.match(block,/g\.ambiguous/);
});

test('r37 keeps underlying trading thresholds and execution neutral',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=37);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
