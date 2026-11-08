const STATUS_VALUES = new Set([
  'RUNNING', 'INTERRUPTED', 'VERIFIED_COMPLETE', 'UNKNOWN'
]);
const FRESHNESS_VALUES = new Set([
  'FRESH', 'STALE', 'UNKNOWN', 'WITHIN_DISPLAY_POLICY'
]);
const ARM_DEFINITIONS = Object.freeze([
  {id: 'baseline', label: 'Baseline'},
  {id: 'challenger', label: 'CONFIRM2_COOLDOWN10'},
  {id: 'cash', label: 'Cash'}
]);
const MONEY_FIELDS = Object.freeze([
  ['netEquityCents', 'Eigenkapital netto', false],
  ['netPnlCents', 'Netto-PnL', true],
  ['feesCents', 'Gebühren', false],
  ['turnoverCents', 'Umsatz', false],
  ['exposureCents', 'Exposure', false],
  ['sampledDrawdownCents', 'Stichproben-Drawdown', false]
]);
const COUNT_FIELDS = Object.freeze([['trades', 'Trades']]);

const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);

function safeText(value, limit = 180) {
  return typeof value === 'string' && value.trim() ?
    value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : null;
}

function cents(value, signed) {
  if (Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || value.length > 129 ||
      !(signed ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/).test(value) ||
      value === '-0') return null;
  return value;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function metricValue(metric, normalize, format) {
  const source = isRecord(metric) ? metric : {value: metric};
  const value = normalize(source.value);
  if (value === null) {
    return {
      value: null,
      label: `Unbekannt — ${safeText(source.reason) || 'Grund nicht angegeben'}`,
      tone: 'tone-muted'
    };
  }
  return {...format(value), value};
}

function formatCents(value, signed) {
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const whole = digits.slice(0, -2) || '0';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const amount = `${grouped},${digits.slice(-2).padStart(2, '0')} €`;
  if (!signed || value === '0') return {label: amount, tone: 'tone-muted'};
  return {
    label: `${negative ? '−' : '+'}${amount} ${negative ? 'Verlust' : 'Gewinn'}`,
    tone: negative ? 'tone-danger' : 'tone-safe'
  };
}

function formatCount(value) {
  return {label: String(value), tone: 'tone-muted'};
}

function duration(value) {
  if (value === null) return null;
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const parts = [];
  if (hours) parts.push(`${hours} Std.`);
  if (minutes) parts.push(`${minutes} Min.`);
  if (seconds || parts.length === 0) parts.push(`${seconds} Sek.`);
  return parts.join(' ');
}

function armModel(source) {
  const arm = isRecord(source) ? source : {};
  const metrics = {};
  for (const [key, , signed] of MONEY_FIELDS) {
    metrics[key] = metricValue(arm[key], value => cents(value, signed),
      value => formatCents(value, signed));
  }
  for (const [key] of COUNT_FIELDS) {
    metrics[key] = metricValue(arm[key], count, formatCount);
  }
  return {
    metrics,
    runId: safeText(arm.runId),
    positionStatus: safeText(arm.positionStatus) ||
      `Unbekannt — ${safeText(arm.positionReason) || 'Positionsstatus fehlt'}`,
    horizonKey: safeText(arm.horizonKey)
  };
}

function comparisonModel(source, arms) {
  const comparison = isRecord(source) ? source : {};
  const keys = ARM_DEFINITIONS.map(({id}) => arms[id].horizonKey);
  const horizon = safeText(comparison.horizonKey);
  const comparable = comparison.valid === true && horizon !== null &&
    keys.every(key => key === horizon);
  if (!comparable) {
    return {
      comparable: false,
      reason: safeText(comparison.reason) ||
        'Gemeinsamer, vergleichbarer Auswertungshorizont ist nicht bestätigt.',
      deltas: null
    };
  }
  return {
    comparable: true,
    reason: safeText(comparison.reason),
    deltas: {
      challengerVsBaseline: metricValue(comparison.challengerVsBaselineNetPnlCents,
        value => cents(value, true), value => formatCents(value, true)),
      cashVsBaseline: metricValue(comparison.cashVsBaselineNetPnlCents,
        value => cents(value, true), value => formatCents(value, true))
    }
  };
}

export function presentSpotPaperPairedReport(dto, {projectReport} = {}) {
  if (typeof projectReport !== 'function') {
    return {
      available: false,
      state: 'empty',
      status: 'UNKNOWN',
      reason: 'Gemeinsame Report-DTO-Prüfung ist noch nicht verbunden.'
    };
  }
  let projected;
  let projectionFailed = false;
  try {
    projected = projectReport(dto);
  } catch {
    projected = null;
    projectionFailed = true;
  }
  if (!isRecord(projected)) {
    return {
      available: false,
      state: projectionFailed ? 'error' : 'empty',
      status: 'UNKNOWN',
      reason: projectionFailed ?
        'Der gemeinsame Report konnte nicht geprüft werden.' :
        'Keine Berichtsdaten verfügbar.'
    };
  }
  const arms = Object.fromEntries(ARM_DEFINITIONS.map(({id}) =>
    [id, armModel(projected.arms?.[id])]));
  const actualDurationMs = count(projected.coverage?.actualDurationMs);
  const requestedDurationMs = 28_800_000;
  const freshness = FRESHNESS_VALUES.has(projected.freshness?.status) ?
    projected.freshness.status : 'UNKNOWN';
  const status = STATUS_VALUES.has(projected.status) ? projected.status : 'UNKNOWN';
  return {
    available: true,
    status,
    reason: safeText(projected.statusReason) ||
      (status === 'UNKNOWN' ? 'Laufstatus fehlt oder ist unbekannt' : null),
    identity: {runId: safeText(projected.identity?.runId)},
    observedAt: safeText(projected.observedAt, 48),
    feed: {
      pair: safeText(projected.feed?.pair),
      shared: projected.feed?.shared === true,
      noLeverage: projected.feed?.noLeverage === true,
      reason: safeText(projected.feed?.reason)
    },
    freshness: {
      status: freshness,
      reason: safeText(projected.freshness?.reason) ||
        (freshness === 'UNKNOWN' ? 'Aktualitätsbeleg fehlt' : null)
    },
    coverage: {
      requestedDurationMs,
      actualDurationMs,
      reason: safeText(projected.coverage?.reason)
    },
    arms,
    comparison: comparisonModel(projected.comparison, arms)
  };
}

export {ARM_DEFINITIONS, MONEY_FIELDS, COUNT_FIELDS};
