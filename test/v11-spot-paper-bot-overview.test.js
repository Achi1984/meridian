import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
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
      highWaterEquity: {amount: 1000, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 12, currency: 'USD'},
      remainingLossAllowance: {amount: 88, currency: 'USD'},
      paused: false,
      pauseObservationId: null
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
    this.open = false;
    this.listeners = {};
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Bot overview must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, listener) {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }
  click() {
    for (const listener of this.listeners.click || []) listener();
  }
}

function harness() {
  const document = {createElement: tag => {
    if (typeof tag !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(tag)) {
      throw new Error('Invalid element name');
    }
    return new Element(document, tag);
  }};
  return {root: new Element(document, 'section'), document};
}

const visit = element => [element, ...element.children.flatMap(visit)];

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
  assert.equal(model.bots[2].nativeUnit, 'USDT');
  assert.equal(model.bots[2].instrument, 'Perpetual-Portfolio (USDT-marginiert)');
  assert.equal(model.curve.available, false);
});

test('missing, rejected, unvalidated, stale, and mixed-currency reports fail closed', () => {
  const missing = presentSpotPaperBotOverview();
  assert.equal(missing.bots[0].state, 'UNKNOWN');
  assert.equal(missing.bots[1].state, 'UNKNOWN');
  assert.equal(missing.bots[2].state, 'PREPARED');
  assert.equal(missing.bots[2].stateReason, 'LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE');

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

  const staleLives = presentSpotPaperBotOverview([
    adapter('btc-usd-lives', sourceReport('btc-usd-lives', {
      freshness: {status: 'STALE', at: freshAt, ageMs: 99_000, reason: 'SOURCE_STALE'}
    }))
  ]);
  assert.equal(staleLives.bots[1].risk.available, false);
  assert.equal(staleLives.bots[1].risk.allowance.reason, 'LIVES_RISK_NOT_VALIDATED');

  for (const lifecycle of ['PREPARED', 'UNKNOWN']) {
    const nonrunningLives = presentSpotPaperBotOverview([
      adapter('btc-usd-lives', sourceReport('btc-usd-lives', {lifecycle}))
    ]);
    assert.equal(nonrunningLives.bots[1].risk.available, false);
  }

  const mismatchedLives = presentSpotPaperBotOverview([
    adapter('btc-usd-lives', sourceReport('btc-usd-lives', {
      market: 'BTC/EUR',
      currency: 'EUR',
      equity: {amount: 988, currency: 'EUR'}
    }))
  ]);
  assert.equal(mismatchedLives.bots[1].risk.available, false);

  const mixed = presentSpotPaperBotOverview([
    adapter('btc-eur-trend',
      sourceReport('btc-eur-trend', {currency: 'USD', market: 'BTC/USD'}))
  ]);
  assert.equal(mixed.bots[0].state, 'UNKNOWN');
  assert.equal(mixed.bots[0].metrics.netPnl.reason, 'BOT_IDENTITY_OR_CURRENCY_MISMATCH');
  assert.equal(mixed.bots[0].currency.available, false);
});

test('FRESH status requires both a valid source timestamp and nonnegative age', () => {
  for (const freshness of [
    {status: 'FRESH', at: null, ageMs: 2000, reason: 'FRESHNESS_METADATA_INCOMPLETE'},
    {status: 'FRESH', at: freshAt, ageMs: null, reason: 'FRESHNESS_METADATA_INCOMPLETE'}
  ]) {
    const {root, document} = harness();
    const mounted = mountSpotPaperBotOverview(root, {
      adapters: [adapter('btc-eur-trend', sourceReport('btc-eur-trend', {freshness}))],
      document
    });
    const model = mounted.render();
    const summary = visit(root).find(item =>
      item.className?.includes('spot-paper-bot-status'));
    assert.equal(model.bots[0].state, 'RUNNING');
    assert.equal(model.bots[0].freshness.status, 'FRESH');
    assert.equal(model.bots[0].metrics.netPnl.available, false);
    assert.equal(summary.textContent, 'Läuft · Datenfrische unbekannt');
    assert.match(root.textContent,
      /Gemeldeter LaufstatusLäuft · Datenfrische unbekannt/);
    assert.doesNotMatch(summary.textContent, /Aktuell/);
  }
});

