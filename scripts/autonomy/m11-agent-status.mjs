import { types as utilTypes } from 'node:util';

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

const VERIFIED_EVIDENCE_TYPES = new Set(['github-workflow', 'github-issue', 'github-pr', 'copilot-session']);
const ALLOWED_PUBLIC_GITHUB_PATHS = new Set(['issues', 'pull', 'actions', 'commit', 'discussions', 'releases']);
const SAFE_TEXT_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/;
const EVIDENCE_KEYS = ['agentId', 'taskId', 'value', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType'];
const ROW_KEYS = [
  'agentId', 'agentName', 'taskId', 'taskLabel', 'taskState', 'coordinatorMode',
  'providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
  'providerEvidence', 'modelEvidence', 'coordinatorEvidence',
  'taskUrl', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType',
  'blocker', 'nextAction', 'ownerDecisionRequired', 'ownerDecisionReason'
];

function isProxy(value) {
  return Boolean(utilTypes && typeof utilTypes.isProxy === 'function' && utilTypes.isProxy(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (isProxy(value)) {
    return false;
  }
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function exactArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || isProxy(value)) {
    return false;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !keys.includes('length')) {
      return false;
    }
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
        return false;
      }
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function safeText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength || SAFE_TEXT_RE.test(text)) {
    return null;
  }
  return text;
}

function requireString(value, maxLength, label) {
  const text = safeText(value, maxLength);
  if (text === null) {
    throw new TypeError(`${label} is invalid`);
  }
  return text;
}

function isAllowedGithubAnchor(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) || /^(?:issuecomment|discussioncomment)-\d+$/.test(value);
}

function validateGithubUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\x00-\x1F\x7F<>]/.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    if (parsed.hostname.toLowerCase() !== 'github.com') return null;
    if (parsed.search) return null;
    const hash = parsed.hash ? parsed.hash.slice(1) : '';
    if (hash && !/^(?:issuecomment|discussioncomment)-\d+$/.test(hash)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo, kind, ...rest] = parts;
    if (!owner || !repo || owner.includes('.') || repo.includes('.')) return null;
    if (!kind || !ALLOWED_PUBLIC_GITHUB_PATHS.has(kind)) return null;
    if (kind === 'issues' && rest.length === 1 && /^\d+$/.test(rest[0])) return parsed.href;
    if (kind === 'pull' && rest.length === 1 && /^\d+$/.test(rest[0])) return parsed.href;
    if (kind === 'commit' && rest.length === 1 && /^[0-9a-fA-F]{7,40}$/.test(rest[0])) return parsed.href;
    if (kind === 'discussions' && rest.length === 1 && /^\d+$/.test(rest[0])) return parsed.href;
    if (kind === 'actions' && rest.length === 2 && rest[0] === 'runs' && /^\d+$/.test(rest[1])) return parsed.href;
    if (kind === 'releases' && rest.length === 2 && rest[0] === 'tag' && /^[A-Za-z0-9._-]+$/.test(rest[1])) return parsed.href;
    return null;
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
  const observedMs = isoMs(observedAt);
  const expiresMs = isoMs(expiresAt);
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return 'UNKNOWN';
  if (observedMs === null || expiresMs === null) return 'UNKNOWN';
  if (observedMs > nowMs) return 'UNKNOWN';
  if (expiresMs <= nowMs) return 'STALE';
  return 'CURRENT';
}

function validateEvidenceBinding(binding, expectedAgentId, expectedTaskId, expectedValue, nowMs) {
  if (binding === null || binding === undefined) return null;
  if (!isPlainObject(binding)) return null;
  if (!Object.hasOwn(binding, 'agentId') || !Object.hasOwn(binding, 'taskId') || !Object.hasOwn(binding, 'value') || !Object.hasOwn(binding, 'observedAt') || !Object.hasOwn(binding, 'expiresAt') || !Object.hasOwn(binding, 'evidenceUrl') || !Object.hasOwn(binding, 'evidenceType')) {
    return null;
  }
  const keys = Reflect.ownKeys(binding);
  if (keys.length !== EVIDENCE_KEYS.length || keys.some(key => typeof key !== 'string' || !EVIDENCE_KEYS.includes(key))) {
    return null;
  }
  const agentId = safeText(binding.agentId, 120);
  const taskId = safeText(binding.taskId, 120);
  const value = safeText(binding.value, 200);
  const evidenceType = safeText(binding.evidenceType, 80);
  if (agentId !== expectedAgentId || taskId !== expectedTaskId) return null;
  if (!value || value === 'UNKNOWN') return null;
  if (expectedValue !== undefined && value !== expectedValue) {
    // allow model/provider mismatch; coordinator evidence must match advised mode
    if (expectedValue !== 'ANY') {
      if (expectedValue === 'coordinator') {
        // not used
      }
    }
  }
  if (evidenceType === null || !M11_EVIDENCE_TYPES.includes(evidenceType)) return null;
  const evidenceUrl = validateGithubUrl(binding.evidenceUrl);
  if (!evidenceUrl) return null;
  const observedAt = isoMs(binding.observedAt);
  const expiresAt = isoMs(binding.expiresAt);
  if (observedAt === null || expiresAt === null || observedAt > expiresAt) return null;
  if (deriveFreshness(binding.observedAt, binding.expiresAt, nowMs) !== 'CURRENT') return null;
  return Object.freeze({
    agentId,
    taskId,
    value,
    observedAt: binding.observedAt,
    expiresAt: binding.expiresAt,
    evidenceUrl,
    evidenceType
  });
}

