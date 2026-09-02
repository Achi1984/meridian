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
must(release.uiPolish==='7.46-PREMIUM-BANNER','Header UI polish version mismatch');
must(release.regimeResearch==='7.38-REGIME-V1','Regime research ruleset mismatch');
must(release.paperOverview==='7.41-OVERVIEW-FIRST','Paper overview UX version mismatch');
must(release.researchTelemetry==='7.47-TELEMETRY-V1','Research telemetry version mismatch');
must(release.exitLab==='7.49-EXIT-LAB-REPLAY-V1','Exit Lab replay version mismatch');
must(release.exitLabReplay==='7.49-FIXED-ENTRY-15M-REPLAY','Exit Lab fixed-entry replay metadata mismatch');
must(release.projectMemory==='7.50-CONTINUITY-V1','Project memory version mismatch');

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
must(uiPolish.includes('<svg id="${BRAND_IMG_ID}"'),'inline horizontal SVG header brand missing');
must(uiPolish.includes('viewBox="0 0 980 112"'),'premium banner viewBox missing');
must(uiPolish.includes('mbSilver'),'premium silver wordmark gradient missing');
must(uiPolish.includes('MERIDIAN</text>'),'premium MERIDIAN wordmark missing');
must(uiPolish.includes('meridian-release-status-row'),'mobile status row missing');
must(uiPolish.includes("document.getElementById('versionBadge')"),'mobile UI polish must relocate version badge');
must(uiPolish.includes("document.getElementById('meridian-runtime-badge')"),'mobile UI polish must relocate runtime badge');
must(uiPolish.includes("document.querySelector('.topbar .live')"),'compact header must retain LIVE DASHBOARD status row');
must(uiPolish.includes('.top-actions{display:none!important}'),'redundant header live/refresh controls must be hidden');
must(uiPolish.includes('@media(max-width:390px)'),'narrow iPhone header guard missing');

const regimeUi=read('app-v7.38-regime-ui.js');
must(regimeUi.includes('/api/regime-v1'),'regime UI endpoint missing');
must(read('regime-v1.js').includes("REGIME_V1_RULESET='7.38-REGIME-V1'"),'regime model ruleset missing');

const overview=read('app-v7.39-paper-overview.js');
must(overview.includes('A/B/C/D BOT ÜBERSICHT'),'ABCD overview heading missing');
must(overview.includes('REGIME Δ P&L vs BASE'),'Regime delta missing');
must(overview.includes("compare.textContent='ÜBERSICHT'"),'overview tab rename missing');
must(overview.includes('tabs.prepend(compare)'),'overview tab must be first');
must(overview.includes('activateOverview'),'Paper overview default activation missing');
must(overview.includes("replace(/3 BOTS/g,'4 BOTS')"),'Paper Lab bot count correction missing');

must(fs.existsSync('research-analytics.js'),'research telemetry module missing');
const telemetry=read('research-analytics.js');
must(telemetry.includes("schemaVersion:'7.47-TELEMETRY-V1'"),'research telemetry schema mismatch');
must(telemetry.includes('executionImpact:false'),'research telemetry must remain non-executing');
must(telemetry.includes('expectancy'),'research telemetry expectancy missing');
must(telemetry.includes('payoffRatio'),'research telemetry payoff ratio missing');
must(telemetry.includes('bySide'),'research telemetry side split missing');
must(telemetry.includes('bySymbol'),'research telemetry symbol split missing');
must(telemetry.includes('byRegime'),'research telemetry regime split missing');
must(telemetry.includes('challengerBaselineReadyDependency:true'),'challenger architecture audit flag missing');
must(telemetry.includes('regimeAdaptedSideUsesBaselineDirectionalScores:true'),'regime architecture audit flag missing');

