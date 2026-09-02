import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const release=json('version.json');
const v=String(release.version||'');
const build=String(release.buildId||'');
const hasTagged=(src,name)=>new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\?v='+v.replace('.','\\.')+'-[^"\'<>\\s]+').test(src);

must(release.ui===v,'version.json ui mismatch');
must(release.engine==='6.2.0','Engine must remain 6.2.0');
must(release.ruleset==='6.2-SIGNAL-V1','Ruleset must remain 6.2-SIGNAL-V1');
must(release.research==='7.34-RESEARCH-V2','Research engine version mismatch');
must(release.privacy==='7.33-HARDENED','Privacy layer version mismatch');
must(release.runtime==='7.36-MONITORING','Runtime monitoring version mismatch');
must(release.regimeResearch==='7.38-REGIME-V1','Regime research ruleset mismatch');
must(release.paperOverview==='7.41-OVERVIEW-FIRST','Paper overview UX version mismatch');

const index=read('index.html');
must(index.includes(`<meta name="meridian-build" content="${build}">`),'index build meta mismatch');
must(index.includes(`window.MERIDIAN_RELEASE_VERSION='${v}';`),'index release version mismatch');
must(index.includes(`window.MERIDIAN_RELEASE_BUILD='${build}';`),'index release build mismatch');
must(index.includes('function depot(){'),'canonical inline depot renderer missing');
must(index.includes('function portfolioIntelligencePanel(){'),'canonical inline render engine missing');

const loader=read('app-v6.06.js');
must(!loader.includes('app-v7.32-legacy.js'),'retired v7.32 diagnostic layer must not be loaded');
must(!/emergency-input-hotfix|nav-hotfix|unlock-hotfix/.test(loader),'retired input hotfix layer loaded');
for(const f of ['app-v7.33-hardening.js','app-runtime-monitor.js','app-v7.37-ui-polish.js','app-v7.38-regime-ui.js','app-v7.39-paper-overview.js','app-v7.60-dashboard-consistency.js','app-v7.60-private-hydration-hotfix.js','app-v7.60-final-ui-authority.js'])must(hasTagged(loader,f),`${f} missing or cache tag mismatch`);
must(loader.lastIndexOf('app-v7.60-final-ui-authority.js')>loader.lastIndexOf('app-v7.60-private-hydration-hotfix.js'),'final UI authority must load after private hydration');

const hardening=read('app-v7.33-hardening.js');
must(hardening.includes(`const VERSION='${v}';`),'hardening VERSION mismatch');
must(hardening.includes(`const BUILD='${build}';`),'hardening BUILD mismatch');
const polish=read('app-v7.37-ui-polish.js');
must(fs.existsSync('assets/achi-meridian-topbar.webp'),'approved ACHI MERIDIAN banner asset missing');
must(polish.includes('assets/achi-meridian-topbar.webp'),'topbar does not use approved banner asset');
must(polish.includes('justify-content:center'),'topbar brand is not centered');
must(polish.includes('.bottom .inner.five-tabs'),'legacy five-tab selector is not explicitly overridden');
must(polish.includes('repeat(6,minmax(0,1fr))'),'mobile navigation must be six equal columns');
must(polish.includes('#meridian-release-status-row')&&polish.includes('.topbar .live'),'topbar live/status controls must be hidden');

const finalUi=read('app-v7.60-final-ui-authority.js');
must(finalUi.includes(`const VERSION='${v}';`),'final UI VERSION mismatch');
must(finalUi.includes(`const BUILD='${build}';`),'final UI BUILD mismatch');
must(finalUi.includes('function ensureRendered()'),'empty-view recovery missing');
must(finalUi.includes("typeof renderOne==='function'"),'empty-view recovery cannot invoke renderer');
must(finalUi.includes('CHALLENGER V3.2'),'V3.2 research candidate missing from Paper overview');
must(finalUi.includes('PAPER-/LIVE-EXECUTION'),'V3.2 research-only execution boundary missing');
must(finalUi.includes('meridianRefreshPrivateDashboard'),'private hydration retry missing');

const data=json('data.json');
must(data?.portfolio?.private===true,'public portfolio must be private');
must(Array.isArray(data?.portfolio?.holdings)&&data.portfolio.holdings.length===0,'public data must not contain holdings');
const server=read('server.js');
must(server.includes('if(!config.paperTrading||config.liveTrading) throw new Error("Unsafe configuration: PAPER only required.");'),'paper-only invariant missing');
const gateway=read('server-gateway.js');
must(gateway.includes('privateData'),'gateway privateData health flag missing');
must(gateway.includes('/api/research-analytics'),'research analytics endpoint missing');
must(read('research-analytics.js').includes('executionImpact:false'),'research telemetry must remain non-executing');
must(read('exit-lab-replay.js').includes('Number(c.closeTime)>opened'),'entry-candle lookahead guard missing');
must(read('regime-v1.js').includes("REGIME_V1_RULESET='7.38-REGIME-V1'"),'regime ruleset missing');
for(const f of ['MERIDIAN_CONTEXT.md','MERIDIAN_DECISIONS.md','MERIDIAN_HANDOFF.md'])must(fs.existsSync(f),`continuity file missing: ${f}`);
for(const [file,view] of [['center.html','center'],['depot.html','portfolio'],['market.html','market'],['trade.html','daytrade'],['forecast.html','forecast']]){
  const shim=read(file);
  must(shim.includes(`route=${view}`)&&shim.includes(`#${view}`),`${file} must redirect to canonical index`);
  must(shim.includes('background:#03070c'),`${file} white-screen guard missing`);
  must(shim.includes('getRegistrations')&&shim.includes('caches.keys'),`${file} stale PWA cleanup missing`);
}
const smoke=read('scripts/runtime-smoke.mjs');
must(smoke.includes('Canonical index missing inline depot renderer'),'runtime smoke must validate inline render engine');
must(smoke.includes('approved logo asset'),'runtime smoke must validate approved logo');
must(smoke.includes('six equal columns'),'runtime smoke must validate six-tab nav');
must(smoke.includes('white boot screen'),'runtime smoke must validate white-screen guard');
const sw=read('sw.js');
must(sw.includes('MERIDIAN_SW_RETIRE'),'service worker retirement sentinel missing');
must(!/caches\.open\s*\(/.test(sw),'service worker must not create application cache');
console.log('MERIDIAN release check OK',v,build);
