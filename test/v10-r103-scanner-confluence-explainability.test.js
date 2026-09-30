import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
function block(a,b){const s=js.indexOf(a),e=js.indexOf(b,s);assert.ok(s>=0&&e>s);return js.slice(s,e)}
test('r103 identity is execution-neutral and coherent',()=>{assert.equal(release.terminalBuild,'10.0-r103');assert.equal(release.terminalExecutionImpact,false);assert.match(release.dashboardShell,/SCANNER-CONFLUENCE-EXPLAINABILITY/);assert.equal(manifest.start_url,'./v10/?build=r103&fresh=r103');assert.ok(js.includes("const BUILD='10.0-r103'"))});
test('r103 explains existing Scanner factors without a second score',()=>{const x=block('function scannerConfluenceHtml(symbol){','function scannerLeaderCard(symbol){');for(const token of ['BULL TREND','BEAR TREND','MIXED TREND','MTF CONFIRMED','FIB ≤1%','BULL/BEAR CONFLICT','KEIN HARTES GEGENSIGNAL'])assert.ok(x.includes(token));assert.match(x,/opportunityContext\(symbol\)/);assert.doesNotMatch(x,/score\s*[+*\/-]=|newScore|weightedScore|Math\.round\(.*score/i)});
test('r103 places Why Now on the priority leader',()=>{const x=block('function scannerLeaderCard(symbol){','function scannerCard(symbol){');assert.match(x,/scannerConfluenceHtml\(symbol\)/);assert.ok(x.indexOf('scannerConfluenceHtml(symbol)')<x.indexOf('scan-drill-actions'))});
test('r103 preserves existing Scanner ranking',()=>{const x=block('function renderScanner(force=false){','function skNum(');assert.match(x,/return B\.score-A\.score\|\|sb\.rank-sa\.rank\|\|sb\.score-sa\.score/)});
test('r103 is compact and presentation-only',()=>{assert.match(css,/scanner-confluence-chips/);assert.match(css,/@media\(max-width:520px\)/);const x=block('function scannerConfluenceHtml(symbol){','function scannerCard(symbol){');assert.doesNotMatch(x,/submitOrder|placeOrder|createOrder|cancelOrder|method:\s*['"]POST|\/trade\/order/) });
