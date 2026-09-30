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
