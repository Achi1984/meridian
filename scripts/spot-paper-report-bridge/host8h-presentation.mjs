import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';
import {readRunJournal} from '../spot-paper-pilot/journal.mjs';
import {
  assessHostEvidence
} from '../spot-paper-pilot/host-evidence-assessment.mjs';
import {
  HOST_LAUNCH_MANIFEST,
  inspectHostRun
} from '../spot-paper-pilot/host-entrypoint.mjs';
import {
  getSpotPaperHost8hIdentity,
  SPOT_PAPER_HOST8H_PANEL_INPUT_SCHEMA,
  SPOT_PAPER_HOST8H_PROFILE_ID,
  SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS,
  SPOT_PAPER_HOST8H_RUN_ID,
  SPOT_PAPER_HOST8H_SOURCE_SHA
} from './host8h-contract.mjs';

const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_BYTES = 16 * 1024;
const NOTIONAL_DIVISOR = 100_000_000_000_000n;
const isInteger = Number.isSafeInteger;

function safeNumber(value) {
  return isInteger(value) ? value : null;
}

function assertBoundedInput(value, maxBytes, errorCode) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error(errorCode);
  }
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw new Error(errorCode);
}

function notionalCents(quantitySat, priceNano) {
  if (!/^(?:0|[1-9]\d{0,30})$/.test(String(quantitySat)) ||
      !/^(?:[1-9]\d{0,30})$/.test(String(priceNano))) return null;
  const result = (BigInt(quantitySat) * BigInt(priceNano) + NOTIONAL_DIVISOR / 2n) /
    NOTIONAL_DIVISOR;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

function estimatedExitCosts(position, mark) {
  if (!position) return {fee: 0, slippage: 0};
  if (!mark || mark.bidNano === undefined || mark.exitPriceNano === undefined) {
    return {fee: null, slippage: null};
  }
  const raw = notionalCents(position.quantitySat, String(mark.bidNano));
  const adjusted = notionalCents(position.quantitySat, String(mark.exitPriceNano));
  if (raw === null || adjusted === null || adjusted > raw) return {fee: null, slippage: null};
  const fee = (BigInt(adjusted) * 50n + 5_000n) / 10_000n;
  return {
    fee: fee <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(fee) : null,
    slippage: raw - adjusted
  };
}

function metricsFromLedger(ledger, checkpoint, events, observedAt, startedAt) {
  if (!ledger || !Array.isArray(ledger.fills) ||
      !isInteger(ledger.cashCents) || !isInteger(ledger.realizedPnlCents) ||
      !isInteger(ledger.feesCents) || !isInteger(checkpoint?.cycle) ||
      !isInteger(checkpoint?.counters?.requests)) {
    throw new Error('HOST8H_JOURNAL_CHECKPOINT_INVALID');
  }
  const position = ledger.position;
  const flat = position === null;
  const unrealized = flat ? 0 : safeNumber(ledger.lastMark?.unrealizedPnlCents);
  const equity = flat ? ledger.cashCents :
    isInteger(ledger.lastMark?.netExitCents) ?
      ledger.cashCents + ledger.lastMark.netExitCents : null;
  const total = unrealized === null ? null : ledger.realizedPnlCents + unrealized;
  if (equity !== null && total !== null && equity - 100_000 !== total) {
    throw new Error('HOST8H_LEDGER_PNL_MISMATCH');
  }
  const inventoryStatus = flat ? 'FLAT' :
    position && typeof position.quantitySat === 'number' &&
      Number.isSafeInteger(position.quantitySat) && position.quantitySat > 0 ?
      'OPEN_PROVISIONAL' : 'UNKNOWN';
  const costs = estimatedExitCosts(position, ledger.lastMark);
  const cycleCount = checkpoint.cycle;
  const observations = events.filter(event => event?.type === 'observation').length;
  const dataGaps = events.filter(event => event?.type === 'data_gap').length;
  const elapsedMs = isInteger(startedAt) ?
    Date.parse(observedAt) - startedAt : null;
  if (elapsedMs !== null && (elapsedMs < 0 ||
      elapsedMs > SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS + 5_000)) {
    throw new Error('HOST8H_ELAPSED_TIME_OUT_OF_BOUNDS');
  }
  return {
    initialCashCents: 100_000,
    cashCents: ledger.cashCents,
    equityCents: equity,
    realizedPnlCents: ledger.realizedPnlCents,
    unrealizedPnlCents: unrealized,
    totalPnlCents: total,
    bookedFeesCents: ledger.feesCents,
    estimatedExitFeeCents: costs.fee,
    estimatedExitSlippageCents: costs.slippage,
    fillCount: ledger.fills.length,
    closedTradeCount: ledger.fills.filter(fill => fill?.side === 'SELL').length,
    openInventory: {
      status: inventoryStatus,
      quantitySat:       inventoryStatus === 'OPEN_PROVISIONAL' ?
        String(position.quantitySat) : null
    },
    cycleCount,
    cycleCoverage: cycleCount / HOST_LAUNCH_MANIFEST.maxCycles,
    acceptedObservations: observations,
    acceptedObservationCoverage: cycleCount === 0 ? 0 : observations / cycleCount,
    observations,
    dataGaps,
    requests: checkpoint.counters.requests,
    elapsedMs,
    durationCoverage: elapsedMs === null ?
      null : elapsedMs / SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS,
    durationStatus: elapsedMs === null ? 'UNKNOWN' :
      elapsedMs >= SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS ?
        'FULL_REQUESTED_DURATION' : 'PARTIAL_BOUNDED_DURATION'
  };
}

function metricsFromAssessment(result) {
  const assessment = result?.assessment;
  if (!assessment || assessment.terminalVerified !== true ||
      assessment.runId !== SPOT_PAPER_HOST8H_RUN_ID ||
      assessment.profileId !== SPOT_PAPER_HOST8H_PROFILE_ID ||
      assessment.sourceSha !== SPOT_PAPER_HOST8H_SOURCE_SHA) {
    throw new Error('HOST8H_ASSESSMENT_UNVERIFIED');
  }
  const fills = Array.isArray(assessment.fills) ? assessment.fills : [];
  const position = assessment.position;
  const inventoryStatus = assessment.positionStatus === 'FLAT' ? 'FLAT' :
    position && typeof position.quantitySat === 'number' ?
      'OPEN_UNRESOLVED_AT_TERMINAL' : 'UNKNOWN';
  const costs = estimatedExitCosts(position, assessment.lastMark);
  const realized = safeNumber(assessment.realizedPnlCents);
  const unrealized = safeNumber(assessment.unrealizedPnlCents);
  return {
    metrics: {
      initialCashCents: 100_000,
      cashCents: safeNumber(assessment.cashCents),
      equityCents: safeNumber(assessment.equityCents),
      realizedPnlCents: realized,
      unrealizedPnlCents: unrealized,
      totalPnlCents: realized === null || unrealized === null ? null : realized + unrealized,
      bookedFeesCents: safeNumber(assessment.feesCents),
      estimatedExitFeeCents: costs.fee,
      estimatedExitSlippageCents: costs.slippage,
      fillCount: fills.length,
      closedTradeCount: fills.filter(fill => fill?.side === 'SELL').length,
      openInventory: {
        status: inventoryStatus,
        quantitySat: inventoryStatus === 'OPEN_UNRESOLVED_AT_TERMINAL' ?
          String(position.quantitySat) : null
      },
      cycleCount: safeNumber(assessment.cycleCount),
      cycleCoverage: typeof assessment.cycleCoverage === 'number' ?
        assessment.cycleCoverage : null,
      acceptedObservations: safeNumber(assessment.acceptedObservations),
      acceptedObservationCoverage: typeof assessment.acceptedObservationCoverage === 'number' ?
        assessment.acceptedObservationCoverage : null,
      observations: safeNumber(assessment.observations),
      dataGaps: safeNumber(assessment.dataGaps),
      requests: safeNumber(assessment.requests),
      elapsedMs: safeNumber(assessment.elapsedMs),
      durationCoverage: typeof assessment.durationCoverage === 'number' ?
        assessment.durationCoverage : null,
      durationStatus: assessment.durationStatus ?? 'UNKNOWN'
    },
    assessment: {
      schemaVersion: result.schemaVersion,
      outcome: result.outcome,
      assessment: {
        terminalVerified: true,
        boundedTermination: assessment.boundedTermination === true,
        runId: assessment.runId,
        profileId: assessment.profileId,
        sourceSha: assessment.sourceSha,
        outcome: assessment.outcome,
        totalPnlCents: realized === null || unrealized === null ? null : realized + unrealized
      }
    }
  };
}

function validateJournal(journal, expectedStatus) {
  if (!journal || journal.schemaVersion !== 'SPOT_PAPER_PILOT_JOURNAL_V1' ||
      journal.runId !== SPOT_PAPER_HOST8H_RUN_ID ||
      !isInteger(journal.sequence) || journal.sequence !== journal.events?.length ||
      journal.sequence > HOST_LAUNCH_MANIFEST.maxCycles + 2 ||
      journal.manifest?.schemaVersion !== 'SPOT_PAPER_PILOT_MANIFEST_V1' ||
      journal.manifest.model !== HOST_LAUNCH_MANIFEST.model ||
      journal.manifest.mode !== 'paper' || journal.manifest.pair !== 'BTC/EUR' ||
      journal.manifest.limits?.maxCycles !== HOST_LAUNCH_MANIFEST.maxCycles ||
      journal.manifest.limits?.maxRequests !== HOST_LAUNCH_MANIFEST.maxRequests ||
      journal.manifest.limits?.maxDurationMs !== HOST_LAUNCH_MANIFEST.maxDurationMs ||
      !Array.isArray(journal.events) ||
      journal.events.length > HOST_LAUNCH_MANIFEST.maxCycles + 2 ||
      !['UNKNOWN_WRITER_OR_INTERRUPTED', 'READ_ONLY_VERIFIED']
        .includes(journal.reconciliationStatus)) {
    throw new Error('HOST8H_JOURNAL_IDENTITY_OR_INTEGRITY_MISMATCH');
  }
  const cycles = journal.events.filter(event =>
    event?.type === 'observation' || event?.type === 'data_gap').length;
  if (cycles !== journal.checkpoint?.cycle ||
      (expectedStatus === 'RUNNING_OBSERVED' &&
        journal.reconciliationStatus !== 'UNKNOWN_WRITER_OR_INTERRUPTED') ||
      (expectedStatus === 'VERIFIED_TERMINAL' &&
        (journal.reconciliationStatus !== 'READ_ONLY_VERIFIED' ||
          journal.events.at(-1)?.type !== 'terminal'))) {
    throw new Error('HOST8H_JOURNAL_SNAPSHOT_INCONSISTENT');
  }
}

export function buildSpotPaperHost8hSummary({
  hostSnapshot, journal, assessment = null, observedAt = new Date().toISOString()
} = {}) {
  assertBoundedInput(hostSnapshot, 256 * 1024, 'HOST8H_SNAPSHOT_SIZE_LIMIT');
  assertBoundedInput(journal, MAX_JOURNAL_BYTES, 'HOST8H_JOURNAL_SIZE_LIMIT');
  if (assessment) {
    assertBoundedInput(assessment, 256 * 1024, 'HOST8H_ASSESSMENT_SIZE_LIMIT');
  }
  const identity = getSpotPaperHost8hIdentity();
  if (!['RUNNING_OBSERVED', 'VERIFIED_TERMINAL', 'INCOMPLETE_UNKNOWN']
    .includes(hostSnapshot?.status) || hostSnapshot.runId !== identity.runId ||
      (hostSnapshot.status === 'VERIFIED_TERMINAL' &&
        hostSnapshot.verifiedTerminal !== true) ||
      !Number.isSafeInteger(Date.parse(observedAt))) {
    throw new Error('HOST8H_STATUS_IDENTITY_INVALID');
  }
  validateJournal(journal, hostSnapshot.status);
  const status = hostSnapshot.status;
  let summaryMetrics = null;
  let summaryAssessment = null;
  let assessmentOutcome = 'NOT_RUN';
  if (status === 'RUNNING_OBSERVED') {
    summaryMetrics = metricsFromLedger(
      journal.checkpoint?.ledger, journal.checkpoint, journal.events,
      observedAt, journal.manifest.startedAt
    );
  } else if (status === 'VERIFIED_TERMINAL') {
    if (!assessment) throw new Error('HOST8H_TERMINAL_ASSESSMENT_REQUIRED');
    const projection = metricsFromAssessment(assessment);
    summaryMetrics = projection.metrics;
    summaryAssessment = projection.assessment;
    assessmentOutcome = projection.assessment.outcome;
  } else if (journal.reconciliationStatus !== 'READ_ONLY_VERIFIED') {
    assessmentOutcome = 'UNKNOWN';
  }
  const result = {
    schemaVersion: SPOT_PAPER_HOST8H_PANEL_INPUT_SCHEMA,
    source: 'Read-only host summary exporter; transport authentication is separate',
    observedAt,
    identity,
    snapshot: {
      status,
      runId: identity.runId,
      verifiedTerminal: status === 'VERIFIED_TERMINAL',
      report: status === 'VERIFIED_TERMINAL' ?
        {stopReason: journal.checkpoint?.stopReason ?? null, runId: journal.runId} : null
    },
    sourceEvidence: {
      journalStatus: journal.reconciliationStatus,
      journalSequence: journal.sequence,
      cycleCount: journal.checkpoint?.cycle ?? null,
      observationCount: journal.events.filter(event => event?.type === 'observation').length,
      dataGapCount: journal.events.filter(event => event?.type === 'data_gap').length,
      assessmentOutcome
    },
    metrics: summaryMetrics,
    assessment: summaryAssessment
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) {
    throw new Error('HOST8H_SUMMARY_SIZE_LIMIT');
  }
  return result;
}

function boundedJournalIo() {
  function fileLimit(path) {
    const name = basename(path);
    return name === 'journal.json' ? MAX_JOURNAL_BYTES :
      name === 'journal.pending' ? MAX_PENDING_BYTES :
        /^[a-f0-9]{64}\.json$/.test(name) ?
          HOST_LAUNCH_MANIFEST.maxResponseBytes : null;
  }

  async function checkedInfo(path) {
    const info = await lstat(path);
    const limit = fileLimit(path);
    if (info.isSymbolicLink() || (limit !== null && (!info.isFile() || info.size > limit))) {
      throw new Error('HOST8H_JOURNAL_FILE_LIMIT');
    }
    return info;
  }
  return {
    lstat: checkedInfo,
    async readFile(path) {
      await checkedInfo(path);
      const bytes = await readFile(path);
      const limit = fileLimit(path);
      if (limit !== null && bytes.byteLength > limit) {
        throw new Error('HOST8H_JOURNAL_FILE_LIMIT');
      }
      return bytes;
    }
  };
}

export async function exportSpotPaperHost8hSummary({
  evidenceDir, expectedHostContext, now = () => Date.now()
} = {}) {
  if (typeof evidenceDir !== 'string' || !evidenceDir.startsWith('/')) {
    throw new TypeError('absolute host evidence directory required');
  }
  const directory = resolve(evidenceDir);
  const hostSnapshot = await inspectHostRun(directory, {includeReport: true});
  const journal = await readRunJournal({
    dataRoot: join(directory, 'runtime'),
    runId: SPOT_PAPER_HOST8H_RUN_ID,
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now(),
    io: boundedJournalIo()
  });
  let assessment = null;
  if (hostSnapshot.status === 'VERIFIED_TERMINAL' && hostSnapshot.verifiedTerminal === true) {
    assessment = await assessHostEvidence({
      evidenceDir: directory,
      expectedHostContext,
      deadlineAt: performance.now() + 60_000
    });
  }
  return buildSpotPaperHost8hSummary({
    hostSnapshot,
    journal,
    assessment,
    observedAt: new Date(now()).toISOString()
  });
}

export function spotPaperHost8hJournalDigest(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
