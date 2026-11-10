import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODELS,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA
} from '../scripts/spot-paper-paired-report/contract.mjs?v=B16-M11-FIX16';
import {validateProgress} from '../scripts/spot-paper-paired-progress/contract.mjs?v=B16-M11-FIX16';

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
const EMPTY_STATES = Object.freeze({
  idle: {
    state: 'idle',
    status: 'NOT_REQUESTED',
    statusLabel: 'Noch kein Bericht geladen; Kennzahlen bleiben unbekannt.'
  },
  ready: {
    state: 'idle',
    status: 'NOT_REQUESTED',
    statusLabel: 'Noch kein Bericht geladen; Kennzahlen bleiben unbekannt.'
  },
  locked: {
    state: 'idle',
    status: 'NOT_REQUESTED',
    statusLabel: 'Noch kein Bericht geladen; Kennzahlen bleiben unbekannt.'
  },
  loading: {
    state: 'loading',
    status: 'LOADING',
    statusLabel: 'Bericht wird geladen …'
  },
  transport_unavailable: {
    state: 'unprovisioned',
    status: 'TRANSPORT_UNAVAILABLE',
    statusLabel: 'Transport nicht provisioniert; Kennzahlen bleiben unbekannt.'
  },
  not_found: {
    state: 'empty',
    status: 'NO_PUBLISHED_REPORT',
    statusLabel: 'Kein gepaarter Bericht veröffentlicht; Kennzahlen bleiben unbekannt.'
  }
});

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
    completedRoundTripCount: arm.completedRoundTripCount,
    recentFills: Array.isArray(arm.recentFills) ? arm.recentFills.map(fill => ({
      side: fill.side,
      grossCents: fill.grossCents,
      feeCents: fill.feeCents,
      executionAt: fill.executionAt
    })) : [],
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
function unavailableReport(state) {
  const unavailable = EMPTY_STATES[state] || {
    state: 'unavailable',
    status: 'UNAVAILABLE',
    statusLabel: 'Bericht nicht verfügbar; Kennzahlen bleiben unbekannt.'
  };
  return {available: false, ...unavailable};
}

function challengerLabel(modelId) {
  if (modelId === SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[1]) {
    return 'CONFIRM2_COOLDOWN10 · 5M-SMA20-Trend';
  }
  if (modelId === SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[0]) {
    return 'CONFIRM2_COOLDOWN10';
  }
  return 'Challenger';
}

function identityMatches(identity, expected) {
  return identity?.runId === expected.runId && identity.pair === expected.pair &&
    identity.sourceSha256 === expected.sourceSha256 &&
    identity.configSha256 === expected.configSha256 &&
    identity.researchSourceSha256 === expected.researchSourceSha256 &&
    identity.modelPairId === expected.modelPairId &&
    expected.models.every((model, index) =>
      identity.models?.[index]?.role === model.role &&
      identity.models[index]?.modelId === model.modelId);
}

function checkpointView(snapshot, expectedIdentity, dto) {
  if (!snapshot) return null;
  const empty = {available: false, status: snapshot.status || 'NOT_REQUESTED'};
  if (!['AVAILABLE', 'STALE'].includes(snapshot.status)) return empty;
  const progress = validateProgress(snapshot.progress, expectedIdentity);
  if (!progress) return {...empty, status: 'REJECTED'};
  const sameRun = dto?.identity?.runId === progress.identity.runId;
  if (sameRun && !identityMatches(dto.identity, expectedIdentity)) {
    return {...empty, status: 'IDENTITY_MISMATCH'};
  }
  const arms = progress.arms.map(arm => armView({
    ...arm,
    metricReasons: Object.fromEntries(MONEY_FIELDS.map(([key]) =>
      [key, arm[key] === null ? 'METRIC_MISSING' : null]))
  }));
  return {
    available: true,
    status: snapshot.status,
    classification: progress.classification,
    identity: progress.identity,
    journalSequence: progress.journalSequence,
    valuationAt: progress.valuationAt,
    valuationAtLabel: timestamp(progress.valuationAt),
    ageMs: snapshot.ageMs,
    terminalStatus: progress.terminal.status,
    arms,
    sourceRelation: !dto ? 'CHECKPOINT_ONLY' : !sameRun ? 'SEPARATE_RUNS' :
      dto.timing.valuationAt === progress.valuationAt ?
        'CHECKPOINT_PRECEDENCE' : 'SEPARATE_VALUATIONS',
    terminalEvidence: sameRun ? dto.evidenceStatus : 'NO_TERMINAL_REPORT',
    independentAuthentication: sameRun ?
      dto.independentAuthentication : 'NO_FINAL_REPORT',
    separateHistoricalReport: dto && !sameRun ? {
      runId: dto.identity.runId,
      valuationAt: dto.timing.valuationAt,
      valuationAtLabel: timestamp(dto.timing.valuationAt),
      evidenceStatus: dto.evidenceStatus
    } : null
  };
}

export function presentSpotPaperPairedReport(input, {
  state = 'idle', progressSnapshot = null, expectedIdentity = null
} = {}) {
  let dto;
  if (input !== null && input !== undefined) {
    try {
      dto = projectSpotPaperPairedDashboard(input);
    } catch {
      dto = null;
    }
  }
  const checkpoint = checkpointView(progressSnapshot, expectedIdentity, dto);
  if (input === null || input === undefined) {
    return {...unavailableReport(state), checkpoint};
  }
  if (!isRecord(dto) || dto.schemaVersion !== SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA) {
    return {
      available: false,
      state: 'error',
      status: 'CORRUPT_UNKNOWN',
      statusLabel: STATUS_LABELS.CORRUPT_UNKNOWN,
      checkpoint
    };
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
      researchSourceSha256: identity.researchSourceSha256,
      modelPairId: identity.modelPairId ?? null
    },
    models: identity.models,
    challengerLabel: challengerLabel(arms.challenger.modelId),
    trendActivityDiagnostic: dto.trendActivityDiagnostic ?? null,
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
    decision: dto.decision,
    checkpoint
  };
}

export {ARM_DEFINITIONS, MONEY_FIELDS, COUNT_FIELDS, formatCents};
