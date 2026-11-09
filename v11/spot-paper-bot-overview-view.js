import {presentSpotPaperBotOverview} from './spot-paper-bot-overview-model.js?v=B16-M11-FIX14';

const STATE_LABELS = Object.freeze({
  PREPARED: 'In Vorbereitung',
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  UNKNOWN: 'Unbekannt'
});
const METRIC_LABELS = Object.freeze([
  ['capital', 'Kapital'],
  ['netPnl', 'Netto-PnL'],
  ['equity', 'Eigenkapital'],
  ['realizedPnl', 'Realisierter PnL'],
  ['unrealizedPnl', 'Nicht realisierter PnL'],
  ['fees', 'Gebühren'],
  ['slippage', 'Slippage'],
  ['funding', 'Funding']
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
  if (!value?.available) return `Unbekannt — ${value?.reason || 'METRIC_NOT_REPORTED'}`;
  const amountText = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value.value));
  if (!signed || value.value === 0) return amountText;
  return `${value.value < 0 ? '−' : '+'}${amountText} ${value.value < 0 ? 'Verlust' : 'Gewinn'}`;
}

function amountTone(value, signed = false) {
  if (!signed || !value?.available || value.value === 0) return 'tone-muted';
  return value.value < 0 ? 'tone-danger' : 'tone-safe';
}

function percent(value) {
  if (!value?.available) return `Unbekannt — ${value?.reason || 'PNL_PERCENT_NOT_REPORTED'}`;
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
  if (!value?.available) return `Unbekannt — ${value?.reason || 'TIME_NOT_REPORTED'}`;
  const seconds = Math.floor(value.value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return [hours && `${hours} Std.`, minutes && `${minutes} Min.`,
    remainder && `${remainder} Sek.`].filter(Boolean).join(' ') || '0 Sek.';
}

function timestamp(value) {
  if (!value?.available) return `Unbekannt — ${value?.reason || 'TIMESTAMP_NOT_REPORTED'}`;
  const date = new Date(value.value);
  if (!Number.isFinite(date.getTime())) return 'Unbekannt — TIMESTAMP_INVALID';
  return `${new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Vienna'
  }).format(date)} (Europe/Wien)`;
}

function describeReason(bot) {
  if (bot.reason) return bot.reason;
  if (bot.state === 'PAUSED') return 'Unbekannt — PAUSE_REASON_NOT_REPORTED';
  if (bot.state === 'PREPARED') return 'Noch keine Laufzeit-Evidenz.';
  if (bot.state === 'UNKNOWN') return `Unbekannt — ${bot.stateReason || 'STATE_UNKNOWN'}`;
  return 'Kein aktueller Hinweis gemeldet.';
}

function renderTradeDetails(document, parent, bot) {
  const details = document.createElement('details');
  details.setAttribute('style', 'margin-top:10px;min-width:0');
  node(document, details, 'summary', `Trade-Details (${bot.trades.length})`);
  if (bot.trades.length === 0) {
    node(document, details, 'p',
      `Keine bestätigten Trade-Details — ${bot.tradesReason || 'NO_TRADES_REPORTED'}`);
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
        `${trade.quantity} · Preis ${amount(trade.price)} · Volumen ${amount(trade.amount)}`);
      if (trade.reason) node(document, item, 'p', `Grund: ${trade.reason}`);
      list.append(item);
    }
    details.append(list);
  }
  parent.append(details);
}

