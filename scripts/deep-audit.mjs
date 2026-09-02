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
const finalUi=fs.existsSync('app-v7.60-final-ui-authority.js')?read('app-v7.60-final-ui-authority.js'):'';
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
check(loader.includes('app-v7.32-legacy.js'),'known-good v7.60 compatibility layer is restored');
check(loader.includes('app-v7.60-dashboard-consistency.js'),'v7.60 dashboard consistency layer is loaded');
check(!/emergency-input-hotfix|nav-hotfix|unlock-hotfix/.test(loader),'obsolete input hotfix layers are not loaded');
check(loader.includes('app-v7.37-ui-polish.js'),'premium header polish is loaded');

check(uiPolish.includes('premium horizontal banner brand'),'known-good premium header implementation restored');
check(uiPolish.includes('meridian-horizontal-brand'),'premium ACHI MERIDIAN banner is present');
check(uiPolish.includes('.top-actions{display:none!important}'),'redundant top actions remain hidden');
check(uiPolish.includes('.logo-btn{display:none!important}'),'legacy corner logo remains hidden');

check(hardening.includes('meridianConfigureReadToken'),'canonical unlock function exists');
check(Array.isArray(data?.portfolio?.holdings)&&data.portfolio.holdings.length===0,'public data.json contains no private holdings');
check(data?.portfolio?.private===true,'public portfolio is marked private');
check(server.includes('Unsafe configuration: PAPER only required.'),'paper-only invariant remains in engine');
check(startGateway.includes('applyReadTokenSecret'),'gateway startup applies read-token hardening');
check(startGateway.includes("auth.mode==='LEGACY_FALLBACK'"),'gateway startup fails closed if no read-token secret is configured');
warn(!gateway.includes('MERIDIAN_READ_TOKEN_SHA256 ||'),'server-gateway still contains an unreachable legacy hash fallback; startup now fails closed before it can be used');

const report={ok:failures.length===0,version,build,passed:pass.length,failed:failures,warnings,checkedAt:new Date().toISOString()};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