test('validated Lives risk is arithmetically consistent and preserves latched drawdown overshoot', () => {
  const invalidRisk = sourceReport('btc-usd-lives', {
    lifecycle: 'PAUSED',
    risk: {
      status: 'ASSERTED',
      lossAllowanceLimit: {amount: 100, currency: 'USD'},
      highWaterEquity: {amount: 1000, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 12, currency: 'USD'},
      remainingLossAllowance: {amount: 88, currency: 'USD'},
      paused: true,
      pauseObservationId: 'limit'
    },
    pauseReason: 'Verlustlimit erreicht'
  });
  const model = presentSpotPaperBotOverview([
    adapter('btc-usd-lives', invalidRisk)
  ]);
  assert.equal(model.bots[1].risk.available, false);
  assert.equal(model.bots[1].risk.allowance.reason, 'LIVES_RISK_NOT_VALIDATED');
  assert.equal(model.bots[1].reason, 'Verlustlimit erreicht');
  assert.equal(model.bots[1].trades.length, 1);

  const inconsistent = sourceReport('btc-usd-lives', {
    risk: {
      status: 'VALIDATED',
      lossAllowanceLimit: {amount: 100, currency: 'USD'},
      highWaterEquity: {amount: 1000, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 12, currency: 'USD'},
      remainingLossAllowance: {amount: 89, currency: 'USD'},
      paused: false,
      pauseObservationId: null
    }
  });
  assert.equal(presentSpotPaperBotOverview([
    adapter('btc-usd-lives', inconsistent)
  ]).bots[1].risk.available, false);

  const overshoot = sourceReport('btc-usd-lives', {
    lifecycle: 'PAUSED',
    equity: {amount: 875, currency: 'USD'},
    netPnl: {amount: -125, currency: 'USD'},
    netPnlPercent: {value: -12.5, basis: 'INITIAL_CAPITAL'},
    risk: {
      status: 'VALIDATED',
      lossAllowanceLimit: {amount: 100, currency: 'USD'},
      highWaterEquity: {amount: 1000, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 125, currency: 'USD'},
      remainingLossAllowance: {amount: 0, currency: 'USD'},
      paused: true,
      pauseObservationId: 'overshoot'
    }
  });
  const overshootBot = presentSpotPaperBotOverview([
    adapter('btc-usd-lives', overshoot)
  ]).bots[1];
  assert.equal(overshootBot.risk.available, true);
  assert.equal(overshootBot.risk.drawdown.value, 125);
  assert.equal(overshootBot.risk.allowance.value, 0);

  const unlatchedOvershoot = sourceReport('btc-usd-lives', {
    equity: {amount: 875, currency: 'USD'},
    risk: {
      ...overshoot.risk,
      netEquityHighWaterDrawdown: {amount: 125, currency: 'USD'},
      remainingLossAllowance: {amount: 0, currency: 'USD'},
      paused: false,
      pauseObservationId: null
    }
  });
  assert.equal(presentSpotPaperBotOverview([
    adapter('btc-usd-lives', unlatchedOvershoot)
  ]).bots[1].risk.available, false);

  const recoveredLatch = sourceReport('btc-usd-lives', {
    lifecycle: 'PAUSED',
    equity: {amount: 1000, currency: 'USD'},
    risk: {
      status: 'VALIDATED',
      lossAllowanceLimit: {amount: 100, currency: 'USD'},
      highWaterEquity: {amount: 1000, currency: 'USD'},
      netEquityHighWaterDrawdown: {amount: 0, currency: 'USD'},
      remainingLossAllowance: {amount: 100, currency: 'USD'},
      paused: true,
      pauseObservationId: 'prior-breach'
    }
  });
  assert.equal(presentSpotPaperBotOverview([
    adapter('btc-usd-lives', recoveredLatch)
  ]).bots[1].risk.available, true);

  const invalidTrade = presentSpotPaperBotOverview([
    adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      trades: [{at: 'not-a-date', side: 'BUY', quantity: 1}]
    }))
  ]);
  assert.equal(invalidTrade.bots[0].trades.length, 0);
  assert.equal(invalidTrade.bots[0].tradesReason, 'TRADE_DETAILS_NOT_VALIDATED');

  const noTrade = presentSpotPaperBotOverview([
    adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      roundTrips: 0,
      lastTradeAt: null,
      noTradeReason: 'Noch kein Einstiegssignal.'
    }))
  ]);
  assert.equal(noTrade.bots[0].reason, 'Noch kein Einstiegssignal.');
});

