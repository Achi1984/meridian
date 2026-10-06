import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const must=(ok,msg)=>{if(!ok)throw new Error('V10_UI_REGRESSION: '+msg)};

const release=json('version.json');
const root=read('index.html');
const manifest=json('manifest.webmanifest');
const html=read('v10/index.html');
const js=read('v10/v10.js');
const v9=read('v9/v9.js');
const css=read('v10/v10.css');
const qa=read('scripts/v10-visual-qa.mjs');
const qaFrame=read('v10/visual-qa-frame.html');
const gateway=read('server-gateway.js');
const contract=read('portfolio-data-contract.js');
const historyStore=read('portfolio-history-store.js');
const marketFeed=read('market-feed-gateway.js');
const authorityUpdate=read('portfolio-authority-update.js');

const build=String(release.terminalBuild||'');
const rev=build.split('-').at(-1)||'';
must(/^10\.0-r\d+$/.test(build),'invalid terminalBuild');
must(release.terminalExecutionImpact===false,'terminalExecutionImpact must remain false');
must(String(release.dashboardShell||'').includes('UI-REGRESSION-GATE'),'dashboardShell must declare UI regression gate');

must(root.includes('content="'+build+'-production"'),'root production build mismatch');
must(root.includes("var target='./v10/?build="+rev+"'"),'root redirect cache revision mismatch');
must(manifest.start_url===`./v10/?build=${rev}&fresh=${rev}`,'manifest start_url mismatch');
must(html.includes('content="'+build+'"'),'v10 meta build mismatch');
must(js.includes("const BUILD='"+build+"'"),'v10 runtime build mismatch');
must(html.includes('../v9/v9.js?v='+build),'v9 engine cache tag mismatch');
must(html.includes('./v10.js?v='+build),'v10 adapter cache tag mismatch');
must(html.includes('viewport-fit=cover'),'viewport-fit=cover missing');

const viewIds=[...html.matchAll(/id="view-([^"]+)"/g)].map(x=>x[1]);
must(new Set(viewIds).size===viewIds.length,'duplicate view ids');
for(const v of ['command','depot','bots','market','research','asset-detail','paper','more'])must(viewIds.includes(v),'missing view-'+v);

