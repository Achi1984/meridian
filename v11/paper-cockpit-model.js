const REPORT_SCHEMA = 'MEMECOIN_PAPER_OPERATOR_REPORT_V1';
const READ_ONLY_KIND = 'READ_ONLY_PAPER_CHECKPOINT_RECEIPTS';
const SYNTHETIC_KIND = 'SYNTHETIC_FIXTURE';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240)
  : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const coverageCount = value => count(value);

function exactCents(value, signed = false) {
  if (typeof value !== 'string' || value.length > 129) return null;
  const pattern = signed ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/;
  return pattern.test(value) && value !== '-0' ? value : null;
}

function rows(value, fields) {
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const row of value) {
    if (result.length >= 40) break;
    if (isRecord(row)) {
      result.push(Object.fromEntries(fields.map(key => [key, text(row[key])])));
    }
  }
  return result;
}

function coverageState(evidence, candidates) {
  const discovery = evidence?.coverage?.discovery;
  const audit = evidence?.coverage?.audit;
  const details = candidates?.detailsCoverage;
  const flags = [
    discovery?.sourceTruncated,
    discovery?.scoutAuditTruncated,
    audit?.truncated,
    details?.sourceTruncated,
    details?.displayTruncated
  ];
  const remainder = [
    discovery?.unaccountedObservedRecords,
    details?.unaccounted
  ].map(coverageCount);
  if (flags.includes(true) || remainder.some(value => value !== null && value > 0)) return 'PARTIAL';
  const complete = flags.every(value => value === false) &&
    remainder.length === 2 && remainder.every(value => value === 0) &&
    coverageCount(details?.total) !== null &&
    coverageCount(details?.observedTotal) === coverageCount(details?.total);
  return complete ? 'COMPLETE' : 'UNKNOWN';
}

function freshness(evidence, now, staleAfterMs) {
  const observedAt = text(evidence?.observedThrough);
  const timestamp = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) {
    return {status: 'UNKNOWN', observedAt, ageMs: null};
  }
  const ageMs = now - timestamp;
  if (ageMs < 0) return {status: 'UNKNOWN', observedAt, ageMs: null};
  return {status: ageMs > staleAfterMs ? 'STALE' : 'WITHIN_DISPLAY_POLICY', observedAt, ageMs};
}

function mode(experiment) {
  if (experiment?.evidenceKind === READ_ONLY_KIND &&
      experiment?.sourceProvenance === 'CALLER_LABEL_ONLY_NOT_AUTHENTICATED') {
    return {
      label: 'Observation-only',
      detail: 'Caller-labeled checkpoint evidence; source authenticity is not established.'
    };
  }
  if (experiment?.evidenceKind === SYNTHETIC_KIND &&
      experiment?.sourceProvenance === 'SYNTHETIC_FIXTURE_DECLARED') {
    return {
      label: 'Simulated trading · synthetic fixture',
      detail: 'Generated demonstration only; this is not a production run.'
    };
  }
  return {label: 'Unknown', detail: 'The report does not establish a recognized run mode.'};
}

export function createPaperCockpitAdapter({readReport} = {}) {
  if (readReport !== undefined && typeof readReport !== 'function') {
    throw new TypeError('readReport must be an injected read-only function');
  }
  return Object.freeze({
    async read() {
      if (!readReport) return {available: false, report: null};
      const report = await readReport();
      return {
        available: isRecord(report) && report.schema === REPORT_SCHEMA &&
          isRecord(report.experiment),
        report: isRecord(report) && report.schema === REPORT_SCHEMA &&
          isRecord(report.experiment) ? report : null
      };
    }
  });
}

