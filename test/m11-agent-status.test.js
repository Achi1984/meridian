import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeM11AgentStatus, validateM11AgentStatusRow } from '../scripts/autonomy/m11-agent-status.mjs';
import { renderM11AgentStatus } from '../public/js/m11-agent-status.js';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function sample(overrides = {}) {
  const row = {
    agentId: 'agent-100',
    agentName: 'Copilot',
    taskId: 'task-200',
    taskLabel: 'M11 Review',
    taskState: 'RUNNING',
    coordinatorMode: 'STOPPED',
    providerRequested: 'github',
    providerVerified: 'github',
    modelRequested: 'gpt-5',
    modelVerified: 'gpt-5',
    providerEvidence: {
      agentId: 'agent-100',
      taskId: 'task-200',
      value: 'github',
      observedAt: '2026-10-29T11:55:00.000Z',
      expiresAt: '2026-10-29T12:05:00.000Z',
      evidenceUrl: 'https://github.com/acme/meridian/actions/runs/123456',
      evidenceType: 'github-workflow'
    },
    modelEvidence: {
      agentId: 'agent-100',
      taskId: 'task-200',
      value: 'gpt-5',
      observedAt: '2026-10-29T11:55:00.000Z',
      expiresAt: '2026-10-29T12:05:00.000Z',
      evidenceUrl: 'https://github.com/acme/meridian/actions/runs/123456',
      evidenceType: 'github-workflow'
    },
    coordinatorEvidence: {
      agentId: 'agent-100',
      taskId: 'task-200',
      value: 'STOPPED',
      observedAt: '2026-10-29T11:55:00.000Z',
      expiresAt: '2026-10-29T12:05:00.000Z',
      evidenceUrl: 'https://github.com/acme/meridian/actions/runs/123456',
      evidenceType: 'github-workflow'
    },
    taskUrl: 'https://github.com/acme/meridian/issues/42',
    observedAt: '2026-10-29T11:55:00.000Z',
    expiresAt: '2026-10-29T12:05:00.000Z',
    evidenceUrl: 'https://github.com/acme/meridian/actions/runs/123456',
    evidenceType: 'github-workflow',
    blocker: 'Awaiting owner confirmation',
    nextAction: 'Wait for owner decision',
    ownerDecisionRequired: true,
    ownerDecisionReason: 'Owner approval is required before launch.'
  };
  return { ...row, ...overrides };
}

function makeDocument() {
  class Node {
    constructor(document, tag = 'div') {
      this.ownerDocument = document;
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attrs = {};
      this._text = '';
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map(node => node.textContent).join('');
    }
    set innerHTML(value) {
      throw new Error('innerHTML is forbidden');
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
      this._text = '';
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    }
    getAttribute(name) {
      return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
    }
    addEventListener() {}
  }
  const document = { createElement(tag) { return new Node(document, tag); } };
  return document;
}

test('normalize -> stringify -> render roundtrip and raw object rejection', () => {
  const input = { schemaVersion: 1, rows: [sample()] };
  const normalized = normalizeM11AgentStatus(input, { now: () => NOW });
  const serialized = JSON.stringify(normalized);
  const document = makeDocument();
  const target = document.createElement('div');
  const rendered = renderM11AgentStatus(target, serialized, { now: () => NOW });
  assert.ok(rendered !== null);
  assert.match(target.textContent, /M11 Agent Status/);
  assert.throws(() => renderM11AgentStatus(target, JSON.stringify({ schemaVersion: 1, rows: [{ ...sample(), agentId: null }] }), { now: () => NOW }), { name: 'TypeError' });
  assert.throws(() => renderM11AgentStatus(target, input, { now: () => NOW }), { name: 'TypeError' });
});

