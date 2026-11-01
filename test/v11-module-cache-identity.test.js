import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const v11Root=new URL('../v11/',import.meta.url);
const indexUrl=new URL('index.html',v11Root);
const bridgeRoot=new URL('../scripts/memecoin-paper-report-bridge/',v11Root);
const CACHE_ID='?v=B16-M11-FIX12';
const diskPath=url=>fileURLToPath(new URL(url.pathname,url));
const readModule=url=>readFileSync(diskPath(url),'utf8');
const exists=url=>existsSync(diskPath(url));
const specifiers=source=>[...source.matchAll(/\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g)]
  .map(match=>match[1]);
const expectedModules=[
  'agent-status-bootstrap.js','agent-status-client.js',
  'app-access-bootstrap.js','app-access.js',
  'arena-historical-export.js','arena-historical-result.js','arena-inspection-report.js','arena-result-view.js',
  'bot-overview-model.js','bot-read-bootstrap.js','bot-read-client.js','bot-read-model.js','bot-read-view.js',
  'depot-current-model.js','depot-history-model.js','depot-history-view.js','depot-portfolio-state.js','depot-read-bootstrap.js',
  'depot-read-client.js','depot-read-model.js','depot-read-view.js',
  'ledger-manual-client.js','ledger-manual-model.js','ledger-manual-view.js','ledger-review-client.js','ledger-review-model.js','ledger-review-view.js','paper-cockpit-controller.js','paper-cockpit-model.js','paper-cockpit-view.js','paper-readiness-view.js','paper-readiness.js','paper-report-connector.js','pionex-history-model.js','release-update.js','research-evidence.js',
  'strategy-arena.js','strategy-catalog.js','strategy-workspace-bootstrap.js'
];

function scanGraph(entries,{root=v11Root,read=readModule,fileExists=exists,importMap=new Map()}={}){
  const visited=new Set(),modules=new Set(),external=new Set(),identities=new Map(),references=new Map();
  function visit(url){
    const href=url.href;
    if(visited.has(href))return;
    visited.add(href);
    if(url.pathname.startsWith(root.pathname)){
      const name=url.pathname.slice(root.pathname.length);
      modules.add(name);
      if(!identities.has(name))identities.set(name,new Set());
      identities.get(name).add(href);
    }else if(url.pathname.startsWith(bridgeRoot.pathname)){
      const name=`bridge:${url.pathname.slice(bridgeRoot.pathname.length)}`;
      if(!identities.has(name))identities.set(name,new Set());
      identities.get(name).add(href);
    }
    for(const specifier of specifiers(read(url))){
      let target=new URL(specifier,url);
      if(target.pathname.startsWith(bridgeRoot.pathname)&&!target.search){
        target=importMap.get(target.href);
        assert.ok(target,`versioned import-map entry exists: ${specifier}`);
      }
      if(!target.pathname.startsWith(root.pathname)){
        assert.ok(fileExists(target),`external module exists: ${specifier}`);
        if(target.pathname.startsWith(bridgeRoot.pathname)){
          assert.equal(target.search,CACHE_ID,`report bridge module must use ${CACHE_ID}`);
          external.add(`../scripts/memecoin-paper-report-bridge/${target.pathname.slice(bridgeRoot.pathname.length)}${target.search}`);
          visit(target);
        }else external.add(specifier);
        continue;
      }
      assert.equal(target.search,CACHE_ID,`internal v11 import must use ${CACHE_ID}: ${url.pathname} -> ${specifier}`);
      assert.ok(fileExists(target),`internal v11 module exists: ${specifier}`);
      const name=target.pathname.slice(root.pathname.length);
      modules.add(name);
      references.set(name,(references.get(name)||0)+1);
      if(!identities.has(name))identities.set(name,new Set());
      identities.get(name).add(target.href);
      visit(target);
    }
  }
  for(const entry of entries){
    assert.equal(entry.search,CACHE_ID,`served M11 entrypoint must use ${CACHE_ID}`);
    assert.ok(fileExists(entry),`served M11 entrypoint exists: ${entry.pathname}`);
    visit(entry);
  }
  return {modules,external,identities,references};
}

