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
  presentSpotPaperPairedReport
} from '../v11/spot-paper-paired-model.js';
import {
  mountSpotPaperPairedPanel
} from '../v11/spot-paper-paired-controller.js';
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

function amount(value, reason) {
  return {value, reason};
}

function projected(overrides = {}) {
  const horizonKey = 'same-8h-window';
  const arm = (pnl, positionStatus = 'STOPPED_FLAT') => ({
    horizonKey,
    netEquityCents: amount('100125'),
    netPnlCents: amount(pnl),
    feesCents: amount('125'),
    turnoverCents: amount('250000'),
    trades: amount(2),
    exposureCents: amount('0'),
    sampledDrawdownCents: amount('250'),
    positionStatus
  });
  return {
    status: 'VERIFIED_COMPLETE',
    identity: {runId: 'synthetic-fixture-run-01'},
    observedAt: '2026-11-08T12:00:00.000Z',
    freshness: {status: 'FRESH'},
    coverage: {actualDurationMs: 28_800_000},
    feed: {pair: 'BTC/EUR', shared: true, noLeverage: true},
    arms: {
      baseline: {...arm('-125'), runId: 'baseline-stopped-synthetic-01'},
      challenger: {...arm('250'), runId: 'confirm2-cooldown10-synthetic-01'},
      cash: {...arm('0'), runId: 'cash-control-synthetic-01'}
    },
    comparison: {
      valid: true,
      horizonKey,
      challengerVsBaselineNetPnlCents: amount('375'),
      cashVsBaselineNetPnlCents: amount('125')
    },
    ...overrides
  };
}

const fixtureDto = Object.freeze({fixtureOnly: 'SYNTHETIC_FIXTURE'});
const syntheticProjector = () => projected();
const visit = element => [element, ...element.children.flatMap(visit)];

test('requires an injected shared DTO projector and has no production fixture fallback', () => {
  const absent = presentSpotPaperPairedReport(fixtureDto);
  assert.equal(absent.available, false);
  assert.equal(absent.status, 'UNKNOWN');
  assert.match(absent.reason, /noch nicht verbunden/);

  const {root, document} = harness();
  mountSpotPaperPairedPanel(root, {dto: fixtureDto, document});
  assert.match(root.textContent, /UNKNOWN/);
  assert.match(root.textContent, /Keine Berichtsdaten verbunden/);
  assert.doesNotMatch(root.textContent, /synthetic-fixture-run-01|1\.001,25/);

  const loading = harness();
  renderSpotPaperPaired(loading.root, null, loading.document, {loading: true});
  assert.match(loading.root.textContent, /Bericht wird geladen/);
  assert.equal(loading.root.attrs['data-state'], 'loading');

  const failed = harness();
  renderSpotPaperPaired(failed.root, fixtureDto, failed.document, {
    projectReport() { throw new Error('fixture validation failure'); }
  });
  assert.match(failed.root.textContent, /Fehler: Bericht konnte nicht validiert werden/);
  assert.equal(failed.root.attrs['data-state'], 'error');
});

