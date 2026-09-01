import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const release=json('version.json');
const v=String(release.version||'');
const build=String(release.buildId||'');
const tag=v+'-R1';

must(release.ui===v,'version.json ui mismatch');
must(release.engine==='6.2.0','Engine must remain 6.2.0');
must(release.ruleset==='6.2-SIGNAL-V1','Ruleset must remain 6.2-SIGNAL-V1');
must(release.research==='7.34-RESEARCH-V2','Research engine version mismatch');
must(release.privacy==='7.33-HARDENED','Privacy layer version mismatch');
must(release.runtime==='7.36-MONITORING','Runtime monitoring version mismatch');
must(release.uiPolish==='7.37-MOBILE','Mobile UI polish version mismatch');

const index=read('index.html');
must(index.includes(`<meta name="meridian-build" content="${build}">`),'index build meta mismatch');
must(index.includes(`window.MERIDIAN_RELEASE_VERSION='${v}';`),'index release version mismatch');
must(index.includes(`window.MERIDIAN_RELEASE_BUILD='${build}';`),'index release build mismatch');
must(index.includes(`manifest.webmanifest?v=${tag}`),'manifest cache tag mismatch');
must(index.includes(`styles-v6.06.css?v=${tag}`),'CSS cache tag mismatch');
must(index.includes(`app-v6.06.js?v=${tag}`),'core app cache tag mismatch');

const loader=read('app-v6.06.js');
must(loader.includes(`app-v7.32-legacy.js?v=${tag}`),'legacy loader cache tag mismatch');
must(loader.includes(`app-v7.33-hardening.js?v=${tag}`),'hardening loader cache tag mismatch');
must(loader.includes(`app-runtime-monitor.js?v=${tag}`),'runtime monitor cache tag mismatch');
must(loader.includes(`app-v7.37-ui-polish.js?v=${tag}`),'ui polish loader cache tag mismatch');
must(loader.includes(`app-v7.38-regime-ui.js?v=${tag}`),'regime UI loader cache tag mismatch');
must(loader.includes(`app-v7.39-paper-overview.js?v=${tag}`),'paper overview loader cache tag mismatch');

const hardening=read('app-v7.33-hardening.js');
must(hardening.includes(`const VERSION='${v}';`),'hardening VERSION mismatch');
must(hardening.includes(`const BUILD='${build}';`),'hardening BUILD mismatch');
must(hardening.includes(`manifest.webmanifest?v=${tag}`),'hardening manifest tag mismatch');

const runtime=read('app-runtime-monitor.js');
must(runtime.includes('/gateway-health'),'runtime monitor must use gateway health');
must(runtime.includes('MERIDIAN_RUNTIME_STATUS'),'runtime monitor status export missing');

const uiPolish=read('app-v7.37-ui-polish.js');
must(uiPolish.includes('meridian-release-status-row'),'mobile status row missing');
const regimeUi=read('app-v7.38-regime-ui.js');
must(regimeUi.includes('/api/regime-v1'),'regime UI endpoint missing');
must(read('regime-v1.js').includes("REGIME_V1_RULESET='7.38-REGIME-V1'"),'regime model ruleset missing');
const overview=read('app-v7.39-paper-overview.js');
must(overview.includes('A/B/C/D BOT ÜBERSICHT'),'ABCD overview heading missing');
must(overview.includes('REGIME Δ P&L vs BASE'),'Regime delta missing');
must(overview.includes("compareButton.textContent='ÜBERSICHT'"),'overview tab rename missing');
must(uiPolish.includes("document.getElementById('versionBadge')"),'mobile UI polish must relocate version badge');
must(uiPolish.includes("document.getElementById('meridian-runtime-badge')"),'mobile UI polish must relocate runtime badge');
must(uiPolish.includes('@media(max-width:390px)'),'narrow iPhone header guard missing');

const manifest=json('manifest.webmanifest');
must(manifest.name===`ACHI MERIDIAN v${v}`,'manifest name mismatch');
must(manifest.short_name===`MERIDIAN ${v}`,'manifest short_name mismatch');
must(manifest.start_url===`./?build=${build}`,'manifest start_url mismatch');

const pkg=json('package.json');
must(pkg.version===v+'.0','package version mismatch');
must(pkg.scripts?.start==='node scripts/start-gateway.mjs','package start must use password-safe gateway launcher');
must(pkg.scripts?.test==='node --test test/*.test.js','test script mismatch');
must(pkg.scripts?.['runtime:smoke']==='node scripts/runtime-smoke.mjs','runtime smoke script mismatch');

must(fs.existsSync('package-lock.json'),'package-lock.json missing');
const lock=json('package-lock.json');
must(lock.lockfileVersion>=2,'package lock format too old');
must(lock.packages?.['']?.version===v+'.0','package-lock root version mismatch');

const docker=read('Dockerfile');
must(docker.includes('RUN npm ci --omit=dev'),'Docker must use npm ci --omit=dev');
must(docker.includes('CMD ["node", "scripts/start-gateway.mjs"]'),'Docker must start password-safe security gateway launcher');

const gateway=read('server-gateway.js');
must(gateway.includes('RELEASE.buildId'),'gateway health must expose canonical build');
must(gateway.includes('NF_DEPLOYMENT_SHA'),'gateway health must expose deployment SHA when available');
must(gateway.includes('privateData'),'gateway health must retain private store readiness');

must(fs.existsSync('.github/workflows/runtime-smoke.yml'),'runtime smoke workflow missing');
const smoke=read('scripts/runtime-smoke.mjs');
must(smoke.includes('GitHub Pages stale'),'runtime smoke must validate Pages release');
must(smoke.includes('Northflank stale'),'runtime smoke must validate Northflank release');
must(smoke.includes('expected 401'),'runtime smoke must verify anonymous protection');

const sw=read('sw.js');
must(sw.includes('MERIDIAN_SW_RETIRE'),'service worker retirement sentinel missing');
must(!/caches\.open\s*\(/.test(sw),'service worker must not create an application cache');

const server=read('server.js');
must(server.includes('if(!config.paperTrading||config.liveTrading) throw new Error("Unsafe configuration: PAPER only required.");'),'paper-only invariant missing');

console.log('MERIDIAN release check OK',v,build);
