import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r34 portfolio regime exposes whether its exposure basis is complete',()=>{
  const block=v9.slice(v9.indexOf('function portfolioRegime'),v9.indexOf('function regimeStrip'));
  assert.ok(block.includes('exposureComplete:e.complete'));
  assert.ok(block.includes("basis:e.complete?'COMPLETE':'PARTIAL_EXPOSURE'"));
  assert.ok(block.includes("if(avgRisk>=6){points-=2"));
  assert.ok(block.includes("else if(avgRisk>=4){points--"));
});

test('r34 preserves concentration and regime score thresholds',()=>{
  const risk=v9.slice(v9.indexOf('function assetExposureShare'),v9.indexOf('function signalSummary'));
  assert.ok(risk.includes('share>=25'));
  assert.ok(risk.includes('share>=15'));
  assert.ok(risk.includes('share>=10'));
  const regime=v9.slice(v9.indexOf('function portfolioRegime'),v9.indexOf('function regimeStrip'));
  assert.ok(regime.includes("points>=2?'RISK-ON':points<=-2?'DEFENSIVE':'NEUTRAL'"));
});

test('r34 visibly labels partial regime basis without changing the regime value',()=>{
  const strip=v9.slice(v9.indexOf('function regimeStrip'),v9.indexOf('function exposureStrip'));
  assert.ok(strip.includes("PORTFOLIO REGIME${r.exposureComplete?'':' · PARTIAL BASIS'}"));
  assert.ok(strip.includes("Exposure-Basis unvollständig"));
  const command=v9.slice(v9.indexOf('function command(){'),v9.indexOf('function botGroup'));
  assert.ok(command.includes("${rg.regime}${rg.exposureComplete?'':' · PARTIAL BASIS'}"));
  const render=v10.slice(v10.indexOf('function renderCommand'),v10.indexOf('function renderBots'));
  assert.doesNotMatch(render,/\.regime-pill/);
});

test('r34 release identity remains canonical and execution-neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=34);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