test('shows signed PnL, EUR units, virtual capital, freshness and run identity', () => {
  const model = presentSpotPaperPairedReport(fixtureDto, {
    projectReport: syntheticProjector
  });
  assert.equal(model.status, 'VERIFIED_COMPLETE');
  assert.equal(model.arms.baseline.metrics.netPnlCents.label, '−1,25 € Verlust');
  assert.equal(model.arms.challenger.metrics.netPnlCents.label, '+2,50 € Gewinn');
  assert.equal(model.arms.cash.metrics.netPnlCents.label, '0,00 €');

  const {root, document} = harness();
  renderSpotPaperPaired(root, fixtureDto, document, {
    projectReport: syntheticProjector,
    preview: true
  });
  assert.match(root.textContent, /SYNTHETIC FIXTURE · nur Vorschau/);
  assert.match(root.textContent, /RUNNING|INTERRUPTED|VERIFIED_COMPLETE/);
  assert.match(root.textContent, /3\.000,00 €/);
  assert.match(root.textContent, /Echte Bestände: nicht Teil dieses Panels/);
  assert.match(root.textContent, /1\.001,25 €/);
  assert.match(root.textContent, /−1,25 € Verlust/);
  assert.match(root.textContent, /\+2,50 € Gewinn/);
  assert.match(root.textContent, /8 Std\. von 8 Std\. angefordert/);
  assert.match(root.textContent, /von 8 Std\. angefordert/);
  assert.match(root.textContent, /synthetic-fixture-run-01/);
  assert.match(root.textContent, /baseline-stopped-synthetic-01/);
  assert.match(root.textContent, /confirm2-cooldown10-synthetic-01/);
  assert.match(root.textContent, /cash-control-synthetic-01/);
  assert.match(root.textContent, /UTC/);
  assert.match(root.textContent, /modellierte Kosten/);
  assert.match(root.textContent, /8-Stunden-Sample/);
  assert.doesNotMatch(root.textContent, /Gewinner:/);
  assert.equal(root.attrs.role, 'region');
  const status = visit(root).find(item => item.attrs['aria-live'] === 'polite');
  assert.equal(status.attrs.role, 'status');
  const negative = visit(root).find(item => item.textContent === '−1,25 € Verlust');
  const positive = visit(root).find(item => item.textContent === '+2,50 € Gewinn');
  assert.equal(negative.className, 'tone-danger');
  assert.equal(positive.className, 'tone-safe');
  assert.equal(visit(root).some(item =>
    ['BUTTON', 'INPUT', 'SELECT', 'FORM'].includes(item.tagName)), false);
});

test('unknown and invalid values retain reasons and are never rendered as zero', () => {
  const report = projected({
    status: 'NOT_A_STATUS',
    observedAt: null,
    freshness: {status: 'STALE', reason: 'Beobachtung zu alt'},
    coverage: {actualDurationMs: null, reason: 'Host-Sample fehlt'},
    arms: {
      baseline: {
        ...projected().arms.baseline,
        netPnlCents: amount(null, 'PnL-Nachweis fehlt'),
        feesCents: amount('-1', 'Gebührenwert ungültig'),
        trades: amount(null, 'Trade-Zähler fehlt')
      },
      challenger: projected().arms.challenger,
      cash: projected().arms.cash
    }
  });
  const model = presentSpotPaperPairedReport(fixtureDto, {
    projectReport: () => report
  });
  assert.equal(model.status, 'UNKNOWN');
  assert.equal(model.freshness.status, 'STALE');
  assert.equal(model.arms.baseline.metrics.netPnlCents.value, null);
  assert.equal(model.arms.baseline.metrics.feesCents.value, null);
  assert.equal(model.arms.baseline.metrics.trades.value, null);

  const {root, document} = harness();
  renderSpotPaperPaired(root, fixtureDto, document, {
    projectReport: () => report,
    preview: true
  });
  assert.match(root.textContent, /Unbekannt — PnL-Nachweis fehlt/);
  assert.match(root.textContent, /Unbekannt — Gebührenwert ungültig/);
  assert.match(root.textContent, /Unbekannt — Trade-Zähler fehlt/);
  assert.match(root.textContent, /Host-Sample fehlt/);
  assert.match(root.textContent, /Veraltet/);
  assert.doesNotMatch(root.textContent, /Gebühren0,00 €|Trades0(?!\d)/);
});

test('only explicitly compatible shared horizons display supplied deltas', () => {
  const report = projected({
    arms: {
      ...projected().arms,
      challenger: {...projected().arms.challenger, horizonKey: 'different-window'}
    }
  });
  const model = presentSpotPaperPairedReport(fixtureDto, {
    projectReport: () => report
  });
  assert.equal(model.comparison.comparable, false);
  assert.equal(model.comparison.deltas, null);
  assert.match(model.comparison.reason, /Auswertungshorizont/);
  const {root, document} = harness();
  renderSpotPaperPaired(root, fixtureDto, document, {
    projectReport: () => report,
    preview: true
  });
  assert.match(root.textContent, /DifferenzenNicht angezeigt/);
  assert.doesNotMatch(root.textContent, /Challenger minus Baseline/);

  const matching = presentSpotPaperPairedReport(fixtureDto, {
    projectReport: syntheticProjector
  });
  assert.equal(matching.comparison.comparable, true);
  assert.equal(matching.comparison.deltas.challengerVsBaseline.label, '+3,75 € Gewinn');
});

