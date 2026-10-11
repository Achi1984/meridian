import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const visualQa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const visualFrame=fs.readFileSync(new URL('../v10/visual-qa-frame.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function block(startNeedle,endNeedle){
  const a=js.indexOf(startNeedle),b=js.indexOf(endNeedle,a+1);
  assert.ok(a>=0&&b>a,'expected source block '+startNeedle);
  return js.slice(a,b);
}

test('r117 release remains execution-neutral and build-coherent',()=>{
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r117 Command risk presentation separates protection risk from liquidation distance',()=>{
  const src=block('function liquidationStage(buffer)','function criticalPair()');
  assert.match(src,/BOT MARK/);
  assert.match(src,/LIQ STATUS/);
  assert.match(src,/BOT SNAPSHOT/);
  assert.match(src,/protectionConflict=st\.code==='PROTECTION_RISK'/);
  assert.match(src,/overallRiskDominates=st\.tone!=='safe'&&liqDisplay\.tone==='safe'/);
  assert.match(src,/liqTone=overallRiskDominates\?'muted':liqDisplay\.tone/);
  assert.match(src,/SL ungültig → siehe oben/);
  assert.doesNotMatch(src,/<span>CURRENT PRICE<\/span>/);
});

test('r117+ keeps degraded NEXT ACTION prioritized while r120 preserves the total-first hierarchy',()=>{
  const src=block('function renderCommand(','function assetWatchShareCard');
  if(js.includes('function commandProModel(now=Date.now()){')){
    // R132 preserves the original intent: verified capital danger wins;
    // otherwise a degraded portfolio must trigger a guarded review action,
    // never a fabricated total, clean HOLD or unverified trade suggestion.
    const model=block('function commandProModel(','function commandProHealthHtml');
    const decision=block('function commandProDecisionHtml(','function commandProRiskHtml');
    const hero=block('function portfolioChartHeroHtml()','function bindCommandPortfolioHero');
    assert.match(model,/const urgent=verified&&\['LIQ_RISK','PROTECTION_RISK'\]\.includes\(critical\.status\.code\)/);
    assert.match(model,/if\(urgent\)\{[\s\S]*?action=nextAction\(\);asset=critical\.symbol;tone='danger'/);
    assert.match(model,/\}else if\(p\.label!=='READY'\)\{/);
    assert.match(model,/action=\{title:'PORTFOLIO-VOLLSTÄNDIGKEIT PRÜFEN',detail:p\.detail\}/);
    assert.match(model,/target='depot';tone='watch'/);
    assert.match(model,/Gesamtwert und Performance bleiben bis zur Authority-Klärung unbekannt/);
    assert.ok(model.indexOf('if(urgent){')<model.indexOf("else if(p.label!=='READY')"),'verified critical risk must precede missing portfolio authority');
    assert.match(hero,/ready=p\.complete===true&&Number\.isFinite\(total\)&&total>=0/);
    assert.match(hero,/totalText=ready\?/);
    assert.match(hero,/AUTHORITY UNVOLLSTÄNDIG · GESAMTWERT BEWUSST AUSGEBLENDET/);
    assert.match(decision,/data-command-decision-owner="r132"/);
    assert.match(decision,/esc\(model\.action\.detail\)/);
    assert.match(src,/if\(model\.urgent\)\{/);
    assert.match(src,/mode\.insertAdjacentElement\('afterend',decision\)/);
    assert.match(src,/decision\.insertAdjacentElement\('afterend',portfolio\)/);
    assert.match(src,/mode\.insertAdjacentElement\('afterend',portfolio\)/);
    assert.match(src,/health\.insertAdjacentElement\('afterend',decision\)/);
    const browser=fs.readFileSync(new URL('./r132-command-pro-browser.test.js',import.meta.url),'utf8');
    assert.match(browser,/criticalDominance/);
    assert.match(browser,/unknownPortfolioNotZero/);
    assert.match(browser,/staleNotAllClear/);
  }else{
    assert.match(src,/degradedPortfolio=S\(\)\?\.portfolio\?\.complete!==true/);
    assert.match(src,/nextPriority\.classList\.add\('command-next-priority'\)/);
    assert.match(src,/portfolioNode\.insertAdjacentElement\('afterend',overviewNode\)/);
    assert.match(src,/overviewNode\.insertAdjacentElement\('afterend',hubNode\)/);
    assert.doesNotMatch(src,/portfolioNode\.insertAdjacentElement\('beforebegin',nextPriority\)/);
  }
});

test('r117 keeps FIB score semantics while exposing display provenance',()=>{
  const src=block('function opportunityContext(symbol)','function marketRow(symbol)');
  assert.match(src,/fibDistance=p>0&&nearPrice>0\?Math\.abs\(nearPrice-p\)\/p\*100:null/);
  assert.match(src,/fibDisplayDistance=displayRef>0&&nearPrice>0/);
  assert.match(src,/fibSource=autoNear\?'AUTO-MAP':'FEED'/);
  assert.match(src,/NEAREST FIB · '\+esc\(ctx\.fibSource\)/);
});

test('r117 Depot mirrors partial value without presenting it as canonical total',()=>{
  const src=block('function renderDepot(','function showSecondaryView(');
  assert.match(src,/knownDepotSources=\[p\.ledgerAutoUsd,p\.okxVenueUsd,p\.pionex\]/);
  assert.match(src,/TEILWERT, NICHT GESAMT/);
  assert.match(src,/p\.complete\?h\.money\?\.\(p\.total\):'—'/);
});

test('r117 visual QA fails closed and covers secondary/mobile trust surfaces',()=>{
  const cfg=block('function localVisualQaConfig()','function setLocalVisualQaDataMode(');
  const report=block('function writeLocalVisualQaReport(cfg)','function writeLocalVisualQaError(');
  const render=block('function renderLocalVisualQa(cfg)','function activeViewKey()');
  assert.match(cfg,/asset-detail/);
  assert.match(cfg,/paper/);
  assert.match(cfg,/invalidView/);
  assert.match(cfg,/qaWidth/);
  assert.match(cfg,/qaHeight/);
  assert.match(render,/UNKNOWN_VISUAL_QA_VIEW/);
  assert.match(render,/\$\$\('\.view'\)\.forEach/);
  assert.match(report,/smallFormControls/);
  assert.match(report,/degradedPriorityInvariant/);
  assert.match(report,/secondaryViewInvariant/);
  assert.match(report,/partialValueParity/);
});

test('r117 visual QA uses real 390 375 and 320 pixel viewports',()=>{
  assert.match(visualQa,/mobile-375-command/);
  assert.match(visualQa,/mobile-320-command/);
  assert.match(visualQa,/qaWidth/);
  assert.match(visualQa,/qaHeight/);
  assert.match(visualFrame,/width:100%;height:100%/);
  assert.match(visualFrame,/inner\.searchParams\.set\('qaWidth'/);
  assert.match(visualFrame,/inner\.searchParams\.set\('qaHeight'/);
  assert.match(visualFrame,/frame\.width=String\(qaWidth\)/);
  assert.match(visualFrame,/frame\.height=String\(qaHeight\)/);
});

test('r117 mobile controls keep the iOS 16px focus floor',()=>{
  assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.v10-shell input,[\s\S]*?\.v10-shell select,[\s\S]*?\.v10-shell textarea\{font-size:16px\}/);
});

test('r117 UI trust blocks remain presentation-only',()=>{
  const src=[
    block('function pairCard(','function criticalPair()'),
    block('function portfolioChartHeroHtml()','function bindCommandPortfolioHero'),
    block('function renderDepot(','function showSecondaryView('),
    block('function renderCommand(','function assetWatchShareCard()'),
    block('function opportunityContext(symbol)','function marketRow(symbol)')
  ].join('\n');
  assert.doesNotMatch(src,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|executeTrade)/i);
});
