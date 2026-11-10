import {presentSpotPaperBotOverview} from './spot-paper-bot-overview-model.js?v=B16-M11-FIX16';

const STATE_LABELS = Object.freeze({
  PREPARED: 'In Vorbereitung',
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  UNKNOWN: 'Unbekannt'
});
const FRESHNESS_LABELS = Object.freeze({
  FRESH: 'Aktuell',
  STALE: 'Veraltet',
  UNKNOWN: 'Unbekannt'
});
const REASON_LABELS = Object.freeze({
  ADAPTER_ID_INVALID_OR_DUPLICATED: 'Datenzuordnung ist ungültig.',
  BOT_IDENTITY_OR_CURRENCY_MISMATCH: 'Instrument oder Währung passt nicht zu diesem Bot.',
  CURVE_NEEDS_TWO_ELIGIBLE_BOTS: 'Für einen Kurvenvergleich fehlen passende Laufdaten.',
  CURVE_HORIZONS_NOT_ALIGNED: 'Die Kurven decken unterschiedliche Zeiträume ab.',
  CURVE_BASIS_OR_COVERAGE_NOT_VALIDATED: 'Kurvenbasis oder Abdeckung ist nicht belegt.',
  DATA_FRESHNESS_UNKNOWN: 'Datenfrische ist unbekannt.',
  DATA_STALE: 'Die Daten sind veraltet.',
  ENTRY_SIGNAL: 'Einstiegssignal.',
  FRESHNESS_METADATA_INCOMPLETE: 'Angaben zur Datenfrische fehlen.',
  LAST_TRADE_NOT_REPORTED: 'Kein letzter Handel gemeldet.',
  LIVES_RISK_NOT_VALIDATED: 'Risikowerte sind nicht ausreichend belegt.',
  LOWVOL_INSTRUMENT_ADAPTER_NOT_AVAILABLE: 'Instrument noch nicht angebunden.',
  LOWVOL_NATIVE_UNIT_ADAPTER_NOT_AVAILABLE: 'Native Einheit USDT; Anbindung noch ausstehend.',
  LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE: 'Laufzeitdaten noch nicht angebunden.',
  METRIC_NOT_REPORTED: 'Wert nicht gemeldet.',
  METRIC_MISSING: 'Wert nicht gemeldet.',
  NO_TRADE_REASON_NOT_REPORTED: 'Kein Handelsgrund gemeldet.',
  NO_TRADES_REPORTED: 'Noch keine Handelsdetails gemeldet.',
  NOT_APPLICABLE_TO_THIS_BOT: 'Für diesen Bot nicht vorgesehen.',
  PAUSE_REASON_NOT_REPORTED: 'Pausengrund nicht gemeldet.',
  PERCENT_BASIS_NOT_VALIDATED: 'Berechnungsbasis nicht belegt.',
  REPORT_ADAPTER_NOT_PROVIDED: 'Noch keine Laufdaten verfügbar.',
  REPORT_ADAPTER_REJECTED: 'Laufdaten konnten nicht geprüft werden.',
  REPORT_SNAPSHOT_HISTORICAL: 'Historischer Bericht-Snapshot; kein aktueller Laufstatus.',
  OBSERVED_CHECKPOINT_NOT_RUNTIME_STATUS: 'Beobachteter Bewertungs-Checkpoint; kein Laufstatus.',
  PAIRED_PROGRESS_IDENTITY_MISMATCH: 'Checkpoint und freigegebene Run-Identität stimmen nicht überein.',
  CHECKPOINT_METRIC_NOT_REPORTED: 'Wert im Checkpoint nicht gemeldet.',
  CHECKPOINT_FILL_DETAILS_LIMITED: 'Nur geprüfte Füllungszahl; keine vollständigen Handelsdetails.',
  NO_FILL_REPORTED: 'Keine Füllung im Checkpoint gemeldet.',
  RUNTIME_EVIDENCE_NOT_VALIDATED: 'Laufstatus ist nicht belegt.',
  PAIRED_REPORT_EVIDENCE_UNKNOWN: 'Berichtsevidenz ist unbekannt.',
  PAIRED_REPORT_IDENTITY_NOT_SUPPORTED: 'Trend-Modellidentität wird nicht unterstützt.',
  PAIRED_REPORT_NOT_VALIDATED: 'Gepaarter Bericht konnte nicht validiert werden.',
  TRADE_DETAILS_NOT_VALIDATED: 'Handelsdetails konnten nicht geprüft werden.',
  TRADE_DETAILS_NOT_REPORTED: 'Handelsdetails wurden nicht gemeldet.',
  ROUND_TRIPS_NOT_REPORTED: 'Handelsrunden wurden nicht gemeldet.',
  VERSION_NOT_REPORTED: 'Version nicht gemeldet.',
  SOURCE_FRESH: 'Quelle meldet aktuelle Daten.',
  SOURCE_STALE: 'Quelle meldet veraltete Daten.'
});
const METRIC_LABELS = Object.freeze([
  ['capital', 'Kapital'],
  ['netPnl', 'Netto-Ergebnis'],
  ['equity', 'Eigenkapital'],
  ['realizedPnl', 'Realisierter PnL'],
  ['unrealizedPnl', 'Nicht realisierter PnL'],
  ['fees', 'Gebühren'],
  ['slippage', 'Ausführungskosten (Slippage)'],
  ['funding', 'Finanzierungskosten']
]);
let overviewSequence = 0;