test('expiry and missing evidence suppress active/running/verified claims', () => {
  const expired = sample({ expiresAt: '2026-10-29T12:00:00.000Z', observedAt: '2026-10-29T11:55:00.000Z', taskState: 'RUNNING', coordinatorMode: 'ACTIVE' });
  const expiredNormalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [expired] }, { now: () => NOW });
  assert.equal(expiredNormalized.rows[0].freshness, 'STALE');
  assert.equal(expiredNormalized.rows[0].taskState, 'UNKNOWN');
  assert.equal(expiredNormalized.rows[0].coordinatorMode, 'UNKNOWN');
  assert.equal(expiredNormalized.rows[0].providerVerified, 'UNKNOWN');

  const future = sample({ observedAt: '2026-10-29T12:01:00.000Z', expiresAt: '2026-10-29T12:30:00.000Z' });
  const futureNormalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [future] }, { now: () => NOW });
  assert.equal(futureNormalized.rows[0].freshness, 'UNKNOWN');
  assert.equal(futureNormalized.rows[0].taskState, 'UNKNOWN');

  const noEvidence = sample({
    providerEvidence: null,
    modelEvidence: null,
    coordinatorEvidence: null,
    providerVerified: 'UNKNOWN',
    modelVerified: 'UNKNOWN',
    taskState: 'RUNNING',
    coordinatorMode: 'ACTIVE'
  });
  const withoutEvidence = normalizeM11AgentStatus({ schemaVersion: 1, rows: [noEvidence] }, { now: () => NOW });
  assert.equal(withoutEvidence.rows[0].freshness, 'UNKNOWN');
  assert.equal(withoutEvidence.rows[0].taskState, 'UNKNOWN');
  assert.equal(withoutEvidence.rows[0].coordinatorMode, 'UNKNOWN');
});

test('differing requested and observed values, wrong binding, missing evidence, and invalid clock are rejected', () => {
  const differentModel = sample({ modelRequested: 'gpt-5', modelVerified: 'gpt-4', modelEvidence: { ...sample().modelEvidence, value: 'gpt-4' } });
  const normalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [differentModel] }, { now: () => NOW });
  assert.equal(normalized.rows[0].modelVerified, 'gpt-4');

  const wrongTask = sample({ providerEvidence: { ...sample().providerEvidence, taskId: 'other-task' } });
  assert.equal(normalizeM11AgentStatus({ schemaVersion: 1, rows: [wrongTask] }, { now: () => NOW }).rows[0].providerVerified, 'UNKNOWN');

  const missingModelEvidence = sample({ modelEvidence: null, modelVerified: 'UNKNOWN' });
  assert.equal(normalizeM11AgentStatus({ schemaVersion: 1, rows: [missingModelEvidence] }, { now: () => NOW }).rows[0].modelVerified, 'UNKNOWN');

  const badClock = () => { throw new Error('clock failed'); };
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: [sample()] }, { now: badClock }), { name: 'TypeError' });

  const mismatchedRequestedModel = sample({ modelRequested: 'gpt-5', modelVerified: 'gpt-4', modelEvidence: { ...sample().modelEvidence, value: 'gpt-4' }, providerEvidence: { ...sample().providerEvidence, value: 'github' } });
  assert.equal(normalizeM11AgentStatus({ schemaVersion: 1, rows: [mismatchedRequestedModel] }, { now: () => NOW }).rows[0].modelVerified, 'gpt-4');
});

test('strict rejection for hostile rows, arrays, and dangerous DTO mutation', () => {
  const withNullAgent = sample();
  withNullAgent.agentId = null;
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: [withNullAgent] }, { now: () => NOW }), { name: 'TypeError' });

  const withNullVerified = sample();
  withNullVerified.providerVerified = null;
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: [withNullVerified] }, { now: () => NOW }), { name: 'TypeError' });

  const withOwnerReason = sample({ ownerDecisionRequired: true, ownerDecisionReason: null });
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: [withOwnerReason] }, { now: () => NOW }), { name: 'TypeError' });

  const proxyTarget = [sample()];
  const proxyRows = new Proxy(proxyTarget, {
    get(target, property, receiver) {
      if (property === 'length') return 1;
      if (property === 'map') {
        throw new Error('map should not be called');
      }
      return Reflect.get(target, property, receiver);
    }
  });
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: proxyRows }, { now: () => NOW }), { name: 'TypeError' });

  const customArray = Object.create(Array.prototype);
  customArray.push(sample());
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: customArray }, { now: () => NOW }), { name: 'TypeError' });

  assert.throws(() => validateM11AgentStatusRow(sample({ taskUrl: 'https://github.com/acme/meridian/issues/42?token=secret' }), NOW), { name: 'TypeError' });
});

