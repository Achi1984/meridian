import {types} from 'node:util';

export const M11_TASK_STATES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'REVIEWING',
  'BLOCKED',
  'DONE',
  'UNKNOWN'
]);

export const M11_COORDINATOR_MODES = Object.freeze([
  'PREPARATION',
  'PILOT',
  'ACTIVE',
  'STOPPED',
  'UNKNOWN'
]);

export const M11_FRESHNESS_STATES = Object.freeze([
  'CURRENT',
  'STALE',
  'UNKNOWN'
]);

export const M11_EVIDENCE_TYPES = Object.freeze([
  'github-workflow',
  'github-issue',
  'github-pr',
  'copilot-session',
  'manual',
  'unknown'
]);

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

function plainObject(value) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/.test(text)) {
    return null;
  }
  return text;
}

function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\x00-\x1F\x7F<>]/.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function isoMs(value) {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function deriveFreshness(observedAt, expiresAt, nowMs) {
  const observed = isoMs(observedAt);
  const expires = isoMs(expiresAt);
  if (observed === null || expires === null) return 'UNKNOWN';
  if (observed > nowMs) return 'UNKNOWN';
  if (expires <= nowMs) return 'STALE';
  return 'CURRENT';
}

function validateRow(row, nowMs) {
  if (!plainObject(row)) {
    throw new TypeError('M11 agent status row must be a plain object');
  }
  const keys = [
    'agentId', 'agentName', 'taskId', 'taskLabel', 'taskState', 'coordinatorMode',
    'providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
    'taskUrl', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType',
    'blocker', 'nextAction', 'ownerDecisionRequired', 'ownerDecisionReason'
  ];
  const currentKeys = Object.keys(row);
  if (currentKeys.length !== keys.length || currentKeys.some(key => !keys.includes(key))) {
    throw new TypeError('M11 agent status row field set is invalid');
  }

  const agentId = safeText(row.agentId, 120);
  const agentName = safeText(row.agentName, 120);
  const taskId = safeText(row.taskId, 120);
  const taskLabel = safeText(row.taskLabel, 160);
  if (!agentId || !agentName || !taskId || !taskLabel) {
    throw new TypeError('Agent and task identity are required');
  }

  if (!M11_TASK_STATES.includes(row.taskState)) {
    throw new TypeError('Invalid taskState');
  }
  if (!M11_COORDINATOR_MODES.includes(row.coordinatorMode)) {
    throw new TypeError('Invalid coordinatorMode');
  }

  const providerRequested = safeText(row.providerRequested, 80);
  const providerVerified = safeText(row.providerVerified, 80);
  const modelRequested = safeText(row.modelRequested, 120);
  const modelVerified = safeText(row.modelVerified, 120);
  if (!providerRequested || !modelRequested) {
    throw new TypeError('Requested provider and model are required');
  }
  if (providerVerified !== 'UNKNOWN' && !providerVerified) {
    throw new TypeError('Provider verification is invalid');
  }
  if (modelVerified !== 'UNKNOWN' && !modelVerified) {
    throw new TypeError('Model verification is invalid');
  }
  if (providerVerified !== 'UNKNOWN' && providerVerified !== providerRequested) {
    throw new TypeError('Provider verification must match the requested provider');
  }
  if (modelVerified !== 'UNKNOWN' && modelVerified !== modelRequested) {
    throw new TypeError('Model verification must match the requested model');
  }

  const taskUrl = safeUrl(row.taskUrl);
  const evidenceUrl = row.evidenceUrl === null ? null : safeUrl(row.evidenceUrl);
  if (!taskUrl) {
    throw new TypeError('Task URL must be http(s)');
  }
  if (providerVerified !== 'UNKNOWN' || modelVerified !== 'UNKNOWN') {
    if (!evidenceUrl) {
      throw new TypeError('Evidence URL is required when provider or model is verified');
    }
  }

  const evidenceType = safeText(row.evidenceType, 80);
  if (evidenceUrl && !evidenceType) {
    throw new TypeError('Evidence type is required when evidence URL is present');
  }
  if (evidenceType && !M11_EVIDENCE_TYPES.includes(evidenceType)) {
    throw new TypeError('Evidence type is invalid');
  }

  const observedAt = isoMs(row.observedAt);
  const expiresAt = isoMs(row.expiresAt);
  if (observedAt === null || expiresAt === null || observedAt > expiresAt) {
    throw new TypeError('Observation and expiry timestamps are invalid');
  }

  const freshness = deriveFreshness(row.observedAt, row.expiresAt, nowMs);
  const blocker = row.blocker === null ? null : safeText(row.blocker, 200);
  const nextAction = safeText(row.nextAction, 200);
  if (!nextAction) {
    throw new TypeError('Next action is required');
  }

  const ownerDecisionRequired = row.ownerDecisionRequired === true || row.ownerDecisionRequired === false;
  if (!ownerDecisionRequired) {
    throw new TypeError('ownerDecisionRequired must be a boolean');
  }
  const ownerDecisionReason = row.ownerDecisionReason === null || row.ownerDecisionReason === undefined
    ? null
    : safeText(row.ownerDecisionReason, 200);
  if (row.ownerDecisionRequired === true && (!ownerDecisionReason || !ownerDecisionReason.length)) {
    throw new TypeError('An owner decision reason is required when ownerDecisionRequired is true');
  }
  if (row.ownerDecisionRequired === false && ownerDecisionReason !== null) {
    throw new TypeError('A false ownerDecisionRequired must not include a reason');
  }

  return Object.freeze({
    agentId,
    agentName,
    taskId,
    taskLabel,
    taskState: row.taskState,
    coordinatorMode: row.coordinatorMode,
    providerRequested,
    providerVerified,
    modelRequested,
    modelVerified,
    taskUrl,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    evidenceUrl,
    evidenceType: evidenceType || 'unknown',
    blocker,
    nextAction,
    ownerDecisionRequired: row.ownerDecisionRequired,
    ownerDecisionReason,
    freshness
  });
}

export function normalizeM11AgentStatus(input, options = {}) {
  if (!plainObject(input)) {
    throw new TypeError('M11 agent status input must be a plain object');
  }
  const currentKeys = Object.keys(input);
  if (currentKeys.length !== 2 || !currentKeys.includes('schemaVersion') || !currentKeys.includes('rows')) {
    throw new TypeError('M11 agent status must contain schemaVersion and rows');
  }
  if (input.schemaVersion !== 1) {
    throw new TypeError('Unsupported M11 agent status schemaVersion');
  }

  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const rows = Array.isArray(input.rows) ? input.rows : null;
  if (!rows || rows.length === 0 || rows.length > 50) {
    throw new TypeError('M11 agent status rows must be a non-empty array up to 50 items');
  }

  const normalized = rows.map(row => validateRow(row, now));
  const uniqueIdentity = new Set();
  for (const row of normalized) {
    const identity = `${row.agentId}|${row.taskId}`;
    if (uniqueIdentity.has(identity)) {
      throw new TypeError('Duplicate agent/task row identity is not allowed');
    }
    uniqueIdentity.add(identity);
  }

  return Object.freeze({
    schemaVersion: 1,
    status: 'READY',
    freshness: normalized.every(row => row.freshness === 'CURRENT') ? 'CURRENT'
      : normalized.some(row => row.freshness === 'STALE') ? 'STALE'
      : 'UNKNOWN',
    rows: Object.freeze(normalized)
  });
}

export function validateM11AgentStatusRow(row, nowMs = Date.now()) {
  return validateRow(row, nowMs);
}

export function deriveM11Freshness(observedAt, expiresAt, nowMs = Date.now()) {
  return deriveFreshness(observedAt, expiresAt, nowMs);
}
