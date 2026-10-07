import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(start,end){
  const a=v10.indexOf(start),b=v10.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return v10.slice(a,b);
}

test('r79 Command Action Hub contract remains active on successor terminal builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=79,'expected r79 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/ACTION-HUB/);
  assert.match(root,new RegExp(release.terminalBuild.replaceAll('.','\\.')+'-production'));
  assert.match(html,new RegExp(release.terminalBuild.replaceAll('.','\\.')));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
});

test('r79 preserves exactly five primary tabs and all secondary surfaces',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  for(const id of ['view-asset-detail','view-paper','view-more'])assert.ok(html.includes('id="'+id+'"'),id);
});

test('r79 Command Action Hub reuses existing readiness and critical-pair state only',()=>{
  const hub=block('function commandActionHubHtml(){','function bindCommandActionHub(view){');
  assert.match(hub,/portfolioReadiness\(\)/);
  assert.match(hub,/botStateItem\(\)/);
  assert.match(hub,/marketStateItem\(\)/);
  assert.match(hub,/paperReadiness\(\)/);
  assert.match(hub,/criticalPair\(\)/);
  assert.match(hub,/marketUniverse\(\)\.includes/);
  assert.doesNotMatch(hub,/score\s*[+=-]|sort\(|rank\s*[+=-]/);
});

test('r79 exposes only the existing safe destination surfaces',()=>{
  const hub=block('function commandActionHubHtml(){','function bindCommandActionHub(view){');
  for(const target of ['depot','bots','market','paper'])assert.ok(hub.includes("item('"+target+"'"),target);
  assert.match(hub,/data-command-asset/);
  assert.doesNotMatch(hub,/trade|order|execute|buy|sell/i);
});

test('r79 primary destination buttons delegate to the canonical primary navigation',()=>{
  const bind=block('function bindCommandActionHub(view){','function pionexDetailAssets(){');
  assert.match(bind,/\$\('#nav button\[data-v="'\+target\+'"]'\)\?\.click\(\)/);
  assert.match(bind,/target==='paper'/);
  assert.match(bind,/showSecondaryView\('paper','research',\{returnView:'command',navKey:'command',label:'COMMAND'\}\)/);
});

test('r79 critical asset drill-down uses Asset Detail and returns to Command',()=>{
  const bind=block('function bindCommandActionHub(view){','function pionexDetailAssets(){');
  assert.match(bind,/openAssetDetail\(symbol,'command','command'\)/);
  const hub=block('function commandActionHubHtml(){','function bindCommandActionHub(view){');
  assert.match(hub,/asset=crit&&marketUniverse\(\)\.includes/);
  assert.match(hub,/CRITICAL ASSET/);
});

test('r79 renderCommand rebuilds and binds the hub without replacing existing Next Action',()=>{
  const render=block('function renderCommand(force=false){','function assetWatchShareCard(){');
  assert.match(render,/bindCommandActionHub\(view\)/);
  if(v10.includes('function commandProModel(now=Date.now()){')){
    // R132 consolidates NEXT ACTION into the one guarded decision owner.
    assert.match(render,/commandProNavigationHtml\(\)/);
    assert.match(render,/commandProDecisionHtml\(model\)/);
    assert.match(render,/data-command-decision-owner|commandProDecisionHtml\(model\)/);
    assert.match(render,/risks\.insertAdjacentElement\('afterend',links\)/);
    const bind=block('function bindCommandActionHub(view){','function pionexDetailAssets(){');
    assert.match(bind,/data-command-go/);
    assert.match(bind,/data-command-asset/);
  }else{
    assert.match(render,/\.command-action-hub/);
    assert.match(render,/commandActionHubHtml\(\)/);
    assert.match(hub,/NEXT ACTION/);
    assert.match(render,/overviewNode\.insertAdjacentElement\('afterend',hubNode\)/);
  }
});

test('r79 permanent UI regression gate freezes the Command Action Hub contract',()=>{
  for(const token of ['Command Action Hub renderer missing','Command Action Hub binding missing','Command Action Hub target missing','Command critical asset must drill into Asset Detail','Command Paper drill-down must preserve Command return context','Command Action Hub styling missing'])assert.ok(gate.includes(token),token);
});

test('r79 Action Hub is mobile touch-friendly and remains presentation-only',()=>{
  assert.match(css,/\.command-action-hub/);
  assert.match(css,/\.command-action-grid/);
  assert.match(css,/@media\(max-width:430px\)[\s\S]*\.command-hub-card\{min-height:48px/);
  const hub=v10.slice(v10.indexOf('function commandActionHubHtml(){'),v10.indexOf('function pionexDetailAssets(){'));
  assert.doesNotMatch(hub,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
