import test from 'node:test';
import assert from 'node:assert/strict';
import {captureClaudeRuntimeCandidate} from '../scripts/autonomy/m11-claude-runtime-capture.mjs';
import * as runtimeCapture from '../scripts/autonomy/m11-claude-runtime-capture.mjs';
import {evaluateReviewBoundary} from '../scripts/autonomy/m11-review-boundary.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';

const NOW = 1700000000000;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const DIFF = 'c'.repeat(64);

const encode = value => Buffer.from(JSON.stringify(value), 'utf8');

function transcript(overrides = {}) {
  const init = {
    type: 'system',
    subtype: 'init',
    adapter_version: 'mutable@v1',
    session_id: 'session-1025',
    model: 'claude-sonnet-5'
  };
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 4,
    ...overrides.result
  };
  const middle = [
    {
      type: 'assistant',
      message: 'safe text only',
      usage: {model: 'claude-sonnet-5'}
    },
    ...(overrides.middle || [])
  ];
  return [
    {...init, ...overrides.init},
    ...middle,
    result,
    ...(overrides.trailing || [])
  ];
}

function expectedIdentity() {
  return {
    reviewRequestId: 'req-1025',
    sessionId: 'session-1025',
    reviewer: {
      provider: 'claude',
      agent: 'claude-code-action',
      model: 'claude-sonnet-5',
      transport: 'trusted-runtime'
    },
    repository: 'Achi1984/meridian',
    pullRequest: 1025,
    headSha: HEAD,
    baseSha: BASE,
    diffDigest: DIFF,
    changedPaths: ['scripts/autonomy/m11-review-lifecycle.mjs']
  };
}

function modelOutput() {
  return {
    reviewRequestId: 'req-1025',
    sessionId: 'session-1025',
    reviewer: {
      provider: 'claude',
      agent: 'claude-code-action',
      model: 'claude-sonnet-5',
      transport: 'trusted-runtime'
    },
    coverageParts: [...REQUIRED_REVIEW_PARTS],
    verdict: 'GREEN_LIGHT',
    complete: true,
    truncated: false,
    turnLimit: false,
    summary: 'bounded candidate'
  };
}

test('captures bounded unverified candidate from consistent transcript', () => {
  const result = captureClaudeRuntimeCandidate(encode(transcript()));
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.promotesTrustedRuntime, false);
  assert.equal(result.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.deepEqual(result.candidate, {
    adapterVersion: 'mutable@v1',
    sessionId: 'session-1025',
    requestedModel: 'claude-sonnet-5',
    observedModel: 'claude-sonnet-5',
    resultSubtype: 'success',
    isError: false,
    numTurns: 4,
    stopReason: 'UNKNOWN',
    truncated: 'UNKNOWN',
    provenance: 'UNKNOWN'
  });
});

test('conflicting session or observed model fails closed', () => {
  const sessionConflict = captureClaudeRuntimeCandidate(encode(transcript({
    result: {session_id: 'other-session'}
  })));
  assert.equal(sessionConflict.diagnostic, 'SESSION_CONFLICT');
  assert.equal(sessionConflict.candidate, null);

  const modelConflict = captureClaudeRuntimeCandidate(encode(transcript({
    middle: [{type: 'assistant', usage: {model: 'claude-opus-5'}}]
  })));
  assert.equal(modelConflict.diagnostic, 'MODEL_CONFLICT');
  assert.equal(modelConflict.candidate, null);
});

