import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
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
import {
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';

const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome',
  '/usr/bin/chromium'].find(path => path && existsSync(path));
const sizes = [320, 390, 1440];
const pairedIdentity = syntheticExpectedPairedIdentity();
const pairedFixture = syntheticPairedDashboard(pairedIdentity);

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

test('real M11 workspace authenticates both manual sources and renders paired fixture at 320/390px', {
  timeout: 180_000
}, async () => {
  const name = 'real M11 workspace authenticates both manual sources and renders paired fixture at 320/390px';
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
        let failure = null;
        const off = call.onEvent('Fetch.requestPaused', event => {
          void (async () => {
            if (event.request.url === VERIFY_ENDPOINT) return;
            if (![SPOT_PAPER_REPORT_ENDPOINT, SPOT_PAPER_PAIRED_REPORT_ENDPOINT]
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
            } else {
              pairedReads++;
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
                  runId: pairedIdentity.runId,
                  report: pairedFixture
                })).toString('base64')
              });
            }
          })().catch(error => { failure = error; });
        });
        await call('Fetch.enable', {patterns: [
          {urlPattern: SPOT_PAPER_REPORT_ENDPOINT, requestStage: 'Request'},
          {urlPattern: SPOT_PAPER_PAIRED_REPORT_ENDPOINT, requestStage: 'Request'}
        ]});
        try {
          await call('Emulation.setDeviceMetricsOverride', {
            width, height: width === 320 ? 568 : width === 390 ? 844 : 900,
            deviceScaleFactor: 1, mobile: width < 600,
            screenWidth: width, screenHeight: width === 320 ? 568 : width === 390 ? 844 : 900
          });
          await unlockAppThroughGate(call, {
            additionalFetchUrls: [SPOT_PAPER_REPORT_ENDPOINT, SPOT_PAPER_PAIRED_REPORT_ENDPOINT]
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
            reads:document.querySelectorAll('#paper-bot-overview-section button').length,
            pairedReads:document.querySelectorAll('#paired-paper-report-section button').length
          })`);
          assert.equal(mounted.overview, true);
          assert.equal(mounted.paired, true);
          assert.equal(mounted.reads, 1);
          assert.equal(mounted.pairedReads, 1);
          assert.equal(reads, 0, 'unlock and navigation do not read report data');
          assert.equal(pairedReads, 0, 'unlock and navigation do not read paired data');
          await evaluate(`document.querySelector('#paper-bot-overview-section > summary').click()`);
          await evaluate(`document.querySelector('#paired-paper-report-section > summary').click()`);
          const initial = await evaluate(`({
            text:document.querySelector('#paper-bot-overview-root').textContent,
            paired:document.querySelector('#paired-paper-source-status').textContent,
            disabled:document.querySelector('#paper-bot-overview-section button').disabled,
            viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth
          })`);
          assert.equal(initial.disabled, false);
          assert.match(initial.text, /In Vorbereitung/);
          assert.match(initial.text, /Unbekannt/);
          assert.match(initial.paired, /Run-, Quellen-, Profil-, Fingerabdruck- und Host-Identität bleiben unbekannt/);
          assert.ok(initial.documentWidth <= initial.viewport + 1,
            `horizontal overflow: ${JSON.stringify(initial)}`);

          await evaluate(`document.querySelector('#paper-bot-overview-section button').click()`);
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
          await evaluate(`document.querySelector('#paired-paper-report-section button').click()`);
          for (let attempt = 0; attempt < 150 && pairedReads === 0; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(failure, null, failure?.message);
          assert.equal(pairedReads, 1, 'one manual paired refresh creates exactly one GET');
          let pairedText = '';
          for (let attempt = 0; attempt < 150; attempt++) {
            pairedText = await evaluate(`document.querySelector('#paired-paper-report-root').textContent`);
            if (pairedText.includes('SYNTHETIC FIXTURE')) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.match(pairedText, /SYNTHETIC FIXTURE/);
          assert.match(pairedText, /BTC_EUR_RESEARCH_TEST_V1/);
          assert.match(pairedText, /RUNNING_SNAPSHOT/);
          const image = await call('Page.captureScreenshot', {format: 'png'});
          writeFileSync(join(evidence, `paper-bot-workspace-${width}.png`),
            Buffer.from(image.data, 'base64'));

          await evaluate(`document.getElementById('app-access-lock').click()`);
          assert.equal(await evaluate(`document.getElementById('app').hidden`), true);
          assert.equal(reads, 1, 'locking clears state without another read');
          await unlockAppThroughGate(call, {
            additionalFetchUrls: [SPOT_PAPER_REPORT_ENDPOINT, SPOT_PAPER_PAIRED_REPORT_ENDPOINT]
          });
          await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
          assert.equal(reads, 1, 're-unlock and navigation do not automatically refresh');
          assert.doesNotMatch(
            await evaluate(`document.querySelector('#paired-paper-report-root').textContent`),
            /SYNTHETIC FIXTURE/,
            'lock clears the paired DTO too');
          await evaluate(`document.querySelector('#paper-bot-overview-section button').click()`);
          for (let attempt = 0; attempt < 150 && reads < 2; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(failure, null, failure?.message);
          assert.equal(reads, 2, 'the second user-initiated read is handled once');
          await evaluate(`document.querySelector('#paired-paper-report-section button').click()`);
          for (let attempt = 0; attempt < 150 && pairedReads < 2; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(pairedReads, 2, 're-unlock requires a second manual paired read');
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