function validateRow(row, nowMs) {
  ensureFiniteClock(nowMs, 'now value');
  if (!isPlainObject(row)) {
    throw new TypeError('M11 agent status row must be a plain object');
  }
  const keys = Reflect.ownKeys(row);
  if (keys.length !== ROW_KEYS.length || keys.some(key => typeof key !== 'string' || !ROW_KEYS.includes(key))) {
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
  const modelRequested = safeText(row.modelRequested, 120);
  if (!providerRequested || !modelRequested) {
    throw new TypeError('Requested provider and model are required');
  }

  const taskUrl = validateGithubUrl(row.taskUrl);
  if (!taskUrl) {
    throw new TypeError('Task URL must be a valid public GitHub URL');
  }

  const observedAt = isoMs(row.observedAt);
  const expiresAt = isoMs(row.expiresAt);
  if (observedAt === null || expiresAt === null || observedAt > expiresAt) {
    throw new TypeError('Observation and expiry timestamps are invalid');
  }

  const evidenceType = safeText(row.evidenceType, 80);
  const evidenceUrl = row.evidenceUrl === null || row.evidenceUrl === undefined ? null : validateGithubUrl(row.evidenceUrl);
  if (evidenceType && !M11_EVIDENCE_TYPES.includes(evidenceType)) {
    throw new TypeError('Evidence type is invalid');
  }
  if ((evidenceUrl === null && evidenceType && evidenceType !== 'unknown' && evidenceType !== 'manual') || (evidenceUrl !== null && evidenceType === null)) {
    // allow null evidenceType only for unknown/manual rows; typed evidence needs URL
  }

  const blocker = row.blocker === null || row.blocker === undefined ? null : safeText(row.blocker, 200);
  const nextAction = safeText(row.nextAction, 200);
  if (!nextAction) {
    throw new TypeError('Next action is required');
  }

  const ownerDecisionRequired = row.ownerDecisionRequired === true || row.ownerDecisionRequired === false;
  if (!ownerDecisionRequired) {
    throw new TypeError('ownerDecisionRequired must be a boolean');
  }
  const ownerDecisionReason = row.ownerDecisionRequired === true
    ? safeText(row.ownerDecisionReason, 200)
    : (row.ownerDecisionReason === null || row.ownerDecisionReason === undefined ? null : safeText(row.ownerDecisionReason, 200));
  if (row.ownerDecisionRequired === true && (!ownerDecisionReason || ownerDecisionReason.length === 0)) {
    throw new TypeError('An owner decision reason is required when ownerDecisionRequired is true');
  }
  if (row.ownerDecisionRequired === false && ownerDecisionReason !== null) {
    throw new TypeError('A false ownerDecisionRequired must not include a reason');
  }

  const rowFreshness = deriveFreshness(row.observedAt, row.expiresAt, nowMs);
  const providerEvidence = validateEvidenceBinding(row.providerEvidence, agentId, taskId, undefined, nowMs);
  const modelEvidence = validateEvidenceBinding(row.modelEvidence, agentId, taskId, undefined, nowMs);
  const coordinatorEvidence = validateEvidenceBinding(row.coordinatorEvidence, agentId, taskId, row.coordinatorMode, nowMs);

  const providerVerified = providerEvidence ? providerEvidence.value : 'UNKNOWN';
  const modelVerified = modelEvidence ? modelEvidence.value : 'UNKNOWN';
  const effectiveCoordinatorMode = row.coordinatorMode === 'ACTIVE' && (!coordinatorEvidence || coordinatorEvidence.value !== 'ACTIVE') ? 'UNKNOWN' : row.coordinatorMode;
  const effectiveTaskState = (row.taskState === 'RUNNING' || row.taskState === 'REVIEWING') && rowFreshness !== 'CURRENT' ? 'UNKNOWN' : row.taskState;
  const effectiveFreshness = rowFreshness === 'UNKNOWN' ? 'UNKNOWN' : rowFreshness;

  if (row.providerVerified !== undefined && safeText(row.providerVerified, 80) !== providerVerified) {
    // preserve only the caller-attested normalized observation; caller may omit raw values and let evidence bind them
  }
  if (row.modelVerified !== undefined && safeText(row.modelVerified, 120) !== modelVerified) {
    // preserve only the caller-attested normalized observation; caller may omit raw values and let evidence bind them
  }

  const normalized = Object.freeze({
    agentId,
    agentName,
    taskId,
    taskLabel,
    taskState: effectiveTaskState,
    coordinatorMode: effectiveCoordinatorMode,
    providerRequested,
    providerVerified,
    modelRequested,
    modelVerified,
    providerEvidence,
    modelEvidence,
    coordinatorEvidence,
    taskUrl,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    evidenceUrl,
    evidenceType: evidenceType || 'unknown',
    blocker,
    nextAction,
    ownerDecisionRequired: row.ownerDecisionRequired,
    ownerDecisionReason,
    freshness: effectiveFreshness
  });
  return normalized;
}

function ensureFiniteClock(value, label = 'clock') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function readClock(options = {}) {
  if (!isPlainObject(options) || !Object.hasOwn(options, 'now')) {
    throw new TypeError('Invalid injected clock');
  }
  if (typeof options.now !== 'function') {
    throw new TypeError('Invalid injected clock');
  }
  let value;
  try {
    value = options.now();
  } catch {
    throw new TypeError('Invalid injected clock');
  }
  ensureFiniteClock(value, 'injected clock');
  return value;
}

export function normalizeM11AgentStatus(input, options = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError('M11 agent status input must be a plain object');
  }
  if (isProxy(input)) {
    throw new TypeError('M11 agent status input must be a plain object');
  }
  const schemaDescriptor = Object.getOwnPropertyDescriptor(input, 'schemaVersion');
  const rowsDescriptor = Object.getOwnPropertyDescriptor(input, 'rows');
  if (!schemaDescriptor || !rowsDescriptor || !Object.hasOwn(input, 'schemaVersion') || !Object.hasOwn(input, 'rows')) {
    throw new TypeError('M11 agent status must contain schemaVersion and rows');
  }
  if (input.schemaVersion !== 1) {
    throw new TypeError('Unsupported M11 agent status schemaVersion');
  }

  const rowsValue = rowsDescriptor.value;
  if (!exactArray(rowsValue) || rowsValue.length === 0 || rowsValue.length > 50) {
    throw new TypeError('M11 agent status rows must be a non-empty array up to 50 items');
  }

  const nowMs = readClock(options);
  const rows = [];
  for (let index = 0; index < rowsValue.length; index += 1) {
    rows.push(validateRow(rowsValue[index], nowMs));
  }

  const uniqueKeys = new Set();
  for (const row of rows) {
    const key = `${row.agentId}|${row.taskId}`;
    if (uniqueKeys.has(key)) {
      throw new TypeError('Duplicate agent/task row identity is not allowed');
    }
    uniqueKeys.add(key);
  }

  const freshness = rows.every(row => row.freshness === 'CURRENT')
    ? 'CURRENT'
    : rows.some(row => row.freshness === 'STALE')
      ? 'STALE'
      : 'UNKNOWN';

  return Object.freeze({
    schemaVersion: 1,
    status: 'READY',
    freshness,
    rows: Object.freeze(rows)
  });
}

export function validateM11AgentStatusRow(row, nowMs) {
  ensureFiniteClock(nowMs, 'now value');
  return validateRow(row, nowMs);
}

export function deriveM11Freshness(observedAt, expiresAt, nowMs) {
  ensureFiniteClock(nowMs, 'now value');
  return deriveFreshness(observedAt, expiresAt, nowMs);
}

export function validatePublicM11Url(value) {
  return validateGithubUrl(value);
}

export const M11AgentStatusContract = Object.freeze({
  normalizeM11AgentStatus,
  validateM11AgentStatusRow,
  deriveM11Freshness,
  validatePublicM11Url
});

if (typeof globalThis !== 'undefined') {
  globalThis.M11AgentStatusContract = M11AgentStatusContract;
}
