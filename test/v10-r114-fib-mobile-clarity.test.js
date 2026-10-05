import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildFibLevels,adjacentFibLevels,fibPlotPosition} from '../v10/fib-core.js';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

function loadFibLayoutHarness(){
  const a=js.indexOf('function fibLayoutHeightPx()');
  const b=js.indexOf('function fibZonePosition(',a);
  assert.ok(a>=0&&b>a,'r114 layout helpers must be present');
  const block=js.slice(a,b);
  return new Function('fibPlotPosition',`
    ${block}
    return {fibLevelKey,fibDisplayLayout};
  `)(fibPlotPosition);
}

test('r114 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r114');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/FIB-MAP-V2-MOBILE-CLARITY/);
  assert.equal(manifest.start_url,'./v10/?build=r114&fresh=r114');
  assert.match(html,/meridian-build" content="10\.0-r114"/);
  assert.ok(js.includes("const BUILD='10.0-r114'"));
});

test('r114 keeps exact FIB anchors while deconflicting display labels around CURRENT',()=>{
  const {fibLevelKey,fibDisplayLayout}=loadFibLayoutHarness();
  const levels=buildFibLevels(9.968,12.005,'UP');
  const current=10.878;
  const next=adjacentFibLevels(levels,current);
  const layout=fibDisplayLayout(levels,next,current,430,22,16);

  assert.ok(next.above&&next.below);
  assert.equal(layout.current.anchorPx,layout.current.displayPx);
  assert.equal(layout.current.shiftPx,0);

  for(const level of levels){
    const row=layout.byKey[fibLevelKey(level)];
    assert.ok(row,'layout row missing '+level.label);
    assert.ok(Math.abs(row.anchorPct-fibPlotPosition(level.price,levels,current))<1e-9);
  }

  const up=layout.byKey[fibLevelKey(next.above)];
  const down=layout.byKey[fibLevelKey(next.below)];
  assert.ok(up.displayPx<layout.current.displayPx);
  assert.ok(down.displayPx>layout.current.displayPx);
  assert.ok(layout.current.displayPx-up.displayPx>=18);
  assert.ok(down.displayPx-layout.current.displayPx>=18);
});

test('r114 marks dense levels as neutral display clusters without changing numeric levels',()=>{
  const {fibDisplayLayout}=loadFibLayoutHarness();
  const levels=buildFibLevels(9.968,12.005,'UP');
  const current=10.878;
  const next=adjacentFibLevels(levels,current);
  const before=levels.map(x=>({ratio:x.ratio,price:x.price,label:x.label,kind:x.kind}));
  const layout=fibDisplayLayout(levels,next,current,430,22,16);

  assert.ok(layout.clusters.some(x=>x.size>=2),'expected at least one dense visual cluster');
  assert.deepEqual(
    levels.map(x=>({ratio:x.ratio,price:x.price,label:x.label,kind:x.kind})),
    before
  );
  assert.match(js,/LEVEL CLUSTER ×/);
  assert.match(js,/DISPLAY/);
  assert.doesNotMatch(js,/CONFLUENCE SCORE/);
});

test('r114 makes CURRENT visually dominant and keeps anchor line separate from shifted labels',()=>{
  assert.match(css,/v10 r114 · FIB Map V2 mobile clarity/);
  assert.match(css,/\.fib-current\{z-index:6\}/);
  assert.match(css,/--fib-shift/);
  assert.match(css,/--fib-leader-height/);
  assert.match(css,/\.fib-level>i,\.fib-current>i/);
  assert.match(css,/visibility:visible!important/);
  assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.fib-ladder\{height:430px\}/);
});

test('r114 compresses inactive Double Advantage but preserves active evidence wording',()=>{
  const a=js.indexOf('function fibSkCards(');
  const b=js.indexOf('function fibResultHtml(',a);
  const block=js.slice(a,b);
  assert.match(block,/sk-double-compact muted/);
  assert.match(block,/aktuell keine bestätigte Gegen-Ziel ∩ GKL Überlappung/);
  assert.match(block,/Gegen-Ziel ∩ GKL/);
  assert.match(block,/Bestätigung über Struktur nötig/);
  assert.doesNotMatch(block,/<b>—<\/b>/);
});

test('r114 remains level-map presentation only and cannot imply execution',()=>{
  const a=js.indexOf('function fibLayoutHeightPx()');
  const b=js.indexOf('async function updateFibMap(',a);
  const block=js.slice(a,b);
  assert.match(block,/LEVEL MAP · KEIN RICHTUNGSSIGNAL/);
  assert.match(block,/Display-Cluster = visuelle Nähe · Preise\/Signale unverändert/);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|method:\s*['"]POST)/i);
});