function node(document, parent, tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function field(document, parent, label, value, tone = 'tone-muted') {
  const item = document.createElement('div');
  item.setAttribute('style',
    'display:grid;gap:3px;min-width:0;overflow-wrap:anywhere;padding:8px 0');
  node(document, item, 'strong', label);
  node(document, item, 'span', value, tone);
  parent.append(item);
}

function amount(value, signed = false) {
  if (!value?.available) return `Unbekannt — ${reasonText(value?.reason)}`;
  const formatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  if (!signed) return formatter.format(value.value);
  const amountText = formatter.format(Math.abs(value.value));
  if (value.value === 0) return amountText;
  return `${value.value < 0 ? '−' : '+'}${amountText} ${value.value < 0 ? 'Verlust' : 'Gewinn'}`;
}

function reasonText(reason) {
  if (typeof reason !== 'string' || reason.length === 0) return 'Angabe nicht verfügbar.';
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  return /^[A-Z][A-Z0-9_]*$/.test(reason) ? 'Angabe nicht verfügbar.' : reason;
}

function unknownText(value, fallback = 'Angabe nicht verfügbar.') {
  return `Unbekannt — ${value?.available ? fallback : reasonText(value?.reason)}`;
}

function amountTone(value, signed = false) {
  if (!signed || !value?.available || value.value === 0) return 'tone-muted';
  return value.value < 0 ? 'tone-danger' : 'tone-safe';
}

function percent(value) {
  if (!value?.available) return unknownText(value, 'Prozentwert nicht gemeldet.');
  const sign = value.value > 0 ? '+' : value.value < 0 ? '−' : '';
  const text = `${sign}${new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value.value))} %`;
  if (value.value === 0) return text;
  return `${text} ${value.value < 0 ? 'Verlust' : 'Gewinn'}`;
}

function signedPercentTone(value) {
  if (!value?.available || value.value === 0) return 'tone-muted';
  return value.value < 0 ? 'tone-danger' : 'tone-safe';
}

function time(value) {
  if (!value?.available) return unknownText(value, 'Zeit nicht gemeldet.');
  const seconds = Math.floor(value.value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return [hours && `${hours} Std.`, minutes && `${minutes} Min.`,
    remainder && `${remainder} Sek.`].filter(Boolean).join(' ') || '0 Sek.';
}

function timestamp(value) {
  if (!value?.available) return unknownText(value, 'Zeitpunkt nicht gemeldet.');
  const date = new Date(value.value);
  if (!Number.isFinite(date.getTime())) return 'Unbekannt — Zeitpunkt ungültig.';
  return `${new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Vienna'
  }).format(date)} (Europe/Wien)`;
}

function snapshotTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 ||
      !Number.isFinite(new Date(value).getTime())) {
    return 'Unbekannt — Bewertungszeitpunkt fehlt oder ist ungültig.';
  }
  return timestamp({available: true, value: new Date(value).toISOString()});
}

