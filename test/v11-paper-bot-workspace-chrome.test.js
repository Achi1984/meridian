import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {unlockAppThroughGate, VERIFY_ENDPOINT} from './helpers/v11-app-access-browser.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';
import {SPOT_PAPER_REPORT_ENDPOINT} from '../v11/spot-paper-cockpit-controller.js';
import {
  SPOT_PAPER_PAIRED_REPORT_ENDPOINT,
  SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA
} from '../v11/spot-paper-paired-report-connector.js';
import {SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT} from
  '../v11/spot-paper-paired-progress-connector.js';
import {
  SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY
} from '../v11/spot-paper-paired-progress-config.js';
import {
  handleSpotPaperPairedProgressGatewayRequest,
  spotPaperPairedProgressGatewayConfig
} from '../spot-paper-paired-progress-gateway.mjs';
import {validateProgress} from '../scripts/spot-paper-paired-progress/contract.mjs';
import {
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';

const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome',
  '/usr/bin/chromium'].find(path => path && existsSync(path));
const sizes = [320, 390, 1440];
const pairedIdentity = syntheticExpectedPairedIdentity();
const pairedFixture = syntheticPairedDashboard(pairedIdentity);
const pairedLegacyIdentity = syntheticExpectedPairedIdentity();
pairedLegacyIdentity.models[1].modelId = 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1';
const pairedLegacyFixture = syntheticPairedDashboard(pairedLegacyIdentity);
const pairedTrendFixture = syntheticPairedDashboard(
  SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY);
const progressValuationAt = Date.now() - 10 * 60 * 1000;
const SPOT_PAPER_PROGRESS_MODEL_IDS =
  SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY.models.map(model => model.modelId);
pairedTrendFixture.timing.valuationAt = progressValuationAt;
const ACCESS_TOKEN = 'synthetic-browser-gate-password';
const progressPayload = validateProgress({
  schemaVersion: 'SPOT_PAPER_PAIRED_PROGRESS_V1',
  identity: SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY,
  journalSequence: 129,
  journalSha256: createHash('sha256').update('synthetic browser checkpoint').digest('hex'),
  classification: 'OBSERVED_CHECKPOINT',
  observedAt: progressValuationAt,
  valuationAt: progressValuationAt,
  exportedAt: progressValuationAt + 1_000,
  latestEventAt: progressValuationAt,
  terminal: {status: 'UNKNOWN', at: null},
  currency: 'EUR',
  monetaryUnit: 'CENTS',
  assumptions: {
    feeBpsPerSide: 20,
    slippageBpsPerSide: 10,
    ratesVerified: false,
    feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION',
    netEquityIncludesCosts: true
  },
  arms: [
    {
      role: 'baseline',
      modelId: SPOT_PAPER_PROGRESS_MODEL_IDS[0],
      startingCapitalCents: 100_000,
      netEquityCents: 99_940,
      netPnlCents: -60,
      cashCents: null,
      bookedFeesCents: 20,
      modeledSlippageCents: 10,
      hypotheticalExitFeeCents: null,
      hypotheticalExitSlippageCents: null,
      turnoverCents: 9_980,
      exposureCents: 9_980,
      sampledDrawdownCents: 60,
      unresolvedObservations: 0,
      inventoryStatus: 'OPEN',
      stopReason: null,
      tradingStoppedAt: null,
      fillCount: 1,
      completedRoundTripCount: 0,
      recentFills: [{side: 'BUY', grossCents: 9_980, feeCents: 20,
        executionAt: progressValuationAt}]
    },
    {
      role: 'challenger',
      modelId: SPOT_PAPER_PROGRESS_MODEL_IDS[1],
      startingCapitalCents: 100_000,
      netEquityCents: 99_500,
      netPnlCents: -500,
      cashCents: null,
      bookedFeesCents: 16,
      modeledSlippageCents: 10,
      hypotheticalExitFeeCents: null,
      hypotheticalExitSlippageCents: null,
      turnoverCents: 8_000,
      exposureCents: 0,
      sampledDrawdownCents: 500,
      unresolvedObservations: 0,
      inventoryStatus: 'FLAT',
      stopReason: null,
      tradingStoppedAt: null,
      fillCount: 2,
      completedRoundTripCount: 1,
      recentFills: [
        {side: 'BUY', grossCents: 4_000, feeCents: 8,
          executionAt: progressValuationAt - 1},
        {side: 'SELL', grossCents: 4_000, feeCents: 8,
          executionAt: progressValuationAt}
      ]
    },
    {
      role: 'cash',
      modelId: SPOT_PAPER_PROGRESS_MODEL_IDS[2],
      startingCapitalCents: 100_000,
      netEquityCents: 100_000,
      netPnlCents: 0,
      cashCents: 100_000,
      bookedFeesCents: 0,
      modeledSlippageCents: 0,
      hypotheticalExitFeeCents: null,
      hypotheticalExitSlippageCents: null,
      turnoverCents: 0,
      exposureCents: 0,
      sampledDrawdownCents: 0,
      unresolvedObservations: 0,
      inventoryStatus: 'FLAT',
      stopReason: null,
      tradingStoppedAt: null,
      fillCount: 0,
      completedRoundTripCount: 0,
      recentFills: []
    }
  ]
}, SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY);
assert.ok(progressPayload, 'browser checkpoint fixture satisfies the producer contract');
const PROGRESS_GATEWAY_CONFIG = spotPaperPairedProgressGatewayConfig({
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_ENABLED: 'true',
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_DEPLOYMENT_VERIFIED: 'true',
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON:
    JSON.stringify(SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY),
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256:
    createHash('sha256').update('separate-browser-uploader').digest('hex'),
  MERIDIAN_READ_TOKEN_SHA256: createHash('sha256').update(ACCESS_TOKEN).digest('hex')
});

