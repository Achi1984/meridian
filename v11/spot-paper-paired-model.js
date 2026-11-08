import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA
} from '../scripts/spot-paper-paired-report/contract.mjs?v=B16-M11-FIX14';

const ARM_DEFINITIONS = Object.freeze([
  {id: 'baseline', label: 'Baseline'},
  {id: 'challenger', label: 'CONFIRM2_COOLDOWN10'},
  {id: 'cash', label: 'Cash'}
]);
const MONEY_FIELDS = Object.freeze([
  ['netEquityCents', 'Eigenkapital netto', false],
  ['netPnlCents', 'Netto-PnL', true],
  ['bookedFeesCents', 'Gebuchte Gebühren', false],
  ['modeledSlippageCents', 'Modellierter Slippage', false],
  ['hypotheticalExitFeeCents', 'Geschätzte Ausstiegsgebühr', false],
  ['hypotheticalExitSlippageCents', 'Geschätzter Ausstiegs-Slippage', false],
  ['turnoverCents', 'Umsatz', false],
  ['exposureCents', 'Exposure', false],
  ['sampledDrawdownCents', 'Stichproben-Drawdown', false]
]);
const COUNT_FIELDS = Object.freeze([
  ['fillCount', 'Fills'],
  ['unresolvedObservations', 'Ungeklärte Beobachtungen']
]);

const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);

function formatCents(value, signed) {
  if (!Number.isSafeInteger(value)) return null;
  const negative = value < 0;
  const digits = String(Math.abs(value)).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const amount = `${grouped},${digits.slice(-2)} €`;
  if (!signed || value === 0) return {value, label: amount, tone: 'tone-muted'};
  return {
    value,
    label: `${negative ? '−' : '+'}${amount} ${negative ? 'Verlust' : 'Gewinn'}`,
    tone: negative ? 'tone-danger' : 'tone-safe'
  };
}

function metric(value, reason, {signed = false, cents = false} = {}) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
    const why = reason || 'METRIC_MISSING';
    return {
      value: null,
      reason: why,
      label: `Unbekannt — ${why}`,
      tone: 'tone-muted'
    };
  }
  if (cents) return formatCents(value, signed);
  return {value, reason: null, label: String(value), tone: 'tone-muted'};
}

function timestamp(ms) {
  return Number.isSafeInteger(ms) && ms >= 0 && Number.isFinite(new Date(ms).getTime()) ?
    new Intl.DateTimeFormat('de-AT', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'Europe/Vienna'
    }).format(ms) + ' (Europe/Wien)' : null;
}

function elapsed(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms % 3_600_000 / 60_000);
  const seconds = Math.floor(ms % 60_000 / 1000);
  const parts = [];
  if (hours) parts.push(`${hours} Std.`);
  if (minutes) parts.push(`${minutes} Min.`);
  if (seconds || parts.length === 0) parts.push(`${seconds} Sek.`);
  return parts.join(' ');
}

function armView(arm) {
  const metrics = {};
  for (const [key, , signed] of MONEY_FIELDS) {
    metrics[key] = metric(arm[key], arm.metricReasons[key], {signed, cents: true});
  }
  for (const [key] of COUNT_FIELDS) {
    metrics[key] = metric(arm[key], arm.metricReasons[key]);
  }
  return {
    role: arm.role,
    modelId: arm.modelId,
    tradingStoppedAt: arm.tradingStoppedAt,
    tradingStoppedAtLabel: timestamp(arm.tradingStoppedAt),
    stopReason: arm.stopReason,
    inventoryStatus: arm.inventoryStatus,
    metrics
  };
}

function deltaView(delta) {
  if (delta.status !== 'AVAILABLE') {
    const reason = delta.reason || 'COMPARISON_UNAVAILABLE';
    const unknown = {
      value: null,
      reason,
      label: `Unbekannt — ${reason}`,
      tone: 'tone-muted'
    };
    return {netPnl: unknown, netEquity: unknown};
  }
  return {
    netPnl: metric(delta.netPnlCents, null, {signed: true, cents: true}),
    netEquity: metric(delta.netEquityCents, null, {signed: true, cents: true})
  };
}