function renderBot(document, parent, bot) {
  const card = document.createElement('details');
  card.setAttribute('style',
    'border:1px solid currentColor;border-radius:12px;padding:12px;min-width:0;overflow-wrap:anywhere');
  const summary = document.createElement('summary');
  summary.setAttribute('style', 'cursor:pointer;display:flex;flex-wrap:wrap;gap:8px;align-items:center');
  node(document, summary, 'strong', bot.label);
  node(document, summary, 'span', STATE_LABELS[bot.state] || STATE_LABELS.UNKNOWN,
    bot.state === 'PAUSED' || bot.state === 'UNKNOWN' ? 'tone-muted' : '');
  card.append(summary);
  const content = document.createElement('div');
  content.setAttribute('style', 'display:grid;gap:8px;min-width:0;padding-top:12px');
  field(document, content, 'Strategie', bot.strategy);
  field(document, content, 'Version',
    bot.version.available ? bot.version.value : `Unbekannt — ${bot.version.reason}`);
  field(document, content, 'Markt',
    bot.market.available ? bot.market.value : `Unbekannt — ${bot.market.reason}`);
  field(document, content, 'Währung',
    bot.currency.available ? bot.currency.value : `Unbekannt — ${bot.currency.reason}`);

  const metrics = document.createElement('div');
  metrics.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:8px;min-width:0');
  for (const [key, label] of METRIC_LABELS) {
    const value = bot.metrics[key];
    field(document, metrics, label, amount(value, key === 'netPnl' ||
      key === 'realizedPnl' || key === 'unrealizedPnl' || key === 'funding'),
    amountTone(value, key === 'netPnl' || key === 'realizedPnl' ||
      key === 'unrealizedPnl' || key === 'funding'));
  }
  field(document, metrics, 'Netto-PnL %', percent(bot.netPnlPercent),
    signedPercentTone(bot.netPnlPercent));
  field(document, metrics, 'Round Trips', bot.roundTrips.available ?
    String(bot.roundTrips.value) : `Unbekannt — ${bot.roundTrips.reason}`);
  field(document, metrics, 'Zeit investiert', time(bot.timeInvestedMs));
  field(document, metrics, 'Letzter Trade', timestamp(bot.lastTradeAt));
  content.append(metrics);
  field(document, content, 'Datenfrische',
    `${bot.freshness.status} · ${bot.freshness.reason}` +
    (bot.freshness.at ? ` · ${timestamp({available: true, value: bot.freshness.at})}` : ''));
  field(document, content, bot.state === 'PAUSED' ? 'Pause-Grund' : 'Handels-/Statusgrund',
    describeReason(bot));

  if (bot.id === 'btc-usd-lives') {
    const risk = document.createElement('section');
    risk.setAttribute('aria-label', `${bot.label} Risikoinformation`);
    node(document, risk, 'h4', 'Lives-Challenge · USD-Verlustlimit');
    field(document, risk, 'Netto-Eigenkapital-High-Water-Drawdown',
      amount(bot.risk.drawdown),
      bot.risk.drawdown.available ? 'tone-danger' : 'tone-muted');
    field(document, risk, 'Verbleibendes USD 100 Verlustbudget',
      amount(bot.risk.allowance));
    field(document, risk, 'Risikovalidierung', bot.risk.available ?
      'Validiert durch den injizierten Report-Adapter.' :
      `Unbekannt — ${bot.risk.drawdown.reason}`);
    content.append(risk);
  }
  renderTradeDetails(document, content, bot);
  card.append(content);
  parent.append(card);
}

function renderCurve(document, root, curve, bots) {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Ausgerichtete normalisierte Kurven');
  node(document, section, 'h3', 'Normalisierte Kurven');
  if (!curve.available) {
    node(document, section, 'p',
      `Nicht dargestellt — ${curve.reason}. Kein Cross-Horizon-Ranking.`);
  } else {
    node(document, section, `Basis ${curve.basis} · Abdeckung ${curve.coverageStart} bis ${curve.coverageEnd}.`);
    const list = document.createElement('ol');
    list.setAttribute('style', 'padding-inline-start:24px');
    for (const point of curve.points) {
      node(document, list, 'li', `${point.at} · ${bots.map(bot =>
        `${bot.label}: ${point.values[bot.id]}`).join(' · ')}`);
    }
    section.append(list);
  }
  root.append(section);
}

export function renderSpotPaperBotOverview(root, adapters, document = root?.ownerDocument) {
  if (!root || !document) return null;
  const model = presentSpotPaperBotOverview(adapters);
  root.replaceChildren();
  root.setAttribute('style',
    'box-sizing:border-box;display:grid;gap:12px;min-width:0;max-width:100%;padding:12px;overflow-wrap:anywhere');
  root.setAttribute('role', 'region');
  const heading = node(document, root, 'h2', 'Paper-Bot-Übersicht');
  heading.id = `spot-paper-bot-overview-${++overviewSequence}`;
  root.setAttribute('aria-labelledby', heading.id);
  if (model.bots.some(bot => bot.syntheticFixture)) {
    node(document, root, 'p',
      'SYNTHETIC FIXTURE · nur Test-/Vorschau-Daten, keine Produktionsdaten.',
      'caption');
  }
  const status = node(document, root, 'p',
    'Drei getrennte Paper-Bot-Identitäten · nur validierte, injizierte Report-Adapter.',
    'caption');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  node(document, root,
    'BTC/EUR und BTC/USD bleiben getrennte Währungen. Es gibt keine Summen oder Rangfolge über Bot-Läufe und Horizonte hinweg.',
    'p', 'caption');
  node(document, root,
    'Diese Ansicht liest keine Konten, startet oder stoppt keine Bots und lädt keine Daten selbst.',
    'p', 'caption');
  const cards = document.createElement('div');
  cards.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;min-width:0');
  for (const bot of model.bots) renderBot(document, cards, bot);
  root.append(cards);
  renderCurve(document, root, model.curve, model.bots);
  return model;
}
