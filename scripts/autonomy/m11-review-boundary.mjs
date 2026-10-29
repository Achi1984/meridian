import {types} from 'node:util';
import {REQUIRED_REVIEW_PARTS} from './m11-event-coordinator.mjs';

const MAX_TEXT_BYTES = 2048;
const MAX_ID_BYTES = 200;
const MAX_REVIEWER_FIELD_BYTES = 120;
const MAX_PATH_BYTES = 512;
const MAX_COVERAGE_ITEMS = REQUIRED_REVIEW_PARTS.length;
const MAX_PATH_ITEMS = 1024;
const MAX_EVIDENCE_AGE_MS = 86400000;
const DIAGNOSTIC_SUMMARY_BYTES = 512;

const TERMINAL_OK_STATE = 'completed';
const TERMINAL_OK_REASON = 'end_turn';
const MODEL_VERDICTS = new Set(['GREEN_LIGHT', 'REVISION_REQUIRED', 'NEEDS_MORE_EVIDENCE']);

class BoundaryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BoundaryError';
    this.code = code;
  }
}

function fail(code) {
  throw new BoundaryError(code);
}

function isNonEmptySafeText(value, maxBytes = MAX_TEXT_BYTES) {
  return isSafeText(value, maxBytes) && value.trim().length > 0;
}

function isSafeText(value, maxBytes = MAX_TEXT_BYTES) {
  return typeof value === 'string'
    && value.isWellFormed()
    && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function readRecord(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length
    || names.some(name => typeof name !== 'string' || !keys.includes(name))) fail(code);
  const out = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    out[key] = descriptor.value;
  }
  return out;
}

function readStringArray(value, {maxItems, maxBytes, code, dedupe = true}) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maxItems) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== value.length + 1 || !names.includes('length')
    || names.some(name => name !== 'length'
      && (typeof name !== 'string' || !/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= value.length))) {
    fail(code);
  }
  const out = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    const item = descriptor.value;
    if (!isSafeText(item, maxBytes)) fail(code);
    if (dedupe && out.includes(item)) fail(code);
    out.push(item);
  }
  return out;
}

function readReviewer(value, code) {
  const reviewer = readRecord(value, ['provider', 'agent', 'model', 'transport'], code);
  for (const key of Object.keys(reviewer)) {
    if (!isNonEmptySafeText(reviewer[key], MAX_REVIEWER_FIELD_BYTES)) fail(code);
  }
  return Object.freeze({...reviewer});
}

function sanitizeDiagnosticSummary(summary) {
  if (!isSafeText(summary, MAX_TEXT_BYTES)) return '';
  const clean = summary.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  return Buffer.byteLength(clean, 'utf8') <= DIAGNOSTIC_SUMMARY_BYTES
    ? clean
    : Buffer.from(clean, 'utf8').subarray(0, DIAGNOSTIC_SUMMARY_BYTES).toString('utf8');
}

function ownHasAllPaths(expectedPaths, witnessedPaths) {
  return expectedPaths.every(path => witnessedPaths.includes(path));
}

function normalizeExpectedIdentity(expected) {
  const input = readRecord(expected, [
    'reviewRequestId', 'sessionId', 'reviewer', 'repository', 'pullRequest',
    'headSha', 'baseSha', 'diffDigest', 'changedPaths'
  ], 'EXPECTED_IDENTITY_INVALID');
  const reviewer = readReviewer(input.reviewer, 'EXPECTED_IDENTITY_INVALID');
  if (!isNonEmptySafeText(input.reviewRequestId, MAX_ID_BYTES)
    || !isNonEmptySafeText(input.sessionId, MAX_ID_BYTES)
    || !isNonEmptySafeText(input.repository, MAX_ID_BYTES)
    || !Number.isSafeInteger(input.pullRequest) || input.pullRequest <= 0
    || typeof input.headSha !== 'string' || !/^[a-f0-9]{40}$/.test(input.headSha)
    || typeof input.baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(input.baseSha)
    || typeof input.diffDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.diffDigest)) {
    fail('EXPECTED_IDENTITY_INVALID');
  }
  const changedPaths = readStringArray(input.changedPaths, {
    maxItems: MAX_PATH_ITEMS,
    maxBytes: MAX_PATH_BYTES,
    code: 'EXPECTED_IDENTITY_INVALID',
    dedupe: true
  });
  return Object.freeze({...input, reviewer, changedPaths: Object.freeze(changedPaths)});
}