test('browser serialization contract preserves current and stale evidence exactly', () => {
  const freshRow = sample();
  const freshNormalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [freshRow] }, { now: () => NOW });
  const freshSerialized = JSON.stringify(freshNormalized);
  const freshDocument = makeDocument();
  const freshRoot = freshDocument.createElement('div');
  renderM11AgentStatus(freshRoot, freshSerialized, { now: () => NOW });
  const freshSection = freshRoot.children[0];
  assert.equal(freshSection.getAttribute('data-status'), 'CURRENT');
  assert.ok(freshRoot.textContent.includes('Aktuell'));
  assert.ok(freshRoot.textContent.includes('Laufend'));
  assert.ok(freshRoot.textContent.includes('Gestoppt'));

  const staleLater = makeDocument();
  const staleRoot = staleLater.createElement('div');
  renderM11AgentStatus(staleRoot, freshSerialized, { now: () => Date.parse('2026-10-29T12:05:00.000Z') });
  const staleSection = staleRoot.children[0];
  assert.equal(staleSection.getAttribute('data-status'), 'STALE');
  assert.ok(staleRoot.textContent.includes('Veraltet'));
  assert.ok(!staleRoot.textContent.includes('Aktuell'));
  assert.ok(staleRoot.textContent.includes('Unbekannt') || staleRoot.textContent.includes('Veraltet'));

  const noEvidence = sample({
    providerEvidence: null,
    modelEvidence: null,
    coordinatorEvidence: null,
    taskState: 'RUNNING',
    coordinatorMode: 'ACTIVE'
  });
  const noEvidenceNormalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [noEvidence] }, { now: () => NOW });
  const noEvidenceSerialized = JSON.stringify(noEvidenceNormalized);
  const unknownDocument = makeDocument();
  const unknownRoot = unknownDocument.createElement('div');
  renderM11AgentStatus(unknownRoot, noEvidenceSerialized, { now: () => NOW });
  const unknownSection = unknownRoot.children[0];
  assert.equal(unknownSection.getAttribute('data-status'), 'UNKNOWN');
  assert.ok(unknownRoot.textContent.includes('Unbekannt'));
  assert.ok(!unknownRoot.textContent.includes('Aktuell'));
  assert.ok(!unknownRoot.textContent.includes('Laufend'));

  const wrongBinding = sample({
    providerEvidence: { ...sample().providerEvidence, taskId: 'other-task' },
    modelEvidence: { ...sample().modelEvidence, taskId: 'other-task' },
    coordinatorEvidence: { ...sample().coordinatorEvidence, taskId: 'other-task' },
    providerVerified: 'github',
    modelVerified: 'gpt-5'
  });
  const wrongBindingNormalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [wrongBinding] }, { now: () => NOW });
  assert.equal(wrongBindingNormalized.rows[0].freshness, 'UNKNOWN');
  assert.equal(wrongBindingNormalized.rows[0].providerVerified, 'UNKNOWN');
  assert.equal(wrongBindingNormalized.rows[0].modelVerified, 'UNKNOWN');
});

