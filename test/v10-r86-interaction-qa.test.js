import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r86 interaction-QA contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=86,'expected r86 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/INTERACTION-QA/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r86 exposes only localhost visual interaction flows',()=>{
  assert.match(js,/flows=\['primary-reset','asset-return','bot-toggle'(?:,'bot-filter-return','scanner-forecast-return')?\]/);
  assert.match(js,/flow=flows\.includes\(q\.get\('qaFlow'\)\)\?q\.get\('qaFlow'\):null/);
  assert.match(js,/if\(!\['127\.0\.0\.1','localhost'\]\.includes\(location\.hostname\)\)return null/);
});

test('r86 primary navigation flow verifies top-level scroll reset',()=>{
  assert.match(js,/cfg\.flow==='primary-reset'/);
  assert.match(js,/checks\.startedScrolled=scrollY>100/);
  assert.match(js,/\$\('#nav button\[data-v="bots"\]'\)\?\.click\(\)/);
  assert.match(js,/checks\.botsActive=activeViewKey\(\)==='bots'/);
  assert.match(js,/checks\.scrollReset=scrollY<=2/);
});

test('r86 asset drill-down flow verifies contextual return and scroll restoration',()=>{
  assert.match(js,/cfg\.flow==='asset-return'/);
  assert.match(js,/\$\('#view-depot \[data-asset-detail\]'\)/);
  assert.match(js,/checks\.assetOpened=activeViewKey\(\)==='asset-detail'/);
  assert.match(js,/\$\('#view-asset-detail \[data-context-back="asset-detail"\]'\)/);
  assert.match(js,/checks\.depotRestored=activeViewKey\(\)==='depot'/);
  assert.match(js,/checks\.scrollRestored=Math\.abs\(Math\.round\(scrollY\)-origin\)<=8/);
});

test('r86 bot accordion flow verifies close-all and open-all controls',()=>{
  assert.match(js,/cfg\.flow==='bot-toggle'/);
  assert.match(js,/checks\.allClosed=details\.length>0&&details\.every\(x=>!x\.open\)/);
  assert.match(js,/checks\.allOpened=details\.length>0&&details\.every\(x=>x\.open\)/);
});

test('r86 browser evidence includes three interaction scenarios',()=>{
  for(const token of [
    "['flow-primary-reset','command',900,'primary-reset']",
    "['flow-asset-return','depot',700,'asset-return']",
    "['flow-bot-toggle','bots',0,'bot-toggle']"
  ])assert.ok(qa.includes(token),token);
  assert.match(qa,/if\(flow\)url\.searchParams\.set\('qaFlow',flow\)/);
});

test('r86 interaction report fails closed when any check is false',()=>{
  assert.match(js,/ok:Object\.values\(checks\)\.every\(Boolean\)/);
  assert.match(js,/function visualQaSettle\(\)/);
  assert.match(gate,/r86 permanent interaction-QA gates/);
});

test('r86 remains QA and navigation only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
