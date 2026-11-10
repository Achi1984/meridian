import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';
import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODELS,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA
} from '../scripts/spot-paper-paired-report/contract.mjs';
import {presentSpotPaperPairedReport} from '../v11/spot-paper-paired-model.js';
import {mountSpotPaperPairedPanel} from '../v11/spot-paper-paired-controller.js';
import {renderSpotPaperPaired} from '../v11/spot-paper-paired-view.js';

class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Paired paper panel must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
}

function harness() {
  const document = {createElement: tag => new Element(document, tag)};
  return {root: new Element(document, 'section'), document};
}

const startAt = Date.UTC(2026, 10, 8, 12);
const roles = [
  ['baseline', 'BTC_EUR_SMA5_SMA20_V1'],
  ['challenger', 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1'],
  ['cash', 'CASH_CONTROL_V1']
];

function arm(role, overrides = {}) {
  const [, modelId] = roles.find(([name]) => name === role);
  return {
    role,
    modelId,
    tradingStoppedAt: startAt + 28_750_000,
    stopReason: role === 'baseline' ? 'SAMPLED_2PCT_BID_STOP' : null,
    inventoryStatus: role === 'challenger' ? 'OPEN' : 'FLAT',
    cashCents: 90_000,
    netEquityCents: 100_000,
    netPnlCents: 0,
    bookedFeesCents: 125,
    modeledSlippageCents: 25,
    hypotheticalExitFeeCents: null,
    hypotheticalExitSlippageCents: null,
    turnoverCents: 25_000,
    fillCount: role === 'baseline' ? 2 : 0,
    exposureCents: role === 'challenger' ? 10_000 : 0,
    sampledDrawdownCents: 250,
    relativeDrawdownBps: 25,
    unresolvedObservations: 0,
    metricReasons: {
      hypotheticalExitFeeCents: 'NOT_REPORTED_BY_REPORT_SCHEMA',
      hypotheticalExitSlippageCents: 'NOT_REPORTED_BY_REPORT_SCHEMA'
    },
    ...overrides
  };
}

function delta(status, netPnlCents = null, reason = 'NOT_COMPARABLE') {
  return {
    status,
    reason: status === 'UNAVAILABLE' ? reason : null,
    netEquityCents: status === 'AVAILABLE' ? netPnlCents : null,
    netPnlCents: status === 'AVAILABLE' ? netPnlCents : null
  };
}

function dto(overrides = {}) {
  const models = roles.map(([role, modelId]) => ({role, modelId}));
  const emptyDelta = delta('AVAILABLE', 0);
  return {
    schemaVersion: SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA,
    evidenceStatus: 'VERIFIED_COMPLETE',
    evidenceQualification: 'STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED',
    reasonCode: 'UNKNOWN',
    syntheticFixture: true,
    independentAuthentication: 'NOT_ESTABLISHED',
    identity: {
      runId: 'paired-synthetic-001',
      pair: 'BTC/EUR',
      sourceSha256: '1'.repeat(64),
      configSha256: '2'.repeat(64),
      researchSourceSha256: '3'.repeat(64),
      models
    },
    timing: {
      requestedDurationMs: 28_800_000,
      observedCoverageMs: 28_799_000,
      actualElapsedMs: 28_800_000,
      runStoppedAt: startAt + 28_800_000,
      valuationAt: startAt + 28_799_000,
      requestedCycles: 480,
      attemptedCycles: 480,
      completedCycles: 479,
      stopReason: 'CYCLE_LIMIT'
    },
    assumptions: {feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false},
    arms: {
      baseline: arm('baseline', {netPnlCents: -125, netEquityCents: 99_875}),
      challenger: arm('challenger', {netPnlCents: 250, netEquityCents: 100_250}),
      cash: arm('cash', {
        inventoryStatus: 'FLAT',
        cashCents: 100_000,
        netPnlCents: 0,
        netEquityCents: 100_000,
        bookedFeesCents: 0,
        modeledSlippageCents: 0,
        turnoverCents: 0,
        fillCount: 0
      })
    },
    deltas: {
      status: 'AVAILABLE',
      reason: null,
      challengerMinusBaseline: delta('AVAILABLE', 375),
      baselineMinusCash: delta('AVAILABLE', -125),
      challengerMinusCash: delta('AVAILABLE', 250)
    },
    decision: 'NO_WINNER_OR_PROMOTION',
    ...overrides
  };
}

function trendDto() {
  const input = dto();
  input.identity.modelPairId = SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR;
  input.identity.models = input.identity.models.map((model, index) => ({
    ...model,
    modelId: SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[index]
  }));
  for (const [index, role] of ['baseline', 'challenger', 'cash'].entries()) {
    input.arms[role].modelId = SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[index];
  }
  input.trendActivityDiagnostic = {
    schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
    status: 'PARTIAL_COVERAGE',
    completedRoundTripCount: 0,
    requiredCompletedRoundTrips: 5,
    observedCoverageMs: input.timing.actualElapsedMs,
    requiredCoverageMs: 86_400_000,
    completeWindow: false,
    forcedTrades: false,
    deadlineExtensionAllowed: false,
    profitability: 'NOT_ASSESSED'
  };
  return input;
}

const visit = element => [element, ...element.children.flatMap(visit)];

test('binds the shared projector and maps its canonical evidence DTO', () => {
  const input = dto();
  const shared = projectSpotPaperPairedDashboard(input);
  assert.ok(shared, 'the canonical shared projector accepts the fixture');
  const model = presentSpotPaperPairedReport(input);
  assert.equal(model.available, true);
  assert.equal(model.status, 'VERIFIED_COMPLETE');
  assert.equal(model.challengerLabel, 'CONFIRM2_COOLDOWN10');
  assert.equal(model.qualification,
    'STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED');
  assert.equal(model.authentication, 'NOT_ESTABLISHED');
  assert.equal(model.identity.pair, 'BTC/EUR');
  assert.equal(model.freshness.status, 'UNKNOWN');
  assert.match(model.freshness.reason, /nicht geliefert/);

  const {root, document} = harness();
  renderSpotPaperPaired(root, input, document);
  assert.match(root.textContent, /SYNTHETIC FIXTURE/);
  assert.match(root.textContent, /VERIFIED_COMPLETE/);
  assert.match(root.textContent, /nicht unabhängig authentifiziert/);
  assert.match(root.textContent, /NOT_ESTABLISHED/);
  assert.match(root.textContent, /Angeforderte Abdeckung8 Std\./);
  assert.match(root.textContent, /Beobachtete gemeinsame Abdeckung7 Std\. 59 Min\. 59 Sek\./);
  assert.match(root.textContent, /08\.11\.2026, 20:59:59 \(Europe\/Wien\)/);
  assert.match(root.textContent, /08\.11\.2026, 21:00:00 \(Europe\/Wien\)/);
  assert.match(root.textContent, /−1,25 € Verlust/);
  assert.match(root.textContent, /\+2,50 € Gewinn/);
  assert.match(root.textContent, /Gebuchte Gebühren1,25 €/);
  assert.match(root.textContent, /Modellierter Slippage0,25 €/);
  assert.match(root.textContent, /Fills2/);
  assert.match(root.textContent, /Fills0/);
  assert.match(root.textContent, /Position offen/);
  assert.match(root.textContent, /Sitzungsverlust-Limit|Stichproben-Stopp/);
  assert.match(root.textContent, /Unbekannt — NOT_REPORTED_BY_REPORT_SCHEMA/);
  assert.match(root.textContent, /Challenger minus Baseline · Netto-PnL\+3,75 € Gewinn/);
  assert.match(root.textContent, /Baseline minus Cash · Netto-PnL−1,25 € Verlust/);
  assert.match(root.textContent, /Challenger minus Cash · Netto-PnL\+2,50 € Gewinn/);
  assert.match(root.textContent, /AktualitätUnbekannt/);
  assert.match(root.textContent, /Hebel: Unbekannt/);
  assert.doesNotMatch(root.textContent, /echte Bestände:/i);
  assert.equal(root.attrs.role, 'region');
  assert.equal(root.attrs['data-state'], 'verified_complete');
  const status = visit(root).find(item => item.attrs['aria-live'] === 'polite');
  assert.equal(status.attrs.role, 'status');
  assert.equal(visit(root).some(item =>
    ['BUTTON', 'INPUT', 'SELECT', 'FORM'].includes(item.tagName)), false);
  const loss = visit(root).find(item => item.textContent === '−1,25 € Verlust');
  const gain = visit(root).find(item => item.textContent === '+2,50 € Gewinn');
  assert.equal(loss.className, 'tone-danger');
  assert.equal(gain.className, 'tone-safe');
});

test('uses canonical interrupted and running snapshot statuses without promotion', () => {
  for (const [evidenceStatus, expected] of [
    ['INTERRUPTED', 'INTERRUPTED · unterbrochener Lauf'],
    ['RUNNING_SNAPSHOT', 'RUNNING_SNAPSHOT · vorläufiger Zwischenstand'],
    ['CORRUPT_UNKNOWN', 'CORRUPT_UNKNOWN · unbekannt oder fehlerhaft']
  ]) {
    const {root, document} = harness();
    renderSpotPaperPaired(root, dto({evidenceStatus}), document);
    assert.ok(root.textContent.includes(expected));
    assert.ok(root.textContent.includes('NO_WINNER_OR_PROMOTION'));
  }
});

test('unavailable deltas and missing values retain DTO reason codes', () => {
  const unknown = {
    status: 'UNAVAILABLE',
    reason: 'COMMON_HORIZON_MARK_UNAVAILABLE',
    challengerMinusBaseline: delta('UNAVAILABLE', null, 'COMMON_HORIZON_MARK_UNAVAILABLE'),
    baselineMinusCash: delta('UNAVAILABLE', null, 'COMMON_HORIZON_MARK_UNAVAILABLE'),
    challengerMinusCash: delta('UNAVAILABLE', null, 'COMMON_HORIZON_MARK_UNAVAILABLE')
  };
  const input = dto({
    arms: {
      ...dto().arms,
      challenger: arm('challenger', {
        netEquityCents: null,
        netPnlCents: null,
        bookedFeesCents: null,
        metricReasons: {
          netEquityCents: 'COMMON_HORIZON_MARK_UNAVAILABLE',
          netPnlCents: 'COMMON_HORIZON_MARK_UNAVAILABLE',
          bookedFeesCents: 'METRIC_MISSING'
        }
      })
    },
    deltas: unknown
  });
  const model = presentSpotPaperPairedReport(input);
  assert.equal(model.arms.challenger.metrics.netPnlCents.value, null);
  assert.equal(model.arms.challenger.metrics.fillCount.value, 0);
  assert.equal(model.deltaStatus, 'UNAVAILABLE');

  const {root, document} = harness();
  renderSpotPaperPaired(root, input, document);
  assert.match(root.textContent, /Netto-PnLUnbekannt — COMMON_HORIZON_MARK_UNAVAILABLE/);
  assert.match(root.textContent, /Gebuchte GebührenUnbekannt — METRIC_MISSING/);
  assert.match(root.textContent, /Differenzen nicht verfügbar — COMMON_HORIZON_MARK_UNAVAILABLE/);
  assert.match(root.textContent, /Fills0/);
  const unknownPnl = visit(root).find(item =>
    item.textContent === 'Unbekannt — COMMON_HORIZON_MARK_UNAVAILABLE');
  assert.ok(unknownPnl);
});

test('unknown or invalid DTOs fail closed and loading remains host-controlled', () => {
  assert.equal(presentSpotPaperPairedReport({schemaVersion: 'wrong'}).available, false);
  const bad = dto();
  bad.evidenceQualification = 'CLAIMED_AUTHENTICATED';
  assert.equal(presentSpotPaperPairedReport(bad).available, false);

  const loading = harness();
  const panel = mountSpotPaperPairedPanel(loading.root, {
    dto: dto(),
    document: loading.document,
    loading: true
  });
  assert.match(loading.root.textContent, /Bericht wird geladen/);
  assert.equal(loading.root.attrs['data-state'], 'loading');
  panel.setLoading(false);
  assert.match(loading.root.textContent, /VERIFIED_COMPLETE/);
  panel.render(dto({evidenceStatus: 'INTERRUPTED'}));
  assert.match(loading.root.textContent, /INTERRUPTED/);
  panel.dispose();
  assert.equal(loading.root.children.length, 0);
  assert.equal(panel.render(), null);
});

test('empty paired states stay distinct from invalid non-null DTOs', () => {
  for (const [state, expectedState, expectedStatus] of [
    ['ready', 'idle', 'NOT_REQUESTED'],
    ['loading', 'loading', 'LOADING'],
    ['transport_unavailable', 'unprovisioned', 'TRANSPORT_UNAVAILABLE'],
    ['not_found', 'empty', 'NO_PUBLISHED_REPORT']
  ]) {
    const model = presentSpotPaperPairedReport(null, {state});
    assert.equal(model.available, false);
    assert.equal(model.state, expectedState);
    assert.equal(model.status, expectedStatus);
  }

  const {root, document} = harness();
  renderSpotPaperPaired(root, null, document, {state: 'loading', loading: true});
  assert.equal(root.attrs['data-state'], 'loading');
  assert.match(root.textContent, /Bericht wird geladen/);
  assert.doesNotMatch(root.textContent, /CORRUPT_UNKNOWN|Report-Projektor/);

  renderSpotPaperPaired(root, null, document, {state: 'transport_unavailable'});
  assert.equal(root.attrs['data-state'], 'unprovisioned');
  assert.match(root.textContent, /Transport nicht provisioniert/);
  assert.match(root.textContent, /Kennzahlen und Identität bleiben/);
  assert.doesNotMatch(root.textContent, /CORRUPT_UNKNOWN|Report-Projektor/);

  renderSpotPaperPaired(root, {schemaVersion: 'wrong'}, document);
  assert.equal(root.attrs['data-state'], 'error');
  assert.match(root.textContent, /CORRUPT_UNKNOWN/);
  assert.match(root.textContent, /Fehler: gemeinsamer Bericht konnte nicht geprüft werden/);

  renderSpotPaperPaired(root, {schemaVersion: 'wrong'}, document, {
    state: 'loading',
    loading: true
  });
  assert.equal(root.attrs['data-state'], 'error');
  assert.match(root.textContent, /CORRUPT_UNKNOWN/);
});

test('challenger identity and validated trend diagnostic survive presentation', () => {
  const input = trendDto();
  const model = presentSpotPaperPairedReport(input);
  assert.equal(model.identity.modelPairId, SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR);
  assert.deepEqual(model.trendActivityDiagnostic, input.trendActivityDiagnostic);
  assert.equal(model.challengerLabel, 'CONFIRM2_COOLDOWN10 · 5M-SMA20-Trend');

  const {root, document} = harness();
  renderSpotPaperPaired(root, input, document);
  assert.match(root.textContent, /CONFIRM2_COOLDOWN10 · 5M-SMA20-Trend/);
  assert.match(root.textContent, new RegExp(SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR));
  assert.match(root.textContent, /0\/5 abgeschlossene Rundreisen/);
  assert.match(root.textContent, /Profitabilität: NOT_ASSESSED/);
});

test('panel source has no implicit network, timer, storage, or HTML injection paths', () => {
  const files = [
    '../v11/spot-paper-paired-model.js',
    '../v11/spot-paper-paired-view.js',
    '../v11/spot-paper-paired-controller.js'
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(files,
    /\bfetch\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(|localStorage|sessionStorage|indexedDB|\.innerHTML\s*=/);
});

test('mobile Chrome renders canonical synthetic DTO without horizontal overflow', {
  timeout: 180_000
}, async () => {
  if (typeof WebSocket !== 'function') {
    const name = 'mobile Chrome renders canonical synthetic DTO without horizontal overflow';
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--experimental-websocket', '--test',
      `--test-name-pattern=^${name}$`, fileURLToPath(import.meta.url)], {
      env, encoding: 'utf8', timeout: 170_000
    });
    assert.equal(child.status, 0,
      `${String(child.stdout).slice(-2500)}${String(child.stderr).slice(-1000)}`);
    assert.match(child.stdout, /V11_SPOT_PAPER_PAIRED_SIZE .*"width":320/);
    assert.match(child.stdout, /V11_SPOT_PAPER_PAIRED_SIZE .*"width":390/);
    return;
  }
  const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome',
    '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(chrome, 'Chrome is required for paired panel mobile evidence');
  const hosted = await startV11StaticServer();
  const evidence = process.env.V11_SPOT_PAPER_PAIRED_EVIDENCE_DIR ||
    process.env.V11_PAPER_COCKPIT_EVIDENCE_DIR ||
    process.env.V11_A2_EVIDENCE_DIR ||
    join(tmpdir(), 'meridian-spot-paper-paired-evidence');
  mkdirSync(evidence, {recursive: true});
  try {
    for (const width of [320, 390]) {
      const metrics = await withMobileChrome(chrome, width, hosted.url, async call => {
        const fixture = JSON.stringify(dto());
        const expression = `(async()=>{
          const {mountSpotPaperPairedPanel}=await import(
            './spot-paper-paired-controller.js?v=B16-M11-FIX16');
          const root=document.createElement('section');
          root.id='paired-panel';
          document.documentElement.style.margin='0';
          document.body.style.margin='0';
          document.body.replaceChildren(root);
          mountSpotPaperPairedPanel(root,{dto:${fixture}});
          return {
            width:innerWidth,
            viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,
            bodyWidth:document.body.scrollWidth,
            panelWidth:root.clientWidth,
            panelScrollWidth:root.scrollWidth,
            heading:document.getElementById(root.getAttribute('aria-labelledby'))?.textContent,
            labelled:!!document.getElementById(root.getAttribute('aria-labelledby')),
            status:root.querySelector('[role="status"]')?.textContent,
            synthetic:root.textContent.includes('SYNTHETIC FIXTURE'),
            loss:root.textContent.includes('−1,25 € Verlust'),
            controls:root.querySelectorAll('button,input,select,form').length,
            armCount:root.querySelectorAll('[aria-label$="Arm"]').length
          };
        })()`;
        const response = await call('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true
        });
        assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        const result = response.result.value;
        assert.equal(result.width, width);
        assert.ok(result.documentWidth <= result.viewport + 1,
          `document overflow at ${width}px: ${JSON.stringify(result)}`);
        assert.ok(result.bodyWidth <= result.viewport + 1,
          `body overflow at ${width}px: ${JSON.stringify(result)}`);
        assert.ok(result.panelScrollWidth <= result.panelWidth + 1,
          `panel overflow at ${width}px: ${JSON.stringify(result)}`);
        assert.equal(result.labelled, true);
        assert.match(result.heading, /Gepaarter Paper-Vergleich/);
        assert.match(result.status, /VERIFIED_COMPLETE/);
        assert.equal(result.synthetic, true);
        assert.equal(result.loss, true);
        assert.equal(result.controls, 0);
        assert.equal(result.armCount, 3);
        const image = await call('Page.captureScreenshot', {format: 'png'});
        writeFileSync(join(evidence, `paired-paper-${width}.png`),
          Buffer.from(image.data, 'base64'));
        return result;
      });
      console.log('V11_SPOT_PAPER_PAIRED_SIZE', JSON.stringify(metrics));
    }
  } finally {
    await hosted.close();
  }
});
