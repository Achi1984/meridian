import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

function block(start,end){
  const a=js.indexOf(start),b=js.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return js.slice(a,b);
}

test('r82 visual interaction contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=82,'expected r82 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/VISUAL-INTERACTION-POLISH/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.match(html,new RegExp(release.terminalBuild.replaceAll('.','\\.')));
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r82 primary navigation starts each top-level surface at the top',()=>{
  const nav=block('function bindV10NavigationAuthority(){','let raf=0');
  assert.match(nav,/decorateA11y\(\);restoreViewport\(0\)/);
});

test('r82 secondary drill-down captures origin scroll and restores it on contextual back',()=>{
  const back=block('function restoreViewport(y=0){','function contextBarHtml');
  assert.match(back,/false,ctx\?\.scrollY\|\|0/);
  const secondary=block("function showSecondaryView(v,navKey='research',context=null,scrollY=0){",'let feedRefreshBusy=false');
  assert.match(secondary,/scrollY:Math\.max\(0,Number\(window\.scrollY\)\|\|0\)/);
  assert.match(secondary,/restoreViewport\(scrollY\)/);
});

test('r82 stacks mobile hierarchy where long status text previously competed horizontally',()=>{
  assert.match(css,/\.section-title\{display:flex;flex-direction:column;align-items:flex-start;gap:2px\}/);
  assert.match(css,/\.forecast-focus-head\{display:grid;grid-template-columns:1fr;gap:6px\}/);
  assert.match(css,/\.forecast-focus-head>strong\{justify-self:start;max-width:100%;white-space:normal/);
  assert.match(css,/\.market-regime\{display:grid;grid-template-columns:1fr;gap:6px;align-items:start\}/);
});

test('r82 improves Scanner and FIB phone readability without hiding information',()=>{
  assert.match(css,/\.scanner-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css,/\.scanner-summary>div\{min-height:58px\}/);
  assert.match(css,/\.fib-head\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;align-items:start\}/);
  assert.match(css,/@media\(max-width:390px\)[\s\S]*\.fib-head\{grid-template-columns:1fr\}/);
});

test('r82 adds mobile scroll safe space above sticky header and fixed nav',()=>{
  assert.match(css,/html\{scroll-padding-top:72px;scroll-padding-bottom:calc\(96px \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.match(css,/nav\{box-shadow:0 -10px 28px rgba\(0,0,0,\.28\)\}/);
});

test('r82 remains presentation and navigation only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.match(gate,/r82 permanent visual-interaction gates/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
