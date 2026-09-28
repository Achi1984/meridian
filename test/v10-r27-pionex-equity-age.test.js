import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract=fs.readFileSync(new URL('../portfolio-data-contract.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r27 portfolio contract exposes explicit source timestamp age without inventing freshness thresholds',()=>{
  assert.match(contract,/export function sourceTimestampAge/);
  assert.match(contract,/future=timestampMs>nowMs\+30000/);
  assert.match(contract,/known:false,future:false,timestampMs:null,ageMs:null/);
  assert.doesNotMatch(contract,/PIONEX.*STALE.*MS/i);
});

test('r27 Pionex portfolio age derives only from explicit equity timestamp provenance',()=>{
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(block,/pionexTime=sourceTimestampAge\(resolvedPionex\.updatedAt\)/);
  assert.match(block,/pionexTimestampKnown:pionexTime\.known/);
  assert.match(block,/pionexTimestampFuture:pionexTime\.future/);
  assert.match(block,/pionexAgeMs:pionexTime\.ageMs/);
  assert.doesNotMatch(block,/sourceTimestampAge\(d\?\.privateUpdatedAt\)/);
});

test('r27 COMMAND displays Pionex source age, missing timestamp and future timestamp explicitly',()=>{
  const helpers=v9.slice(v9.indexOf('function portfolioPionexAgeText'),v9.indexOf('function command(){'));
  assert.match(helpers,/FUTURE TIMESTAMP/);
  assert.match(helpers,/NO TIMESTAMP/);
  assert.match(helpers,/ageText\(p\.pionexAgeMs\)/);
  assert.match(helpers,/STATIC SEED/);
  const command=v9.slice(v9.indexOf('function command(){'),v9.indexOf('function botGroup'));
  assert.match(command,/pionexAge=portfolioPionexAgeText\(p\)/);
  assert.match(command,/pionexSourceText=portfolioPionexSourceText\(p\)/);
  assert.match(command,/pionexSourceText\+' · '\+pionexAge/);
  const strip=v10.slice(v10.indexOf('function commandDataStrip'),v10.indexOf('function renderSystemHeader'));
  assert.match(strip,/FUTURE TS/);
  assert.match(strip,/NO TIMESTAMP/);
  assert.match(strip,/PIONEX '\+pionexAge/);
});

test('r27 timestamp provenance is display-only and execution impact remains false',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=27);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v9.includes("live-price-core-r18.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