test('zero and negative equity remain visible while capital stays strictly positive', () => {
  for (const equity of [0, -25]) {
    const report = sourceReport('btc-eur-trend', {
      equity: {amount: equity, currency: 'EUR'}
    });
    const model = presentSpotPaperBotOverview([adapter('btc-eur-trend', report)]);
    assert.equal(model.bots[0].metrics.equity.available, true);
    assert.equal(model.bots[0].metrics.equity.value, equity);
  }
  const {root: zeroRoot, document: zeroDocument} = harness();
  mountSpotPaperBotOverview(zeroRoot, {
    adapters: [adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      equity: {amount: 0, currency: 'EUR'}
    }))],
    document: zeroDocument
  });
  assert.match(zeroRoot.textContent, /Eigenkapital0,00\s+€/);
  const invalidCapital = presentSpotPaperBotOverview([
    adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      capital: {amount: 0, currency: 'EUR'}
    }))
  ]);
  assert.equal(invalidCapital.bots[0].metrics.capital.available, false);
  const {root, document} = harness();
  mountSpotPaperBotOverview(root, {
    adapters: [adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      equity: {amount: -25, currency: 'EUR'}
    }))],
    document
  });
  assert.match(root.textContent, /[-−]25,00\s+€/);
  assert.ok(visit(root).some(item => item.className === 'tone-danger' &&
    /[-−]25,00 €/.test(item.textContent)));
});

test('normalized curves compare eligible subsets and reject invalid coverage or normalization', () => {
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
      strategy: 'LowVol V2', market: 'BTC/EUR', currency: 'EUR',
      curve: structuredClone(coverage)
    }))
  ];
  const aligned = presentSpotPaperBotOverview(adapters);
  assert.equal(aligned.curve.available, true);
  assert.deepEqual(aligned.curve.botIds, ['btc-eur-trend', 'btc-usd-lives']);
  assert.deepEqual(aligned.curve.excludedBotIds, ['lowvol-v2']);
  assert.deepEqual(aligned.curve.points[1].values, {
    'btc-eur-trend': 101,
    'btc-usd-lives': 101
  });
  const {root, document} = harness();
  mountSpotPaperBotOverview(root, {adapters, document});
  assert.match(root.textContent, /Auf Startkapital normiert/);
  assert.match(root.textContent, /BTC\/EUR Trend-Kandidat: 101/);
  assert.match(root.textContent, /Nicht enthalten: LowVol V2 \(noch in Vorbereitung\)/);
  assert.equal(aligned.bots[2].state, 'PREPARED');
  assert.equal(aligned.bots[2].market.available, false);
  assert.equal(aligned.bots[2].currency.available, false);
  const mismatched = presentSpotPaperBotOverview([
    adapters[0],
    adapters[1],
    adapter('lowvol-v2', sourceReport('lowvol-v2', {
      strategy: 'LowVol V2',
      market: 'BTC/EUR',
      currency: 'EUR',
      curve: {...structuredClone(coverage), coverageEnd: '2026-11-09T11:59:00.000Z'}
    }))
  ]);
  assert.equal(mismatched.curve.available, true);
  assert.equal(mismatched.curve.botIds.length, 2);

  const validPair = adapters.slice(0, 2);
  for (const mutate of [
    curve => ({...curve, coverageStart: curve.coverageEnd}),
    curve => ({...curve, points: [{at: curve.coverageStart, index: 99}, ...curve.points.slice(1)]}),
    curve => ({...curve, points: [curve.points[0], curve.points[0], curve.points[2]]}),
    curve => ({...curve, points: [curve.points[0],
      {at: '2026-11-09T12:01:00.000Z', index: 100}, curve.points[1]]})
  ]) {
    const invalid = presentSpotPaperBotOverview(validPair.map(item => {
      const report = sourceReport(item.id, {
        curve: mutate(structuredClone(coverage))
      });
      return adapter(item.id, report);
    }));
    assert.equal(invalid.curve.available, false);
  }
  const mismatchedPair = presentSpotPaperBotOverview([
    validPair[0],
    adapter('btc-usd-lives', sourceReport('btc-usd-lives', {
      curve: {...structuredClone(coverage), coverageEnd: '2026-11-09T11:59:00.000Z',
        points: [
          {at: '2026-11-09T11:00:00.000Z', index: 100},
          {at: '2026-11-09T11:59:00.000Z', index: 101}
        ]}
    }))
  ]);
  assert.equal(mismatchedPair.curve.available, false);
  assert.equal(mismatchedPair.curve.reason, 'CURVE_HORIZONS_NOT_ALIGNED');
});

