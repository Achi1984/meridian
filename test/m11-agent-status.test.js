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
  return {...row, ...overrides};
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

test('roundtrip JSON and strict renderer input contract', () => {
  const input = {schemaVersion: 1, rows: [sample()]};
  const normalized = normalizeM11AgentStatus(input, {now: () => NOW});
  const serialized = JSON.stringify(normalized);
  const doc = makeDocument();
  const target = doc.createElement('div');
  const rendered = renderM11AgentStatus(target, serialized, {now: () => NOW});
  assert.ok(rendered !== null);
  assert.match(target.textContent, /M11 Agent Status/);
  assert.throws(() => renderM11AgentStatus(target, input, {now: () => NOW}), {name: 'TypeError'});
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [{...sample(), agentId: null}]}, {now: () => NOW}), {name: 'TypeError'});
});

test('expiry and missing evidence suppress active/running/verified claims', () => {
  const expired = sample({expiresAt: '2026-10-29T11:59:00.000Z'});
  const expiredNormalized = normalizeM11AgentStatus({schemaVersion: 1, rows: [expired]}, {now: () => NOW});
  assert.equal(expiredNormalized.rows[0].freshness, 'STALE');
  assert.equal(expiredNormalized.rows[0].taskState, 'UNKNOWN');
  assert.equal(expiredNormalized.rows[0].coordinatorMode, 'UNKNOWN');
  assert.equal(expiredNormalized.rows[0].providerVerified, 'UNKNOWN');

  const future = sample({observedAt: '2026-10-29T12:01:00.000Z', expiresAt: '2026-10-29T12:30:00.000Z'});
  const futureNormalized = normalizeM11AgentStatus({schemaVersion: 1, rows: [future]}, {now: () => NOW});
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
  const withoutEvidence = normalizeM11AgentStatus({schemaVersion: 1, rows: [noEvidence]}, {now: () => NOW});
  assert.equal(withoutEvidence.rows[0].freshness, 'UNKNOWN');
  assert.equal(withoutEvidence.rows[0].taskState, 'UNKNOWN');
  assert.equal(withoutEvidence.rows[0].coordinatorMode, 'UNKNOWN');
});

test('mismatched requested/observed model and binding checks fail closed', () => {
  const differentModel = sample({modelRequested: 'gpt-5', modelVerified: 'gpt-4', modelEvidence: { ...sample().modelEvidence, value: 'gpt-4' }});
  const normalized = normalizeM11AgentStatus({schemaVersion: 1, rows: [differentModel]}, {now: () => NOW});
  assert.equal(normalized.rows[0].modelVerified, 'gpt-4');

  const wrongTask = sample({ providerEvidence: { ...sample().providerEvidence, taskId: 'other-task' } });
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [wrongTask]}, {now: () => NOW}), {name: 'TypeError'});

  const missingModelEvidence = sample({ modelEvidence: null, modelVerified: 'UNKNOWN' });
  assert.equal(normalizeM11AgentStatus({schemaVersion: 1, rows: [missingModelEvidence]}, {now: () => NOW}).rows[0].modelVerified, 'UNKNOWN');

  const badClock = () => { throw new Error('clock failed'); };
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [sample()]}, {now: badClock}), {name: 'TypeError'});
});

test('strict rejection for hostile rows, arrays, and dangerous DTO mutation', () => {
  const withNullAgent = sample();
  withNullAgent.agentId = null;
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [withNullAgent]}, {now: () => NOW}), {name: 'TypeError'});

  const withNullVerified = sample();
  withNullVerified.providerVerified = null;
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [withNullVerified]}, {now: () => NOW}), {name: 'TypeError'});

  const withOwnerReason = sample({ownerDecisionRequired: true, ownerDecisionReason: null});
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [withOwnerReason]}, {now: () => NOW}), {name: 'TypeError'});

  const proxy = new Proxy([sample()], { get(target, prop, receiver) { if (prop === 'length') return 1; return Reflect.get(target, prop, receiver); }});
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: proxy}, {now: () => NOW}), {name: 'TypeError'});

  const customArray = Object.create(Array.prototype);
  customArray.push(sample());
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: customArray}, {now: () => NOW}), {name: 'TypeError'});
  assert.throws(() => validateM11AgentStatusRow(sample({taskUrl: 'https://github.com/acme/meridian/issues/42?token=secret'}), NOW), {name: 'TypeError'});
});