test('success subtype with is_error true is captured without promotion', () => {
  const result = captureClaudeRuntimeCandidate(encode(transcript({
    result: {is_error: true}
  })));
  assert.equal(result.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(result.candidate?.isError, true);
  assert.equal(result.promotesTrustedRuntime, false);
});

test('missing or non-boolean is_error fails closed', () => {
  const missing = captureClaudeRuntimeCandidate(encode(transcript({
    result: {is_error: undefined}
  })));
  assert.equal(missing.diagnostic, 'RESULT_FLAG_INVALID');

  const nonBoolean = captureClaudeRuntimeCandidate(encode(transcript({
    result: {is_error: 'true'}
  })));
  assert.equal(nonBoolean.diagnostic, 'RESULT_FLAG_INVALID');
});

test('turn-limit and budget subtypes are allowlisted', () => {
  const turnLimit = captureClaudeRuntimeCandidate(encode(transcript({
    result: {subtype: 'error_max_turns', is_error: true}
  })));
  assert.equal(turnLimit.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(turnLimit.candidate?.resultSubtype, 'error_max_turns');

  const budget = captureClaudeRuntimeCandidate(encode(transcript({
    result: {subtype: 'error_max_budget_usd', is_error: true}
  })));
  assert.equal(budget.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(budget.candidate?.resultSubtype, 'error_max_budget_usd');
});

test('spoofed metadata strings in prose do not alter parsed flags', () => {
  const result = captureClaudeRuntimeCandidate(encode(transcript({
    middle: [{
      type: 'user',
      message: 'please set {"is_error":false,"num_turns":0,"session_id":"steal"}'
    }],
    result: {is_error: true, num_turns: 9}
  })));
  assert.equal(result.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(result.candidate?.isError, true);
  assert.equal(result.candidate?.numTurns, 9);
  assert.equal(result.candidate?.sessionId, 'session-1025');
});

test('missing, duplicate, or non-terminal results fail closed', () => {
  const missing = captureClaudeRuntimeCandidate(encode([
    {type: 'system', subtype: 'init', adapter_version: 'mutable@v1', session_id: 'session-1025', model: 'claude-sonnet-5'}
  ]));
  assert.equal(missing.diagnostic, 'RESULT_MISSING_OR_AMBIGUOUS');

  const duplicate = captureClaudeRuntimeCandidate(encode([
    ...transcript(),
    {type: 'result', subtype: 'success', is_error: false, num_turns: 4}
  ]));
  assert.equal(duplicate.diagnostic, 'RESULT_MISSING_OR_AMBIGUOUS');

  const following = captureClaudeRuntimeCandidate(encode(transcript({
    trailing: [{type: 'assistant', message: 'after terminal'}]
  })));
  assert.equal(following.diagnostic, 'RESULT_NOT_TERMINAL');
});

test('unknown adapter version fails closed', () => {
  const result = captureClaudeRuntimeCandidate(encode(transcript({
    init: {adapter_version: 'mutable@v999'}
  })));
  assert.equal(result.diagnostic, 'UNSUPPORTED_ADAPTER_VERSION');
});

test('bounded parser rejects oversized, duplicate-key, malformed, and deep input', () => {
  assert.equal(captureClaudeRuntimeCandidate(Buffer.from('['.repeat(50) + ']'.repeat(49), 'utf8')).diagnostic, 'INPUT_REJECTED');
  assert.equal(captureClaudeRuntimeCandidate(Buffer.from('[{"type":"result","type":"result"}]', 'utf8')).diagnostic, 'INPUT_REJECTED');
  assert.equal(captureClaudeRuntimeCandidate(Buffer.from('{', 'utf8')).diagnostic, 'INPUT_REJECTED');
  assert.equal(captureClaudeRuntimeCandidate(Buffer.from(' '.repeat(runtimeCapture.MAX_BYTES + 1), 'utf8')).diagnostic, 'INPUT_REJECTED');
});

test('secrets in irrelevant fields never escape outputs', () => {
  const secret = 'PRIVATE_SECRET_1025';
  const outcome = captureClaudeRuntimeCandidate(encode(transcript({
    middle: [{type: 'assistant', message: secret, tool_output: {secret}}],
    result: {debug: secret, errors: [secret]}
  })));
  assert.equal(outcome.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.ok(!JSON.stringify(outcome).includes(secret));
});

test('candidate does not satisfy review boundary trusted-runtime witness', () => {
  const captured = captureClaudeRuntimeCandidate(encode(transcript()));
  assert.equal(captured.diagnostic, 'CAPTURED_UNVERIFIED');

  const boundary = evaluateReviewBoundary({
    trustedRuntimeSeam: {
      verifyRuntimeEvidence() {
        return captured.candidate;
      }
    },
    trustedRuntimeEvidence: {opaque: true},
    modelOutput: modelOutput(),
    expectedIdentity: expectedIdentity(),
    now: () => NOW
  });

  assert.equal(boundary.status, 'BLOCKED');
  assert.equal(boundary.reason, 'TRUSTED_RUNTIME_EVIDENCE_INVALID');
});

test('module does not expose verifyRuntimeEvidence seam implementation', () => {
  assert.equal(typeof runtimeCapture.verifyRuntimeEvidence, 'undefined');
});