must(fs.existsSync('exit-lab.js'),'Exit Lab module missing');
const exitLab=read('exit-lab.js');
must(exitLab.includes("EXIT_LAB_VERSION='7.49-EXIT-LAB-REPLAY-V1'"),'Exit Lab schema mismatch');
must(exitLab.includes('B_CONFIRM_CLOSE'),'TP1 close-confirmation probe missing');
must(exitLab.includes('B_BE_PLUS_010'),'BE +0.10R probe missing');
must(exitLab.includes('B_BE_PLUS_025'),'BE +0.25R probe missing');
must(exitLab.includes('confirmTp1Close'),'confirmed TP1 close protection missing');
must(exitLab.includes('beExtraR'),'R-profit lock support missing');
must(fs.existsSync('exit-lab-replay.js'),'Exit Lab replay module missing');
const exitReplay=read('exit-lab-replay.js');
must(exitReplay.includes('FIXED_ENTRY_15M_EXIT_COHORT_REPLAY'),'fixed-entry cohort replay missing');
must(exitReplay.includes('SAME_HISTORICAL_ENTRIES_PARALLEL_EXIT_POLICIES'),'parallel exit policy replay missing');
must(exitReplay.includes('Number(c.closeTime)>opened'),'entry-candle lookahead guard missing');
const cloud=read('cloud-backtest.js');
must(cloud.includes("from './exit-lab-replay.js'"),'cloud backtest Exit Lab replay import missing');
must(cloud.includes("stage:'exit-lab-replay'"),'cloud backtest Exit Lab progress stage missing');
must(cloud.includes('exitLabReplay'),'cloud backtest Exit Lab result missing');
must(cloud.includes("version:'7.49-EXIT-LAB-REPLAY-V1'"),'cloud backtest Exit Lab version missing');

const continuityFiles=['MERIDIAN_CONTEXT.md','MERIDIAN_DECISIONS.md','MERIDIAN_HANDOFF.md'];
for(const f of continuityFiles)must(fs.existsSync(f),`continuity file missing: ${f}`);
const context=read('MERIDIAN_CONTEXT.md');
const decisions=read('MERIDIAN_DECISIONS.md');
const handoff=read('MERIDIAN_HANDOFF.md');
must(context.includes('Single source of truth for project continuity'),'canonical context marker missing');
must(context.includes('Baseline 6.2 execution is a frozen reference'),'baseline freeze context missing');
must(decisions.includes('Avoid over-filtering'),'over-filtering principle missing');
must(decisions.includes('Research must never auto-promote'),'research promotion principle missing');
must(decisions.includes('TP1 should transition into a protected runner in research'),'protected runner decision missing');
must(handoff.includes('Challenger V3'),'next bot handoff missing');
must(handoff.includes('Regime V2'),'regime v2 handoff missing');
must(handoff.includes('read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first'),'new-chat startup instruction missing');

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
must(gateway.includes('researchComparison'),'gateway must load research analytics');
must(gateway.includes('/api/research-analytics'),'protected research analytics endpoint missing');
must(gateway.includes('stateGet("paper")'),'research analytics baseline state source missing');
must(gateway.includes('stateGet("shadow_v1")'),'research analytics shadow state source missing');
must(gateway.includes('stateGet("challenger_v2")'),'research analytics challenger state source missing');
must(gateway.includes('stateGet("regime_v1")'),'research analytics regime state source missing');

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

// v7.52 Challenger V3 research-only continuity guards
must(release.challengerResearch==='7.52-CHALLENGER-V3','Challenger V3 metadata mismatch');
must(release.exitLabEvidence==='7.51-EXIT-LAB-EVIDENCE-V1','Exit Lab evidence metadata missing');
must(fs.existsSync('challenger-v3.js'),'Challenger V3 module missing');
const c3v752=read('challenger-v3.js');
must(c3v752.includes("CHALLENGER_V3_RULESET='7.52-CHALLENGER-V3'"),'Challenger V3 ruleset mismatch');
must(c3v752.includes('baselineReadyDependency:false'),'Challenger V3 READY-independence marker missing');
const cloud752=read('cloud-backtest.js');
must(cloud752.includes("makeLedger('CHALLENGER_V3'"),'Challenger V3 independent ledger missing');
must(cloud752.includes("variantStability('CHALLENGER V3'"),'Challenger V3 walk-forward missing');
must(cloud752.includes('baselineStatusAtEntry:sig.status'),'Challenger V3 baseline status telemetry missing');
must(!cloud752.includes('challengerV3:ledgers.challengerV3.tradeList'),'Challenger V3 must not enter Exit Lab before initial entry evaluation');