test('faithfully presents interrupted, open-inventory and verified terminal states', () => {
  for (const [status, positionStatus, expected] of [
    ['RUNNING', 'OPEN', 'RUNNING · Lauf läuft'],
    ['INTERRUPTED', 'STOPPED_OPEN', 'INTERRUPTED · Lauf unterbrochen'],
    ['VERIFIED_COMPLETE', 'STOPPED_FLAT', 'VERIFIED_COMPLETE · Abschluss geprüft'],
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN · Status unbekannt']
  ]) {
    const report = projected({
      status,
      arms: {
        ...projected().arms,
        challenger: {
          ...projected().arms.challenger,
          positionStatus
        }
      }
    });
    const {root, document} = harness();
    renderSpotPaperPaired(root, fixtureDto, document, {
      projectReport: () => report,
      preview: true
    });
    assert.ok(root.textContent.includes(expected));
    assert.ok(root.textContent.includes(`Position: ${positionStatus}`));
  }
});

test('zero trades remain distinct from missing trade evidence', () => {
  const report = projected({
    arms: {
      ...projected().arms,
      baseline: {
        ...projected().arms.baseline,
        trades: amount(0),
        positionStatus: 'STOPPED_FLAT'
      }
    }
  });
  const {root, document} = harness();
  renderSpotPaperPaired(root, fixtureDto, document, {
    projectReport: () => report,
    preview: true
  });
  assert.match(root.textContent, /Trades0/);
  assert.match(root.textContent, /Position: STOPPED_FLAT/);
  assert.doesNotMatch(root.textContent, /Gewinner:|Profitabilität bestätigt/);
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

test('mobile Chrome renders the paired panel without horizontal overflow', {
  timeout: 180_000
}, async () => {
  if (typeof WebSocket !== 'function') {
    const name = 'mobile Chrome renders the paired panel without horizontal overflow';
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
        const browserFixture = projected();
        browserFixture.arms.baseline.feesCents = amount(null, 'Modellkosten fehlen');
        browserFixture.arms.challenger.horizonKey = 'different-horizon';
        const fixture = JSON.stringify(browserFixture);
        const expression = `(async()=>{
          const {mountSpotPaperPairedPanel}=await import(
            './spot-paper-paired-controller.js?v=B16-M11-FIX14');
          const root=document.createElement('section');
          root.id='paired-panel';
          document.documentElement.style.margin='0';
          document.body.style.margin='0';
          document.body.replaceChildren(root);
          mountSpotPaperPairedPanel(root,{
            dto:{fixtureOnly:'SYNTHETIC_FIXTURE'},
            projectReport:()=>(${fixture}),
            preview:true
          });
          const label=root.getAttribute('aria-labelledby');
          const heading=document.getElementById(label);
          return {
            width:innerWidth,
            viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,
            bodyWidth:document.body.scrollWidth,
            panelWidth:root.clientWidth,
            panelScrollWidth:root.scrollWidth,
            heading:heading?.textContent,
            labelled:!!heading,
            status:root.querySelector('[role="status"]')?.textContent,
            controls:root.querySelectorAll('button,input,select,form').length,
            loss:root.textContent.includes('−1,25 € Verlust'),
            syntheticLabel:root.textContent.includes('SYNTHETIC FIXTURE · nur Vorschau'),
            unknown:root.textContent.includes('Unbekannt — Modellkosten fehlen') &&
              root.textContent.includes('Nicht angezeigt'),
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
        assert.equal(result.controls, 0);
        assert.equal(result.loss, true);
        assert.equal(result.syntheticLabel, true);
        assert.equal(result.unknown, true);
        assert.equal(result.armCount, 3);
        assert.ok(result.heading);
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

test.todo('Bind and integrate the actual #1302 shared sanitized DTO exports once published');
