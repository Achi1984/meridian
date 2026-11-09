import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';
import {presentSpotPaperBotOverview} from '../v11/spot-paper-bot-overview-model.js';
import {mountSpotPaperBotOverview} from '../v11/spot-paper-bot-overview-controller.js';

const freshAt = '2026-11-09T12:00:00.000Z';

function sourceReport(id, overrides = {}) {
  const isLives = id === 'btc-usd-lives';
  const currency = isLives ? 'USD' : 'EUR';
  return {
    lifecycle: 'RUNNING',
    runtimeEvidence: 'VALIDATED',
    strategy: isLives ? 'Lives Challenge' : 'BTC Trend Candidate',
    version: isLives ? 'challenge-v1' : 'trend-v1',
    market: isLives ? 'BTC/USD' : 'BTC/EUR',
    currency,
    capital: {amount: 1000, currency},
    netPnl: {amount: isLives ? -12 : 25, currency},
    equity: {amount: isLives ? 988 : 1025, currency},
    realizedPnl: {amount: isLives ? -7 : 20, currency},
    unrealizedPnl: {amount: isLives ? -5 : 5, currency},
    netPnlPercent: {value: isLives ? -1.2 : 2.5, basis: 'INITIAL_CAPITAL'},
    fees: {amount: 1.25, currency},
    slippage: {amount: 0.5, currency},
    funding: {amount: isLives ? -0.75 : 0, currency},
    roundTrips: 2,
    timeInvestedMs: 3_600_000,
    lastTradeAt: freshAt,
    freshness: {status: 'FRESH', at: freshAt, ageMs: 2000, reason: 'SOURCE_FRESH'},
    pauseReason: null,
    noTradeReason: null,
    risk: isLives ? {
      status: 'VALIDATED',
      lossAllowanceLimit: {amount: 100, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 12, currency: 'USD'},
      remainingLossAllowance: {amount: 88, currency: 'USD'}
    } : null,
    trades: [{
      at: freshAt,
      side: 'BUY',
      quantity: 0.002,
      price: {amount: 50_000, currency},
      amount: {amount: 100, currency},
      reason: 'ENTRY_SIGNAL'
    }],
    syntheticFixture: true,
    ...overrides
  };
}

function projectSource(report) {
  return {
    state: report.lifecycle,
    runtimeEvidence: report.runtimeEvidence,
    strategy: report.strategy,
    version: report.version,
    market: report.market,
    currency: report.currency,
    capital: report.capital,
    netPnl: report.netPnl,
    equity: report.equity,
    realizedPnl: report.realizedPnl,
    unrealizedPnl: report.unrealizedPnl,
    netPnlPercent: report.netPnlPercent,
    fees: report.fees,
    slippage: report.slippage,
    funding: report.funding,
    roundTrips: report.roundTrips,
    timeInvestedMs: report.timeInvestedMs,
    lastTradeAt: report.lastTradeAt,
    freshness: report.freshness,
    pauseReason: report.pauseReason,
    noTradeReason: report.noTradeReason,
    risk: report.risk,
    trades: report.trades,
    syntheticFixture: report.syntheticFixture,
    curve: report.curve
  };
}

