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

const ALLOWED_PUBLIC_GITHUB_PATHS = new Set(['issues', 'pull', 'actions', 'commit', 'discussions', 'releases']);
const SAFE_TEXT_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/;
const ROW_KEYS = [
  'agentId', 'agentName', 'taskId', 'taskLabel', 'taskState', 'coordinatorMode',
  'providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
  'providerEvidence', 'modelEvidence', 'coordinatorEvidence',
  'taskUrl', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType',
  'blocker', 'nextAction', 'ownerDecisionRequired', 'ownerDecisionReason'
];
const ROW_KEYS_WITH_FRESHNESS = [...ROW_KEYS, 'freshness'];
const EVIDENCE_KEYS = ['agentId', 'taskId', 'value', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType'];
const EVIDENCE_KEYS_WITH_FRESHNESS = [...EVIDENCE_KEYS, 'freshness'];

function isProxy(value) {
  return Boolean(utilTypes && typeof utilTypes.isProxy === 'function' && utilTypes.isProxy(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function readOwnDataValue(obj, key) {
  if (!isPlainObject(obj)) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) {
    return undefined;
  }
  return descriptor.value;
}

function readRequiredOwnData(obj, key, label) {
  if (!isPlainObject(obj)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) {
    throw new TypeError(`${label} must be an own enumerable data property`);
  }
  return descriptor.value;
}

function hasExactDataKeys(obj, expectedKeys) {
  if (!isPlainObject(obj) && !Array.isArray(obj)) {
    return false;
  }
  const keys = Reflect.ownKeys(obj);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) {
    return false;
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) {
      return false;
    }
  }
  return true;
}

function isExactArray(value) {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
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
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function ensureFiniteClock(value, label = 'clock') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function readClock(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError('Invalid injected clock');
  }
  const ownNow = Object.getOwnPropertyDescriptor(options, 'now');
  if (!ownNow || typeof ownNow.value !== 'function') {
    throw new TypeError('Invalid injected clock');
  }
  let value;
  try {
    value = ownNow.value.call(options);
  } catch {
    throw new TypeError('Invalid injected clock');
  }
  ensureFiniteClock(value, 'injected clock');
  return value;
}

function safeText(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!text || text.length > maxLength || SAFE_TEXT_RE.test(text)) {
    return null;
  }
  return text;
}

function validateGithubUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!text || /[\x00-\x1F\x7F<>]/.test(text)) {
    return null;
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port || parsed.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    if (parsed.search) return null;
    const hash = parsed.hash ? parsed.hash.slice(1) : '';
    if (hash && !/^(?:issuecomment|discussioncomment)-\d+$/.test(hash)) {
      return null;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo, kind, ...rest] = parts;
    if (!owner || !repo || owner.includes('.') || repo.includes('.')) {
      return null;
    }
    if (!kind || !ALLOWED_PUBLIC_GITHUB_PATHS.has(kind)) {
      return null;
    }
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

function validateEvidenceBinding(binding, expectedAgentId, expectedTaskId, expectedMode, nowMs) {
  if (binding === null || binding === undefined) {
    return null;
  }
  if (!isPlainObject(binding)) {
    return null;
  }
  const bindingKeys = Reflect.ownKeys(binding);
  const expectedBindingKeys = bindingKeys.length === EVIDENCE_KEYS_WITH_FRESHNESS.length ? EVIDENCE_KEYS_WITH_FRESHNESS : EVIDENCE_KEYS;
  if (!hasExactDataKeys(binding, expectedBindingKeys)) {
    throw new TypeError('M11 evidence binding must use exact data properties');
  }
  const agentId = safeText(readOwnDataValue(binding, 'agentId'), 120);
  const taskId = safeText(readOwnDataValue(binding, 'taskId'), 120);
  const value = safeText(readOwnDataValue(binding, 'value'), 200);
  const evidenceType = safeText(readOwnDataValue(binding, 'evidenceType'), 80);
  const evidenceUrl = validateGithubUrl(readOwnDataValue(binding, 'evidenceUrl'));
  if (!agentId || !taskId || !value || !evidenceType || !evidenceUrl) {
    return null;
  }
  if (agentId !== expectedAgentId || taskId !== expectedTaskId) {
    return null;
  }
  if (expectedMode && value !== expectedMode) {
    return null;
  }
  if (!M11_EVIDENCE_TYPES.includes(evidenceType)) {
    return null;
  }
  const observedAt = isoMs(readOwnDataValue(binding, 'observedAt'));
  const expiresAt = isoMs(readOwnDataValue(binding, 'expiresAt'));
  if (observedAt === null || expiresAt === null || observedAt > expiresAt) {
    return null;
  }
  const bindingFreshness = readOwnDataValue(binding, 'freshness');
  const freshness = deriveFreshness(readOwnDataValue(binding, 'observedAt'), readOwnDataValue(binding, 'expiresAt'), nowMs);
  if (bindingFreshness !== undefined && bindingFreshness !== null && !['CURRENT', 'STALE', 'UNKNOWN'].includes(bindingFreshness)) {
    throw new TypeError('M11 evidence binding freshness must be CURRENT, STALE, or UNKNOWN');
  }
  if (freshness === 'UNKNOWN') {
    return null;
  }
  if (evidenceType === 'manual' || evidenceType === 'unknown') {
    return null;
  }
  return Object.freeze({
    agentId,
    taskId,
    value,
    observedAt: readOwnDataValue(binding, 'observedAt'),
    expiresAt: readOwnDataValue(binding, 'expiresAt'),
    evidenceUrl,
    evidenceType,
    freshness
  });
}

function validateRow(row, nowMs) {
  ensureFiniteClock(nowMs, 'now value');
  if (!isPlainObject(row)) {
    throw new TypeError('M11 agent status row must be a plain object');
  }
  const rowKeys = Reflect.ownKeys(row);
  const exactKeys = rowKeys.length === ROW_KEYS_WITH_FRESHNESS.length ? ROW_KEYS_WITH_FRESHNESS : ROW_KEYS;
  if (!hasExactDataKeys(row, exactKeys)) {
    throw new TypeError('M11 agent status row field set is invalid');
  }
  if (Object.prototype.hasOwnProperty.call(row, 'freshness') && !M11_FRESHNESS_STATES.includes(row.freshness)) {
    throw new TypeError('M11 agent status row freshness must be CURRENT, STALE, or UNKNOWN');
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
  const providerVerifiedRaw = safeText(row.providerVerified, 80);
  const modelVerifiedRaw = safeText(row.modelVerified, 120);
  if (!providerRequested || !modelRequested) {
    throw new TypeError('Requested provider and model are required');
  }
  if (providerVerifiedRaw === null || modelVerifiedRaw === null) {
    throw new TypeError('Provider and model verification values must be strings or UNKNOWN');
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
  const allowedEvidenceType = safeText(row.evidenceType, 80);
  if (allowedEvidenceType && !M11_EVIDENCE_TYPES.includes(allowedEvidenceType)) {
    throw new TypeError('Evidence type is invalid');
  }

  const providerEvidence = validateEvidenceBinding(row.providerEvidence, agentId, taskId, undefined, nowMs);
  const modelEvidence = validateEvidenceBinding(row.modelEvidence, agentId, taskId, undefined, nowMs);
  const coordinatorEvidence = validateEvidenceBinding(row.coordinatorEvidence, agentId, taskId, row.coordinatorMode, nowMs);

  const evidenceFreshnesses = [providerEvidence && providerEvidence.freshness, modelEvidence && modelEvidence.freshness, coordinatorEvidence && coordinatorEvidence.freshness].filter(Boolean);
  const outerFreshness = deriveFreshness(row.observedAt, row.expiresAt, nowMs);
  const rowFreshness = evidenceFreshnesses.length === 0 ? 'UNKNOWN'
    : outerFreshness === 'STALE' || evidenceFreshnesses.includes('STALE') ? 'STALE'
      : outerFreshness === 'UNKNOWN' ? 'UNKNOWN'
        : 'CURRENT';
  const providerVerified = (rowFreshness === 'CURRENT' && providerEvidence) ? providerEvidence.value : 'UNKNOWN';
  const modelVerified = (rowFreshness === 'CURRENT' && modelEvidence) ? modelEvidence.value : 'UNKNOWN';

  const effectiveTaskState = row.taskState === 'RUNNING' || row.taskState === 'REVIEWING'
    ? ((rowFreshness === 'CURRENT' && (providerEvidence || modelEvidence)) ? row.taskState : 'UNKNOWN')
    : row.taskState;
  const effectiveCoordinatorMode = row.coordinatorMode === 'ACTIVE'
    ? ((rowFreshness === 'CURRENT' && coordinatorEvidence && coordinatorEvidence.value === 'ACTIVE') ? row.coordinatorMode : 'UNKNOWN')
    : row.coordinatorMode;

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

  return Object.freeze({
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
    evidenceUrl: row.evidenceUrl === null || row.evidenceUrl === undefined ? null : validateGithubUrl(row.evidenceUrl),
    evidenceType: allowedEvidenceType || 'unknown',
    blocker,
    nextAction,
    ownerDecisionRequired: row.ownerDecisionRequired,
    ownerDecisionReason,
    freshness: rowFreshness
  });
}

export function normalizeM11AgentStatus(input, options = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError('M11 agent status input must be a plain object');
  }
  const topKeys = Reflect.ownKeys(input);
  const allowedTopKeys = new Set(['schemaVersion', 'rows']);
  const fullTopKeys = new Set(['schemaVersion', 'status', 'freshness', 'rows']);
  const isMinimalInput = topKeys.length === 2 && topKeys.every(key => allowedTopKeys.has(key));
  const isSerializedInput = topKeys.length === 4 && topKeys.every(key => fullTopKeys.has(key));
  if (!isMinimalInput && !isSerializedInput) {
    throw new TypeError('M11 agent status must contain schemaVersion and rows');
  }

  const schemaDesc = Object.getOwnPropertyDescriptor(input, 'schemaVersion');
  const rowsDesc = Object.getOwnPropertyDescriptor(input, 'rows');
  if (!schemaDesc || !Object.prototype.hasOwnProperty.call(schemaDesc, 'value') || schemaDesc.enumerable !== true || schemaDesc.get !== undefined || schemaDesc.set !== undefined) {
    throw new TypeError('M11 agent status schemaVersion must be a plain data property');
  }
  if (!rowsDesc || !Object.prototype.hasOwnProperty.call(rowsDesc, 'value') || rowsDesc.enumerable !== true || rowsDesc.get !== undefined || rowsDesc.set !== undefined) {
    throw new TypeError('M11 agent status rows must be a plain data property');
  }

  const schemaValue = schemaDesc.value;
  const rowsValue = rowsDesc.value;
  const statusDesc = Object.getOwnPropertyDescriptor(input, 'status');
  const freshnessDesc = Object.getOwnPropertyDescriptor(input, 'freshness');
  const statusValue = Object.prototype.hasOwnProperty.call(input, 'status') ? readRequiredOwnData(input, 'status', 'M11 agent status status') : undefined;
  const freshnessValue = Object.prototype.hasOwnProperty.call(input, 'freshness') ? readRequiredOwnData(input, 'freshness', 'M11 agent status freshness') : undefined;
  if (Object.prototype.hasOwnProperty.call(input, 'status') && (!statusDesc || !Object.prototype.hasOwnProperty.call(statusDesc, 'value') || statusDesc.enumerable !== true || statusDesc.get !== undefined || statusDesc.set !== undefined)) {
    throw new TypeError('M11 agent status status must be a plain data property');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'freshness') && (!freshnessDesc || !Object.prototype.hasOwnProperty.call(freshnessDesc, 'value') || freshnessDesc.enumerable !== true || freshnessDesc.get !== undefined || freshnessDesc.set !== undefined)) {
    throw new TypeError('M11 agent status freshness must be a plain data property');
  }
  if (schemaValue !== 1) {
    throw new TypeError('Unsupported M11 agent status schemaVersion');
  }
  if (statusValue !== undefined && statusValue !== 'READY') {
    throw new TypeError('Invalid M11 agent status status');
  }
  if (freshnessValue !== undefined && !M11_FRESHNESS_STATES.includes(freshnessValue)) {
    throw new TypeError('Invalid M11 agent status freshness');
  }
  if (!isExactArray(rowsValue) || rowsValue.length === 0 || rowsValue.length > 50) {
    throw new TypeError('M11 agent status rows must be a non-empty array up to 50 items');
  }

  const nowMs = readClock(options);
  const rows = [];
  for (let index = 0; index < rowsValue.length; index += 1) {
    const row = rowsValue[index];
    if (isProxy(row) || !isPlainObject(row)) {
      throw new TypeError('M11 agent status row must be a plain object');
    }
    rows.push(validateRow(row, nowMs));
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
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError('Invalid injected clock');
  }
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