function normalizeModelOutput(modelOutput) {
  const input = readRecord(modelOutput, [
    'reviewRequestId', 'sessionId', 'reviewer', 'coverageParts', 'verdict',
    'complete', 'truncated', 'turnLimit', 'summary'
  ], 'MODEL_OUTPUT_INVALID');
  const reviewer = readReviewer(input.reviewer, 'MODEL_OUTPUT_INVALID');
  if (!isNonEmptySafeText(input.reviewRequestId, MAX_ID_BYTES)
    || !isNonEmptySafeText(input.sessionId, MAX_ID_BYTES)
    || !MODEL_VERDICTS.has(input.verdict)
    || typeof input.complete !== 'boolean'
    || typeof input.truncated !== 'boolean'
    || typeof input.turnLimit !== 'boolean'
    || !isSafeText(input.summary, MAX_TEXT_BYTES)) {
    fail('MODEL_OUTPUT_INVALID');
  }
  const coverageParts = readStringArray(input.coverageParts, {
    maxItems: MAX_COVERAGE_ITEMS,
    maxBytes: MAX_REVIEWER_FIELD_BYTES,
    code: 'MODEL_OUTPUT_INVALID',
    dedupe: true
  });
  if (!coverageParts.every(part => REQUIRED_REVIEW_PARTS.includes(part))) {
    fail('MODEL_OUTPUT_INVALID');
  }
  return Object.freeze({
    ...input,
    reviewer,
    coverageParts: Object.freeze(coverageParts),
    summary: sanitizeDiagnosticSummary(input.summary)
  });
}

function normalizeTrustedRuntimeEvidence(evidence, nowMs) {
  const input = readRecord(evidence, [
    'evidenceId', 'provider', 'observedAtMs', 'expiresAtMs', 'runtime'
  ], 'TRUSTED_RUNTIME_EVIDENCE_INVALID');
  if (!isNonEmptySafeText(input.evidenceId, MAX_ID_BYTES)
    || !isNonEmptySafeText(input.provider, MAX_REVIEWER_FIELD_BYTES)
    || !Number.isSafeInteger(input.observedAtMs)
    || !Number.isSafeInteger(input.expiresAtMs)
    || input.observedAtMs <= 0
    || input.expiresAtMs <= input.observedAtMs
    || input.observedAtMs > nowMs
    || input.expiresAtMs <= nowMs
    || input.expiresAtMs - input.observedAtMs > MAX_EVIDENCE_AGE_MS) {
    fail('TRUSTED_RUNTIME_EVIDENCE_EXPIRED');
  }
  const runtime = readRecord(input.runtime, [
    'reviewRequestId', 'sessionId', 'reviewer', 'repository', 'pullRequest',
    'headSha', 'baseSha', 'diffDigest', 'terminalState', 'stopReason',
    'truncated', 'turnLimit', 'coverageParts', 'changedPaths'
  ], 'TRUSTED_RUNTIME_EVIDENCE_INVALID');
  const reviewer = readReviewer(runtime.reviewer, 'TRUSTED_RUNTIME_EVIDENCE_INVALID');
  const coverageParts = readStringArray(runtime.coverageParts, {
    maxItems: MAX_COVERAGE_ITEMS,
    maxBytes: MAX_REVIEWER_FIELD_BYTES,
    code: 'TRUSTED_RUNTIME_EVIDENCE_INVALID',
    dedupe: true
  });
  const changedPaths = readStringArray(runtime.changedPaths, {
    maxItems: MAX_PATH_ITEMS,
    maxBytes: MAX_PATH_BYTES,
    code: 'TRUSTED_RUNTIME_EVIDENCE_INVALID',
    dedupe: true
  });
  if (!isNonEmptySafeText(runtime.reviewRequestId, MAX_ID_BYTES)
    || !isNonEmptySafeText(runtime.sessionId, MAX_ID_BYTES)
    || !isNonEmptySafeText(runtime.repository, MAX_ID_BYTES)
    || !Number.isSafeInteger(runtime.pullRequest) || runtime.pullRequest <= 0
    || typeof runtime.headSha !== 'string' || !/^[a-f0-9]{40}$/.test(runtime.headSha)
    || typeof runtime.baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(runtime.baseSha)
    || typeof runtime.diffDigest !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.diffDigest)
    || !isSafeText(runtime.terminalState, MAX_REVIEWER_FIELD_BYTES)
    || !isSafeText(runtime.stopReason, MAX_REVIEWER_FIELD_BYTES)
    || typeof runtime.truncated !== 'boolean'
    || typeof runtime.turnLimit !== 'boolean') {
    fail('TRUSTED_RUNTIME_EVIDENCE_INVALID');
  }
  return Object.freeze({
    evidenceId: input.evidenceId,
    provider: input.provider,
    observedAtMs: input.observedAtMs,
    expiresAtMs: input.expiresAtMs,
    runtime: Object.freeze({...runtime, reviewer, coverageParts: Object.freeze(coverageParts), changedPaths: Object.freeze(changedPaths)})
  });
}