test('browser revalidation recomputes stale visible claims and rejects descriptor-driven getters', () => {
  const valid = sample({
    taskState: 'RUNNING',
    coordinatorMode: 'STOPPED',
    providerVerified: 'github',
    modelVerified: 'gpt-5'
  });
  const normalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [valid] }, { now: () => NOW });
  const serialized = JSON.stringify(normalized);

  const document = makeDocument();
  const root = document.createElement('div');
  renderM11AgentStatus(root, serialized, { now: () => Date.parse('2026-10-29T12:05:00.000Z') });
  assert.match(root.textContent, /Veraltet|Unbekannt/);

  const mutated = JSON.parse(serialized);
  mutated.rows[0].modelEvidence = null;
  mutated.rows[0].modelVerified = 'gpt-5';
  const mutRoot = document.createElement('div');
  renderM11AgentStatus(mutRoot, JSON.stringify(mutated), { now: () => NOW });
  assert.match(mutRoot.textContent, /Unbekannt/);

  let schemaGetterCount = 0;
  const getterObject = {
    get schemaVersion() {
      schemaGetterCount += 1;
      return 1;
    },
    rows: [valid]
  };
  assert.throws(() => normalizeM11AgentStatus(getterObject, { now: () => NOW }), { name: 'TypeError' });
  assert.equal(schemaGetterCount, 0);

  let statusGetterCount = 0;
  const getterStatusObject = {
    schemaVersion: 1,
    get status() {
      statusGetterCount += 1;
      return 'READY';
    },
    get freshness() {
      statusGetterCount += 1;
      return 'CURRENT';
    },
    rows: [valid]
  };
  assert.throws(() => normalizeM11AgentStatus(getterStatusObject, { now: () => NOW }), { name: 'TypeError' });
  assert.equal(statusGetterCount, 0);

  const explicitUndefinedStatus = { schemaVersion: 1, status: undefined, rows: [valid] };
  assert.throws(() => normalizeM11AgentStatus(explicitUndefinedStatus, { now: () => NOW }), { name: 'TypeError' });
  const explicitUndefinedFreshness = { schemaVersion: 1, status: 'READY', freshness: undefined, rows: [valid] };
  assert.throws(() => normalizeM11AgentStatus(explicitUndefinedFreshness, { now: () => NOW }), { name: 'TypeError' });

  let evidenceGetterCount = 0;
  const evilEvidence = {
    get value() {
      evidenceGetterCount += 1;
      return 'github';
    },
    agentId: 'agent-100',
    taskId: 'task-200',
    observedAt: '2026-10-29T11:55:00.000Z',
    expiresAt: '2026-10-29T12:05:00.000Z',
    evidenceUrl: 'https://github.com/acme/meridian/actions/runs/123456',
    evidenceType: 'github-workflow'
  };
  const evilRow = sample({ providerEvidence: evilEvidence });
  assert.throws(() => normalizeM11AgentStatus({ schemaVersion: 1, rows: [evilRow] }, { now: () => NOW }), { name: 'TypeError' });
  assert.equal(evidenceGetterCount, 0);
});

test('manual and unknown evidence never verify provider, model, or active coordinator claims', () => {
  const manualRow = sample({
    providerEvidence: { ...sample().providerEvidence, evidenceType: 'manual' },
    modelEvidence: { ...sample().modelEvidence, evidenceType: 'manual' },
    coordinatorEvidence: { ...sample().coordinatorEvidence, evidenceType: 'manual' },
    providerVerified: 'github',
    modelVerified: 'gpt-5',
    taskState: 'RUNNING',
    coordinatorMode: 'ACTIVE'
  });
  const normalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [manualRow] }, { now: () => NOW });
  assert.equal(normalized.rows[0].providerVerified, 'UNKNOWN');
  assert.equal(normalized.rows[0].modelVerified, 'UNKNOWN');
  assert.equal(normalized.rows[0].coordinatorMode, 'UNKNOWN');

  const unknownRow = sample({
    providerEvidence: { ...sample().providerEvidence, evidenceType: 'unknown' },
    modelEvidence: { ...sample().modelEvidence, evidenceType: 'unknown' },
    coordinatorEvidence: { ...sample().coordinatorEvidence, evidenceType: 'unknown' },
    providerVerified: 'github',
    modelVerified: 'gpt-5',
    coordinatorMode: 'ACTIVE'
  });
  const unknownNormalized = normalizeM11AgentStatus({ schemaVersion: 1, rows: [unknownRow] }, { now: () => NOW });
  assert.equal(unknownNormalized.rows[0].providerVerified, 'UNKNOWN');
  assert.equal(unknownNormalized.rows[0].modelVerified, 'UNKNOWN');
  assert.equal(unknownNormalized.rows[0].coordinatorMode, 'UNKNOWN');
});

