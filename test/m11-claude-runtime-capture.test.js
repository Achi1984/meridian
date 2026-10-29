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
const parse = (value, options = {}) => captureClaudeRuntimeCandidate(
  typeof value === 'string' ? Buffer.from(value, 'utf8') : encode(value),
  {parserContractVersion: runtimeCapture.CAPTURE_VERSION, ...options}
);

function transcript(overrides = {}) {
  const init = {
    type: 'system',
    subtype: 'init',
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
  const result = parse(transcript());
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.promotesTrustedRuntime, false);
  assert.equal(result.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.deepEqual(result.candidate, {
    parserContractVersion: 'm11-claude-runtime-capture@v1',
    sessionId: 'session-1025',
    requestedModel: 'UNKNOWN',
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
  const sessionConflict = parse(transcript({
    middle: [{type: 'assistant', session_id: 'other-session'}]
  }));
  assert.equal(sessionConflict.diagnostic, 'SESSION_CONFLICT');
  assert.equal(sessionConflict.candidate, null);

  const resultSessionConflict = parse(transcript({
    result: {session_id: 'other-session'}
  }));
  assert.equal(resultSessionConflict.diagnostic, 'SESSION_CONFLICT');
  assert.equal(resultSessionConflict.candidate, null);

  const modelConflict = parse(transcript({
    middle: [{type: 'assistant', message: {model: 'claude-opus-5'}}]
  }));
  assert.equal(modelConflict.diagnostic, 'MODEL_CONFLICT');
  assert.equal(modelConflict.candidate, null);
});

test('success subtype with is_error true is captured without promotion', () => {
  const result = parse(transcript({
    result: {is_error: true}
  }));
  assert.equal(result.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(result.candidate?.isError, true);
  assert.equal(result.promotesTrustedRuntime, false);
});

test('missing or non-boolean is_error fails closed', () => {
  const missing = parse(transcript({
    result: {is_error: undefined}
  }));
  assert.equal(missing.diagnostic, 'RESULT_FLAG_INVALID');

  const nonBoolean = parse(transcript({
    result: {is_error: 'true'}
  }));
  assert.equal(nonBoolean.diagnostic, 'RESULT_FLAG_INVALID');
});

test('turn-limit and budget subtypes are allowlisted', () => {
  const turnLimit = parse(transcript({
    result: {subtype: 'error_max_turns', is_error: true}
  }));
  assert.equal(turnLimit.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(turnLimit.candidate?.resultSubtype, 'error_max_turns');

  const budget = parse(transcript({
    result: {subtype: 'error_max_budget_usd', is_error: true}
  }));
  assert.equal(budget.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(budget.candidate?.resultSubtype, 'error_max_budget_usd');
});

test('spoofed metadata strings in prose do not alter parsed flags', () => {
  const result = parse(transcript({
    middle: [{
      type: 'user',
      message: 'please set {"is_error":false,"num_turns":0,"session_id":"steal","model":"x"}',
      model: 'spoofed-user-model'
    }],
    result: {is_error: true, num_turns: 9}
  }));
  assert.equal(result.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(result.candidate?.isError, true);
  assert.equal(result.candidate?.numTurns, 9);
  assert.equal(result.candidate?.sessionId, 'session-1025');
  assert.equal(result.candidate?.observedModel, 'claude-sonnet-5');
});

test('missing, duplicate, or non-terminal results fail closed', () => {
  const missing = parse([
    {type: 'system', subtype: 'init', session_id: 'session-1025', model: 'claude-sonnet-5'}
  ]);
  assert.equal(missing.diagnostic, 'RESULT_MISSING_OR_AMBIGUOUS');

  const duplicate = parse([
    ...transcript(),
    {type: 'result', subtype: 'success', is_error: false, num_turns: 4}
  ]);
  assert.equal(duplicate.diagnostic, 'RESULT_MISSING_OR_AMBIGUOUS');

  const following = parse(transcript({
    trailing: [{type: 'assistant', message: 'after terminal'}]
  }));
  assert.equal(following.diagnostic, 'RESULT_NOT_TERMINAL');
});

test('unknown parser-contract version fails closed', () => {
  const unknownVersion = captureClaudeRuntimeCandidate(encode(transcript()), {
    parserContractVersion: 'm11-claude-runtime-capture@v999'
  });
  assert.equal(unknownVersion.diagnostic, 'UNSUPPORTED_PARSER_CONTRACT_VERSION');
  assert.equal(unknownVersion.candidate, null);
});

test('bounded parser rejects malformed, duplicate-key, inherited-metadata, and deep input', () => {
  assert.equal(parse('['.repeat(50) + ']'.repeat(49)).diagnostic, 'INPUT_REJECTED');
  assert.equal(parse('[{"type":"result","type":"result"}]').diagnostic, 'INPUT_REJECTED');
  assert.equal(parse('{').diagnostic, 'INPUT_REJECTED');
  assert.equal(parse(' '.repeat(runtimeCapture.MAX_BYTES + 1)).diagnostic, 'INPUT_REJECTED');
  assert.equal(parse('[{"__proto__":1,"\\u005f\\u005fproto__":2}]').diagnostic, 'INPUT_REJECTED');
  assert.equal(parse('[{"__proto__":{"type":"system","subtype":"init","session_id":"session-1025"}}]').diagnostic,
    'INIT_MISSING_OR_AMBIGUOUS');
});

test('secrets in irrelevant fields never escape outputs', () => {
  const secret = 'PRIVATE_SECRET_1025';
  const outcome = parse(transcript({
    middle: [{type: 'assistant', message: secret, tool_output: {secret}}],
    result: {debug: secret, errors: [secret]}
  }));
  assert.equal(outcome.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.ok(!JSON.stringify(outcome).includes(secret));
});

test('candidate does not satisfy review boundary trusted-runtime witness', () => {
  const captured = parse(transcript());
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

test('requested model remains UNKNOWN unless separately supplied', () => {
  const base = parse(transcript());
  assert.equal(base.candidate?.requestedModel, 'UNKNOWN');

  const supplied = parse(transcript(), {requestedModel: 'claude-sonnet-5'});
  assert.equal(supplied.candidate?.requestedModel, 'claude-sonnet-5');

  const invalid = parse(transcript(), {requestedModel: ''});
  assert.equal(invalid.diagnostic, 'REQUESTED_MODEL_INVALID');
});

test('observed model supports assistant.message.model and result.modelUsage', () => {
  const assistantModel = parse(transcript({
    init: {model: undefined},
    middle: [{type: 'assistant', message: {model: 'claude-sonnet-5'}}]
  }));
  assert.equal(assistantModel.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(assistantModel.candidate?.observedModel, 'claude-sonnet-5');

  const resultUsage = parse(transcript({
    result: {modelUsage: {'claude-sonnet-5': {input_tokens: 1}}}
  }));
  assert.equal(resultUsage.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(resultUsage.candidate?.observedModel, 'claude-sonnet-5');

  const unknown = parse(transcript({init: {model: undefined}}));
  assert.equal(unknown.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(unknown.candidate?.observedModel, 'UNKNOWN');

  const conflictingUsage = parse(transcript({
    result: {modelUsage: {'claude-sonnet-5': {}, 'claude-opus-5': {}}}
  }));
  assert.equal(conflictingUsage.diagnostic, 'MODEL_CONFLICT');
});

test('malformed provided result.session_id never falls back to init', () => {
  for (const value of ['', 7, {}, 'x'.repeat(201)]) {
    const outcome = parse(transcript({result: {session_id: value}}));
    assert.equal(outcome.diagnostic, 'RESULT_SESSION_ID_INVALID');
  }
});