function runFlaggedBrowserTest(name) {
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--experimental-websocket', '--test',
    `--test-name-pattern=^${name}$`, fileURLToPath(import.meta.url)], {
    env, encoding: 'utf8', timeout: 175_000
  });
}

function assertNamedTestPassed(output, name) {
  const line = output.split(/\r?\n/).find(item =>
    item.startsWith('ok ') &&
    (item.includes(` - ${name}`) || item.includes(` - ${name} #`)));
  assert.ok(line, `the named M11 browser regression must execute:\n${output}`);
  assert.doesNotMatch(line, /# SKIP(?:\s|$)/);
}

test('real M11 workspace authenticates both manual sources and renders paired fixtures at 320/390/1440px', {
  timeout: 180_000
}, async () => {
  const name = 'real M11 workspace authenticates both manual sources and renders paired fixtures at 320/390/1440px';
  if (typeof WebSocket !== 'function') {
    const child = runFlaggedBrowserTest(name);
    assert.equal(child.status, 0,
      `${String(child.stdout).slice(-2500)}${String(child.stderr).slice(-1000)}`);
    assertNamedTestPassed(child.stdout, name);
    for (const width of sizes) {
      assert.match(child.stdout, new RegExp(`V11_PAPER_BOT_WORKSPACE_SIZE .*"width":${width}`));
    }
    return;
  }
  assert.ok(chrome, 'Chrome is required for actual M11 entrypoint screenshots');
  const hosted = await startV11StaticServer();
  const evidence = process.env.V11_PAPER_BOT_WORKSPACE_EVIDENCE_DIR ||
    process.env.V11_A2_EVIDENCE_DIR ||
    join(tmpdir(), 'meridian-paper-bot-workspace-evidence');
  mkdirSync(evidence, {recursive: true});
  try {
    for (const width of sizes) {
      const metrics = await withMobileChrome(chrome, width, hosted.url, async call => {
        let reads = 0;
        let pairedReads = 0;
        let progressReads = 0;
        let pendingPairedRequestId = null;
        let pairedResponseMode = width === 320 ? 'unprovisioned' :
          width === 390 ? 'not_found' : 'trend';
        let failure = null;
        const off = call.onEvent('Fetch.requestPaused', event => {
          void (async () => {
            if (event.request.url === VERIFY_ENDPOINT) return;
            if (![SPOT_PAPER_REPORT_ENDPOINT, SPOT_PAPER_PAIRED_REPORT_ENDPOINT,
              SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT]
              .includes(event.request.url)) throw Error('Unexpected report route');
            if (event.request.method === 'OPTIONS') {
              await call('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: 204,
                responseHeaders: [
                  {name: 'Access-Control-Allow-Origin', value: '*'},
                  {name: 'Access-Control-Allow-Methods', value: 'GET'},
                  {name: 'Access-Control-Allow-Headers', value: 'accept,authorization'},
                  {name: 'Access-Control-Max-Age', value: '0'}
                ]
              });
              return;
            }
            assert.equal(event.request.method, 'GET');
            const authorization = Object.entries(event.request.headers || {})
              .find(([key]) => key.toLowerCase() === 'authorization')?.[1];
            assert.ok(authorization?.startsWith('Bearer '));
            assert.ok(authorization.length > 'Bearer '.length);
            if (event.request.url === SPOT_PAPER_REPORT_ENDPOINT) {
              reads++;
              await call('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: 404,
                responseHeaders: [
                  {name: 'Access-Control-Allow-Origin', value: '*'},
                  {name: 'Content-Type', value: 'application/json; charset=utf-8'},
                  {name: 'Cache-Control', value: 'no-store'}
                ],
                body: Buffer.from(JSON.stringify({error: 'report_not_found'})).toString('base64')
              });
            } else if (event.request.url === SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT) {
              progressReads++;
              const request = Readable.from([]);
              Object.assign(request, {
                url: new URL(event.request.url).pathname,
                method: event.request.method,
                headers: event.request.headers
              });
              const gateway = await handleSpotPaperPairedProgressGatewayRequest(request, {
                config: PROGRESS_GATEWAY_CONFIG,
                getStore: () => ({get: async identity => {
                  assert.deepEqual(identity, SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY);
                  return progressPayload;
                }}),
                authorizedRead: req =>
                  req.headers.authorization === 'Bearer ' + ACCESS_TOKEN
              });
              assert.equal(gateway.status, 200);
              await call('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: gateway.status,
                responseHeaders: [
                  {name: 'Access-Control-Allow-Origin', value: '*'},
                  {name: 'Content-Type', value: 'application/json; charset=utf-8'},
                  {name: 'Cache-Control', value: 'no-store'}
                ],
                body: Buffer.from(JSON.stringify(gateway.body)).toString('base64')
              });
            } else {
              pairedReads++;
              const mode = pairedResponseMode;
              if (mode === 'hold') {
                pendingPairedRequestId = event.requestId;
                return;
              }
              if (mode === 'unprovisioned' || mode === 'not_found') {
                await call('Fetch.fulfillRequest', {
                  requestId: event.requestId,
                  responseCode: mode === 'unprovisioned' ? 503 : 404,
                  responseHeaders: [
                    {name: 'Access-Control-Allow-Origin', value: '*'},
                    {name: 'Content-Type', value: 'application/json; charset=utf-8'},
                    {name: 'Cache-Control', value: 'no-store'}
                  ],
                  body: Buffer.from(JSON.stringify({
                    error: mode === 'unprovisioned' ?
                      'spot_paper_paired_transport_not_provisioned' :
                      'spot_paper_paired_report_not_found'
                  })).toString('base64')
                });
                return;
              }
              const report = mode === 'trend' ? pairedTrendFixture :
                mode === 'legacy' ? pairedLegacyFixture : pairedFixture;
              await call('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: 200,
                responseHeaders: [
                  {name: 'Access-Control-Allow-Origin', value: '*'},
                  {name: 'Content-Type', value: 'application/json; charset=utf-8'},
                  {name: 'Cache-Control', value: 'no-store'}
                ],
                body: Buffer.from(JSON.stringify({
                  schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
                  runId: report.identity.runId,
                  report
                })).toString('base64')
              });
            }
          })().catch(error => { failure = error; });
        });
        await call('Fetch.enable', {patterns: [
          {urlPattern: SPOT_PAPER_REPORT_ENDPOINT, requestStage: 'Request'},
          {urlPattern: SPOT_PAPER_PAIRED_REPORT_ENDPOINT, requestStage: 'Request'},
          {urlPattern: SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT, requestStage: 'Request'}
        ]});
        try {
          await call('Emulation.setDeviceMetricsOverride', {
            width, height: width === 320 ? 568 : width === 390 ? 844 : 900,
            deviceScaleFactor: 1, mobile: width < 600,
            screenWidth: width, screenHeight: width === 320 ? 568 : width === 390 ? 844 : 900
          });
          await unlockAppThroughGate(call, {
            additionalFetchUrls: [SPOT_PAPER_REPORT_ENDPOINT,
              SPOT_PAPER_PAIRED_REPORT_ENDPOINT, SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT]
          });
          const evaluate = async expression => {
            const result = await call('Runtime.evaluate', {
              expression, returnByValue: true, awaitPromise: true
            });
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
          };
          await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
          const mounted = await evaluate(`({
            overview:!!document.querySelector('#paper-bot-overview-root'),
            paired:!!document.querySelector('#paired-paper-report-root'),
            readControls:[...document.querySelectorAll(
              '#paper-bot-overview-section button')].filter(button =>
                button.type==='button' &&
                button.textContent.trim()==='BTC/EUR-Quelle manuell prüfen').length,
            pairedReadControls:[...document.querySelectorAll(
              '#paired-paper-report-section button')].filter(button =>
                button.type==='button' &&
                button.textContent.trim()==='Gepaarte BTC/EUR-Quelle manuell prüfen').length,
            overviewControls:[...document.querySelectorAll(
              '#paper-bot-overview-root button')].map(button=>button.textContent.trim())
          })`);
          assert.equal(mounted.overview, true);
          assert.equal(mounted.paired, true);
          assert.equal(mounted.readControls, 1, 'one explicitly labelled overview read control');
          assert.equal(mounted.pairedReadControls, 1, 'one explicitly labelled paired read control');
          assert.deepEqual(mounted.overviewControls,
            ['Alle Details öffnen', 'Alle Details schließen']);
          assert.equal(reads, 0, 'unlock and navigation do not read report data');
          for (let attempt = 0; attempt < 150 && pairedReads === 0; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(pairedReads, 1,
            'authenticated active-tab entry creates exactly one paired GET');
          const progressUi = await evaluate(`({
            status:document.querySelector('#paired-paper-report-section').textContent,
            buttons:[...document.querySelectorAll('#paired-paper-report-section button')]
              .map(item=>({text:item.textContent,disabled:item.disabled,
                busy:item.getAttribute('aria-busy')}))
          })`);
          assert.equal(progressReads, 1,
            `authenticated active-tab entry creates exactly one progress GET; ` +
            `failure=${failure?.message || 'none'}; ui=${JSON.stringify(progressUi)}`);
          const entryState = width === 320 ? 'unprovisioned' :
            width === 390 ? 'empty' : 'running_snapshot';
          let entryPanel = null;
          for (let attempt = 0; attempt < 150; attempt++) {
            entryPanel = await evaluate(`(()=>{
              const root=document.querySelector('#paired-paper-report-root');
              return {state:root.dataset.state,text:root.textContent};
            })()`);
            if (entryPanel.state === entryState) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(entryPanel?.state, entryState,
            'active entry renders its bounded read result');
          await evaluate(`document.querySelector('#paper-bot-overview-section > summary').click()`);
          await evaluate(`document.querySelector('#paired-paper-report-section > summary').click()`);
          const initial = await evaluate(`({
            text:document.querySelector('#paper-bot-overview-root').textContent,
            paired:document.querySelector('#paired-paper-source-status').textContent,
            pairedPanel:document.querySelector('#paired-paper-report-root').textContent,
            pairedPanelState:document.querySelector('#paired-paper-report-root').dataset.state,
            badges:[...document.querySelectorAll(
              '#paper-bot-overview-root summary .spot-paper-bot-status')].map(element=>{
                const style=getComputedStyle(element),bounds=element.getBoundingClientRect();
                return {text:element.textContent,transform:style.transform,
                  writingMode:style.writingMode,width:bounds.width,height:bounds.height,
                  scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};
              }),
            disabled:[...document.querySelectorAll(
              '#paper-bot-overview-section button')].find(button =>
                button.textContent.trim()==='BTC/EUR-Quelle manuell prüfen').disabled,
            viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth
          })`);
          assert.equal(initial.disabled, false);
          assert.match(initial.text, /In Vorbereitung/);
          assert.match(initial.text, /Unbekannt/);
          assert.match(initial.text, /Checkpoint · beobachtet/);
          assert.match(initial.text, /−5,00\s+€ Verlust/);
          assert.ok(initial.text.includes(new Intl.DateTimeFormat('de-AT', {
            dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Vienna'
          }).format(progressValuationAt)));
          assert.doesNotMatch(initial.text,
            /BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1|CASH_CONTROL_V1/);
          assert.match(initial.pairedPanel, /Beobachteter Checkpoint/);
          assert.match(initial.pairedPanel, /STALE/);
          assert.match(initial.pairedPanel, /Aufgezeichneter EndstatusUNKNOWN/);
          assert.match(initial.pairedPanel, /−0,60\s+€ Verlust/);
          assert.match(initial.pairedPanel, /−5,00\s+€ Verlust/);
          assert.match(initial.pairedPanel, /Fills1/);
          assert.match(initial.pairedPanel, /Position offen/);
          assert.match(initial.pairedPanel, /Abgeschlossene Handelsrunden1/);
          for (const modelId of SPOT_PAPER_PROGRESS_MODEL_IDS) {
            assert.ok(initial.pairedPanel.includes(modelId));
          }
          if (width === 1440) {
            assert.match(initial.pairedPanel, /Checkpoint-Metriken haben.*Vorrang/);
            assert.match(initial.pairedPanel, /Unabhängige AbschlussauthentifizierungNOT_ESTABLISHED/);
          }
          if (width === 320) {
            assert.match(initial.paired, /Transport ist nicht provisioniert/);
            assert.match(initial.pairedPanel, /Transport nicht provisioniert/);
          } else if (width === 390) {
            assert.match(initial.paired, /Kein gepaarter Bericht veröffentlicht/);
            assert.match(initial.pairedPanel, /Kein gepaarter Bericht veröffentlicht/);
          } else {
            assert.match(initial.paired, /Gepaarter Bericht geladen/);
            assert.match(initial.pairedPanel, /CONFIRM2_COOLDOWN10/);
          }
          assert.equal(initial.pairedPanelState, entryState);
          assert.doesNotMatch(initial.pairedPanel, /CORRUPT_UNKNOWN|Report-Projektor/);
          assert.equal(initial.badges.length, 3);
          for (const badge of initial.badges) {
            assert.equal(badge.transform, 'none', JSON.stringify(badge));
            assert.equal(badge.writingMode, 'horizontal-tb', JSON.stringify(badge));
            assert.ok(badge.height < 30, JSON.stringify(badge));
            assert.ok(badge.scrollWidth <= badge.clientWidth + 1, JSON.stringify(badge));
          }
          assert.ok(initial.documentWidth <= initial.viewport + 1,
            `horizontal overflow: ${JSON.stringify(initial)}`);
          const idleImage = await call('Page.captureScreenshot', {format: 'png'});
          writeFileSync(join(evidence, `paper-bot-workspace-${width}-idle.png`),
            Buffer.from(idleImage.data, 'base64'));

          const toggleCheck = await evaluate(`(()=>{
            const root=document.querySelector('#paper-bot-overview-root');
            const buttons=[...root.querySelectorAll('button')];
            const open=buttons.find(button=>button.textContent.trim()==='Alle Details öffnen');
            const close=buttons.find(button=>button.textContent.trim()==='Alle Details schließen');
            const details=[...root.querySelectorAll('details')];
            open.click();
            const allOpened=details.length>0&&details.every(item=>item.open);
            close.click();
            return {
              controls:buttons.map(button=>button.textContent.trim()),
              allOpened,
              allClosed:details.every(item=>!item.open)
            };
          })()`);
          assert.deepEqual(toggleCheck.controls,
            ['Alle Details öffnen', 'Alle Details schließen']);
          assert.equal(toggleCheck.allOpened, true, 'open-all expands bot and trade details');
          assert.equal(toggleCheck.allClosed, true, 'close-all collapses bot and trade details');
          await new Promise(resolve => setTimeout(resolve, 50));
          assert.equal(reads, 0, 'overview disclosure controls do not request the BTC/EUR report');
          assert.equal(pairedReads, 1,
            'overview disclosure controls do not add paired requests');
          assert.equal(progressReads, 1,
            'overview disclosure controls do not add progress requests');
          await evaluate(`[...document.querySelectorAll(
            '#paired-paper-report-section button')].find(button =>
              button.textContent.trim()==='Paper-Checkpoint manuell prüfen').click()`);
          for (let attempt = 0; attempt < 150 && progressReads < 2; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(progressReads, 2,
            'manual checkpoint refresh creates exactly one additional authenticated GET');

          await evaluate(`[...document.querySelectorAll(
            '#paper-bot-overview-section button')].find(button =>
              button.textContent.trim()==='BTC/EUR-Quelle manuell prüfen').click()`);
          for (let attempt = 0; attempt < 150 && reads === 0; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(failure, null, failure?.message);
          assert.equal(reads, 1, 'one manual refresh creates exactly one authenticated GET');
          let unavailable = '';
          for (let attempt = 0; attempt < 150; attempt++) {
           unavailable = await evaluate(`document.querySelector('#paper-bot-overview-section').textContent`);
           if (unavailable.includes('Kein authentifizierter Bericht verfügbar')) break;
           await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.match(unavailable, /Kein authentifizierter Bericht verfügbar/);
          assert.match(unavailable, /In Vorbereitung/);
          assert.doesNotMatch(unavailable, /0,00 €|0 fills/i);
          pairedResponseMode = 'trend';
          await evaluate(`[...document.querySelectorAll(
            '#paired-paper-report-section button')].find(button =>
              button.textContent.trim()==='Gepaarte BTC/EUR-Quelle manuell prüfen').click()`);
          for (let attempt = 0; attempt < 150 && pairedReads < 2; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(failure, null, failure?.message);
          assert.equal(pairedReads, 2, 'explicit refresh creates exactly one additional GET');
          let pairedSnapshot = null;
          const expectedFirstState = 'running_snapshot';
          for (let attempt = 0; attempt < 150; attempt++) {
            pairedSnapshot = await evaluate(`(()=>{
              const root=document.querySelector('#paired-paper-report-root');
              return {state:root.dataset.state,text:root.textContent};
            })()`);
            if (pairedSnapshot.state === expectedFirstState) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(pairedSnapshot?.state, expectedFirstState);
          assert.match(pairedSnapshot.text, /5M-SMA20-Trend/);
          assert.doesNotMatch(pairedSnapshot.text,
            /CORRUPT_UNKNOWN|gemeinsamer Bericht konnte nicht geprüft werden/);
          const image = await call('Page.captureScreenshot', {format: 'png'});
          writeFileSync(join(evidence, `paper-bot-workspace-${width}-${pairedResponseMode}.png`),
            Buffer.from(image.data, 'base64'));

          pairedResponseMode = 'hold';
          await evaluate(`[...document.querySelectorAll(
            '#paired-paper-report-section button')].find(button =>
              button.textContent.trim()==='Gepaarte BTC/EUR-Quelle manuell prüfen').click()`);
          for (let attempt = 0; attempt < 150 && pendingPairedRequestId === null; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.ok(pendingPairedRequestId, 'the pending paired request is intercepted before lock');
          await evaluate(`document.getElementById('app-access-lock').click()`);
          assert.equal(await evaluate(`document.getElementById('app').hidden`), true);
          assert.equal(reads, 1, 'locking clears state without another read');
          assert.doesNotMatch(
            await evaluate(`document.querySelector('#paired-paper-report-root').textContent`),
            /SYNTHETIC FIXTURE|5M-SMA20-Trend/,
            'lock clears private paired DTO before the next unlock');
          try {
            await call('Fetch.fulfillRequest', {
              requestId: pendingPairedRequestId,
              responseCode: 200,
              responseHeaders: [
                {name: 'Access-Control-Allow-Origin', value: '*'},
                {name: 'Content-Type', value: 'application/json; charset=utf-8'},
                {name: 'Cache-Control', value: 'no-store'}
              ],
              body: Buffer.from(JSON.stringify({
                schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
                runId: pairedTrendFixture.identity.runId,
                report: pairedTrendFixture
              })).toString('base64')
            });
          } catch {
            // The browser may already have discarded the paused request after abort.
          }
          await new Promise(resolve => setTimeout(resolve, 50));
          assert.doesNotMatch(
            await evaluate(`document.querySelector('#paired-paper-report-root').textContent`),
            /SYNTHETIC FIXTURE|5M-SMA20-Trend/,
            'a response released after lock cannot repaint private paired data');
          pairedResponseMode = 'trend';
          await unlockAppThroughGate(call, {
            additionalFetchUrls: [SPOT_PAPER_REPORT_ENDPOINT,
              SPOT_PAPER_PAIRED_REPORT_ENDPOINT, SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT]
          });
          await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
          for (let attempt = 0; attempt < 150 && pairedReads < 4; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(reads, 1, 're-unlock does not refresh the legacy report');
          assert.equal(pairedReads, 4,
            're-unlock while active creates exactly one new paired read');
          assert.equal(progressReads, 3,
            're-unlock while active creates exactly one new progress read');
          for (let attempt = 0; attempt < 150; attempt++) {
            const settled = await evaluate(`(()=>{
              const root=document.querySelector('#paired-paper-report-root');
              const refresh=[...document.querySelectorAll(
                '#paired-paper-report-section button')].find(button =>
                  button.textContent.trim()==='Gepaarte BTC/EUR-Quelle manuell prüfen');
              return root.textContent.includes('5M-SMA20-Trend') &&
                !!refresh && !refresh.disabled;
            })()`);
            if (settled) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(await evaluate(`(()=>{
            const root=document.querySelector('#paired-paper-report-root');
            const refresh=[...document.querySelectorAll(
              '#paired-paper-report-section button')].find(button =>
                button.textContent.trim()==='Gepaarte BTC/EUR-Quelle manuell prüfen');
            return root.textContent.includes('5M-SMA20-Trend') &&
              !!refresh && !refresh.disabled;
          })()`),true,'paired result and refresh control settle after active unlock');
          await evaluate(`[...document.querySelectorAll(
            '#paper-bot-overview-section button')].find(button =>
              button.textContent.trim()==='BTC/EUR-Quelle manuell prüfen').click()`);
          for (let attempt = 0; attempt < 150 && reads < 2; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(failure, null, failure?.message);
          assert.equal(reads, 2, 'the second user-initiated read is handled once');
          await evaluate(`[...document.querySelectorAll(
            '#paired-paper-report-section button')].find(button =>
              button.textContent.trim()==='Gepaarte BTC/EUR-Quelle manuell prüfen').click()`);
          for (let attempt = 0; attempt < 150 && pairedReads < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(pairedReads, 5,
            'manual refresh after re-unlock remains explicit and single-flight');
          for (let attempt = 0; attempt < 150; attempt++) {
            const panelText = await evaluate(
              `document.querySelector('#paired-paper-report-root').textContent`);
            if (panelText.includes('SYNTHETIC FIXTURE')) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          const pairedAfterRelock = await evaluate(
            `document.querySelector('#paired-paper-report-root').textContent`);
          assert.match(pairedAfterRelock, /SYNTHETIC FIXTURE/);
          if (pairedResponseMode === 'trend') {
            assert.match(pairedAfterRelock, /5M-SMA20-Trend/);
            assert.match(pairedAfterRelock, /BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1/);
          } else {
            assert.match(pairedAfterRelock, /CONFIRM2_COOLDOWN10/);
            assert.doesNotMatch(pairedAfterRelock, /5M-SMA20-Trend/);
          }
          const validImage = await call('Page.captureScreenshot', {format: 'png'});
          writeFileSync(join(evidence, `paper-bot-workspace-${width}-${pairedResponseMode}.png`),
            Buffer.from(validImage.data, 'base64'));
          const finalSize = await evaluate(`({
            width:innerWidth,
            viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,
            bodyWidth:document.body.scrollWidth,
            overview:!!document.querySelector('#paper-bot-overview-root'),
            paired:!!document.querySelector('#paired-paper-report-root')
          })`);
          assert.equal(finalSize.width, width);
          assert.ok(finalSize.documentWidth <= finalSize.viewport + 1);
          assert.ok(finalSize.bodyWidth <= finalSize.viewport + 1);
          console.log('V11_PAPER_BOT_WORKSPACE_SIZE', JSON.stringify(finalSize));
          return finalSize;
        } finally {
          off();
          await call('Fetch.disable');
        }
      });
      assert.equal(metrics.width, width);
    }
  } finally {
    await hosted.close();
  }
});
