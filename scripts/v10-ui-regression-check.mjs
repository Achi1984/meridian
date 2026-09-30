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
must(js.includes('<span>HOLDING <b>'),'Depot holding-value label missing');
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
must(js.includes("allowed=['command','depot','bots','market','research']"),'visual QA top-level view coverage missing');
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
must(js.includes('layout.bottomClearance&&!report.bodyOverflow'),'bottom clearance must gate visual QA pass/fail');
must(js.includes('layout.commandHubInvariant&&layout.botAccordionInvariant&&layout.forecastFibInvariant'),'view structural invariants must gate visual QA');
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
