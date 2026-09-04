import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const release=json('version.json');
const v=String(release.version||'');
const build=String(release.buildId||'');
const revision=build.split('-').slice(-1)[0]||'R1';
const tag=`${v}-${revision}`;

must(/^\d+\.\d+$/.test(v),'invalid release version');
must(build.startsWith(v+'-'),'buildId/version mismatch');
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

// Runtime version SSOT: version.json -> compatibility loader -> app-release-authority.js.
const loader=read('app-v6.06.js');
must(loader.includes(`const TAG='${tag}'`),'compat loader release tag mismatch');
must(loader.includes('app-release-authority.js'),'release authority must load last');
const authority=read('app-release-authority.js');
must(authority.includes("fetch('version.json?authority='+Date.now(),{cache:'no-store'})"),'release authority must fetch canonical version.json no-store');
must(authority.includes('MERIDIAN_RELEASE_AUTHORITY'),'release authority status export missing');
must(authority.includes('MutationObserver'),'release authority must heal stale badge painters');
must(authority.includes('MERIDIAN_RELEASE_VERSION'),'release authority global version stamp missing');
must(authority.includes('MERIDIAN_RELEASE_BUILD'),'release authority global build stamp missing');

// index.html is intentionally a compatibility bootstrap and may contain historical inline painters;
// it must still load the compatibility core. Runtime authority owns the final version/build state.
const index=read('index.html');
must(index.includes('app-v6.06.js'),'index compatibility loader missing');
must(index.includes('id="versionBadge"'),'version badge missing');

const manifest=json('manifest.webmanifest');
must(manifest.name===`ACHI MERIDIAN v${v}`,'manifest name mismatch');
must(manifest.short_name===`MERIDIAN ${v}`,'manifest short_name mismatch');
must(manifest.start_url===`./?build=${build}`,'manifest start_url mismatch');

const pkg=json('package.json');
must(pkg.version===v+'.0','package version mismatch');
must(pkg.scripts?.start==='node scripts/start-gateway.mjs','package start must use gateway launcher');
must(pkg.scripts?.test==='node --test test/*.test.js','test script mismatch');
must(pkg.scripts?.['runtime:smoke']==='node scripts/runtime-smoke.mjs','runtime smoke script mismatch');
const lock=json('package-lock.json');
must(lock.lockfileVersion>=2,'package lock format too old');
must(lock.version===v+'.0','package-lock top-level version mismatch');
must(lock.packages?.['']?.version===v+'.0','package-lock root version mismatch');

const runtime=read('app-runtime-monitor.js');
must(runtime.includes('/gateway-health'),'runtime monitor must use gateway health');
must(runtime.includes('MERIDIAN_RUNTIME_STATUS'),'runtime monitor status export missing');
const gateway=read('server-gateway.js');
must(gateway.includes('RELEASE.buildId'),'gateway health must expose canonical build');
must(gateway.includes('NF_DEPLOYMENT_SHA'),'gateway health must expose deployment SHA when available');
must(gateway.includes('privateData'),'gateway health must retain private store readiness');

const uiPolish=read('app-v7.37-ui-polish.js');
must(uiPolish.includes('meridian-release-status-row'),'mobile release status row missing');
must(uiPolish.includes("document.getElementById('versionBadge')"),'UI polish must retain version badge');
must(uiPolish.includes("document.getElementById('meridian-runtime-badge')"),'UI polish must retain runtime badge');
must(uiPolish.includes('@media(max-width:390px)'),'narrow iPhone header guard missing');

const regimeUi=read('app-v7.38-regime-ui.js');
must(regimeUi.includes('/api/regime-v1'),'regime UI endpoint missing');
must(read('regime-v1.js').includes("REGIME_V1_RULESET='7.38-REGIME-V1'"),'regime model ruleset missing');
const overview=read('app-v7.39-paper-overview.js');
must(overview.includes('A/B/C/D BOT ÜBERSICHT'),'ABCD overview heading missing');
must(overview.includes('activateOverview'),'Paper overview default activation missing');

must(fs.existsSync('research-analytics.js'),'research telemetry module missing');
const telemetry=read('research-analytics.js');
must(telemetry.includes("schemaVersion:'7.47-TELEMETRY-V1'"),'research telemetry schema mismatch');
must(telemetry.includes('executionImpact:false'),'research telemetry must remain non-executing');
must(telemetry.includes('bySide'),'research telemetry side split missing');
must(telemetry.includes('byRegime'),'research telemetry regime split missing');

must(fs.existsSync('exit-lab.js'),'Exit Lab module missing');
must(fs.existsSync('exit-lab-replay.js'),'Exit Lab replay module missing');
const exitReplay=read('exit-lab-replay.js');
must(exitReplay.includes('FIXED_ENTRY_15M_EXIT_COHORT_REPLAY'),'fixed-entry cohort replay missing');
must(exitReplay.includes('Number(c.closeTime)>opened'),'entry-candle lookahead guard missing');

for(const f of ['MERIDIAN_CONTEXT.md','MERIDIAN_DECISIONS.md','MERIDIAN_HANDOFF.md'])must(fs.existsSync(f),`continuity file missing: ${f}`);
const context=read('MERIDIAN_CONTEXT.md');
const decisions=read('MERIDIAN_DECISIONS.md');
must(context.includes('Baseline 6.2 execution is a frozen reference'),'baseline freeze context missing');
must(decisions.includes('Avoid over-filtering'),'over-filtering principle missing');
must(decisions.includes('Research must never auto-promote'),'research promotion principle missing');

const docker=read('Dockerfile');
must(docker.includes('RUN npm ci --omit=dev'),'Docker must use npm ci --omit=dev');
must(docker.includes('CMD ["node", "scripts/start-gateway.mjs"]'),'Docker must start gateway launcher');
const sw=read('sw.js');
must(sw.includes('MERIDIAN_SW_RETIRE'),'service worker retirement sentinel missing');
must(!/caches\.open\s*\(/.test(sw),'service worker must not create an application cache');
const server=read('server.js');
must(server.includes('if(!config.paperTrading||config.liveTrading) throw new Error("Unsafe configuration: PAPER only required.");'),'paper-only invariant missing');

console.log('MERIDIAN release check OK',v,build,'authority=version.json');
