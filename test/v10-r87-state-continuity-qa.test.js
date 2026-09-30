import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r87 state-continuity contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=87,'expected r87 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/STATE-CONTINUITY-QA/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r87 exposes state-continuity flows only through localhost QA allowlist',()=>{
  assert.match(js,/flows=\['primary-reset','asset-return','bot-toggle','bot-filter-return','scanner-forecast-return'(?:,'stale-recovery')?\]/);
  assert.match(js,/if\(!\['127\.0\.0\.1','localhost'\]\.includes\(location\.hostname\)\)return null/);
});

test('r87 verifies Bot filter survives navigation and session context',()=>{
  assert.match(js,/cfg\.flow==='bot-filter-return'/);
  assert.match(js,/checks\.filterSet=botViewUi\.filter==='RISK'/);
  assert.match(js,/checks\.commandVisited=activeViewKey\(\)==='command'/);
  assert.match(js,/checks\.botsReturned=activeViewKey\(\)==='bots'/);
  assert.match(js,/checks\.filterRetained=botViewUi\.filter==='RISK'/);
  assert.match(js,/checks\.sessionFilterRetained=String\(saved\.botFilter\|\|''\)\.toUpperCase\(\)==='RISK'/);
});

test('r87 verifies Scanner to Forecast selected asset and contextual return',()=>{
  assert.match(js,/cfg\.flow==='scanner-forecast-return'/);
  assert.match(js,/const origin=Math\.round\(scrollY\),open=\$\('#view-research \[data-forecast-asset\]'\),target=/);
  assert.match(js,/checks\.forecastOpened=activeViewKey\(\)==='market'/);
  assert.match(js,/checks\.assetSelected=!!target&&fibUi\.symbol===target/);
  assert.match(js,/checks\.contextBack=!!\$\('#view-market \[data-context-back="market"\]'\)/);
  assert.match(js,/checks\.sessionAssetRetained=String\(saved\.fibSymbol\|\|''\)\.toUpperCase\(\)===target/);
  assert.match(js,/checks\.scannerRestored=activeViewKey\(\)==='research'/);
  assert.match(js,/checks\.scrollRestored=Math\.abs\(Math\.round\(scrollY\)-origin\)<=8/);
});

test('r87 visual evidence runner includes both continuity flows',()=>{
  assert.ok(qa.includes("['flow-bot-filter-return','bots',0,'bot-filter-return']"));
  assert.ok(qa.includes("['flow-scanner-forecast-return','research',520,'scanner-forecast-return']"));
});

test('r87 remains QA/navigation only and fails closed through existing interaction report',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.match(js,/ok:Object\.values\(checks\)\.every\(Boolean\)/);
  assert.match(gate,/r87 permanent state-continuity gates/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
