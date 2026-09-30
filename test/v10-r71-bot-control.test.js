import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function extract(name,nextName){
  const start=v10.indexOf('function '+name);
  const end=v10.indexOf('\nfunction '+nextName,start);
  assert.ok(start>=0&&end>start,'function slice missing: '+name);
  return v10.slice(start,end);
}
const botTypeLabel=new Function(extract('botTypeLabel','botTypeSummary')+';return botTypeLabel')();
const botRangeState=new Function(extract('botRangeState','botRangeSummary')+';return botRangeState')();

test('r71 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r71');
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardShell,'10.0-r71-BOT-CONTROL-2');
  assert.match(root,/10\.0-r71-production/);
  assert.match(html,/10\.0-r71/);
  assert.match(v10,/const BUILD='10\.0-r71'/);
});

test('r71 preserves live bot type and grid metadata without changing matching inputs',()=>{
  assert.match(v9,/botType:String\(x\.botType\|\|x\.buOrderType/);
  assert.match(v9,/grids:pick\(x,\['grids','gridCount','grid_count','row'\]\)/);
  assert.match(v9,/cateType:String\(x\.cateType/);
  const match=v9.slice(v9.indexOf('function botMatchScore'),v9.indexOf('const MATCH_MAX_SCORE'));
  assert.doesNotMatch(match,/botType|grids|cateType/);
});

test('r71 maps common bot types for display only',()=>{
  assert.equal(botTypeLabel({botType:'futures_grid'}),'GRID');
  assert.equal(botTypeLabel({botType:'futures_dca'}),'DCA');
  assert.equal(botTypeLabel({botType:'futures_lite'}),'LITE');
  assert.equal(botTypeLabel({botType:''}),'BOT');
});

test('r71 range state reports fresh in-range position and fails closed on stale market',()=>{
  const inside=botRangeState({lower:100,upper:200},{value:150,stale:false});
  assert.equal(inside.available,true);
  assert.equal(inside.positionFresh,true);
  assert.equal(inside.inRange,true);
  assert.equal(inside.positionPct,50);
  assert.equal(inside.label,'IN RANGE');

  const above=botRangeState({lower:100,upper:200},{value:250,stale:false});
  assert.equal(above.inRange,false);
  assert.equal(above.positionPct,100);
  assert.equal(above.label,'ABOVE RANGE');

  const stale=botRangeState({lower:100,upper:200},{value:150,stale:true});
  assert.equal(stale.positionFresh,false);
  assert.equal(stale.positionPct,null);
  assert.equal(stale.label,'MKT STALE');
});

test('r71 BOTS view exposes four presentation-only filters',()=>{
  for(const key of ['ALL','RISK','PROFIT','HEDGE'])assert.ok(v10.includes("['"+key+"'")||v10.includes("'"+key+"'"));
  for(const token of ['data-bot-filter','ALLE','RISIKO','PROFIT','HEDGE','Nur Darstellung · Risk-Ranking bleibt unverändert'])assert.ok(v10.includes(token),token);
  assert.match(css,/\.bot-filter-bar/);
  assert.match(css,/\.bot-filter-actions button\.active/);
});

test('r71 collapsed asset cards show PnL liquidation hedge and range coverage',()=>{
  assert.match(v10,/asset-glance/);
  for(const token of ['PNL <b','MIN LIQ <b','HEDGE <b','RANGE <b'])assert.ok(v10.includes(token),token);
  assert.match(v10,/botRangeSummary\(rows,mp\)/);
  assert.match(css,/\.asset-glance\{grid-template-columns:repeat\(4/);
});

test('r71 expanded bot legs show type grids and a visual range meter',()=>{
  assert.match(v10,/Math\.round\(grids\)\+' GRIDS'/);
  assert.match(v10,/class="leg-range"/);
  assert.match(v10,/class="leg-range-track"/);
  assert.match(v10,/--range-pos:/);
  assert.match(css,/\.leg-range-track i/);
});

test('r71 UI block remains read-only and does not add order paths',()=>{
  const start=v10.indexOf('function botTypeLabel');
  const end=v10.indexOf('function marketUniverse',start);
  const block=v10.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method:\s*['"]POST/);
  assert.match(v10,/BOT CONTROL CENTER 2\.0/);
});

test('r71 keeps the five-tab dashboard shell unchanged',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="more"/);
});

test('r71 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