function describeReason(bot) {
  if (bot.reason) return reasonText(bot.reason);
  if (bot.state === 'PAUSED') return 'Unbekannt — Pausengrund nicht gemeldet.';
  if (bot.state === 'PREPARED') return 'Noch keine Laufzeit-Evidenz.';
  if (bot.state === 'UNKNOWN') return `Unbekannt — ${reasonText(bot.stateReason)}`;
  return 'Kein aktueller Hinweis gemeldet.';
}

function summaryStatus(bot) {
  if (bot.reportSnapshot) {
    const evidence = {
      VERIFIED_COMPLETE: 'strukturell vollständig',
      INTERRUPTED: 'unterbrochen',
      RUNNING_SNAPSHOT: 'Zwischenstand',
      OBSERVED_CHECKPOINT: 'beobachtet'
    }[bot.reportSnapshot.evidenceStatus] || 'Evidenz unbekannt';
    return `${bot.reportSnapshot.evidenceStatus === 'OBSERVED_CHECKPOINT' ?
      'Checkpoint' : 'Historischer Snapshot'} · ${evidence}`;
  }
  const state = STATE_LABELS[bot.state] || STATE_LABELS.UNKNOWN;
  if (bot.state === 'PREPARED' || bot.state === 'UNKNOWN') return state;
  return `${state} · ${freshnessPresentation(bot)}`;
}

function freshnessPresentation(bot) {
  const freshness = bot?.freshness;
  if (freshness?.status === 'STALE') return 'Daten veraltet';
  const validTimestamp = typeof freshness?.at === 'string' &&
    Number.isFinite(Date.parse(freshness.at));
  const validAge = Number.isFinite(freshness?.ageMs) && freshness.ageMs >= 0;
  if (freshness?.status === 'FRESH' && validTimestamp && validAge) {
    return 'Aktuell';
  }
  return 'Datenfrische unbekannt';
}

function renderTradeDetails(document, parent, bot, disclosures, disclosureStates) {
  const details = document.createElement('details');
  details.spotPaperDisclosureKey = `trades:${bot.id}`;
  if (disclosureStates.has(details.spotPaperDisclosureKey)) {
    details.open = disclosureStates.get(details.spotPaperDisclosureKey);
  }
  details.setAttribute('style', 'margin-top:10px;min-width:0');
  node(document, details, 'summary', `Handelsdetails (${bot.trades.length})`);
  if (bot.trades.length === 0) {
    node(document, details, 'p',
      `Keine bestätigten Handelsdetails — ${reasonText(bot.tradesReason)}`);
  } else {
    const list = document.createElement('ol');
    list.setAttribute('style', 'padding-inline-start:24px;min-width:0');
    for (const trade of bot.trades) {
      const item = document.createElement('li');
      item.setAttribute('style', 'overflow-wrap:anywhere;padding:6px 0');
      node(document, item, 'strong', `${trade.side} · ${timestamp({
        available: true, value: trade.at
      })}`);
      node(document, item, 'p',
        `${trade.quantity} ${trade.quantityUnit} · Preis ${amount(trade.price)} · Volumen ${amount(trade.amount)}`);
      if (trade.reason) node(document, item, 'p', `Grund: ${reasonText(trade.reason)}`);
      list.append(item);
    }
    details.append(list);
  }
  parent.append(details);
  disclosures.push(details);
}