test('served M11 and Paper bridge module graph shares one versioned identity',()=>{
  const html=readFileSync(indexUrl,'utf8');
  const entries=[...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)]
    .map(match=>new URL(match[1],indexUrl));
  assert.deepEqual(entries.map(url=>url.pathname.slice(v11Root.pathname.length)).sort(),
    ['agent-status-bootstrap.js','app-access-bootstrap.js','bot-read-bootstrap.js','depot-read-bootstrap.js','strategy-workspace-bootstrap.js']);

  const rawImportMap=JSON.parse(html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/)?.[1]||'{}');
  const importMap=new Map(Object.entries(rawImportMap.imports||{}).map(([key,value])=>
    [new URL(key,indexUrl).href,new URL(value,indexUrl)]));
  const graph=scanGraph(entries,{importMap});
  assert.deepEqual([...graph.modules].sort(),expectedModules);
  assert.deepEqual([...graph.external].sort(),[
    '../ledger-manual-snapshot.js','../portfolio-data-contract.js','../public/js/m11-agent-status.js',
    '../research/strategy-paper-arena.js','../scripts/memecoin-paper-report-bridge/contract.mjs?v=B16-M11-FIX12',
    '../scripts/memecoin-paper-report-bridge/index.mjs?v=B16-M11-FIX12',
    '../v8-clean/live-price-core-r18.js'
  ]);
  assert.ok(graph.references.get('app-access.js')>=4,'status shares the existing central access module');
  const renderer=readModule(new URL('../public/js/m11-agent-status.js',v11Root));
  assert.deepEqual(specifiers(renderer),[],'browser renderer has no Node normalizer dependency');
  assert.ok(graph.references.get('bot-read-client.js')>=2,'shared bot client is reached by both read surfaces');
  for(const [module,identities] of graph.identities){
    assert.equal(identities.size,1,`${module} must resolve to one shared URL identity`);
    assert.match([...identities][0],/\?v=B16-M11-FIX12$/);
  }
});

test('agent-status browser harness shares the served B17 bootstrap, client and access modules',()=>{
  const source=readFileSync(new URL('./v11-agent-status-chrome.test.js',import.meta.url),'utf8');
  const imports=[...source.matchAll(/import\('([^']+)'\)/g)].map(match=>new URL(match[1],'http://localhost'));
  const statusModules=imports.filter(url=>url.pathname.startsWith('/v11/'))
    .map(url=>url.pathname.slice('/v11/'.length)+url.search).sort();
  assert.deepEqual(statusModules,[
    'agent-status-bootstrap.js?v=B16-M11-FIX12',
    'agent-status-client.js?v=B16-M11-FIX12',
    'app-access.js?v=B16-M11-FIX12'
  ]);
});

test('nested stale B15 edges fail the same graph assertion',()=>{
  const fixtureRoot=new URL('file:///fixture/v11/');
  const fixture=new Map([
    ['/fixture/v11/entry.js',"import './nested.js?v=B16-M11-FIX12';"],
    ['/fixture/v11/nested.js',"import './leaf.js?v=B16-M11';"],
    ['/fixture/v11/leaf.js','export const ready=true;']
  ]);
  assert.throws(()=>scanGraph([new URL('entry.js?v=B16-M11-FIX12',fixtureRoot)],{
    root:fixtureRoot,
    read:url=>fixture.get(url.pathname),
    fileExists:url=>fixture.has(url.pathname)
  }),/internal v11 import must use \?v=B16-M11-FIX12/);
});

test('B17 cache preview remains isolated from terminal, root and PWA release identities',()=>{
  const release=JSON.parse(readFileSync(new URL('../version.json',import.meta.url),'utf8'));
  const rootHtml=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const terminalHtml=readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
  const serviceWorker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const v11Html=readFileSync(indexUrl,'utf8');

  assert.equal(release.terminalBuild,'10.0-r130');
  assert.match(rootHtml,/<meta name="meridian-build" content="10\.0-r130-production">/);
  assert.match(rootHtml,/manifest\.webmanifest\?v=10\.0-r130/);
  assert.match(terminalHtml,/<meta name="meridian-build" content="10\.0-r130">/);
  assert.match(terminalHtml,/manifest\.webmanifest\?v=10\.0-r130/);
  assert.deepEqual([manifest.id,manifest.scope,manifest.start_url],
    ['./','./','./v10/?build=r130&fresh=r130']);
  assert.match(serviceWorker,/MERIDIAN_SW_RETIRE — v7\.35/);
  assert.doesNotMatch(v11Html,/<link\b[^>]*rel=["']manifest|serviceWorker/i);
});
