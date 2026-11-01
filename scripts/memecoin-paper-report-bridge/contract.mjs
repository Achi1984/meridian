export const PAPER_REPORT_SCHEMA = 'MEMECOIN_PAPER_OPERATOR_REPORT_V1';
export const PAPER_REPORT_ENVELOPE_SCHEMA = 'MEMECOIN_PAPER_REPORT_BRIDGE_ENVELOPE_V1';
export const MAX_PAPER_REPORT_BYTES = 256 * 1024;
export const MAX_PAPER_REPORT_TIMEOUT_MS = 10_000;

const MAX_NODES = 10_000;
const MAX_DEPTH = 16;
const MAX_STRING_BYTES = 512;
const MAX_ROWS = 40;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const INTEGER_CENTS = /^(?:0|[1-9]\d{0,128})$/;
const SIGNED_CENTS = /^-?(?:0|[1-9]\d{0,128})$/;

const text = (max = MAX_STRING_BYTES, nullable = true) => ({kind: 'text', max, nullable});
const count = {kind: 'count', nullable: true};
const flag = {kind: 'flag', nullable: true};
const amount = {kind: 'amount', nullable: true};
const signedAmount = {kind: 'signedAmount', nullable: true};
const date = {kind: 'date', nullable: true};
const observedDate = {kind: 'observedDate', nullable: true};
const array = (item, max = MAX_ROWS) => ({kind: 'array', item, max});
const object = (required, fields) => ({kind: 'object', required, fields});

const coverage = object(
  [],
  {
    observedTotal: count,
    total: count,
    displayed: count,
    displayTruncated: flag,
    sourceTruncated: flag,
    unaccounted: count
  }
);

const discoveryCoverage = object(
  [],
  {
    observedRecords: count,
    scoutAuditRows: count,
    unaccountedObservedRecords: count,
    sourceTruncated: flag,
    scoutAuditTruncated: flag,
    exhaustive: flag
  }
);

const auditCoverage = object(
  [],
  {
    present: flag,
    observedRows: count,
    truncated: flag,
    totalRows: count,
    replayLoggerTruncated: flag,
    ledgerAuditTruncated: flag,
    ledgerEventsReported: count,
    ledgerEventsAudited: count
  }
);

const reasonRow = object(['gate', 'status', 'reason', 'source', 'observedAt'], {
  mint: text(80),
  gate: text(80),
  status: text(32),
  reason: text(),
  source: text(120),
  observedAt: observedDate
});

const candidateDetailRow = object(
  ['chainId', 'mint', 'pool', 'relatedPool', 'quote', 'sampledAt',
    'status', 'reasons', 'reasonsCoverage'],
  {
    chainId: text(32),
    mint: text(80),
    pool: text(80),
    relatedPool: text(80),
    quote: text(80),
    sampledAt: observedDate,
    status: text(32),
    reasons: array(reasonRow),
    reasonsCoverage: coverage
  }
);

const stopRow = object(['kind', 'status', 'reason', 'observedAt', 'source'], {
  kind: text(64),
  status: text(32),
  reason: text(),
  observedAt: observedDate,
  source: text(120)
});

const positionRow = object(['mint', 'markStatus'], {
  mint: text(80),
  tokenAtoms: amount,
  decimals: count,
  entryCostCents: amount,
  stopPriceMicros: amount,
  trailingActive: flag,
  markStatus: text(32)
});

const unresolvedFillRow = object(['kind', 'receiptId', 'status', 'reason'], {
  kind: text(40),
  receiptId: text(120),
  status: text(32),
  reason: text()
});

const provenanceRow = object(
  ['chainId', 'mint', 'pool', 'relatedPool', 'quote', 'sampledAt', 'status'],
  {
    chainId: text(32),
    mint: text(80),
    pool: text(80),
    relatedPool: text(80),
    quote: text(80),
    sampledAt: observedDate,
    status: text(32)
  }
);