function renderBot(document, parent, bot, disclosures, disclosureStates) {
  const card = document.createElement('details');
  card.className = 'spot-paper-bot-card';
  card.spotPaperDisclosureKey = `card:${bot.id}`;
  if (disclosureStates.has(card.spotPaperDisclosureKey)) {
    card.open = disclosureStates.get(card.spotPaperDisclosureKey);
  }
  card.setAttribute('style',
    'border:1px solid currentColor;border-radius:12px;padding:12px;min-width:0;overflow-wrap:anywhere');
  const summary = document.createElement('summary');
  summary.setAttribute('style',
    'cursor:pointer;display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0;padding:4px 0;letter-spacing:0');
  node(document, summary, 'strong', bot.label);
  if (bot.strategy !== bot.label) node(document, summary, 'small', bot.strategy);
  const status = node(document, summary, 'span', summaryStatus(bot),
    'spot-paper-bot-status tone-muted');
  status.setAttribute('style',
    'display:inline-flex;align-items:center;max-width:100%;padding:2px 7px;border:1px solid currentColor;border-radius:999px;font-size:11px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;transform:none;transition:none');
  const summaryPnl = bot.metrics.netPnl;
  const summaryValue = document.createElement('strong');
  summaryValue.setAttribute('style', 'font-size:13px;overflow-wrap:anywhere');
  summaryValue.textContent = `Netto-PnL ${summaryPnl?.available ?
    amount(summaryPnl, true) : 'Unbekannt'}`;
  summaryValue.className = amountTone(summaryPnl, true);
  summary.append(summaryValue);
  node(document, summary, 'small', bot.reportSnapshot ?
    `Bewertung: ${snapshotTimestamp(bot.reportSnapshot.valuationAt)}` :
      `Quelle: ${bot.freshness.at ?
        timestamp({available: true, value: bot.freshness.at}) : 'Zeitpunkt nicht gemeldet.'}`);
  card.append(summary);
  disclosures.push(card);

  const content = document.createElement('div');
  content.setAttribute('style', 'display:grid;gap:8px;min-width:0;padding-top:12px');
  const capital = document.createElement('section');
  capital.setAttribute('aria-label', `${bot.label} Kapital und Ergebnis`);
  node(document, capital, 'h4', 'Kapital & Ergebnis');
  const capitalMetrics = document.createElement('div');
  capitalMetrics.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:8px;min-width:0');
  for (const key of ['capital', 'equity', 'netPnl', 'realizedPnl', 'unrealizedPnl']) {
    const label = METRIC_LABELS.find(([metric]) => metric === key)[1];
    const value = bot.metrics[key];
    const signed = key === 'netPnl' || key === 'realizedPnl' || key === 'unrealizedPnl';
    field(document, capitalMetrics, label, amount(value, signed),
      key === 'equity' && value?.available && value.value < 0 ?
        'tone-danger' : amountTone(value, signed));
  }
  field(document, capitalMetrics, 'Netto-PnL %', percent(bot.netPnlPercent),
    signedPercentTone(bot.netPnlPercent));
  capital.append(capitalMetrics);
  content.append(capital);

  if (bot.instrument) {
    const instrument = document.createElement('section');
    instrument.setAttribute('aria-label', `${bot.label} Instrument`);
    field(document, instrument, 'Instrument', bot.instrument);
    field(document, instrument, 'Modelleinheit', bot.nativeUnit);
    content.append(instrument);
  }

  const costs = document.createElement('section');
  costs.setAttribute('aria-label', `${bot.label} Kosten und Handel`);
  node(document, costs, 'h4', 'Kosten & Handel');
  const costMetrics = document.createElement('div');
  costMetrics.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:8px;min-width:0');
  for (const key of ['fees', 'slippage', 'funding']) {
    const label = METRIC_LABELS.find(([metric]) => metric === key)[1];
    const value = bot.metrics[key];
    const signed = key === 'funding';
    field(document, costMetrics, label, amount(value, signed), amountTone(value, signed));
  }
  field(document, costMetrics, 'Abgeschlossene Handelsrunden', bot.roundTrips.available ?
    String(bot.roundTrips.value) : unknownText(bot.roundTrips));
  field(document, costMetrics, 'Zeit investiert', time(bot.timeInvestedMs));
  field(document, costMetrics, 'Letzter Trade', timestamp(bot.lastTradeAt));
  costs.append(costMetrics);
  renderTradeDetails(document, costs, bot, disclosures, disclosureStates);
  content.append(costs);

  const details = document.createElement('section');
  details.setAttribute('aria-label', `${bot.label} Statusdetails`);
  node(document, details, 'h4', 'Status & Details');
  field(document, details, 'Strategie', bot.strategy);
  field(document, details, 'Version', bot.version.available ?
    bot.version.value : unknownText(bot.version));
  if (bot.instrument) {
    field(document, details, 'Markt', unknownText(bot.market));
    field(document, details, 'Währung', unknownText(bot.currency));
  } else {
    field(document, details, 'Markt', bot.market.available ?
      bot.market.value : unknownText(bot.market));
    field(document, details, 'Währung', bot.currency.available ?
      bot.currency.value : unknownText(bot.currency));
  }
  const reportedState = STATE_LABELS[bot.state] || STATE_LABELS.UNKNOWN;
  field(document, details, 'Gemeldeter Laufstatus',
    bot.state === 'PREPARED' || bot.state === 'UNKNOWN' ? reportedState :
      `${reportedState} · ${freshnessPresentation(bot)}`);
  field(document, details, 'Datenfrische',
    `${FRESHNESS_LABELS[bot.freshness.status] || FRESHNESS_LABELS.UNKNOWN} · ${reasonText(bot.freshness.reason)}` +
    (bot.freshness.at ? ` · ${timestamp({available: true, value: bot.freshness.at})}` : ''));
  field(document, details, bot.state === 'PAUSED' ? 'Pause-Grund' : 'Handels-/Statusgrund',
    describeReason(bot));
  if (bot.reportSnapshot) {
    field(document, details, 'Bericht-Snapshot · Run-ID', bot.reportSnapshot.runId);
    field(document, details, 'Evidenzstatus', bot.reportSnapshot.evidenceStatus);
    field(document, details, 'Bewertungszeitpunkt',
      snapshotTimestamp(bot.reportSnapshot.valuationAt));
    if (bot.reportSnapshot.terminalStatus) {
      field(document, details, 'Aufgezeichneter Endstatus',
        bot.reportSnapshot.terminalStatus);
      field(document, details, 'Geprüfte Füllungen',
        String(bot.reportSnapshot.fillCount));
      field(document, details, 'Bestand am Checkpoint',
        bot.reportSnapshot.inventoryStatus === 'OPEN' ? 'Offene Position' :
          bot.reportSnapshot.inventoryStatus === 'FLAT' ? 'Keine offene Position' :
            'Unbekannt');
      if (bot.reportSnapshot.recentFills.length > 0) {
        const fills = document.createElement('section');
        node(document, fills, 'h4',
          `Letzte geprüfte Füllungen (${bot.reportSnapshot.recentFills.length})`);
        const list = document.createElement('ol');
        list.setAttribute('style',
          'padding-inline-start:24px;min-width:0;overflow-wrap:anywhere');
        for (const fill of bot.reportSnapshot.recentFills) {
          node(document, list, 'li',
            `${fill.side} · ${timestamp({available: true,
              value: new Date(fill.executionAt).toISOString()})} · ` +
            `Volumen ${amount({available: true, value: fill.grossCents / 100,
              currency: 'EUR'})} · Gebühr ${amount({available: true,
              value: fill.feeCents / 100, currency: 'EUR'})}`);
        }
        fills.append(list);
        details.append(fills);
      }
    }
    field(document, details, 'Kostenannahmen',
      `${bot.reportSnapshot.feeBpsPerSide} bp Gebühr und ` +
      `${bot.reportSnapshot.slippageBpsPerSide} bp Slippage je Seite; ` +
      `${bot.reportSnapshot.ratesVerified ? 'Sätze verifiziert.' : 'Sätze nicht verifiziert.'}`);
  }
  content.append(details);

  if (bot.id === 'btc-usd-lives') {
    const risk = document.createElement('section');
    risk.setAttribute('aria-label', `${bot.label} Risikoinformation`);
    node(document, risk, 'h4', 'Lives-Challenge · USD-Verlustgrenze');
    field(document, risk, 'Rückgang vom bisherigen Höchststand',
      amount(bot.risk.drawdown),
      bot.risk.drawdown.available ? 'tone-danger' : 'tone-muted');
    field(document, risk, 'Verbleibendes USD 100 Verlustbudget',
      amount(bot.risk.allowance));
    field(document, risk, 'Risikovalidierung', bot.risk.available ?
      'Risikowerte aus geprüften Daten.' : unknownText(bot.risk.drawdown));
    content.append(risk);
  }
  card.append(content);
  parent.append(card);
}

