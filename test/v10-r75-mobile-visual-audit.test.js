import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(start,end){
  const a=v10.indexOf(start),b=v10.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return v10.slice(a,b);
}

test('r75 mobile visual hardening remains active on successor terminal builds',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('r').at(-1))>=75);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/MOBILE-HARDENED/);
  assert.ok(root.includes(release.terminalBuild+'-production'));
  assert.ok(html.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  const rev=release.terminalBuild.split('-').at(-1);
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
});

test('r75 keeps exactly five primary tabs and all secondary surfaces',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  for(const id of ['view-asset-detail','view-paper','view-more'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.doesNotMatch(html,/data-v="asset-detail"|data-v="paper"|data-v="more"/);
});

test('r75 protects iPhone safe areas and dynamic viewport without horizontal page overflow',()=>{
  assert.match(css,/body\{min-height:100dvh\}/);
  assert.match(css,/html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.match(css,/padding-right:calc\(8px \+ env\(safe-area-inset-right\)\)/);
  assert.match(css,/padding-left:calc\(8px \+ env\(safe-area-inset-left\)\)/);
  assert.match(css,/padding-bottom:calc\(84px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/nav\{padding-left:calc\(8px \+ env\(safe-area-inset-left\)\);padding-right:calc\(8px \+ env\(safe-area-inset-right\)\)\}/);
  assert.match(css,/\.v10-topbar\{top:env\(safe-area-inset-top\)\}/);
});

test('r75 standardizes mobile touch targets to at least 44px',()=>{
  assert.match(css,/@media\(max-width:760px\)\{[\s\S]*\.v10-shell button,[\s\S]*min-height:44px/);
  assert.match(css,/\.depot-asset-card>summary,[\s\S]*\.v10-unmatched-details>summary\{min-height:44px\}/);
  assert.match(css,/\.feed-refresh,[\s\S]*\.bot-filter-actions button\{min-height:44px\}/);
  assert.match(css,/#nav button\{min-height:44px/);
});

test('r75 decongests the narrow header and mode banners',()=>{
  assert.match(css,/@media\(max-width:600px\)\{[\s\S]*\.v10-topbar\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css,/\.v10-mode-banner\{display:grid;grid-template-columns:1fr;gap:3px/);
  assert.match(css,/\.v10-mode-banner small\{max-width:none;text-align:left/);
  assert.match(css,/@media\(max-width:390px\)\{[\s\S]*\.v10-topbar>div:first-child>small\{display:none\}/);
});

test('r75 makes dense cards shrink and wrap instead of widening the viewport',()=>{
  assert.match(css,/\.v10-shell,main,\.view,\.view\.active\{min-width:0;max-width:100%\}/);
  assert.match(css,/\.v10-shell :where\(\.command-kpi-grid,[\s\S]*\.paper-cohort-grid\)>\*\{min-width:0\}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.command-kpi-grid b,[\s\S]*overflow-wrap:anywhere/);
  assert.match(css,/nav button span\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
});

test('r75 provides visible keyboard focus and polite live status semantics',()=>{
  assert.match(css,/button:focus-visible,[\s\S]*outline:2px solid var\(--cyan\)/);
  const a11y=block('function decorateA11y(){','function selectHistoryAnchor');
  assert.match(a11y,/\.v10-live-blocked,\.paper-cockpit-state,\.paper-refresh-warning,\.v10-unverified-note/);
  assert.match(a11y,/setAttribute\('role','status'\)/);
  assert.match(a11y,/setAttribute\('aria-live','polite'\)/);
  assert.match(a11y,/\.v10-shell button/);
});

test('r75 remains presentation/accessibility-only in the changed adapter block',()=>{
  const a11y=block('function decorateA11y(){','function selectHistoryAnchor');
  assert.doesNotMatch(a11y,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
