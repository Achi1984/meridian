import test from 'node:test';
import assert from 'node:assert/strict';
import {
  M11_TASK_STATES,
  M11_COORDINATOR_MODES,
  normalizeM11AgentStatus,
  validateM11AgentStatusRow
} from '../scripts/autonomy/m11-agent-status.mjs';
import {renderM11AgentStatus} from '../public/js/m11-agent-status.js';

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
    taskUrl: 'https://example.com/tasks/task-200',
    observedAt: '2026-10-29T11:55:00.000Z',
    expiresAt: '2026-10-29T12:05:00.000Z',
    evidenceUrl: 'https://example.com/evidence/abc123',
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
      this.className = '';
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

  const document = {
    createElement(tag) {
      return new Node(document, tag);
    }
  };

  return document;
}

test('strict contract accepts valid rows and keeps task/state independence explicit', () => {
  const input = {
    schemaVersion: 1,
    rows: [sample({taskState: 'RUNNING', coordinatorMode: 'STOPPED', modelVerified: 'gpt-5'})]
  };
  const result = normalizeM11AgentStatus(input, {now: () => NOW});
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.freshness, 'CURRENT');
  assert.equal(result.rows[0].taskState, 'RUNNING');
  assert.equal(result.rows[0].coordinatorMode, 'STOPPED');
  assert.ok(M11_TASK_STATES.includes('RUNNING'));
  assert.ok(M11_COORDINATOR_MODES.includes('STOPPED'));
  assert.deepEqual(normalizeM11AgentStatus(input, {now: () => NOW}), result);
});

test('missing, malformed, expired or future evidence fail closed without inventing policy', () => {
  const future = sample({observedAt: '2026-10-29T12:01:00.000Z', expiresAt: '2026-10-29T12:30:00.000Z'});
  const futureStatus = normalizeM11AgentStatus({schemaVersion: 1, rows: [future]}, {now: () => NOW});
  assert.equal(futureStatus.rows[0].freshness, 'UNKNOWN');

  const expired = sample({expiresAt: '2026-10-29T11:59:00.000Z'});
  const stale = normalizeM11AgentStatus({schemaVersion: 1, rows: [expired]}, {now: () => NOW});
  assert.equal(stale.rows[0].freshness, 'STALE');

  const noEvidence = sample({
    providerVerified: 'UNKNOWN',
    modelVerified: 'UNKNOWN',
    evidenceUrl: null,
    evidenceType: 'unknown',
    ownerDecisionRequired: false,
    ownerDecisionReason: null
  });
  const validUnknown = normalizeM11AgentStatus({schemaVersion: 1, rows: [noEvidence]}, {now: () => NOW});
  assert.equal(validUnknown.rows[0].providerVerified, 'UNKNOWN');
  assert.equal(validUnknown.rows[0].modelVerified, 'UNKNOWN');

  assert.throws(() => validateM11AgentStatusRow(sample({providerVerified: 'gitlab'}), NOW), {name: 'TypeError'});
  assert.throws(() => validateM11AgentStatusRow(sample({modelVerified: 'claude-3'}), NOW), {name: 'TypeError'});
  assert.throws(() => validateM11AgentStatusRow(sample({ownerDecisionRequired: true, ownerDecisionReason: null}), NOW), {name: 'TypeError'});
});

test('hostile URLs, extra fields and text are rejected before rendering', () => {
  const withExtraField = sample();
  withExtraField.extra = 'nope';
  assert.throws(() => validateM11AgentStatusRow(sample({taskUrl: 'javascript:alert(1)'}), NOW), {name: 'TypeError'});
  assert.throws(() => validateM11AgentStatusRow(sample({evidenceUrl: 'file:///etc/passwd'}), NOW), {name: 'TypeError'});
  assert.throws(() => validateM11AgentStatusRow(sample({nextAction: '<script>alert(1)</script>'}), NOW), {name: 'TypeError'});
  assert.throws(() => normalizeM11AgentStatus({schemaVersion: 1, rows: [withExtraField]}, {now: () => NOW}), {name: 'TypeError'});

  const proxy = new Proxy(sample(), {});
  assert.throws(() => validateM11AgentStatusRow(proxy, NOW), {name: 'TypeError'});
});

test('rendering is DOM-safe and text-only for public output', () => {
  const document = makeDocument();
  const target = document.createElement('div');
  const rendered = renderM11AgentStatus(target, {schemaVersion: 1, rows: [sample()]}, {now: () => NOW});
  assert.ok(rendered !== null);
  assert.match(target.textContent, /M11 Agent Status/);
  assert.match(target.textContent, /Copilot/);
  assert.match(target.textContent, /Wartend|Laufend|Prüfung|Blockiert|Erledigt|Unbekannt/);
  assert.doesNotMatch(target.textContent, /<script>|javascript:|secret/);
  assert.equal(target.getAttribute('data-status'), null);
});

test('rendering keeps a stable card structure for same input and clock', () => {
  const document = makeDocument();
  const target = document.createElement('div');
  const base = {schemaVersion: 1, rows: [sample({taskState: 'REVIEWING', coordinatorMode: 'PILOT'})]};
  renderM11AgentStatus(target, base, {now: () => NOW});
  const before = target.textContent;
  renderM11AgentStatus(target, base, {now: () => NOW});
  const after = target.textContent;
  assert.equal(before, after);
});
