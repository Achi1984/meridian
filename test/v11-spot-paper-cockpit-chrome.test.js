import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {unlockAppThroughGate} from './helpers/v11-app-access-browser.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';
import {SPOT_PAPER_REPORT_ENDPOINT} from '../v11/spot-paper-cockpit-controller.js';
import {getAcceptedSpotPaperIdentity, SPOT_PAPER_REPORT_ENVELOPE_SCHEMA} from
  '../scripts/spot-paper-report-bridge/contract.mjs';

const name = 'BTC/EUR cockpit is manual, authenticated, and renders only the versioned report';
const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(path => path && existsSync(path));
const token = 'synthetic-browser-gate-password';
const accepted = getAcceptedSpotPaperIdentity();

function dto(accepted = getAcceptedSpotPaperIdentity()) {
  return {
    schemaVersion: 'BTC_EUR_SPOT_PAPER_DASHBOARD_V1',
    identity: {
      runId: accepted.runId,
      sourceSha: accepted.sourceSha,
      workflowSha: accepted.workflowSha,
      workflowRunId: accepted.workflowRunId,
      workflowRunNumber: 1,
      workflowRunAttempt: 1,
      profileId: accepted.profileId,
      model: accepted.model,
      pair: accepted.pair
    },
    acceptedDispatchContext: {
      status: 'PASS',
      workflowRunId: accepted.workflowRunId,
      workflowRunNumber: 1,
      workflowRunAttempt: 1
    },
    snapshot: {
      status: 'COMPLETED_BOUNDED',
      completedAt: new Date().toISOString(),
      stopReason: 'CYCLE_LIMIT'
    },
    startingBalanceCents: '100000',
    cashCents: '89643',
    equityCents: '99525',
    realizedPnlCents: '-357',
    unrealizedPnlCents: '-118',
    feesCents: '350',
    buyCount: 4,
    sellCount: 3,
    fillCount: 7,
    openInventory: {status: 'OPEN_UNRESOLVED_AT_TERMINAL', quantitySat: '146122'},
    duration: {
      elapsedMs: accepted.maxDurationMs - 57_098,
      requestedMs: accepted.maxDurationMs,
      coverage: (accepted.maxDurationMs - 57_098) / accepted.maxDurationMs,
      status: 'PARTIAL_BOUNDED_DURATION'
    },
    coverage: {
      observations: accepted.maxCycles, acceptedObservations: accepted.maxCycles,
      dataGaps: 0, requests: accepted.maxRequests
    },
    verification: {
      terminalReadback: 'PASS',
      assessment: 'COMPLETED',
      assessmentSignalReplay: 'NOT_PERFORMED',
      signalReplay: 'PASS',
      profitability: 'NOT_ASSESSED'
    }
  };
}

function runFlaggedBrowserTest() {
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--experimental-websocket', '--test',
    `--test-name-pattern=^${name}$`, fileURLToPath(import.meta.url)],
  {env, encoding: 'utf8', timeout: 120_000});
}

function assertNamedTestPassed(output) {
  const success = output.split(/\r?\n/).some(line =>
    /^ok \d+ - /.test(line) && line.includes(` - ${name}`));
  assert.ok(success, `the named browser test must pass:\n${output}`);
}

async function interceptReport(call, accepted) {
  const responseBody = Buffer.from(JSON.stringify({
    schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
    runId: accepted.runId,
    report: dto(accepted)
  })).toString('base64');
  let reads = 0;
  let failure;
  const off = call.onEvent('Fetch.requestPaused', event => {
    void (async () => {
      assert.equal(event.request.url, SPOT_PAPER_REPORT_ENDPOINT);
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
      const auth = Object.entries(event.request.headers || {})
        .find(([key]) => key.toLowerCase() === 'authorization')?.[1];
      assert.equal(auth, 'Bearer ' + token);
      reads++;
      await call('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [
          {name: 'Access-Control-Allow-Origin', value: '*'},
          {name: 'Content-Type', value: 'application/json; charset=utf-8'},
          {name: 'Cache-Control', value: 'no-store'}
        ],
        body: responseBody
      });
    })().catch(error => { failure = error; });
  });
  await call('Fetch.enable', {
    patterns: [{urlPattern: `${SPOT_PAPER_REPORT_ENDPOINT}*`, requestStage: 'Request'}]
  });
  return {
    reads: () => reads,
    assertHealthy() { if (failure) throw failure; },
    async close() { off(); await call('Fetch.disable'); }
  };
}