function renderCurve(document, root, curve, bots) {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Ausgerichtete normalisierte Kurven');
  node(document, section, 'h3', 'Normalisierte Kurven');
  if (!curve.available) {
    node(document, section, 'p',
      `Nicht dargestellt — ${reasonText(curve.reason)} Keine Rangfolge zwischen unterschiedlichen Zeiträumen.`);
  } else {
    node(document, section, 'p',
      `Auf Startkapital normiert · Zeitraum ${timestamp({available: true, value: curve.coverageStart})} bis ${timestamp({available: true, value: curve.coverageEnd})}.`);
    const botById = new Map(bots.map(bot => [bot.id, bot]));
    const curveBots = curve.botIds.map(id => botById.get(id)).filter(Boolean);
    if (curve.excludedBotIds.length > 0) {
      node(document, section, 'p',
        `Nicht enthalten: ${curve.excludedBotIds.map(id => {
          const bot = botById.get(id);
          const reason = bot?.state === 'PREPARED' ? 'noch in Vorbereitung' :
            bot?.state === 'UNKNOWN' ? 'Laufstatus unbekannt' : 'keine passende Kurve';
          return `${bot?.label || 'Unbekannt'} (${reason})`;
        }).join(', ')}.`);
    }
    const list = document.createElement('ol');
    list.setAttribute('style', 'padding-inline-start:24px');
    for (const point of curve.points) {
      node(document, list, 'li', `${timestamp({available: true, value: point.at})} · ${curveBots.map(bot =>
        `${bot.label}: ${point.values[bot.id]}`).join(' · ')}`);
    }
    section.append(list);
  }
  root.append(section);
}