const reportShape = object(
  ['schema', 'experiment', 'evidence', 'candidates', 'trading', 'controls',
    'valuation', 'costs', 'unresolvedFills', 'unresolvedFillsCoverage',
    'provenance', 'provenanceCoverage'],
  {
    schema: {kind: 'literal', value: PAPER_REPORT_SCHEMA},
    experiment: object(
      ['id', 'source', 'evidenceKind', 'sourceProvenance', 'reportStatus',
        'operationalStatus'],
      {
        id: text(80, false),
        source: text(120, false),
        evidenceKind: text(64, false),
        sourceProvenance: text(64, false),
        reportStatus: {kind: 'enum', values: ['FINISHED', 'INCOMPLETE']},
        sourceReadiness: text(64),
        operationalStatus: {kind: 'literal', value: 'NOT_EVIDENCED'},
        startAt: date,
        endAt: date
      }
    ),
    evidence: object(
      ['status', 'basis', 'sources', 'coverage'],
      {
        status: {kind: 'enum', values: ['PASS', 'REJECT', 'UNKNOWN']},
        observedFrom: observedDate,
        observedThrough: observedDate,
        basis: text(),
        sources: array(text(120), 20),
        coverage: object(['discovery', 'audit'], {
          discovery: discoveryCoverage,
          audit: auditCoverage
        })
      }
    ),
    candidates: object(
      ['basis', 'details', 'detailsCoverage'],
      {
        considered: count,
        accepted: count,
        rejected: count,
        unknown: count,
        audited: count,
        authorizationReceiptCount: count,
        unaccountedObserved: count,
        discoveryTruncated: flag,
        scoutAuditTruncated: flag,
        basis: text(),
        details: array(candidateDetailRow),
        detailsCoverage: coverage
      }
    ),
    trading: object(
      ['status', 'basis', 'noTradeReasons', 'noTradeReasonsCoverage'],
      {
        status: text(64, false),
        paperEntryFills: count,
        basis: text(),
        noTradeReasons: array(reasonRow),
        noTradeReasonsCoverage: coverage
      }
    ),
    controls: object(
      ['stops', 'stopsCoverage', 'openPositions', 'openPositionsCoverage'],
      {
        stops: array(stopRow),
        stopsCoverage: coverage,
        reservations: count,
        openPositionCount: count,
        openPositions: array(positionRow),
        openPositionsCoverage: coverage
      }
    ),
    valuation: object(
      ['status', 'basis'],
      {
        status: text(64, false),
        cashCents: amount,
        realizedGrossPnlCents: signedAmount,
        realizedNetPnlCents: signedAmount,
        grossOpenValueCents: amount,
        estimatedExitCostsCents: amount,
        unrealizedGrossPnlCents: signedAmount,
        unrealizedNetPnlCents: signedAmount,
        unresolvedPositions: count,
        basis: text()
      }
    ),
    costs: object(
      ['basis', 'entryByType', 'exitByType', 'totalByType'],
      {
        basis: text(),
        entryByType: object([], {
          feeCents: amount,
          spreadCents: amount,
          slippageCents: amount,
          priceImpactCents: amount,
          networkCents: amount
        }),
        exitByType: object([], {
          feeCents: amount,
          spreadCents: amount,
          slippageCents: amount,
          priceImpactCents: amount,
          networkCents: amount
        }),
        totalByType: object([], {
          feeCents: amount,
          spreadCents: amount,
          slippageCents: amount,
          priceImpactCents: amount,
          networkCents: amount
        }),
        totalCents: amount
      }
    ),
    unresolvedFills: array(unresolvedFillRow),
    unresolvedFillsCoverage: coverage,
    provenance: array(provenanceRow),
    provenanceCoverage: coverage
  }
);

export class PaperReportContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PaperReportContractError';
    this.code = code;
  }
}