const navButtons=[...html.matchAll(/<button data-v="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span><\/button>/g)].map(x=>({route:x[1],label:x[2]}));
const expected=[
  {route:'command',label:'COMMAND'},
  {route:'depot',label:'DEPOT'},
  {route:'bots',label:'BOTS'},
  {route:'market',label:'FORECAST'},
  {route:'research',label:'SCANNER'}
];
must(navButtons.length===5,'primary nav must contain exactly five buttons');
must(JSON.stringify(navButtons)===JSON.stringify(expected),'primary nav route/label contract changed');
for(const secondary of ['asset-detail','paper','more'])must(!navButtons.some(x=>x.route===secondary),secondary+' must remain secondary');

must(js.includes("if(active==='asset-detail')return renderAssetDetail(force)"),'Asset Detail secondary renderer missing');
must(js.includes("if(active==='paper')return renderPaperCockpit(force)"),'Paper Cockpit secondary renderer missing');
must(js.includes("if(active==='more')return renderLab()"),'LAB secondary renderer missing');
must(js.includes("showSecondaryView('paper','research')"),'Scanner to Paper Cockpit bridge missing');
must(js.includes("showSecondaryView('more','research')"),'secondary LAB bridge missing');

must(js.includes('function dataStateStripHtml(scope)'),'unified Data State renderer missing');
for(const scope of ['command','depot','bots','market','research','asset','paper','lab']){
  must(js.includes("dataStateStripHtml('"+scope+"')"),'Data State scope missing: '+scope);
}
must(css.includes('.data-state-strip{'),'Data State strip styling missing');
must(css.includes('.data-state-item.tone-danger'),'Data State danger tone missing');

const contextStart=js.indexOf("const UI_CONTEXT_KEY='meridian.v10.context.v1'");
const contextEnd=js.indexOf('const MARKET_FRESH_MS',contextStart);
must(contextStart>=0&&contextEnd>contextStart,'UI session context block missing');
const contextBlock=js.slice(contextStart,contextEnd);
must(contextBlock.includes('sessionStorage.getItem(UI_CONTEXT_KEY)'),'UI session context read missing');
must(contextBlock.includes('sessionStorage.setItem(UI_CONTEXT_KEY'),'UI session context write missing');
must(!contextBlock.includes('localStorage'),'UI context must remain session-only');
must(contextBlock.includes("JSON.stringify({fibSymbol:String(fibUi.symbol||'BTC').toUpperCase(),botFilter:"),'UI context payload must stay limited to asset + bot filter');
must(js.includes('function contextualBack(target'),'contextual back helper missing');
must(js.includes('function contextBarHtml(target)'),'contextual return bar helper missing');
must(js.includes("contextBarHtml('market')"),'Scanner-to-Forecast return context missing');
must(js.includes("contextualBack('asset-detail'"),'Asset Detail contextual back missing');
must(js.includes("contextualBack('paper'"),'Paper contextual back missing');
must(js.includes("contextualBack('more'"),'LAB contextual back missing');
must(js.includes('delete viewContextUi[v]'),'direct primary navigation must clear stale target context');
must(css.includes('.context-return-bar{'),'contextual return bar styling missing');

must(js.includes('function commandActionHubHtml()'),'Command Action Hub renderer missing');
must(js.includes('function bindCommandActionHub(view)'),'Command Action Hub binding missing');
for(const target of ['depot','bots','market','paper'])must(js.includes("item('"+target+"'"),'Command Action Hub target missing: '+target);
must(js.includes("openAssetDetail(symbol,'command','command')"),'Command critical asset must drill into Asset Detail');
must(js.includes("showSecondaryView('paper','research',{returnView:'command',navKey:'command',label:'COMMAND'})"),'Command Paper drill-down must preserve Command return context');
must(css.includes('.command-action-hub{'),'Command Action Hub styling missing');

const badSelector=/(^|[^$])\$\([^()\n]*\)\.(?:forEach|filter|map|some|every|reduce|find)\s*\(/m;
must(!badSelector.test(js),'single-element selector used as collection');

const forbiddenUiExecution=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
must(!forbiddenUiExecution.test(js),'v10 presentation contains execution/order path');
must(v9.includes("paperOverview:()=>getJson('/api/paper/overview')"),'Paper Overview must use protected GET bridge');
must(!/paperOverview:[^\n]*postJson/.test(v9),'Paper Overview bridge must not POST');

for(const edge of ['safe-area-inset-top','safe-area-inset-right','safe-area-inset-bottom','safe-area-inset-left'])must(css.includes(edge),'missing '+edge);
must(css.includes('html,body{max-width:100%;overflow-x:hidden}'),'page horizontal-overflow guard missing');
must(css.includes('body{min-height:100dvh}'),'dynamic viewport guard missing');
must(/nav button\{min-height:48px/.test(css),'48px mobile primary nav target missing');
must(/min-height:44px/.test(css),'44px secondary mobile touch target missing');
must(css.includes(':focus-visible'),'focus-visible styling missing');
must(css.includes('@media(prefers-reduced-motion:reduce)'),'reduced-motion guard missing');
must(css.includes('transition:none!important')&&css.includes('animation:none!important'),'reduced-motion behavior incomplete');
must(js.includes("setAttribute('role','status')")&&js.includes("setAttribute('aria-live','polite')"),'dynamic status accessibility guard missing');

console.log('V10_UI_REGRESSION_PASS',build,JSON.stringify({primaryTabs:navButtons.length,views:viewIds.length,secondaryViews:3,executionImpact:false}));


/* r80 permanent trust / semantic-consistency gates */
must(js.includes('function marketIntel(symbol)'),'canonical market-intel resolver missing');
must(js.includes("intelFresh(marketIntel('BTC'))"),'BTC freshness must use canonical market intel');
must(js.includes("label:'STRUCTURE REVIEW',tone:'watch',rank:70"),'technical structure review must remain non-danger review');
must(js.includes("label:'LIQ RISK',tone:'danger',rank:120"),'liquidation risk danger priority changed');
must(js.includes("label:'PROTECTION RISK',tone:'danger',rank:130"),'hard protection danger priority changed');
must(js.includes("rank:90,reason:unmatched.length+' private Bot-Rows"),'unverified API rows must outrank technical review');
must(js.includes("OPPORTUNITY '+ctx.score+'/100"),'Forecast opportunity score must be explicitly named');
must(js.includes("REGIME '+i.score+'/100"),'BTC regime score must be explicitly named');
must(js.includes("function fibZonePosition(zone,current)"),'FIB zone position classifier missing');
for(const state of ["return'below'","return'above'","return'inside'"])must(js.includes(state),'FIB zone state missing: '+state);
must(js.includes('<span>WALLET <b>'),'Depot wallet-value label missing');
must(js.includes('<span>OPEN FUTURES</span>'),'open-futures count label missing');
must(js.includes('<span>BOT IDENTITIES</span>'),'bot identity count label missing');
must(js.includes('function portfolioAuthorityDetail('),'granular portfolio authority detail missing');
must(js.includes('class="command-next-decision"'),'Command Next Action consolidation missing');
must(css.includes('.command-next-decision{'),'Command consolidated action styling missing');
must(css.includes('.sk-zone.state-below,.sk-zone.state-above'),'FIB inactive-zone styling missing');
must(css.includes('.command-attention>.section-title{display:flex;flex-direction:column'),'mobile Attention collision guard missing');
must(css.includes('#view-market .fib-output{padding-bottom:calc(68px + env(safe-area-inset-bottom))}'),'mobile FIB/nav safe-space guard missing');


/* r81 permanent mobile-density gates */
must(String(release.dashboardShell||'').includes('MOBILE-DENSITY-V2'),'dashboardShell must declare mobile density v2');
must(css.includes('/* v10 r81 · mobile density v2 */'),'r81 mobile-density CSS block missing');
must(css.includes('.data-state-items{grid-template-columns:repeat(2,minmax(0,1fr))}'),'mobile Data State must use compact two-column layout');
must(css.includes('.data-state-item:only-child,.data-state-item:last-child:nth-child(odd){grid-column:1/-1}'),'odd Data State span guard missing');
must(css.includes('.scanner-toolbar-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;gap:6px}'),'Scanner tool actions must stay side-by-side on phone');
must(css.includes('.bot-filter-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}'),'Bot mobile filter density guard missing');
must(css.includes('.asset-toggle-actions button{min-height:44px;padding:0 7px}'),'Asset toggle touch-target guard missing');
must(css.includes('.depot-asset-card>summary{min-height:58px;padding:8px 9px}'),'Depot mobile card density guard missing');
must(css.includes('.asset-pair-details>summary{min-height:60px;padding:8px}'),'Bot accordion mobile density guard missing');
must(css.includes('.command-hub-card{min-height:52px;padding:7px 8px}'),'Command Hub mobile density guard missing');


/* r82 permanent visual-interaction gates */
must(String(release.dashboardShell||'').includes('VISUAL-INTERACTION-POLISH'),'dashboardShell must declare visual interaction polish');
must(js.includes('function restoreViewport(y=0)'),'viewport restore helper missing');
must(js.includes("scrollY:Math.max(0,Number(window.scrollY)||0)"),'secondary drill-down scroll capture missing');
must(js.includes("false,ctx?.scrollY||0"),'contextual back scroll restore missing');
must(js.includes("decorateA11y();restoreViewport(0)"),'primary tab navigation must reset viewport');
must(css.includes('/* v10 r82 · visual + interaction polish */'),'r82 visual CSS block missing');
must(css.includes('.section-title{display:flex;flex-direction:column;align-items:flex-start;gap:2px}'),'global mobile section-title collision guard missing');
must(css.includes('.forecast-focus-head{display:grid;grid-template-columns:1fr;gap:6px}'),'Forecast focus narrow-screen stack missing');
must(css.includes('.market-regime{display:grid;grid-template-columns:1fr;gap:6px;align-items:start}'),'Market regime narrow-screen stack missing');
must(css.includes('.scanner-summary{grid-template-columns:repeat(2,minmax(0,1fr))}'),'Scanner summary 2x2 phone layout missing');
must(css.includes('html{scroll-padding-top:72px;scroll-padding-bottom:calc(96px + env(safe-area-inset-bottom))}'),'mobile scroll safe-area padding missing');


/* r83 permanent visual-QA gates */
must(String(release.dashboardShell||'').includes('VISUAL-QA-HARNESS'),'dashboardShell must declare visual QA harness');
must(v9.includes("const LOCAL_VISUAL_QA=['127.0.0.1','localhost'].includes(location.hostname)"),'visual QA network freeze must remain localhost-only');
must(js.includes('function localVisualQaConfig()'),'local visual QA config missing');
must(js.includes("if(!['127.0.0.1','localhost'].includes(location.hostname))return null"),'visual QA fixture must remain localhost-only');
must(js.includes("allowed=['command','depot','bots','market','research','asset-detail','paper']"),'visual QA primary/secondary view coverage missing');
must(js.includes("fibUi.mode='MANUAL'"),'visual QA deterministic FIB fixture missing');
must(js.includes('function writeLocalVisualQaReport(cfg)'),'visual QA layout report missing');
must(js.includes('bodyOverflow:root.scrollWidth>innerWidth+2'),'visual QA body overflow gate missing');
must(js.includes('shortButtons'),'visual QA touch-target gate missing');
must(fs.existsSync('scripts/v10-visual-qa.mjs'),'visual QA runner missing');
must(fs.existsSync('.github/workflows/v10-visual-qa.yml'),'visual QA workflow missing');


/* r84 permanent evidence-layout gates */
must(String(release.dashboardShell||'').includes('EVIDENCE-LAYOUT-INVARIANTS'),'dashboardShell must declare evidence layout invariants');
must(js.includes('const scannerActionsSameRow='),'visual QA scanner same-row invariant missing');
must(js.includes('layout={scannerActionsSameRow'),'visual QA layout evidence payload missing');
must(js.includes('layout.scannerActionsSameRow&&')&&js.includes('!report.bodyOverflow'),'visual QA same-row invariant must gate pass/fail');
must(js.includes("updatedAt:new Date(now).toISOString(),snapshotAt:new Date(now).toISOString(),walletStatus:'OK'"),'visual QA account fixture must be timestamped and fresh');
must(css.includes('#view-research .scanner-toolbar-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;width:100%!important'),'mobile Scanner actions must remain a two-column evidence-locked grid');
must(css.includes('#view-research .scanner-toolbar-actions>button{width:100%!important;min-width:0!important;min-height:44px!important'),'Scanner action touch-target evidence guard missing');


/* r85 permanent occlusion gates */
must(String(release.dashboardShell||'').includes('VISUAL-QA-OCCLUSION'),'dashboardShell must declare visual QA occlusion');
must(js.includes('const commandHubCards='),'Command Hub visual invariant missing');
must(js.includes('const botSummaries='),'Bot accordion visual invariant missing');
must(js.includes('const forecastFibInvariant='),'Forecast/FIB visual invariant missing');
must(js.includes('const nearBottom=scrollY+innerHeight>=root.scrollHeight-4'),'bottom-state detector missing');
must(js.includes('const navCandidates=nearBottom?'),'bottom-nav occlusion candidate scan missing');
must(js.includes('navOcclusions'),'bottom-nav occlusion evidence missing');
must(js.includes('layout.bottomClearance&&layout.navEndClearance&&!report.bodyOverflow'),'bottom + nav-end clearance must gate visual QA pass/fail');
must(/report\.ok=[^;\n]*layout\.commandHubInvariant[^;\n]*layout\.degradedPriorityInvariant[^;\n]*layout\.botAccordionInvariant[^;\n]*layout\.forecastFibInvariant[^;\n]*layout\.secondaryViewInvariant[^;\n]*layout\.partialValueParity/.test(js),'view structural invariants must gate visual QA');
must(qa.includes("['command-bottom','command',6000]"),'Command bottom evidence capture missing');
must(qa.includes("['bots-bottom','bots',6000]"),'Bots bottom evidence capture missing');
must(qa.includes("['forecast-fib','market',1050]"),'Forecast FIB evidence capture missing');
must(qa.includes("['forecast-bottom','market',6000]"),'Forecast bottom evidence capture missing');
must(qa.includes("['scanner-bottom','research',6000]"),'Scanner bottom evidence capture missing');
must(js.includes('function visualQaVisible(el)'),'visibility-aware visual QA helper missing');
must(js.includes("node.tagName==='DETAILS'&&!node.open"),'closed-details visibility exclusion missing');
must(js.includes(".filter(visualQaVisible):[]"),'nav occlusion scan must ignore hidden details content');


/* r86 permanent interaction-QA gates */
must(String(release.dashboardShell||'').includes('INTERACTION-QA'),'dashboardShell must declare interaction QA');
must(js.includes("flows=['primary-reset','asset-return','bot-toggle'"),'interaction QA core flow allowlist missing');
must(js.includes('async function runLocalInteractionQa(cfg)'),'interaction QA runner missing');
must(js.includes("$('#nav button[data-v=\"bots\"]')?.click()"),'primary navigation interaction probe missing');
must(js.includes("$('#view-depot [data-asset-detail]')"),'Asset Detail drill-down interaction probe missing');
must(js.includes("$('#view-asset-detail [data-context-back=\"asset-detail\"]')"),'contextual back interaction probe missing');
must(js.includes("$('#view-bots [data-assets-action=\"close\"]')"),'Bot close-all interaction probe missing');
must(js.includes("$('#view-bots [data-assets-action=\"open\"]')"),'Bot open-all interaction probe missing');
must(qa.includes("['flow-primary-reset','command',900,'primary-reset']"),'primary reset browser evidence case missing');
must(qa.includes("['flow-asset-return','depot',700,'asset-return']"),'asset return browser evidence case missing');
must(qa.includes("['flow-bot-toggle','bots',0,'bot-toggle']"),'bot toggle browser evidence case missing');


/* r87 permanent state-continuity gates */
must(String(release.dashboardShell||'').includes('STATE-CONTINUITY-QA'),'dashboardShell must declare state continuity QA');
must(js.includes("'bot-filter-return','scanner-forecast-return'"),'state-continuity QA flow allowlist missing');
must(js.includes("cfg.flow==='bot-filter-return'"),'Bot filter continuity interaction flow missing');
must(js.includes("checks.filterRetained=botViewUi.filter==='RISK'"),'Bot filter return-state check missing');
must(js.includes("checks.sessionFilterRetained=String(saved.botFilter||'').toUpperCase()==='RISK'"),'Bot filter session continuity check missing');
must(js.includes("cfg.flow==='scanner-forecast-return'"),'Scanner to Forecast continuity flow missing');
must(js.includes("checks.assetSelected=!!target&&fibUi.symbol===target"),'Forecast selected-asset continuity check missing');
must(js.includes("checks.sessionAssetRetained=String(saved.fibSymbol||'').toUpperCase()===target"),'Forecast asset session continuity check missing');
must(js.includes("checks.scannerRestored=activeViewKey()==='research'"),'Scanner contextual return check missing');
must(qa.includes("['flow-bot-filter-return','bots',0,'bot-filter-return']"),'Bot filter continuity evidence case missing');
must(qa.includes("['flow-scanner-forecast-return','research',520,'scanner-forecast-return']"),'Scanner Forecast continuity evidence case missing');


/* r88 permanent data-resilience QA gates */
must(String(release.dashboardShell||'').includes('DATA-RESILIENCE-QA'),'dashboardShell must declare data resilience QA');
must(js.includes("dataModes=['fresh','stale','error']"),'visual QA data-mode allowlist missing');
must(js.includes("flows=['primary-reset','asset-return','bot-toggle','bot-filter-return','scanner-forecast-return','stale-recovery']"),'stale recovery QA flow missing');
must(js.includes('function setLocalVisualQaDataMode(mode,s=S(),now=Date.now())'),'QA data-state mutator missing');
must(js.includes("mode==='stale'")&&js.includes("mode==='error'"),'stale/error QA fixtures missing');
must(js.includes("dataStateInvariant=cfg.dataMode==='stale'"),'data-state resilience invariant missing');
must(js.includes("cfg.flow==='stale-recovery'"),'stale recovery interaction flow missing');
must(js.includes("checks.failClosedBefore=!!$('#view-command .blocked-critical')"),'fail-closed stale guard check missing');
must(js.includes("checks.botRecovered=after.BOTS==='READY'"),'Bot recovery check missing');
must(js.includes("checks.marketRecovered=after.MARKET==='READY'"),'Market recovery check missing');
must(qa.includes("['data-command-stale','command',0,null,'stale']"),'stale Command evidence case missing');
must(qa.includes("['data-bots-error','bots',0,null,'error']"),'error Bots evidence case missing');
must(qa.includes("['flow-stale-recovery','command',0,'stale-recovery','stale']"),'stale recovery evidence case missing');


/* r89 permanent visual-QA parameter forwarding gates */
must(String(release.dashboardShell||'').includes('VISUAL-QA-PARAM-FORWARDING'),'dashboardShell must declare visual QA parameter forwarding');
must(qaFrame.includes("const inner=new URL('./',location.href)"),'visual QA frame must build inner dashboard URL explicitly');
must(qaFrame.includes("for(const key of ['qaFlow','qaData'])"),'visual QA frame must forward flow and data-mode parameters');
must(qaFrame.includes("if(value)inner.searchParams.set(key,value)"),'visual QA frame parameter forwarding assignment missing');
must(qaFrame.includes("frame.src=inner.pathname+inner.search"),'visual QA frame must use forwarded inner URL');
must(qa.includes("if(flow)url.searchParams.set('qaFlow',flow)"),'visual QA runner must emit qaFlow');
must(qa.includes("if(dataMode)url.searchParams.set('qaData',dataMode)"),'visual QA runner must emit qaData');

must(js.includes("if(!force&&$('.asset-detail-topbar',view))return"),'Asset Detail must be idempotent under mutation-only decorate passes');
must(js.includes('data-asset-back data-context-back="asset-detail"'),'Asset Detail contextual-back QA selector must exist in rendered markup');

must(js.includes("botErrorSurfaceInvariant=cfg.view!=='bots'||cfg.dataMode!=='error'||!!active.querySelector('.bot-live-blocked')"),'Bots ERROR visual QA must require visible fail-closed surface');
must(js.includes("if(cfg.view==='bots'&&cfg.dataMode==='error')botAccordionInvariant=botErrorSurfaceInvariant"),'Bots ERROR state must replace accordion requirement with error-surface requirement');


/* r90 permanent Command progressive-disclosure gates */
must(String(release.dashboardShell||'').includes('COMMAND-PROGRESSIVE-DISCLOSURE'),'dashboardShell must declare Command progressive disclosure');
must(js.includes('function dataGuardCard(compact=false)'),'Data Guard compact/full contract missing');
must(js.includes('function walletDiscoveryLayer(){return walletDiscoveryLayerMode(false)}'),'Wallet discovery full contract missing');
must(js.includes('function walletDiscoveryLayerCompact(){return walletDiscoveryLayerMode(true)}'),'Wallet discovery compact contract missing');
must(js.includes('guard.innerHTML=dataGuardCard(true)'),'Command must use compact Data Guard');
must(js.includes('wallet.innerHTML=walletDiscoveryLayerCompact()'),'Command must use compact Wallet discovery');
must(js.includes('command-next-decision command-next-action-open'),'Next Action critical-asset drilldown missing');
must(!js.includes('class="command-hub-card command-hub-critical'),'duplicate Command critical-asset card must stay removed');
must(css.includes('.v10-command-tech-details>summary'),'Command technical disclosure styling missing');
must(css.includes('min-height:44px'),'touch target floor missing');


/* r91 permanent Command top-fold clarity gates */
must(String(release.dashboardShell||'').includes('COMMAND-TOP-FOLD-CLARITY'),'dashboardShell must declare Command top-fold clarity');
must(js.includes('function commandHealthSummary()'),'Command health summary missing');
must(js.includes("const dataReady=br.label==='READY'&&mr.label==='READY'"),'Command data health must stay independent from portfolio authority');
must(js.includes("chip('DATA',h.data)"),'Command DATA health chip missing');
must(js.includes('function commandDataDisclosure()'),'Command source disclosure renderer missing');
must(js.includes('source.innerHTML=commandDataDisclosure()'),'Command source details must be collapsed by default');
must(css.includes('.command-source-details>summary'),'Command source disclosure styling missing');


/* r92 permanent Command decision-flow gates */
must(String(release.dashboardShell||'').includes('COMMAND-DECISION-FLOW'),'dashboardShell must declare Command decision flow');
must(js.includes('function commandAttentionHtml()'),'Command Attention standalone renderer missing');
must(js.includes("attentionWrap.innerHTML=commandAttentionHtml()"),'Command Attention must render after Next/Open');
must(js.includes("hubNode.insertAdjacentElement('afterend',attentionNode)"),'Command Attention ordering must follow Next/Open');
must(js.includes('command-position-details'),'Command Account Futures disclosure missing');
must(css.includes('.command-position-details>summary'),'Command Account Futures disclosure styling missing');

must(qa.includes("virtualBudget=name.startsWith('flow-')?8000:2600"),'interaction visual QA flow budget must cover iframe settle window');
must(qaFrame.includes('if(tries<600)setTimeout(pump,20);'),'visual QA iframe pump must outlive interaction flow budget');


/* r93 permanent dominant portfolio-chart gates */
must(String(release.dashboardShell||'').includes('COMMAND-PORTFOLIO-CHART-1H-1D-1W'),'dashboardShell must declare Command portfolio chart');
must(js.includes("const portfolioChartUi={range:'1d'}"),'portfolio chart default range missing');
must(js.includes("PORTFOLIO_CHART_WINDOWS=Object.freeze({ '1h':60*60*1000,'1d':24*60*60*1000,'1w':7*24*60*60*1000 })"),'portfolio chart windows missing');
must(js.includes("String(x?.sourceStatus?.spot||'')==='STRICT_AUTHORITY'"),'portfolio chart must use strict authority history only');
must(js.includes('function portfolioChartHeroHtml()'),'portfolio chart hero renderer missing');
must(js.includes('function bindCommandPortfolioHero(view)'),'portfolio chart range binding missing');
must(js.includes("portfolioBox.innerHTML=portfolioChartHeroHtml()"),'portfolio chart must render into Command top fold');
must(js.includes("bindCommandPortfolioHero(view)"),'portfolio chart controls must be bound');
must(css.includes('.command-portfolio-hero'),'dominant portfolio hero styling missing');
must(css.includes('.portfolio-range-switch button'),'portfolio range controls styling missing');
must(css.includes('.portfolio-chart-line'),'portfolio chart line styling missing');


/* r94 permanent portfolio-authority/history gates */
must(String(release.dashboardShell||'').includes('PORTFOLIO-AUTHORITY-SERVER-HISTORY'),'dashboardShell must declare server portfolio authority history');
must(gateway.includes('u.pathname==="/api/private/portfolio-authority"'),'portfolio authority endpoint missing');
must(gateway.includes('reconcilePortfolioAuthority(current,body)'),'portfolio authority endpoint must use limited reconciler');
must(gateway.includes('capturePortfolioHistoryOnce({db:pool(),data:merged.data,dedupeMs:0})'),'portfolio authority update must attempt immediate history capture');
must(authorityUpdate.includes("action==='confirm_ledger'"),'Ledger confirmation action missing');
must(authorityUpdate.includes("action==='set_okx'"),'OKX authority action missing');
must(historyStore.includes("externalVenueExpectedVenues:hasLedgerHoldings?['OKX']:['Ledger','OKX']"),'history must use Ledger holdings as required venue authority');
must(historyStore.includes("requiredHoldingVenues:hasLedgerHoldings?['Ledger']:[]"),'history Ledger required-holding contract missing');
must(v9.includes("postJson('/api/private/portfolio-authority',{action:'confirm_ledger'})"),'client Ledger authority server sync missing');
must(v9.includes("postJson('/api/private/portfolio-authority',{action:'set_okx',valueUsd:value})"),'client OKX authority server sync missing');


/* r95 permanent portfolio-history bootstrap UX gates */
must(String(release.dashboardShell||'').includes('PORTFOLIO-HISTORY-BOOTSTRAP-UX'),'dashboardShell must declare portfolio history bootstrap UX');
must(js.includes("storedPoints===0?(ready?'STARTPUNKT WIRD GESPEICHERT'"),'zero-point portfolio history state missing');
must(js.includes("storedPoints===1?'1. MESSPUNKT GESPEICHERT · KURVE STARTET MIT DEM NÄCHSTEN'"),'one-point portfolio history bootstrap state missing');
must(js.includes('portfolio-history-progress'),'portfolio history bootstrap progress missing');
must(css.includes('.portfolio-history-progress'),'portfolio history progress styling missing');


/* r96 permanent Command portfolio-hero cleanup gates */
must(String(release.dashboardShell||'').includes('COMMAND-PORTFOLIO-HERO-CLEANUP'),'dashboardShell must declare Command portfolio hero cleanup');
must(js.includes('class="portfolio-venue-strip"'),'portfolio venue split missing from dominant hero');
must(js.includes("sourceCard('LEDGER'"),'Ledger venue card missing');
must(js.includes("sourceCard('OKX'"),'OKX venue card missing');
must(js.includes("sourceCard('PIONEX'"),'Pionex venue card missing');
must(js.includes("okxVenueSource||'SERVER_PORTFOLIO_AUTHORITY'"),'OKX server authority provenance missing in hero');
must(v9.includes('okxVenueSource:okxVenue?.source||null'),'portfolio model must expose OKX authority source');
must(!v9.includes("'LOCAL REF · '+okxAge"),'stale LOCAL REF label must remain removed');
must(js.includes('function commandSystemDiagnostics()'),'collapsed Command system diagnostics missing');
must(js.includes("details.className='command-system-diagnostics command-diagnostics'"),'Command system diagnostics disclosure missing');
must(js.includes("const guard=document.createElement('div');guard.innerHTML=dataGuardCard(true)"),'compact Data Guard must remain inside Command diagnostics');
must(js.includes("const wallet=document.createElement('div');wallet.innerHTML=walletDiscoveryLayerCompact()"),'compact wallet diagnostics must remain inside Command diagnostics');
must(css.includes('#view-command .data-state-items{grid-template-columns:repeat(3,minmax(0,1fr))'),'Command data-state compact row missing');
must(css.includes('#view-command .command-source-authority>.source-grid'),'duplicate authority source grid cleanup missing');
must(css.includes('.command-system-diagnostics>summary'),'Command system diagnostics touch surface missing');


/* r97 permanent Depot overview-density gates */
must(String(release.dashboardShell||'').includes('DEPOT-OVERVIEW-DENSITY'),'dashboardShell must declare Depot overview density');
must(js.includes("<span>GESAMTPORTFOLIO</span>"),'Depot canonical portfolio total label missing');
must(/const okxSource=String\(p\.okxVenueSource\|\|'SERVER_PORTFOLIO_AUTHORITY'\)\.includes\('SERVER'\)\?'SERVER AUTH':'AUTHORITY'/.test(js),'Depot OKX authority provenance missing');
must(js.includes('class="depot-accounting-details"'),'Depot accounting disclosure missing');
must(js.includes("rows.map(row=>depotAssetCard(row,had?openAssets.has(row.symbol):false))"),'Depot assets must default closed while preserving open state');
must(css.includes('#view-depot .data-state-items{grid-template-columns:repeat(2,minmax(0,1fr))'),'Depot compact two-column data state missing');
must(css.includes('.depot-accounting-details>summary'),'Depot accounting disclosure styling missing');
must(css.includes('#view-depot .depot-asset-card>summary{min-height:58px'),'Depot compact asset summary target missing');


/* r98 permanent Bots overview-density gates */
must(String(release.dashboardShell||'').includes('BOTS-OVERVIEW-DENSITY'),'dashboardShell must declare Bots overview density');
must(js.includes("liveCards=syms.map(symbol=>pairCard(symbol,false,hadAssetAccordion?openAssets.has(symbol):false,true))"),'Bots asset cards must default closed while preserving explicit open state');
must(js.includes("const riskCount=allSyms.filter(symbol=>botFilterMatch(symbol,'RISK')).length"),'Bots risk-count summary missing');
must(js.includes("profitCount=allSyms.filter(symbol=>botFilterMatch(symbol,'PROFIT')).length"),'Bots profit-count summary missing');
must(js.includes("hedgeCount=allSyms.filter(symbol=>botFilterMatch(symbol,'HEDGE')).length"),'Bots hedge-count summary missing');
must(js.includes("<small>RISIKO '+riskCount+' · PROFIT '+profitCount+' · HEDGE '+hedgeCount"),'Bots filter-count summary missing');
must(css.includes('#view-bots .data-state-items{grid-template-columns:repeat(2,minmax(0,1fr))'),'Bots compact data-state row missing');
must(css.includes('#view-bots .asset-pair-details>summary{min-height:60px'),'Bots compact asset summary missing');
must(css.includes('#view-bots .bot-filter-actions{width:100%;grid-template-columns:repeat(4,minmax(0,1fr))'),'Bots four-filter mobile row missing');


/* r99 permanent Forecast overview-density gates */
must(String(release.dashboardShell||'').includes('FORECAST-OVERVIEW-DENSITY'),'dashboardShell must declare Forecast overview density');
must(js.includes('function renderMarket(force=false)'),'Forecast renderer missing');
must(js.includes('const techOpen=!mh.fresh||!mh.coverageComplete||!mh.priceFresh'),'Forecast fail-visible tech disclosure guard missing');
must(js.includes('class="market-tech-details"'),'Forecast market-tech disclosure missing');
must(js.includes('const tapeOpen=mh.staleAssets>0||mh.missingAssets>0'),'Forecast Asset Tape degraded-coverage guard missing');
must(js.includes('class="market-tape-details"'),'Forecast Asset Tape disclosure missing');
must(js.includes("forecastContextHtml(fibUi.symbol)+technical+fibMapHtml()+tape"),'Forecast primary surface ordering missing');
must(css.includes('#view-market .data-state-items{grid-template-columns:1fr'),'Forecast compact data state missing');
must(css.includes('.market-tech-details>summary,.market-tape-details>summary'),'Forecast disclosure touch surface missing');
must(css.includes('#view-market .forecast-focus-head b{font-size:18px'),'Forecast dominant focus typography missing');


/* r99 QA determinism guard */
{
  const a=js.indexOf("}else if(cfg.flow==='bot-toggle'){"),b=js.indexOf("}else if(cfg.flow==='bot-filter-return'){",a),block=js.slice(a,b);
  must(a>=0&&b>a,'bot-toggle visual QA block missing');
  must(!block.includes('await visualQaSettle()'),'bot-toggle visual QA must not depend on RAF after synchronous details mutation');
}


/* r100 permanent Scanner priority-surface gates */
must(String(release.dashboardShell||'').includes('SCANNER-PRIORITY-SURFACE'),'dashboardShell must declare Scanner priority surface');
must(js.includes('function scannerLeaderCard(symbol)'),'Scanner leader renderer missing');
must(js.includes('TOP MARKET CONTEXTS · PRIORITY 1'),'Scanner top-context label missing');
must(js.includes("top=fresh.slice(0,4),leader=top[0]||null,next=top.slice(1,3),rest=[...top.slice(3),...fresh.slice(4)]"),'Scanner leader/next/remainder partition missing');
must(js.includes("leaderHtml=leader?scannerLeaderCard(leader)"),'Scanner leader composition missing');
must(js.includes('NÄCHSTE KONTEXTE'),'Scanner next-context surface missing');
must(js.includes("Quality ist Markt-Kontext, keine Renditeprognose"),'Scanner context disclaimer missing');
must(css.includes('#view-research .data-state-items{grid-template-columns:repeat(2,minmax(0,1fr))'),'Scanner compact data state missing');
must(css.includes('.scanner-leader-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))'),'Scanner leader metric grid missing');
must(css.includes('#view-research .scan-drill-actions{grid-template-columns:repeat(2,minmax(0,1fr))'),'Scanner mobile dual-action layout missing');


/* r101 permanent mobile shell-density gates */
must(String(release.dashboardShell||'').includes('MOBILE-SHELL-DENSITY'),'dashboardShell must declare mobile shell density');
must(css.includes('/* v10 r101 · global mobile shell density */'),'r101 mobile shell density styles missing');
must(css.includes('grid-template-columns:44px auto'),'mobile topbar action layout missing');
must(css.includes('.feed-refresh span{display:none}'),'mobile refresh label suppression missing');
must(css.includes('min-height:44px'),'44px touch invariant missing');
must(css.includes('grid-template-columns:repeat(2,auto)'),'mobile status row missing');
must(css.includes('nav button.active::before'),'mobile active-nav cue missing');
must(css.includes('padding-bottom:calc(5px + env(safe-area-inset-bottom))'),'mobile nav safe-area padding missing');
must(css.includes('@media(max-width:350px)'),'narrow mobile shell fallback missing');


/* r102 permanent live-history integrity gates */
must(String(release.dashboardShell||'').includes('LIVE-HISTORY-INTEGRITY'),'dashboardShell must declare live/history integrity');
must(js.includes('function portfolioHistoryIntegrityHtml()'),'portfolio history integrity renderer missing');
must(js.includes('class="portfolio-integrity-strip"'),'portfolio integrity strip missing');
must(js.includes('data-history-points='),'strict history point telemetry missing');
for(const key of ['1h','1d','1w'])must(js.includes("rangeCard('"+key+"')"),'history integrity range missing: '+key);
must(js.includes('data-history-ready='),'history readiness telemetry missing');
must(js.includes('STRICT HISTORY'),'strict history integrity label missing');
must(js.includes('portfolioHistoryIntegrityHtml()+chart'),'integrity strip must stay adjacent to portfolio chart');
must(css.includes('/* v10 r102 · live + history integrity */'),'r102 history-integrity CSS block missing');
must(css.includes('.portfolio-integrity-strip{'),'portfolio integrity layout missing');
must(css.includes('.portfolio-integrity-range.tone-safe'),'history READY tone missing');


/* r103 Scanner confluence explainability gates */
must(js.includes('function scannerConfluenceHtml(symbol){'),'r103 Scanner confluence renderer missing');
must(js.includes('WHY NOW?'),'r103 Why Now label missing');
must(js.includes('kein zusätzlicher Score'),'r103 no-new-score disclosure missing');
must(js.includes('BULL/BEAR CONFLICT'),'r103 conflict warning missing');
must(js.includes('FIB WEITER ENTFERNT'),'r103 FIB counter-signal missing');
must(js.includes('scannerConfluenceHtml(symbol)'),'r103 confluence must be composed into Scanner leader');
must(css.includes('/* v10 r103 · Scanner confluence explainability */'),'r103 Scanner confluence CSS missing');


/* r104 permanent portfolio-history component-integrity gates */
must(String(release.dashboardShell||'').includes('PORTFOLIO-HISTORY-COMPONENT-INTEGRITY'),'dashboardShell must declare portfolio history component integrity');
must(String(release.dashboardConsistency||'').includes('CANONICAL-PORTFOLIO-HISTORY-V'),'dashboard consistency must declare canonical history version');
must(historyStore.includes('tradingAuthority'),'history writer must inspect Pionex equity authority');
must(historyStore.includes('spotAuthorityComplete=base?.spotAuthority?.complete===true'),'history Spot authority component missing');
must(historyStore.includes('tradingAuthorityComplete=tradingAuthority?.found===true'),'history Pionex authority component missing');
must(historyStore.includes('authorityComplete=spotAuthorityComplete&&tradingAuthorityComplete'),'history completeness must require both components');
must(historyStore.includes('canonicalHistoryPointComplete'),'canonical history point completeness filter missing');
must(historyStore.includes("spotStatus==='STRICT_AUTHORITY'&&tradingStatus==='PIONEX_EQUITY'"),'history read filter must require Spot + Pionex authority');
must(historyStore.includes('excludedIncompletePoints'),'history API must expose excluded incomplete count');
must(js.includes('portfolioHistoryTradingAuthorityFresh'),'UI history guard must require Pionex equity authority');
must(js.includes('excludedIncompletePoints'),'UI must expose blocked legacy point count');


/* r105 permanent Pionex history source-alignment gates */
must(String(release.dashboardShell||'').includes('PIONEX-HISTORY-SOURCE-ALIGNMENT'),'dashboardShell must declare Pionex history source alignment');
must(String(release.dashboardConsistency||'').includes('CANONICAL-PORTFOLIO-HISTORY-V3'),'dashboard consistency must declare history V3');
must(contract.includes('export function authoritativePionexEquitySnapshot'),'authoritative Pionex equity resolver missing');
must(contract.includes("source:'PIONEX_WALLET_READ_API'"),'fresh wallet API source path missing');
must(contract.includes('PIONEX_EQUITY_AUTHORITY_MAX_AGE_MS=15*60*1000'),'Pionex freshness window missing');
must(historyStore.includes('authoritativePionexEquitySnapshot(strictData,timestamp)'),'history writer must use authoritative Pionex resolver');
must(historyStore.includes("tradingAuthorityVersion:tradingAuthorityComplete?'PIONEX_FRESH_V1':'MISSING'"),'history provenance version missing');
must(historyStore.includes('tradingUpdatedAt:tradingAuthority?.updatedAt||null'),'history Pionex timestamp provenance missing');
must(historyStore.includes("authorityVersion==='PIONEX_FRESH_V1'"),'history reader must reject pre-r105 provenance');
must(js.includes('function portfolioHistoryTradingAuthorityFresh(x){'),'client history freshness guard missing');
must(js.includes('SPOT + FRESH PIONEX'),'history integrity UI must disclose fresh Pionex requirement');
must(v9.includes('authoritativePionexEquitySnapshot(d,now)'),'live portfolio must share authoritative Pionex resolver');


/* r106 permanent market freshness lifecycle gates */
must(String(release.dashboardShell||'').includes('MARKET-FRESHNESS-LIFECYCLE'),'dashboardShell must declare market freshness lifecycle');
must(marketFeed.includes("const MARKET_STALE_FALLBACK_MS=90*1000;"),'gateway stale fallback reserve must remain below decision freshness boundary');
must(v9.includes("marketSyncStatus:'IDLE'"),'market sync lifecycle state missing');
must(v9.includes("state.marketSyncStatus='RUNNING';state.marketSyncStartedAt=Date.now();notifyData()"),'market sync start lifecycle missing');
must(v9.includes("state.marketSyncStatus=btcRows?(errors.length?'PARTIAL':'OK'):'ERROR'"),'market sync completion lifecycle missing');
must(v9.includes("gatewayCache==='STALE_FALLBACK'&&gatewayAge!=null&&gatewayAge>90*1000"),'client stale-fallback reserve guard missing');
must(js.includes("if(m.syncing)return{label:'SYNCING',tone:'watch'}"),'UI must distinguish SYNCING from STALE');
must(js.includes('Technischer Markt-Refresh läuft; alter Stand bleibt fail-closed'),'header sync lifecycle disclosure missing');
must(js.includes("if(g.safetyReady>0)return{label:'SAFETY',tone:'watch'}"),'BOT SAFETY fail-closed state must remain intact');


/* r107 permanent market coverage diagnostics gates */
must(String(release.dashboardShell||'').includes('MARKET-COVERAGE-DIAGNOSTICS'),'dashboardShell must declare market coverage diagnostics');
must(js.includes('function compactMarketSymbols(rows=[],limit=6){'),'market coverage compact-symbol helper missing');
must(js.includes('function marketCoverageIssueText(m){'),'market coverage issue formatter missing');
must(js.includes('freshSymbols=rows.filter(x=>intelFresh(x.intel)).map(x=>x.symbol)'),'fresh market symbol telemetry missing');
must(js.includes('staleSymbols=rows.filter(x=>!!x.intel&&!intelFresh(x.intel)).map(x=>x.symbol)'),'stale market symbol telemetry missing');
must(js.includes('missingSymbols=rows.filter(x=>!x.intel).map(x=>x.symbol)'),'missing market symbol telemetry missing');
must(js.includes("parts.push('STALE '+compactMarketSymbols(m.staleSymbols))"),'stale-symbol disclosure missing');
must(js.includes("parts.push('MISSING '+compactMarketSymbols(m.missingSymbols))"),'missing-symbol disclosure missing');
must(js.includes("SYNC '+esc(m.syncStatus)"),'market sync-status disclosure missing');
must(js.includes("if(m.syncing)return{label:'SYNCING',tone:'watch'}"),'market SYNCING readiness invariant changed');
must(js.includes("if(m.fresh&&m.coverageComplete)return{label:'READY',tone:'safe'}"),'market READY coverage invariant changed');
must(js.includes("if(g.safetyReady>0)return{label:'SAFETY',tone:'watch'}"),'BOT SAFETY fail-closed invariant changed');


/* r108 permanent Paper readiness prefetch gates */
must(String(release.dashboardShell||'').includes('PAPER-READINESS-PREFETCH'),'dashboardShell must declare Paper readiness prefetch');
must(js.includes("paperCockpitUi={loading:false,data:null,error:null,loadedAt:0,prefetchStarted:false}"),'Paper prefetch lifecycle state missing');
must(js.includes('function primePaperCockpit(){'),'Paper prefetch helper missing');
must(js.includes('if(paperCockpitUi.prefetchStarted)return'),'Paper prefetch one-shot guard missing');
must(js.includes('queueMicrotask(()=>loadPaperCockpit(false))'),'Paper prefetch microtask missing');
must(js.includes("if(!paperOverviewTrusted(d))throw new Error('PAPER_OVERVIEW_CONTRACT_INVALID')"),'Paper Overview trust guard missing');
must(js.includes("schedule(true)"),'Paper readiness lifecycle must schedule UI refresh');
must(v9.includes("paperOverview:()=>getJson('/api/paper/overview')"),'Paper Overview bridge must remain GET-only');
must(!/setInterval\([^\n]*loadPaperCockpit/.test(js),'Paper readiness must not introduce a polling loop');
must(js.includes("d.researchOnly===true")&&js.includes("d.executionImpact===false"),'Paper research-only execution-neutral guard missing');


/* r109 permanent screenshot-integrity gates */
must(String(release.dashboardShell||'').includes('SCREENSHOT-INTEGRITY-NULL-AUTHORITY-HISTORY-PRICE-PRECISION'),'dashboardShell must declare r109 screenshot integrity');
must(js.includes('function knownNumber(v){'),'known-number null guard missing');
must(js.includes("p.complete!==true||current==null||current<0"),'history delta must fail closed on incomplete portfolio authority');
must(js.includes('points=strictPortfolioHistoryPoints()'),'history delta must use strict validated history only');
must(js.includes('const sourceMoney=v=>knownNumber(v)?'),'venue source cards must not coerce null authority to zero');
must(js.includes('historyStale=!m.currentIncluded'),'stale chart date-label guard missing');
must(js.includes('<span>WALLET <b>'),'Depot compact asset value must be labelled as wallet detail, not total holding');
must(js.includes('const p=portfolioReadiness()'),'Command health must consume canonical portfolio readiness');
must(js.includes("p.label==='BLOCKED'"),'Command health must preserve blocked portfolio authority');
must(js.includes('function precisePrice(v){'),'sub-dollar price precision helper missing');

must(js.includes("deltaAvailable=series.currentIncluded&&delta!=null&&startCovered&&endCovered"),'chart delta must require current canonical total');
must(js.includes('AKTUELLER TOTAL FEHLT · NUR VALIDIERTE HISTORIE'),'missing current total must be explicit beside history chart');
must(js.includes("venue:'Pionex Wallet',source:'READ API BALANCE'"),'Pionex balance residue provenance must be wallet-specific');
must(js.includes('<span>WALLET DETAIL</span>'),'missing asset-detail fallback must use wallet wording');


/* r111 permanent portfolio partial / paused-history gates */
must(String(release.dashboardShell||'').includes('PORTFOLIO-PARTIAL-KNOWN-VALUE-HISTORY-PAUSED-SEMANTICS'),'r111 dashboardShell marker missing');
must(js.includes("label='PAUSED'"),'paused portfolio history state missing');
must(js.includes('BEKANNTER TEILWERT'),'known partial portfolio disclosure missing');
must(js.includes('NICHT GESAMTPORTFOLIO'),'partial portfolio disclaimer missing');
must(js.includes('VERLAUF PAUSIERT · PORTFOLIO AUTHORITY FEHLT'),'paused history explanation missing');