test('mount is host-controlled, compact, accessible, and renders signed PnL text', () => {
  const {root, document} = harness();
  const mounted = mountSpotPaperBotOverview(root, {
    adapters: [
      adapter('btc-eur-trend', sourceReport('btc-eur-trend')),
      adapter('btc-usd-lives', sourceReport('btc-usd-lives', {
        lifecycle: 'PAUSED',
        pauseReason: '<b>Loss limit reached</b>'
      }))
    ],
    document
  });
  assert.equal(root.attrs.role, 'region');
  assert.ok(root.attrs['aria-labelledby']);
  assert.match(root.textContent, /Vorschau mit Testdaten/);
  assert.match(root.textContent, /Schreibgeschützte Ansicht/);
  assert.doesNotMatch(root.textContent, /REPORT_ADAPTER|RUNTIME_EVIDENCE|SOURCE_FRESH/);
  assert.match(root.textContent, /Paper-Bot-Übersicht/);
  assert.match(root.textContent, /BTC\/EUR/);
  assert.match(root.textContent, /BTC\/USD/);
  assert.match(root.textContent, /\+25,00\s+€/);
  assert.match(root.textContent, /Verlust/);
  assert.match(root.textContent, /88,00\s+\$/);
  assert.match(root.textContent, /Handelsdetails \(1\)/);
  assert.match(root.textContent, /Quelle: 09\.11\.2026/);
  assert.match(root.textContent, /Kapital & Ergebnis/);
  assert.match(root.textContent, /Kosten & Handel/);
  assert.match(root.textContent, /Status & Details/);
  assert.match(root.textContent, /LowVol V2 bleibt in Vorbereitung/);
  assert.match(root.textContent, /<b>Loss limit reached<\/b>/);
  const nodes = visit(root);
  assert.equal(nodes.some(item => item.tagName === 'B'), false);
  const buttons = nodes.filter(item => item.tagName === 'BUTTON');
  assert.deepEqual(buttons.map(item => item.textContent),
    ['Alle Details öffnen', 'Alle Details schließen']);
  assert.ok(buttons.every(item => item.attrs['aria-controls']));
  const disclosures = nodes.filter(item => item.tagName === 'DETAILS');
  assert.ok(disclosures.some(item => item.open === false));
  buttons[0].click();
  assert.ok(disclosures.every(item => item.open === true));
  buttons[1].click();
  assert.ok(disclosures.every(item => item.open === false));
  const summaries = nodes.filter(item => item.tagName === 'SUMMARY');
  assert.ok(summaries.some(item => /Läuft · Aktuell/.test(item.textContent)));
  assert.ok(summaries.some(item => /Pausiert · Aktuell/.test(item.textContent)));
  assert.ok(summaries.some(item => /In Vorbereitung/.test(item.textContent)));
  assert.ok(!summaries.some(item => /REPORT_ADAPTER|SOURCE_FRESH/.test(item.textContent)));
  const positivePnl = nodes.find(item => item.textContent === '+25,00 € Gewinn');
  const negativePnl = nodes.find(item => item.textContent === '−12,00 $ Verlust');
  assert.equal(positivePnl.className, 'tone-safe');
  assert.equal(negativePnl.className, 'tone-danger');
  const {root: zeroRoot, document: zeroDocument} = harness();
  mountSpotPaperBotOverview(zeroRoot, {
    adapters: [adapter('btc-eur-trend', sourceReport('btc-eur-trend', {
      netPnl: {amount: 0, currency: 'EUR'}
    }))],
    document: zeroDocument
  });
  const zeroPnl = visit(zeroRoot).find(item =>
    item.tagName === 'STRONG' && item.textContent.startsWith('Netto-PnL '));
  assert.equal(zeroPnl.textContent, 'Netto-PnL 0,00 €');
  assert.equal(zeroPnl.className, 'tone-muted');
  assert.doesNotMatch(root.textContent, /Summe EUR|Gesamtkapital|Rang 1/i);
  assert.equal(mounted.update([]).bots[2].state, 'PREPARED');
  mounted.dispose();
  assert.equal(root.children.length, 0);
});