function hasRequiredCoverage(coverageParts) {
  return REQUIRED_REVIEW_PARTS.every(part => coverageParts.includes(part));
}

function resultBase() {
  return {
    dispatch: false,
    merge: false,
    activation: false,
    externalEffects: false,
    retryAllowed: false
  };
}

function readEvaluationInput(input) {
  const value = input === undefined ? {} : input;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('INPUT_ENVELOPE_INVALID');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  const allowed = new Set(['trustedRuntimeSeam', 'trustedRuntimeEvidence', 'modelOutput', 'expectedIdentity', 'now']);
  const out = {};
  for (const name of names) {
    if (typeof name !== 'string' || !allowed.has(name)) fail('INPUT_ENVELOPE_INVALID');
    const descriptor = descriptors[name];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('INPUT_ENVELOPE_INVALID');
    }
    out[name] = descriptor.value;
  }
  return out;
}

function readClockNow(nowFn) {
  if (typeof nowFn !== 'function') fail('CLOCK_INVALID');
  let nowMs;
  try {
    nowMs = nowFn();
  } catch {
    fail('CLOCK_INVALID');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) fail('CLOCK_INVALID');
  return nowMs;
}

export function evaluateReviewBoundary(input) {
  try {
    const envelope = readEvaluationInput(input);
    const frozenNow = readClockNow(envelope.now);

    const seam = readRecord(envelope.trustedRuntimeSeam, ['verifyRuntimeEvidence'], 'TRUSTED_RUNTIME_SEAM_REQUIRED');
    if (typeof seam.verifyRuntimeEvidence !== 'function') fail('TRUSTED_RUNTIME_SEAM_REQUIRED');

    const expected = normalizeExpectedIdentity(envelope.expectedIdentity);
    const untrusted = normalizeModelOutput(envelope.modelOutput);

    if (untrusted.reviewRequestId !== expected.reviewRequestId
      || untrusted.sessionId !== expected.sessionId
      || untrusted.reviewer.provider !== expected.reviewer.provider
      || untrusted.reviewer.agent !== expected.reviewer.agent
      || untrusted.reviewer.model !== expected.reviewer.model
      || untrusted.reviewer.transport !== expected.reviewer.transport) {
      fail('MODEL_IDENTITY_MISMATCH');
    }

    let verified;
    try {
      verified = seam.verifyRuntimeEvidence(envelope.trustedRuntimeEvidence, {nowMs: frozenNow, expectedIdentity: expected});
    } catch {
      return Object.freeze({status: 'UNKNOWN', reason: 'RUNTIME_SEAM_UNAVAILABLE', ...resultBase()});
    }
    const postVerifyNow = readClockNow(envelope.now);
    const trusted = normalizeTrustedRuntimeEvidence(verified, postVerifyNow);
    const runtime = trusted.runtime;

    if (runtime.reviewRequestId !== expected.reviewRequestId
      || runtime.sessionId !== expected.sessionId
      || runtime.repository !== expected.repository
      || runtime.pullRequest !== expected.pullRequest
      || runtime.headSha !== expected.headSha
      || runtime.baseSha !== expected.baseSha
      || runtime.diffDigest !== expected.diffDigest
      || runtime.reviewer.provider !== expected.reviewer.provider
      || runtime.reviewer.agent !== expected.reviewer.agent
      || runtime.reviewer.model !== expected.reviewer.model
      || runtime.reviewer.transport !== expected.reviewer.transport) {
      fail('RUNTIME_IDENTITY_MISMATCH');
    }
    if (!hasRequiredCoverage(runtime.coverageParts)) fail('RUNTIME_COVERAGE_WITNESS_MISSING');
    if (!ownHasAllPaths(expected.changedPaths, runtime.changedPaths)) fail('RUNTIME_CHANGED_PATH_WITNESS_MISSING');

    const terminalComplete = runtime.terminalState === TERMINAL_OK_STATE
      && runtime.stopReason === TERMINAL_OK_REASON
      && runtime.truncated === false
      && runtime.turnLimit === false;

    const reviewComplete = terminalComplete
      && hasRequiredCoverage(runtime.coverageParts)
      && ownHasAllPaths(expected.changedPaths, runtime.changedPaths)
      && hasRequiredCoverage(untrusted.coverageParts)
      && untrusted.complete === true
      && untrusted.truncated === false
      && untrusted.turnLimit === false;

    const finalVerdict = reviewComplete
      ? (untrusted.verdict === 'REVISION_REQUIRED' ? 'REVISION_REQUIRED'
        : untrusted.verdict === 'GREEN_LIGHT' ? 'GREEN_LIGHT' : 'NEEDS_MORE_EVIDENCE')
      : 'NEEDS_MORE_EVIDENCE';

    const completionState = reviewComplete && finalVerdict === 'GREEN_LIGHT'
      ? 'COMPLETE'
      : finalVerdict === 'REVISION_REQUIRED'
        ? 'REVISION_REQUIRED'
        : 'INCOMPLETE';

    return Object.freeze({
      status: 'ADMITTED',
      completionState,
      verdict: finalVerdict,
      reviewer: expected.reviewer,
      identity: Object.freeze({
        reviewRequestId: expected.reviewRequestId,
        sessionId: expected.sessionId,
        repository: expected.repository,
        pullRequest: expected.pullRequest,
        headSha: expected.headSha,
        baseSha: expected.baseSha,
        diffDigest: expected.diffDigest
      }),
      trustedRuntime: Object.freeze({
        evidenceId: trusted.evidenceId,
        provider: trusted.provider,
        observedAtMs: trusted.observedAtMs,
        expiresAtMs: trusted.expiresAtMs
      }),
      witness: Object.freeze({
        coverageParts: runtime.coverageParts,
        changedPaths: runtime.changedPaths,
        terminalState: runtime.terminalState,
        stopReason: runtime.stopReason,
        truncated: runtime.truncated,
        turnLimit: runtime.turnLimit
      }),
      untrustedDiagnostic: Object.freeze({
        summary: untrusted.summary,
        modelVerdictClaim: untrusted.verdict,
        authority: 'UNTRUSTED_MODEL_OUTPUT'
      }),
      dispatch: false,
      merge: false,
      activation: false,
      externalEffects: false,
      retryAllowed: false
    });
  } catch (error) {
    if (error instanceof BoundaryError) {
      const unknown = new Set(['TRUSTED_RUNTIME_SEAM_REQUIRED', 'CLOCK_INVALID', 'RUNTIME_SEAM_UNAVAILABLE']);
      return Object.freeze({
        status: unknown.has(error.code) ? 'UNKNOWN' : 'BLOCKED',
        reason: error.code,
        ...resultBase()
      });
    }
    return Object.freeze({status: 'UNKNOWN', reason: 'UNEXPECTED_ERROR', ...resultBase()});
  }
}