function fail(code) {
  throw new PaperReportContractError(code);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function project(value, descriptor, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) fail('DTO_LIMIT');

  if (descriptor.kind === 'literal') {
    if (value !== descriptor.value) fail('UNSUPPORTED_SCHEMA');
    return value;
  }
  if (descriptor.kind === 'object') {
    if (!isRecord(value)) fail('INVALID_DTO');
    const keys = Object.keys(value);
    if (keys.length > 64 || keys.some(key => !Object.hasOwn(descriptor.fields, key)) ||
        descriptor.required.some(key => !Object.hasOwn(value, key))) {
      fail('INVALID_DTO');
    }
    const result = {};
    for (const key of keys) {
      result[key] = project(value[key], descriptor.fields[key], state, depth + 1);
    }
    return result;
  }
  if (descriptor.kind === 'array') {
    if (!Array.isArray(value) || value.length > descriptor.max) fail('DTO_LIMIT');
    return value.map(item => project(item, descriptor.item, state, depth + 1));
  }
  if (value === null && descriptor.nullable) return null;
  if (descriptor.kind === 'text' || descriptor.kind === 'enum') {
    if (typeof value !== 'string' || byteLength(value) > descriptor.max ||
        (descriptor.kind === 'enum' && !descriptor.values.includes(value)) ||
        (descriptor.nullable === false && !value.trim())) {
      fail('INVALID_DTO');
    }
    return value;
  }
  if (descriptor.kind === 'count') {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_DTO');
    return value;
  }
  if (descriptor.kind === 'flag') {
    if (typeof value !== 'boolean') fail('INVALID_DTO');
    return value;
  }
  if (descriptor.kind === 'amount' || descriptor.kind === 'signedAmount') {
    const pattern = descriptor.kind === 'amount' ? INTEGER_CENTS : SIGNED_CENTS;
    if (typeof value !== 'string' || value.length > 129 || !pattern.test(value) || value === '-0') {
      fail('INVALID_DTO');
    }
    return value;
  }
  if (descriptor.kind === 'date' || descriptor.kind === 'observedDate') {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      fail('INVALID_DTO');
    }
    const timestamp = Date.parse(value);
    if (descriptor.kind === 'observedDate' && timestamp > state.now) fail('FUTURE_OBSERVATION');
    return value;
  }
  fail('INVALID_DTO');
}

function decodeInput(input) {
  let bytes;
  if (typeof input === 'string') {
    if (input.length > MAX_PAPER_REPORT_BYTES) fail('OVERSIZED');
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    fail('INVALID_INPUT');
  }
  if (bytes.byteLength > MAX_PAPER_REPORT_BYTES) fail('OVERSIZED');
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    fail('INVALID_JSON');
  }
  return value;
}

export function decodePaperReportEnvelope(input, {now = Date.now(), staleAfterMs = null} = {}) {
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime()) ||
      (staleAfterMs !== null &&
        (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0))) {
    fail('INVALID_FRESHNESS_POLICY');
  }

  const envelope = decodeInput(input);
  if (!isRecord(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'report,runId,schema' ||
      envelope.schema !== PAPER_REPORT_ENVELOPE_SCHEMA) {
    fail('UNSUPPORTED_ENVELOPE');
  }
  if (typeof envelope.runId !== 'string' || !SAFE_RUN_ID.test(envelope.runId)) {
    fail('INVALID_IDENTITY');
  }

  const report = project(envelope.report, reportShape, {nodes: 0, now});
  const experiment = report.experiment;
  if (envelope.runId !== experiment.id) fail('RUN_ID_MISMATCH');
  const observationMode = experiment.evidenceKind === 'READ_ONLY_PAPER_CHECKPOINT_RECEIPTS' &&
    experiment.sourceProvenance === 'CALLER_LABEL_ONLY_NOT_AUTHENTICATED';
  const syntheticMode = experiment.evidenceKind === 'SYNTHETIC_FIXTURE' &&
    experiment.sourceProvenance === 'SYNTHETIC_FIXTURE_DECLARED';
  if (!observationMode && !syntheticMode) fail('INVALID_PROVENANCE');

  const observedFrom = report.evidence.observedFrom;
  const observedThrough = report.evidence.observedThrough;
  if (observedFrom && observedThrough && Date.parse(observedFrom) > Date.parse(observedThrough)) {
    fail('INVALID_OBSERVATION_WINDOW');
  }
  let freshness = {status: 'UNKNOWN', observedAt: observedThrough ?? null, ageMs: null};
  if (observedThrough && staleAfterMs !== null) {
    const ageMs = now - Date.parse(observedThrough);
    freshness = {
      status: ageMs > staleAfterMs ? 'STALE' : 'WITHIN_DISPLAY_POLICY',
      observedAt: observedThrough,
      ageMs
    };
  }

  return {
    status: freshness.status === 'STALE' ? 'STALE' : 'AVAILABLE',
    runId: envelope.runId,
    report,
    freshness
  };
}