test(name, {timeout: 180_000}, async () => {
  if (typeof WebSocket !== 'function') {
    const child = runFlaggedBrowserTest();
    assert.equal(child.status, 0,
      String(child.stdout).slice(-2000) + String(child.stderr).slice(-1000));
    assertNamedTestPassed(child.stdout);
    return;
  }
  assert.ok(chrome, 'Chrome is required for the BTC/EUR cockpit browser test');
  const hosted = await startV11StaticServer();
  try {
    for (const identity of [accepted, getAcceptedSpotPaperIdentity('spot-paper-42404743386-1')])
    await withMobileChrome(chrome, 390, hosted.url, async call => {
      await unlockAppThroughGate(call);
      const intercepted = await interceptReport(call, identity);
      try {
        const evaluate = async expression => {
          const result = await call('Runtime.evaluate', {
            expression, returnByValue: true, awaitPromise: true
          });
          assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
          return result.result?.value;
        };
        await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
        assert.equal(await evaluate(`!!document.querySelector('#spot-paper-cockpit-root')`), true);
        assert.equal(intercepted.reads(), 0, 'unlock and navigation do not read the report');
        assert.equal(await evaluate(`document.getElementById('paper-history-section').open`), false,
          'previous reports start collapsed');
        await evaluate(`document.querySelector('#paper-history-section > summary').click()`);
        assert.equal(await evaluate(`document.getElementById('paper-history-section').open &&
          document.querySelector('#spot-paper-cockpit-root button').getBoundingClientRect().height >= 44`), true,
          'opening history exposes a usable manual report control');
        assert.equal(intercepted.reads(), 0, 'opening history does not read the report');
        await evaluate(`document.querySelector('#spot-paper-cockpit-root button').click()`);
        for (let attempt = 0; attempt < 150; attempt++) {
          if (await evaluate(`document.querySelector('#spot-paper-cockpit-root').textContent.includes('OPEN_UNRESOLVED_AT_TERMINAL')`)) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        intercepted.assertHealthy();
        const diagnostics = await evaluate(`(()=>{
          const root=document.querySelector('#spot-paper-cockpit-root');
          const button=root.querySelector('button');
          return {state:root.dataset.state,hidden:button.hidden,disabled:button.disabled,text:root.textContent};
        })()`);
        assert.equal(intercepted.reads(), 1,
          `only the explicit manual refresh reads the report: ${JSON.stringify(diagnostics)}`);
        assert.ok(diagnostics.text.includes(identity.workflowRunId));
        assert.ok(diagnostics.text.includes(identity.profileId));
        assert.ok(diagnostics.text.includes(identity.maxDurationMs === 14_400_000 ?
          '4 Stunden' : '1 Stunde'));
        const visible = await evaluate(`(()=>{
          const root=document.querySelector('#spot-paper-cockpit-root');
          return {
            title:root.textContent.includes('BTC/EUR Paper – echte Marktdaten, simulierte Trades'),
            snapshot:root.textContent.includes('Abgeschlossen (begrenzt)'),
            negative:root.textContent.includes('−3,57 €'),
            inventory:root.textContent.includes('146122 sat'),
            noRunning:!root.textContent.includes('RUNNING'),
            noDisconnectedPreview:root.querySelector('.spot-paper-fixture').hidden,
            state:root.dataset.state
          };
        })()`);
        assert.deepEqual(visible, {
          title: true, snapshot: true, negative: true, inventory: true,
          noRunning: true, noDisconnectedPreview: true, state: 'terminal'
        });
      } finally {
        await intercepted.close();
      }
    });
  } finally {
    await hosted.close();
  }
});
