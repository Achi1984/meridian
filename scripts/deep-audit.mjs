import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const failures=[];
const warnings=[];
const pass=[];
const check=(ok,msg)=>{(ok?pass:failures).push(msg)};
const warn=(ok,msg)=>{if(!ok)warnings.push(msg)};

const release=json('version.json');
const version=String(release.version||'');
const build=String(release.buildId||'');
const index=read('index.html');
const loader=read('app-v6.06.js');
const uiPolish=read('app-v7.37-ui-polish.js');
const finalUi=read('app-v7.60-final-ui-authority.js');
const hardening=read('app-v7.33-hardening.js');
const gateway=read('server-gateway.js');
const startGateway=read('scripts/start-gateway.mjs');
const data=json('data.json');
const server=read('server.js');

check(version==='7.60','release version is 7.60');
check(index.includes(`MERIDIAN_RELEASE_VERSION='${version}'`),'index release version matches version.json');
check(index.includes(`MERIDIAN_RELEASE_BUILD='${build}'`),'index build matches version.json');
check(index.includes('function depot(){'),'canonical inline renderer contains depot view');
check(index.includes('function portfolioIntelligencePanel(){'),'canonical inline render engine is present');
check(!loader.includes('app-v7.32-legacy.js'),'retired v7.32 diagnostic layer is not loaded');
check(loader.includes('app-v7.60-final-ui-authority.js'),'canonical loader includes final UI authority');
check(loader.lastIndexOf('app-v7.60-final-ui-authority.js')>loader.lastIndexOf('app-v7.60-private-hydration-hotfix.js'),'final UI authority loads after private hydration');
check(!/emergency-input-hotfix|nav-hotfix|unlock-hotfix/.test(loader),'obsolete hotfix layers are not loaded');
check(!loader.includes('document.write'),'canonical loader never injects modules during parser execution');
check(loader.includes("window.addEventListener('load'")&&loader.includes('async function start()'),'canonical modules are deferred until legacy inline runtime has finished');
check(loader.includes("data-meridian-canonical-ready"),'canonical loader exposes ready state for runtime diagnosis');

check(fs.existsSync('assets/achi-meridian-topbar.webp'),'approved topbar logo asset exists');
check(uiPolish.includes('assets/achi-meridian-topbar.webp'),'topbar uses approved ACHI MERIDIAN logo asset');
check(uiPolish.includes('.bottom .inner.five-tabs'),'five-tab legacy specificity is explicitly overridden');
check(uiPolish.includes('repeat(6,minmax(0,1fr))'),'mobile bottom nav is locked to six equal columns');
check(uiPolish.includes('#meridian-release-status-row')&&uiPolish.includes('.topbar .live'),'topbar status/live controls are explicitly hidden');
check(uiPolish.includes('justify-content:center'),'topbar brand is centered');
check(finalUi.includes('function ensureRendered()'),'empty-view recovery is installed');
check(finalUi.includes("typeof renderOne==='function'"),'empty-view recovery can invoke canonical renderer');

check(finalUi.includes("const VERSION='7.60'"),'final UI authority owns v7.60 stamp');
check(finalUi.includes('CHALLENGER V3.2'),'Paper overview exposes Challenger V3.2 research candidate');
check(finalUi.includes('PAPER-/LIVE-EXECUTION'),'V3.2 UI explicitly preserves research-only boundary');
check(finalUi.includes('meridianRefreshPrivateDashboard'),'final UI can retry private depot hydration');
check(hardening.includes('meridianConfigureReadToken'),'canonical unlock function exists');
check(Array.isArray(data?.portfolio?.holdings)&&data.portfolio.holdings.length===0,'public data.json contains no private holdings');
check(data?.portfolio?.private===true,'public portfolio is marked private');
check(server.includes('Unsafe configuration: PAPER only required.'),'paper-only invariant remains in engine');
check(startGateway.includes('applyReadTokenSecret'),'gateway startup applies read-token hardening');
check(startGateway.includes("auth.mode==='LEGACY_FALLBACK'"),'gateway startup fails closed if no read-token secret is configured');
warn(!gateway.includes('MERIDIAN_READ_TOKEN_SHA256 ||'),'server-gateway still contains an unreachable legacy hash fallback; startup now fails closed before it can be used');

for(const [file,view] of [['center.html','center'],['depot.html','portfolio'],['market.html','market'],['trade.html','daytrade'],['forecast.html','forecast']]){
  const html=read(file);
  check(html.length<2400&&html.includes(`route=${view}`)&&html.includes(`#${view}`),`${file} is a hardened redirect to canonical index`);
  check(html.includes('background:#03070c'),`${file} cannot present a white boot screen`);
  check(html.includes('getRegistrations')&&html.includes('caches.keys'),`${file} clears stale PWA/service-worker state`);
}

const report={ok:failures.length===0,version,build,passed:pass.length,failed:failures,warnings,checkedAt:new Date().toISOString()};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
