import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r32 header readiness emits only semantic v10 tone classes',()=>{
  const market=v10.slice(v10.indexOf('function marketReadiness'),v10.indexOf('function botReadiness'));
  const bot=v10.slice(v10.indexOf('function botReadiness'),v10.indexOf('function dataGuardCard'));
  assert.match(market,/label:'READY',tone:'safe'/);
  assert.match(market,/label:'PARTIAL',tone:'watch'/);
  assert.match(market,/label:'STALE',tone:'watch'/);
  assert.doesNotMatch(market,/tone:'mixed'/);
  assert.match(bot,/label:'ERROR',tone:'danger'/);
  assert.match(bot,/label:'REF',tone:'muted'/);
  assert.match(bot,/label:'READY',tone:'safe'/);
  assert.match(bot,/label:'PARTIAL',tone:'watch'/);
  assert.match(bot,/label:'SAFETY',tone:'watch'/);
  assert.match(bot,/label:'BLOCKED',tone:'muted'/);
  assert.doesNotMatch(bot,/tone:'reference'/);
});

test('r32 header and source strip consume readiness tones directly',()=>{
  const strip=v10.slice(v10.indexOf('function commandDataStrip'),v10.indexOf('function renderSystemHeader'));
  assert.match(strip,/class="tone-'+mr\.tone\+'"/);
  assert.match(strip,/class="tone-'+br\.tone\+'"/);
  assert.doesNotMatch(strip,/mr\.tone==='mixed'/);
  assert.doesNotMatch(strip,/br\.tone==='reference'/);
  const header=v10.slice(v10.indexOf('function renderSystemHeader'),v10.indexOf('function decorateA11y'));
  assert.match(header,/set\(market,'● MKT '\+mr\.label,'live '\+mr\.tone/);
  assert.match(header,/set\(bot,'● BOT '\+br\.label,'live '\+br\.tone/);
});

test('r32 shell and CSS agree on the semantic tone vocabulary',()=>{
  for(const cls of ['.live.safe{color:var(--green)}','.live.watch{color:var(--amber)}','.live.danger{color:var(--red)}','.live.muted{color:var(--muted)}'])assert.ok(css.includes(cls),cls);
  assert.match(shell,/class="live muted" id="market-status"/);
  assert.match(shell,/class="live muted" id="data-status"/);
  assert.doesNotMatch(v10,/tone:'mixed'|tone:'reference'/);
});

test('r32 release identity is canonical and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r32');
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(shell.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(root.includes('build=r32'));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