export function presentPaperCockpitReport(report, {now = null, staleAfterMs = null} = {}) {
  if (!isRecord(report) || report.schema !== REPORT_SCHEMA || !isRecord(report.experiment)) {
    return {available: false};
  }
  const experiment = report.experiment;
  const evidence = isRecord(report.evidence) ? report.evidence : {};
  const candidates = isRecord(report.candidates) ? report.candidates : {};
  const trading = isRecord(report.trading) ? report.trading : {};
  const controls = isRecord(report.controls) ? report.controls : {};
  const valuation = isRecord(report.valuation) ? report.valuation : {};
  const signedCents = key => exactCents(valuation[key], true);
  const cents = key => exactCents(valuation[key]);
  const amount = value => {
    if (value === null) return {label: 'Unavailable', tone: 'tone-muted'};
    if (value === '0') return {label: '0 cents', tone: 'tone-muted'};
    return {
      label: `${value.startsWith('-') ? '−' : '+'}${value.replace(/^-/, '')} cents`,
      tone: value.startsWith('-') ? 'tone-danger' : 'tone-safe'
    };
  };
  const runStatus = ['FINISHED', 'INCOMPLETE'].includes(experiment.reportStatus)
    ? experiment.reportStatus : 'UNKNOWN';
  const freshnessResult = freshness(evidence, now, staleAfterMs);
  return {
    available: true,
    experiment: {
      id: text(experiment.id),
      source: text(experiment.source),
      mode: mode(experiment),
      startAt: text(experiment.startAt),
      endAt: text(experiment.endAt),
      status: runStatus,
      readiness: text(experiment.sourceReadiness) ?? 'UNKNOWN'
    },
    liveness: 'NOT_EVIDENCED',
    durability: 'NOT_ESTABLISHED_BY_REPORT',
    evidence: {
      status: ['PASS', 'REJECT', 'UNKNOWN'].includes(evidence.status) ? evidence.status : 'UNKNOWN',
      basis: text(evidence.basis),
      observedFrom: text(evidence.observedFrom),
      observedThrough: freshnessResult.observedAt,
      freshness: freshnessResult,
      coverage: coverageState(evidence, candidates),
      discovery: isRecord(evidence.coverage?.discovery) ? evidence.coverage.discovery : null,
      audit: isRecord(evidence.coverage?.audit) ? evidence.coverage.audit : null
    },
    candidates: {
      considered: count(candidates.considered),
      accepted: count(candidates.accepted),
      rejected: count(candidates.rejected),
      unknown: count(candidates.unknown),
      audited: count(candidates.audited),
      coverage: isRecord(candidates.detailsCoverage) ? candidates.detailsCoverage : null
    },
    trading: {
      fillCount: count(trading.paperEntryFills),
      status: text(trading.status) ?? 'UNKNOWN',
      reasons: rows(trading.noTradeReasons, ['gate', 'status', 'reason']),
      reasonsCoverage: isRecord(trading.noTradeReasonsCoverage) ? trading.noTradeReasonsCoverage : null
    },
    controls: {
      openPositionCount: count(controls.openPositionCount),
      openPositions: rows(controls.openPositions, ['mint', 'markStatus']),
      positionsCoverage: isRecord(controls.openPositionsCoverage) ? controls.openPositionsCoverage : null,
      stops: rows(controls.stops, ['code', 'kind', 'status', 'reason']),
      stopsCoverage: isRecord(controls.stopsCoverage) ? controls.stopsCoverage : null
    },
    valuation: {
      status: text(valuation.status) ?? 'UNKNOWN',
      cash: amount(cents('cashCents')),
      realizedGross: amount(signedCents('realizedGrossPnlCents')),
      realizedNet: amount(signedCents('realizedNetPnlCents')),
      unrealizedGross: amount(signedCents('unrealizedGrossPnlCents')),
      unrealizedNet: amount(signedCents('unrealizedNetPnlCents'))
    },
    unresolvedFills: rows(report.unresolvedFills, ['kind', 'status', 'reason']),
    unresolvedFillsCoverage: isRecord(report.unresolvedFillsCoverage)
      ? report.unresolvedFillsCoverage : null
  };
}

export function getDemoPaperCockpitReport() {
  return {
    schema: REPORT_SCHEMA,
    experiment: {
      id: 'm11-generated-demo-run',
      source: 'SYNTHETIC_FIXTURE_REPLAY_ONLY',
      evidenceKind: SYNTHETIC_KIND,
      sourceProvenance: 'SYNTHETIC_FIXTURE_DECLARED',
      reportStatus: 'INCOMPLETE',
      sourceReadiness: 'BLOCKED',
      operationalStatus: 'NOT_EVIDENCED',
      startAt: '2026-11-01T10:00:00.000Z',
      endAt: null
    },
    evidence: {
      status: 'UNKNOWN',
      observedFrom: '2026-11-01T10:00:00.000Z',
      observedThrough: '2026-11-01T10:05:00.000Z',
      basis: 'Generated fixture timestamps; no wall-clock freshness recomputation.',
      sources: ['GENERATED_DEMO_FIXTURE'],
      coverage: {
        discovery: {
          observedRecords: 100,
          scoutAuditRows: 5,
          unaccountedObservedRecords: 95,
          sourceTruncated: true,
          scoutAuditTruncated: false,
          exhaustive: false
        },
        audit: {
          present: true,
          observedRows: 5,
          truncated: false,
          totalRows: 5
        }
      }
    },
    candidates: {
      considered: 100,
      accepted: 0,
      rejected: 2,
      unknown: 98,
      audited: 5,
      details: [],
      detailsCoverage: {
        observedTotal: 5,
        total: 100,
        displayed: 5,
        displayTruncated: false,
        sourceTruncated: true,
        unaccounted: 95
      }
    },
    trading: {
      status: 'UNKNOWN',
      paperEntryFills: null,
      basis: 'No fill decision is evidenced in this generated example.',
      noTradeReasons: [
        {gate: 'liquidity', status: 'UNKNOWN', reason: 'Required liquidity evidence is unavailable.'},
        {gate: 'momentum', status: 'UNKNOWN', reason: 'Candidate evidence is incomplete.'}
      ],
      noTradeReasonsCoverage: {
        observedTotal: 2,
        total: null,
        displayed: 2,
        displayTruncated: false,
        sourceTruncated: true,
        unaccounted: null
      }
    },
    controls: {
      openPositionCount: null,
      openPositions: [],
      openPositionsCoverage: {
        observedTotal: 0,
        total: null,
        displayed: 0,
        displayTruncated: false,
        sourceTruncated: null,
        unaccounted: null
      },
      stops: [],
      stopsCoverage: {
        observedTotal: 0,
        total: null,
        displayed: 0,
        displayTruncated: false,
        sourceTruncated: null,
        unaccounted: null
      }
    },
    valuation: {
      status: 'UNKNOWN',
      cashCents: null,
      realizedGrossPnlCents: null,
      realizedNetPnlCents: null,
      unrealizedGrossPnlCents: null,
      unrealizedNetPnlCents: null
    },
    unresolvedFills: [],
    unresolvedFillsCoverage: {
      observedTotal: 0,
      total: null,
      displayed: 0,
      displayTruncated: false,
      sourceTruncated: null,
      unaccounted: null
    },
    provenance: [],
    provenanceCoverage: {
      observedTotal: 0,
      total: null,
      displayed: 0,
      displayTruncated: false,
      sourceTruncated: null,
      unaccounted: null
    }
  };
}