const STATUS_LABELS = Object.freeze({
  VERIFIED_COMPLETE: 'VERIFIED_COMPLETE · strukturell abgeglichen',
  INTERRUPTED: 'INTERRUPTED · unterbrochener Lauf',
  RUNNING_SNAPSHOT: 'RUNNING_SNAPSHOT · vorläufiger Zwischenstand',
  CORRUPT_UNKNOWN: 'CORRUPT_UNKNOWN · unbekannt oder fehlerhaft'
});
const INVENTORY_LABELS = Object.freeze({
  FLAT: 'Keine offene Position',
  OPEN: 'Offene Position',
  UNKNOWN: 'Unbekannt — Bestandsstatus fehlt'
});
export function presentSpotPaperPairedReport(input) {
  let dto;
  try {
    dto = projectSpotPaperPairedDashboard(input);
  } catch {
    dto = null;
  }
  if (!isRecord(dto) || dto.schemaVersion !== SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA) {
    return {available: false, state: 'error', status: 'CORRUPT_UNKNOWN'};
  }
  const identity = dto.identity;
  const arms = Object.fromEntries(ARM_DEFINITIONS.map(({id}) =>
    [id, armView(dto.arms[id])]));
  const deltas = {
    challengerMinusBaseline: deltaView(dto.deltas.challengerMinusBaseline),
    baselineMinusCash: deltaView(dto.deltas.baselineMinusCash),
    challengerMinusCash: deltaView(dto.deltas.challengerMinusCash)
  };
  const statusLabel = STATUS_LABELS[dto.evidenceStatus] || STATUS_LABELS.CORRUPT_UNKNOWN;
  return {
    available: true,
    state: dto.evidenceStatus === 'CORRUPT_UNKNOWN' ? 'unknown' :
      dto.evidenceStatus === 'RUNNING_SNAPSHOT' ? 'running_snapshot' :
        dto.evidenceStatus.toLowerCase(),
    status: dto.evidenceStatus,
    statusLabel,
    reasonCode: dto.reasonCode,
    qualification: dto.evidenceQualification,
    authentication: dto.independentAuthentication,
    syntheticFixture: dto.syntheticFixture,
    identity: {
      runId: identity.runId,
      pair: identity.pair,
      sourceSha256: identity.sourceSha256,
      configSha256: identity.configSha256,
      researchSourceSha256: identity.researchSourceSha256
    },
    models: identity.models,
    timing: {
      requestedDurationMs: dto.timing.requestedDurationMs,
      observedCoverageMs: dto.timing.observedCoverageMs,
      observedCoverageLabel: elapsed(dto.timing.observedCoverageMs),
      actualElapsedMs: dto.timing.actualElapsedMs,
      actualElapsedLabel: elapsed(dto.timing.actualElapsedMs),
      runStoppedAt: dto.timing.runStoppedAt,
      runStoppedAtLabel: timestamp(dto.timing.runStoppedAt),
      valuationAt: dto.timing.valuationAt,
      valuationAtLabel: timestamp(dto.timing.valuationAt),
      requestedCycles: dto.timing.requestedCycles,
      attemptedCycles: dto.timing.attemptedCycles,
      completedCycles: dto.timing.completedCycles,
      stopReason: dto.timing.stopReason
    },
    assumptions: dto.assumptions,
    freshness: {
      status: 'UNKNOWN',
      reason: 'Frische wird im gemeinsamen Dashboard-DTO nicht geliefert.'
    },
    arms,
    deltas,
    deltaStatus: dto.deltas.status,
    deltaReason: dto.deltas.reason,
    decision: dto.decision
  };
}

export {ARM_DEFINITIONS, MONEY_FIELDS, COUNT_FIELDS};