function adapter(id, report, project = projectSource) {
  return {id, report, project};
}

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
  set innerHTML(_) { throw Error('Bot overview must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
}

function harness() {
  const document = {createElement: tag => new Element(document, tag)};
  return {root: new Element(document, 'section'), document};
}

test('projects explicit sanitized adapters without combining currencies', () => {
  let projectCalls = 0;
  const adapters = [
    adapter('btc-eur-trend', sourceReport('btc-eur-trend'), report => {
      projectCalls++;
      return projectSource(report);
    }),
    adapter('btc-usd-lives', sourceReport('btc-usd-lives'))
  ];
  const model = presentSpotPaperBotOverview(adapters);
  assert.equal(projectCalls, 1);
  assert.deepEqual(model.bots.map(bot => bot.id),
    ['btc-eur-trend', 'btc-usd-lives', 'lowvol-v2']);
  assert.equal(model.bots[0].state, 'RUNNING');
  assert.equal(model.bots[0].metrics.netPnl.value, 25);
  assert.equal(model.bots[0].metrics.netPnl.currency, 'EUR');
  assert.equal(model.bots[1].metrics.netPnl.value, -12);
  assert.equal(model.bots[1].metrics.netPnl.currency, 'USD');
  assert.equal(model.bots[1].risk.available, true);
  assert.equal(model.bots[1].risk.drawdown.value, 12);
  assert.equal(model.bots[1].risk.allowance.value, 88);
  assert.equal(model.bots[2].state, 'PREPARED');
  assert.equal(model.bots[2].metrics.netPnl.available, false);
  assert.equal(model.curve.available, false);
});

test('missing, rejected, unvalidated, stale, and mixed-currency reports fail closed', () => {
  const missing = presentSpotPaperBotOverview();
  assert.equal(missing.bots[0].state, 'UNKNOWN');
  assert.equal(missing.bots[1].state, 'UNKNOWN');
  assert.equal(missing.bots[2].state, 'PREPARED');
  assert.equal(missing.bots[2].stateReason, 'Noch keine Laufzeit-Evidenz.');

  const rejected = presentSpotPaperBotOverview([
    adapter('btc-eur-trend', sourceReport('btc-eur-trend'), () => { throw Error('no'); })
  ]);
  assert.equal(rejected.bots[0].state, 'UNKNOWN');
  assert.equal(rejected.bots[0].stateReason, 'REPORT_ADAPTER_REJECTED');

  const unvalidated = presentSpotPaperBotOverview([
    adapter('btc-eur-trend',
      sourceReport('btc-eur-trend', {runtimeEvidence: 'ASSERTED'}))
  ]);
  assert.equal(unvalidated.bots[0].state, 'UNKNOWN');
  assert.equal(unvalidated.bots[0].stateReason, 'RUNTIME_EVIDENCE_NOT_VALIDATED');
  assert.equal(unvalidated.bots[0].metrics.netPnl.available, false);

  const stale = presentSpotPaperBotOverview([
    adapter('btc-eur-trend',
      sourceReport('btc-eur-trend', {
        freshness: {status: 'STALE', at: freshAt, ageMs: 99_000, reason: 'SOURCE_STALE'}
      }))
  ]);
  assert.equal(stale.bots[0].state, 'RUNNING');
  assert.equal(stale.bots[0].freshness.status, 'STALE');
  assert.equal(stale.bots[0].metrics.netPnl.reason, 'DATA_STALE');
  assert.equal(stale.bots[0].trades.length, 0);

  const mixed = presentSpotPaperBotOverview([
    adapter('btc-eur-trend',
      sourceReport('btc-eur-trend', {currency: 'USD', market: 'BTC/USD'}))
  ]);
  assert.equal(mixed.bots[0].state, 'UNKNOWN');
  assert.equal(mixed.bots[0].metrics.netPnl.reason, 'BOT_IDENTITY_OR_CURRENCY_MISMATCH');
  assert.equal(mixed.bots[0].currency.available, false);
});

test('only validated USD risk DTOs expose Lives loss allowance; reasons and trade details are bounded', () => {
  const invalidRisk = sourceReport('btc-usd-lives', {
    lifecycle: 'PAUSED',
    risk: {
      status: 'ASSERTED',
      lossAllowanceLimit: {amount: 100, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 12, currency: 'USD'},
      remainingLossAllowance: {amount: 88, currency: 'USD'}
    },
    pauseReason: '<b>exchange pause</b>'
  });
  const model = presentSpotPaperBotOverview([
    adapter('btc-usd-lives', invalidRisk)
  ]);
  assert.equal(model.bots[1].risk.available, false);
  assert.equal(model.bots[1].risk.allowance.reason, 'LIVES_RISK_NOT_VALIDATED');
  assert.equal(model.bots[1].reason, '<b>exchange pause</b>');
  assert.equal(model.bots[1].trades.length, 1);

  const invalidTrade = presentSpotPaperBotOverview([
    adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      trades: [{at: 'not-a-date', side: 'BUY', quantity: 1}]
    }))
  ]);
  assert.equal(invalidTrade.bots[0].trades.length, 0);
  assert.equal(invalidTrade.bots[0].tradesReason, 'TRADE_DETAILS_NOT_VALIDATED');
});

test('normalized curves require explicit same basis and identical coverage', () => {
  const coverage = {
    coverageStart: '2026-11-09T11:00:00.000Z',
    coverageEnd: '2026-11-09T12:00:00.000Z',
    basis: 'INITIAL_CAPITAL_INDEX_100',
    points: [
      {at: '2026-11-09T11:00:00.000Z', index: 100},
      {at: '2026-11-09T12:00:00.000Z', index: 101}
    ]
  };
  const adapters = [
    adapter('btc-eur-trend', sourceReport('btc-eur-trend', {curve: structuredClone(coverage)})),
    adapter('btc-usd-lives', sourceReport('btc-usd-lives', {curve: structuredClone(coverage)})),
    adapter('lowvol-v2', sourceReport('lowvol-v2', {
      market: 'BTC/EUR',
      currency: 'EUR',
      curve: structuredClone(coverage)
    }))
  ];
  const aligned = presentSpotPaperBotOverview(adapters);
  assert.equal(aligned.curve.available, true);
  assert.deepEqual(aligned.curve.points[1].values, {
    'btc-eur-trend': 101,
    'btc-usd-lives': 101,
    'lowvol-v2': 101
  });
  const mismatched = presentSpotPaperBotOverview([
    adapters[0],
    adapters[1],
    adapter('lowvol-v2', sourceReport('lowvol-v2', {
      market: 'BTC/EUR',
      currency: 'EUR',
      curve: {...structuredClone(coverage), coverageEnd: '2026-11-09T11:59:00.000Z'}
    }))
  ]);
  assert.equal(mismatched.curve.available, false);
  assert.equal(mismatched.curve.reason, 'CURVE_HORIZONS_NOT_ALIGNED');
});

