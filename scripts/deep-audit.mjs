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
const renderer=read('app-v7.32-legacy.js');
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
check(loader.includes('app-v7.32-legacy.js'),'canonical base renderer is loaded');
check(loader.indexOf('app-v7.32-legacy.js')<loader.indexOf('app-v7.33-hardening.js'),'base renderer loads before hardening');
check(renderer.includes('function renderAll')||renderer.includes('renderAll='),'base renderer exposes renderAll');
check(loader.includes('app-v7.60-final-ui-authority.js'),'canonical loader includes final UI authority');
check(loader.lastIndexOf('app-v7.60-final-ui-authority.js')>loader.lastIndexOf('app-v7.60-private-hydration-hotfix.js'),'final UI authority loads after private hydration');
check(!loader.includes('app-v7.60-emergency-input-hotfix.js'),'emergency input layer is not loaded');
check(!loader.includes('app-v7.60-nav-hotfix.js'),'obsolete nav hotfix is not loaded');
check(!loader.includes('app-v7.60-unlock-hotfix.js'),'obsolete unlock hotfix is not loaded');

check(fs.existsSync('assets/achi-meridian-topbar.webp'),'approved topbar logo asset exists');
check(uiPolish.includes("assets/achi-meridian-topbar.webp"),'topbar uses approved ACHI MERIDIAN logo asset');
check(uiPolish.includes("repeat(6,minmax(0,1fr))"),'mobile bottom nav is locked to six equal columns');
check(uiPolish.includes('#meridian-release-status-row')&&uiPolish.includes('.topbar .live'),'topbar status/live controls are explicitly hidden');
check(uiPolish.includes('justify-content:center'),'topbar brand is centered');

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
  check(html.length<2000&&html.includes(`index.html#${view}`),`${file} is a thin redirect to canonical index`);
}

const report={ok:failures.length===0,version,build,passed:pass.length,failed:failures,warnings,checkedAt:new Date().toISOString()};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