test('serialized status/freshness descriptor matrix rejects invalid top-level data without invoking getters', () => {
  const validRaw = { schemaVersion: 1, rows: [sample()] };
  const validSerialized = { schemaVersion: 1, status: 'READY', freshness: 'CURRENT', rows: [sample()] };
  assert.doesNotThrow(() => normalizeM11AgentStatus(validRaw, { now: () => NOW }));
  assert.doesNotThrow(() => normalizeM11AgentStatus(validSerialized, { now: () => NOW }));

  const statusUndefined = { schemaVersion: 1, status: undefined, freshness: 'CURRENT', rows: [sample()] };
  assert.throws(() => normalizeM11AgentStatus(statusUndefined, { now: () => NOW }), { name: 'TypeError' });

  const freshnessUndefined = { schemaVersion: 1, status: 'READY', freshness: undefined, rows: [sample()] };
  assert.throws(() => normalizeM11AgentStatus(freshnessUndefined, { now: () => NOW }), { name: 'TypeError' });

  let statusGetterCount = 0;
  let freshnessGetterCount = 0;
  const getterStatus = {
    schemaVersion: 1,
    get status() {
      statusGetterCount += 1;
      return 'READY';
    },
    freshness: 'CURRENT',
    rows: [sample()]
  };
  const getterFreshness = {
    schemaVersion: 1,
    status: 'READY',
    get freshness() {
      freshnessGetterCount += 1;
      return 'CURRENT';
    },
    rows: [sample()]
  };
  const combinedGetter = {
    schemaVersion: 1,
    get status() {
      statusGetterCount += 1;
      return 'READY';
    },
    get freshness() {
      freshnessGetterCount += 1;
      return 'CURRENT';
    },
    rows: [sample()]
  };
  assert.throws(() => normalizeM11AgentStatus(getterStatus, { now: () => NOW }), { name: 'TypeError' });
  assert.throws(() => normalizeM11AgentStatus(getterFreshness, { now: () => NOW }), { name: 'TypeError' });
  assert.throws(() => normalizeM11AgentStatus(combinedGetter, { now: () => NOW }), { name: 'TypeError' });
  assert.equal(statusGetterCount, 0);
  assert.equal(freshnessGetterCount, 0);

  let statusSetterCount = 0;
  let freshnessSetterCount = 0;
  const setterStatus = {
    schemaVersion: 1,
    status: undefined,
    freshness: 'CURRENT',
    rows: [sample()]
  };
  Object.defineProperty(setterStatus, 'status', {
    enumerable: true,
    set(value) {
      statusSetterCount += 1;
      this.__status = value;
    }
  });
  const setterFreshness = {
    schemaVersion: 1,
    status: 'READY',
    freshness: undefined,
    rows: [sample()]
  };
  Object.defineProperty(setterFreshness, 'freshness', {
    enumerable: true,
    set(value) {
      freshnessSetterCount += 1;
      this.__freshness = value;
    }
  });
  assert.throws(() => normalizeM11AgentStatus(setterStatus, { now: () => NOW }), { name: 'TypeError' });
  assert.throws(() => normalizeM11AgentStatus(setterFreshness, { now: () => NOW }), { name: 'TypeError' });
  assert.equal(statusSetterCount, 0);
  assert.equal(freshnessSetterCount, 0);

  const nonEnumerableStatus = { schemaVersion: 1, rows: [sample()] };
  Object.defineProperty(nonEnumerableStatus, 'status', { value: 'READY', enumerable: false });
  Object.defineProperty(nonEnumerableStatus, 'freshness', { value: 'CURRENT', enumerable: true });
  assert.throws(() => normalizeM11AgentStatus(nonEnumerableStatus, { now: () => NOW }), { name: 'TypeError' });

  const nonEnumerableFreshness = { schemaVersion: 1, status: 'READY', rows: [sample()] };
  Object.defineProperty(nonEnumerableFreshness, 'freshness', { value: 'CURRENT', enumerable: false });
  assert.throws(() => normalizeM11AgentStatus(nonEnumerableFreshness, { now: () => NOW }), { name: 'TypeError' });
});