test('mount is host-controlled, accessible, collapsible, and renders signed PnL text', () => {
  const {root, document} = harness();
  const mounted = mountSpotPaperBotOverview(root, {
    adapters: [
      adapter('btc-eur-trend', sourceReport('btc-eur-trend')),
      adapter('btc-usd-lives', sourceReport('btc-usd-lives'))
    ],
    document
  });
  assert.equal(root.attrs.role, 'region');
  assert.ok(root.attrs['aria-labelledby']);
  assert.match(root.textContent, /SYNTHETIC FIXTURE/);
  assert.match(root.textContent, /Paper-Bot-Übersicht/);
  assert.match(root.textContent, /BTC\/EUR/);
  assert.match(root.textContent, /BTC\/USD/);
  assert.match(root.textContent, /\+25,00\s+€/);
  assert.match(root.textContent, /Verlust/);
  assert.match(root.textContent, /88,00\s+\$/);
  assert.match(root.textContent, /Trade-Details \(1\)/);
  assert.match(root.textContent, /LowVol V2 bleibt in Vorbereitung/);
  assert.doesNotMatch(root.textContent, /Summe EUR|Gesamtkapital|Rang 1/i);
  assert.equal(mounted.update([]).bots[2].state, 'PREPARED');
  mounted.dispose();
  assert.equal(root.children.length, 0);
});

test('mobile Chrome renders separate responsive cards without horizontal overflow', {
  timeout: 180_000
}, async () => {
  const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome',
    '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(chrome, 'Chrome is required for paper bot overview mobile evidence');
  const hosted = await startV11StaticServer();
  const evidence = process.env.V11_SPOT_PAPER_BOT_OVERVIEW_EVIDENCE_DIR ||
    join(tmpdir(), 'meridian-spot-paper-bot-overview-evidence');
  mkdirSync(evidence, {recursive: true});
  const source = JSON.stringify(sourceReport('btc-eur-trend'));
  const lives = JSON.stringify(sourceReport('btc-usd-lives'));
  try {
    for (const width of [320, 390]) {
      const metrics = await withMobileChrome(chrome, width, hosted.url, async call => {
        const expression = `(async()=>{
          const project=report=>({
            state:report.lifecycle,runtimeEvidence:report.runtimeEvidence,
            strategy:report.strategy,version:report.version,market:report.market,
            currency:report.currency,capital:report.capital,netPnl:report.netPnl,
            equity:report.equity,realizedPnl:report.realizedPnl,
            unrealizedPnl:report.unrealizedPnl,netPnlPercent:report.netPnlPercent,
            fees:report.fees,slippage:report.slippage,funding:report.funding,
            roundTrips:report.roundTrips,timeInvestedMs:report.timeInvestedMs,
            lastTradeAt:report.lastTradeAt,freshness:report.freshness,
            risk:report.risk,trades:report.trades,syntheticFixture:true
          });
          const {mountSpotPaperBotOverview}=await import(
            './spot-paper-bot-overview-controller.js?v=B16-M11-FIX14');
          const root=document.createElement('section');
          document.body.replaceChildren(root);
          mountSpotPaperBotOverview(root,{adapters:[
            {id:'btc-eur-trend',report:${source},project},
            {id:'btc-usd-lives',report:${lives},project}
          ]});
          return {
            width:innerWidth,viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,
            bodyWidth:document.body.scrollWidth,rootWidth:root.clientWidth,
            rootScrollWidth:root.scrollWidth,
            details:root.querySelectorAll('details').length,
            regions:root.querySelectorAll('[role="region"]').length,
            synthetic:root.textContent.includes('SYNTHETIC FIXTURE'),
            currencies:root.textContent.includes('EUR')&&root.textContent.includes('USD'),
            prepared:root.textContent.includes('In Vorbereitung')
          };
        })()`;
        const response = await call('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true
        });
        assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        const result = response.result.value;
        assert.equal(result.width, width);
        assert.ok(result.documentWidth <= result.viewport + 1, JSON.stringify(result));
        assert.ok(result.bodyWidth <= result.viewport + 1, JSON.stringify(result));
        assert.ok(result.rootScrollWidth <= result.rootWidth + 1, JSON.stringify(result));
        assert.ok(result.details >= 4);
        assert.equal(result.regions, 1);
        assert.equal(result.synthetic, true);
        assert.equal(result.currencies, true);
        assert.equal(result.prepared, true);
        const image = await call('Page.captureScreenshot', {format: 'png'});
        writeFileSync(join(evidence, `bot-overview-${width}.png`),
          Buffer.from(image.data, 'base64'));
        return result;
      });
      assert.equal(metrics.width, width);
    }
  } finally {
    await hosted.close();
  }
});