test('overview modules do not add network, timers, storage, HTML parsing, or trading controls', () => {
  const sources = [
    '../v11/spot-paper-bot-overview-model.js',
    '../v11/spot-paper-bot-overview-view.js',
    '../v11/spot-paper-bot-overview-controller.js'
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(sources,
    /\bfetch\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(|localStorage|sessionStorage|indexedDB|\.innerHTML\s*=/);
  assert.doesNotMatch(sources, /createElement\(['"](?:button|input|select|form)['"]\)/);
});

test('Chrome renders compact responsive cards and supports keyboard disclosure controls', {
  timeout: 180_000
}, async () => {
  if (typeof WebSocket !== 'function') {
    const name = 'Chrome renders compact responsive cards and supports keyboard disclosure controls';
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--experimental-websocket', '--test',
      `--test-name-pattern=^${name}$`, fileURLToPath(import.meta.url)], {
      env, encoding: 'utf8', timeout: 170_000
    });
    assert.equal(child.status, 0,
      `${String(child.stdout).slice(-2500)}${String(child.stderr).slice(-1000)}`);
    assert.match(child.stdout, /V11_SPOT_PAPER_BOT_OVERVIEW_SIZE .*"width":320/);
    assert.match(child.stdout, /V11_SPOT_PAPER_BOT_OVERVIEW_SIZE .*"width":390/);
    assert.match(child.stdout, /V11_SPOT_PAPER_BOT_OVERVIEW_SIZE .*"width":1280/);
    return;
  }
  const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome',
    '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(chrome, 'Chrome is required for paper bot overview mobile evidence');
  const hosted = await startV11StaticServer();
  const evidence = process.env.V11_SPOT_PAPER_BOT_OVERVIEW_EVIDENCE_DIR ||
    join(tmpdir(), 'meridian-spot-paper-bot-overview-evidence');
  mkdirSync(evidence, {recursive: true});
  const source = JSON.stringify(sourceReport('btc-eur-trend'));
  const negativeSource = JSON.stringify(sourceReport('btc-eur-trend', {
    equity: {amount: -25, currency: 'EUR'}
  }));
  const lives = JSON.stringify(sourceReport('btc-usd-lives', {
    lifecycle:'PAUSED',pauseReason:'Synthetische Pause'
  }));
  const curve = {
    coverageStart: '2026-11-09T11:00:00.000Z',
    coverageEnd: '2026-11-09T12:00:00.000Z',
    basis: 'INITIAL_CAPITAL_INDEX_100',
    points: [
      {at: '2026-11-09T11:00:00.000Z', index: 100},
      {at: '2026-11-09T12:00:00.000Z', index: 101}
    ]
  };
  const trendCurve = JSON.stringify(sourceReport('btc-eur-trend', {curve}));
  const livesCurve = JSON.stringify(sourceReport('btc-usd-lives', {curve}));
  try {
    for (const width of [320, 390, 1280]) {
      const metrics = await withMobileChrome(chrome, width, hosted.url, async call => {
        const pageErrors = [];
        call.onEvent('Runtime.exceptionThrown', () => pageErrors.push('exception'));
        call.onEvent('Runtime.consoleAPICalled', event => {
          if (event.type === 'error') pageErrors.push('console');
        });
        call.onEvent('Log.entryAdded', event => {
          if (event.entry.level === 'error') {
            pageErrors.push({text: event.entry.text, url: event.entry.url});
          }
        });
        await call('Log.enable');
        await call('Emulation.setDeviceMetricsOverride', {
          width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1,
          mobile: width < 600, screenWidth: width,
          screenHeight: width === 320 ? 568 : 844
        });
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
            risk:report.risk,trades:report.trades,curve:report.curve,syntheticFixture:true
          });
          const {mountSpotPaperBotOverview}=await import(
            './spot-paper-bot-overview-controller.js?v=B16-M11-FIX14');
          const root=document.createElement('section');
          root.id='paper-bot-overview-root';
          document.body.replaceChildren(root);
          const missingMount=mountSpotPaperBotOverview(root,{adapters:[]});
          const missingModel=missingMount.render();
          const emptyRendered=root.textContent.includes('Unbekannt')&&
            root.textContent.includes('In Vorbereitung');
          const missingSummary=[...root.querySelectorAll('.spot-paper-bot-card>summary')]
            .map(summary=>summary.textContent);
          const missingSummaryCompact=missingSummary.every(summary=>
            !summary.includes('REPORT_ADAPTER')&&!summary.includes('METRIC_NOT_REPORTED')&&
            !summary.includes('BTC/EUR Trend-KandidatBTC/EUR Trend-Kandidat')&&
            !summary.includes('LowVol V2LowVol V2'));
          mountSpotPaperBotOverview(root,{adapters:[
            {id:'btc-eur-trend',report:${source},project},
            {id:'btc-usd-lives',report:${lives},project}
          ]});
          const validRendered=root.textContent.includes('BTC/EUR Trend-Kandidat')&&
            root.textContent.includes('+25,00')&&root.textContent.includes('Pausiert');
          const validSummaries=[...root.querySelectorAll('.spot-paper-bot-card>summary')]
            .map(summary=>summary.textContent);
          const statusBadge=root.querySelector('.spot-paper-bot-status');
          const statusBadgeReadable=Boolean(statusBadge)&&
            getComputedStyle(statusBadge).fontSize==='11px'&&
            getComputedStyle(statusBadge).transform==='none';
          const controlButtons=[...root.querySelectorAll('button')];
          const allOpenButton=controlButtons.find(button=>button.textContent==='Alle Details öffnen');
          const allCloseButton=controlButtons.find(button=>button.textContent==='Alle Details schließen');
          allOpenButton.focus();
          const focusedControl=allOpenButton===document.activeElement;
          mountSpotPaperBotOverview(root,{adapters:[
            {id:'btc-eur-trend',report:${negativeSource},project}
          ]});
          const negativeRendered=root.textContent.includes('Eigenkapital-25,00');
          const staleSource={...${source},freshness:{status:'STALE',at:'${freshAt}',
            ageMs:99000,reason:'SOURCE_STALE'}};
          const completedLives={...${lives},lifecycle:'COMPLETED'};
          mountSpotPaperBotOverview(root,{adapters:[
            {id:'btc-eur-trend',report:staleSource,project},
            {id:'btc-usd-lives',report:completedLives,project}
          ]});
          const staleAndCompleted=[...root.querySelectorAll('.spot-paper-bot-card>summary')]
            .map(summary=>summary.textContent);
          const staleDetails=root.textContent.includes(
            'Gemeldeter LaufstatusLäuft · Daten veraltet');
          const curveMount=mountSpotPaperBotOverview(root,{adapters:[
            {id:'btc-eur-trend',report:${trendCurve},project},
            {id:'btc-usd-lives',report:${livesCurve},project}
          ]});
          const curveModel=curveMount.render();
          return {
            width:innerWidth,viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,
            bodyWidth:document.body.scrollWidth,rootWidth:root.clientWidth,
            rootScrollWidth:root.scrollWidth,
            details:root.querySelectorAll('details').length,
            emptyRendered,missingModelPrepared:missingModel.bots[2].state==='PREPARED',
            missingSummaryCompact,missingSummary,validRendered,negativeRendered,
            validSummaries,staleAndCompleted,statusBadgeReadable,focusedControl,
            staleDetails,
            allOpenButton: Boolean(allOpenButton),allCloseButton:Boolean(allCloseButton),
            alignedCurve:curveModel.curve.available,
            curveBotIds:curveModel.curve.botIds,
            curveRendered:root.textContent.includes('Auf Startkapital normiert')&&
              root.textContent.includes('BTC/EUR Trend-Kandidat: 101')&&
              root.textContent.includes('BTC/USD Lives-Challenge: 101'),
            hasNamedRegion:root.getAttribute('role')==='region'&&
              Boolean(root.getAttribute('aria-labelledby')),
            synthetic:root.textContent.includes('Vorschau mit Testdaten'),
            currencies:root.textContent.includes('EUR')&&root.textContent.includes('USD'),
            prepared:root.textContent.includes('In Vorbereitung')
          };
        })()`;
        const response = await call('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true
        });
        assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        const result = response.result.value;
        const key = async (type, keyName, code, value) => call('Input.dispatchKeyEvent', {
         type, key: keyName, code, windowsVirtualKeyCode: value,
         nativeVirtualKeyCode: value,
         ...(type === 'keyDown' ? {
           text: keyName === 'Enter' ? '\r' : ' ',
           unmodifiedText: keyName === 'Enter' ? '\r' : ' '
         } : {})
        });
        const allOpenFocus = await call('Runtime.evaluate', {
         expression: `(()=>{const b=[...document.querySelectorAll('button')].find(
           item=>item.textContent==='Alle Details öffnen');b.focus();return document.activeElement===b})()`,
         returnByValue: true
        });
        await key('keyDown', 'Enter', 'Enter', 13);
        await key('keyUp', 'Enter', 'Enter', 13);
        const opened = await call('Runtime.evaluate', {
         expression: `(()=>{
           const root=document.querySelector('#paper-bot-overview-root');
           const buttons=[...root.querySelectorAll('button')];
           const bounds=root.getBoundingClientRect();
           return {
             all:[...root.querySelectorAll('details')].every(item=>item.open),
             badge:getComputedStyle(root.querySelector('.spot-paper-bot-status')).transform,
             viewport:document.documentElement.clientWidth,
             documentWidth:document.documentElement.scrollWidth,
             bodyWidth:document.body.scrollWidth,
             rootWidth:root.clientWidth,
             rootScrollWidth:root.scrollWidth,
             rootLeft:bounds.left,
             rootRight:bounds.right,
             cards:[...root.querySelectorAll('.spot-paper-bot-card')].map(card=>{
               const cardBounds=card.getBoundingClientRect();
               return {left:cardBounds.left,right:cardBounds.right,
                 width:card.clientWidth,scrollWidth:card.scrollWidth};
             }),
             cardOverflow:[...root.querySelectorAll('.spot-paper-bot-card')].some(card=>{
               const cardBounds=card.getBoundingClientRect();
               return card.scrollWidth>card.clientWidth+1||
                 cardBounds.left<0||cardBounds.right>innerWidth+1;
             }),
             buttonOverflow:buttons.some(button=>!root.contains(button)||
               button.scrollWidth>button.clientWidth+1||
               button.getBoundingClientRect().left<0||
               button.getBoundingClientRect().right>innerWidth+1)
           };
         })()`,
         returnByValue: true
        });
        const expandedLayout = opened.result.value;
        result.expandedLayout = expandedLayout;
        assert.equal(expandedLayout.all, true);
        assert.ok(expandedLayout.documentWidth <= expandedLayout.viewport + 1,
          JSON.stringify(expandedLayout));
        assert.ok(expandedLayout.bodyWidth <= expandedLayout.viewport + 1,
          JSON.stringify(expandedLayout));
        assert.ok(expandedLayout.rootScrollWidth <= expandedLayout.rootWidth + 1,
          JSON.stringify(expandedLayout));
        assert.ok(expandedLayout.rootLeft >= -1 &&
          expandedLayout.rootRight <= expandedLayout.viewport + 1,
        JSON.stringify(expandedLayout));
        assert.equal(expandedLayout.cards.length, 3, JSON.stringify(expandedLayout));
        assert.equal(expandedLayout.cardOverflow, false, JSON.stringify(expandedLayout));
        assert.equal(expandedLayout.buttonOverflow, false, JSON.stringify(expandedLayout));
        const expandedImage = await call('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: true
        });
        writeFileSync(join(evidence, `bot-overview-${width}-expanded.png`),
          Buffer.from(expandedImage.data, 'base64'));
        const allCloseFocus = await call('Runtime.evaluate', {
         expression: `(()=>{const b=[...document.querySelectorAll('button')].find(
           item=>item.textContent==='Alle Details schließen');b.focus();return document.activeElement===b})()`,
         returnByValue: true
        });
        await key('keyDown', ' ', 'Space', 32);
        await key('keyUp', ' ', 'Space', 32);
        const closed = await call('Runtime.evaluate', {
         expression: `[...document.querySelectorAll('#paper-bot-overview-root details')]
           .every(item=>!item.open)`,
         returnByValue: true
        });
        result.disclosureEvidence = {
         allOpenFocus: allOpenFocus.result.value,
         opened: opened.result.value.all,
         badgeTransform: opened.result.value.badge,
         allCloseFocus: allCloseFocus.result.value,
         closed: closed.result.value
        };
        result.disclosuresComplete = result.disclosureEvidence.allOpenFocus &&
         result.disclosureEvidence.opened && result.disclosureEvidence.badgeTransform === 'none' &&
         result.disclosureEvidence.allCloseFocus && result.disclosureEvidence.closed;
        const connectedLayout = await call('Runtime.evaluate', {
          expression: `(()=>{
            const root=document.querySelector('#paper-bot-overview-root');
            const buttons=[...root.querySelectorAll('button')];
            return {
              rootWidth:root.clientWidth,
              rootScrollWidth:root.scrollWidth,
              buttonOverflow:buttons.some(button=>!root.contains(button)||
                button.scrollWidth>button.clientWidth+1)
            };
          })()`,
          returnByValue: true
        });
        result.buttonOverflow = connectedLayout.result.value.buttonOverflow;
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.deepEqual(pageErrors, []);
        assert.equal(result.width, width);
        assert.ok(result.documentWidth <= result.viewport + 1, JSON.stringify(result));
        assert.ok(result.bodyWidth <= result.viewport + 1, JSON.stringify(result));
        assert.ok(result.rootScrollWidth <= result.rootWidth + 1, JSON.stringify(result));
        assert.equal(result.buttonOverflow, false);
        assert.ok(result.details >= 4);
        assert.equal(result.emptyRendered, true);
        assert.equal(result.missingModelPrepared, true);
        assert.equal(result.missingSummaryCompact, true);
        assert.equal(result.validRendered, true);
        assert.equal(result.validSummaries.length, 3);
        assert.ok(result.validSummaries.some(summary=>summary.includes('Läuft · Aktuell')));
        assert.ok(result.validSummaries.some(summary=>summary.includes('Pausiert · Aktuell')));
        assert.ok(result.validSummaries.some(summary=>summary.includes('In Vorbereitung')));
        assert.ok(result.staleAndCompleted.some(summary=>
          summary.includes('Läuft · Daten veraltet')));
        assert.ok(result.staleAndCompleted.some(summary=>summary.includes('Abgeschlossen · Aktuell')));
        assert.equal(result.staleDetails, true);
        assert.equal(result.statusBadgeReadable, true);
        assert.equal(result.disclosuresComplete, true, JSON.stringify(result.disclosureEvidence));
        assert.equal(result.negativeRendered, true);
        assert.equal(result.alignedCurve, true);
        assert.deepEqual(result.curveBotIds, ['btc-eur-trend', 'btc-usd-lives']);
        assert.equal(result.curveRendered, true);
        assert.equal(result.hasNamedRegion, true);
        assert.equal(result.synthetic, true);
        assert.equal(result.currencies, true);
        assert.equal(result.prepared, true);
        const image = await call('Page.captureScreenshot', {format: 'png'});
        writeFileSync(join(evidence, `bot-overview-${width}.png`),
          Buffer.from(image.data, 'base64'));
        return result;
      }, 844, async call => {
        await call('Page.addScriptToEvaluateOnNewDocument', {
          source: `document.addEventListener('DOMContentLoaded',()=>{
            if(!document.querySelector('link[rel~="icon"]')){
              const icon=document.createElement('link');
              icon.rel='icon';icon.href='data:,';document.head.append(icon);
            }
          },{once:true});`
        });
      });
      assert.equal(metrics.width, width);
      console.log('V11_SPOT_PAPER_BOT_OVERVIEW_SIZE ' + JSON.stringify(metrics));
    }
  } finally {
    await hosted.close();
  }
});