export function renderSpotPaperBotOverview(root, adapters, document = root?.ownerDocument,
  {pairedReport = null, pairedProgress = null, expectedIdentity = null} = {}) {
  if (!root || !document) return null;
  const disclosureStates = new Map();
  const rememberDisclosures = element => {
    if (element?.tagName === 'DETAILS' && element.spotPaperDisclosureKey) {
      disclosureStates.set(element.spotPaperDisclosureKey, element.open);
    }
    for (const child of element?.children || []) rememberDisclosures(child);
  };
  rememberDisclosures(root);
  const model = presentSpotPaperBotOverview(adapters, {
    pairedReport, pairedProgress, expectedIdentity
  });
  root.replaceChildren();
  root.setAttribute('style',
    'box-sizing:border-box;display:grid;gap:12px;min-width:0;max-width:100%;padding:12px;overflow-wrap:anywhere');
  root.setAttribute('role', 'region');
  const heading = node(document, root, 'h2', 'Paper-Bot-Übersicht');
  heading.id = `spot-paper-bot-overview-${++overviewSequence}`;
  root.setAttribute('aria-labelledby', heading.id);
  if (model.bots.some(bot => bot.syntheticFixture)) {
    node(document, root, 'p',
      'Vorschau mit Testdaten. Keine Echtdaten.',
      'caption');
  }
  const status = node(document, root, 'p',
    'Drei getrennte Papier-Bot-Ansichten.',
    'caption');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  node(document, root, 'p',
    'BTC/EUR und BTC/USD werden getrennt angezeigt. Keine währungsübergreifenden Summen oder Rangfolgen.',
    'caption');
  node(document, root, 'p',
    'Schreibgeschützte Ansicht. Keine Kontozugriffe oder Start-/Stopp-Funktionen.',
    'caption');
  const cards = document.createElement('div');
  cards.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;min-width:0');
  cards.id = `${heading.id}-cards`;
  const disclosures = [];
  for (const bot of model.bots) {
    renderBot(document, cards, bot, disclosures, disclosureStates);
  }
  const controls = document.createElement('div');
  controls.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:8px;min-width:0');
  for (const [label, open] of [['Alle Details öffnen', true], ['Alle Details schließen', false]]) {
    const button = node(document, controls, 'button', label);
    button.setAttribute('type', 'button');
    button.setAttribute('aria-controls', cards.id);
    button.setAttribute('style',
      'min-height:44px;min-width:44px;max-width:100%;padding:8px 12px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere');
    button.addEventListener('click', () => {
      for (const disclosure of disclosures) disclosure.open = open;
    });
  }
  root.append(controls);
  root.append(cards);
  renderCurve(document, root, model.curve, model.bots);
  return model;
}
