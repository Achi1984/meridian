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

export const POWERED_BY_PUBLIC_GITHUB = Object.freeze({
  hostnames: Object.freeze(['github.com', 'www.github.com'])
});

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);
const VERIFIED_EVIDENCE_TYPES = new Set(['github-workflow', 'github-issue', 'github-pr', 'copilot-session']);
const SUSPICIOUS_QUERY_KEYS = /(?:^|[?&;])(token|auth|password|passwd|secret|key|sig|signature|session|jwt|access_token|client_secret|authorization)(?:=|$)/i;

function isSafePlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.every(key => typeof key === 'string')
      && Object.values(descriptors).every(descriptor => descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true && descriptor.get === undefined && descriptor.set === undefined);
  } catch {
    return false;
  }
}

function isSafeArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) return false;
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ensureFiniteClock(nowMs, label = 'clock') {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function readClock(options = {}) {
  if (Object.hasOwn(options, 'now') && typeof options.now !== 'function') {
    throw new TypeError('Invalid injected clock');
  }
  const provider = typeof options.now === 'function' ? options.now : Date.now;
  let value;
  try {
    value = provider();
  } catch {
    throw new TypeError('Invalid injected clock');
  }
  ensureFiniteClock(value, 'injected clock');
  return value;
}

function safeText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/.test(text)) {
    return null;
  }
  return text;
}

function safeGitHubUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\x00-\x1F\x7F<>]/.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (!POWERED_BY_PUBLIC_GITHUB.hostnames.includes(host)) return null;
    if (parsed.port) return null;
    const suspiciousQuery = parsed.search && SUSPICIOUS_QUERY_KEYS.test(parsed.search);
    const suspiciousHash = parsed.hash && SUSPICIOUS_QUERY_KEYS.test(parsed.hash);
    if (suspiciousQuery || suspiciousHash) return null;
    const noPublicHost = /(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\.local(?:host)?|\.internal|\.home|\.lan|\.localdomain|\.local$)/i.test(host);
    if (noPublicHost) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo, kind, ...rest] = parts;
    if (!owner || !repo || /\.+$/.test(owner) || /\.+$/.test(repo)) return null;
    const validKinds = new Set(['issues', 'pull', 'actions', 'commit', 'discussions', 'releases', 'compare']);
    if (kind && !validKinds.has(kind)) return null;
    if (!kind) return parsed.href;
    if (kind === 'issues' && rest.length > 1) return null;
    if (kind === 'pull' && rest.length > 1) return null;
    if (kind === 'commit' && rest.length > 1) return null;
    if (kind === 'discussions' && rest.length > 1) return null;
    if (kind === 'releases' && rest.length > 1) return null;
    if (kind === 'actions') {
      if (rest.length === 0) return parsed.href;
      if (rest[0] === 'runs' && rest.length <= 2) return parsed.href;
      return null;
    }
    if (kind === 'compare' && rest.length <= 2) return parsed.href;
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
  if (!Number.isFinite(nowMs)) return 'UNKNOWN';
  if (observed === null || expires === null) return 'UNKNOWN';
  if (observed > nowMs) return 'UNKNOWN';
  if (expires <= nowMs) return 'STALE';
  return 'CURRENT';
}

function validateRow(row, nowMs) {
  ensureFiniteClock(nowMs, 'now value');
  if (!isSafePlainObject(row)) {
    throw new TypeError('M11 agent status row must be a plain object');
  }
  const keys = [
    'agentId', 'agentName', 'taskId', 'taskLabel', 'taskState', 'coordinatorMode',
    'providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
    'taskUrl', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType',
    'blocker', 'nextAction', 'ownerDecisionRequired', 'ownerDecisionReason'
  ];
  const descriptors = Object.getOwnPropertyDescriptors(row);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError('M11 agent status row field set is invalid');
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError(`M11 agent status row field '${key}' is invalid`);
    }
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
    throw new TypeError('Provider verification must match the requested provider or be UNKNOWN');
  }
  if (modelVerified !== 'UNKNOWN' && modelVerified !== modelRequested) {
    throw new TypeError('Model verification must match the requested model or be UNKNOWN');
  }

  const taskUrl = safeGitHubUrl(row.taskUrl);
  if (!taskUrl) {
    throw new TypeError('Task URL must be a valid public GitHub URL');
  }

  const evidenceType = safeText(row.evidenceType, 80);
  const evidenceUrl = row.evidenceUrl === null || row.evidenceUrl === undefined ? null : safeGitHubUrl(row.evidenceUrl);
  if ((providerVerified !== 'UNKNOWN' || modelVerified !== 'UNKNOWN') && (!evidenceUrl || !evidenceType || !VERIFIED_EVIDENCE_TYPES.has(evidenceType))) {
    throw new TypeError('Verified provider/model claims require explicit public GitHub evidence');
  }
  if (evidenceType && !M11_EVIDENCE_TYPES.includes(evidenceType)) {
    throw new TypeError('Evidence type is invalid');
  }
  if (evidenceType === 'manual' || evidenceType === 'unknown') {
    if (providerVerified !== 'UNKNOWN' || modelVerified !== 'UNKNOWN') {
      throw new TypeError('Manual or unknown evidence cannot verify executed provider/model claims');
    }
  }
  if (evidenceUrl === null && (providerVerified !== 'UNKNOWN' || modelVerified !== 'UNKNOWN')) {
    throw new TypeError('Evidence URL is required when provider or model is verified');
  }
  if (evidenceUrl === null && evidenceType) {
    if (evidenceType !== 'unknown' && evidenceType !== 'manual') {
      throw new TypeError('Evidence URL must be supplied for typed evidence');
    }
  }

  const observedAt = isoMs(row.observedAt);
  const expiresAt = isoMs(row.expiresAt);
  if (observedAt === null || expiresAt === null || observedAt > expiresAt) {
    throw new TypeError('Observation and expiry timestamps are invalid');
  }
  const freshness = deriveFreshness(row.observedAt, row.expiresAt, nowMs);

  const blocker = row.blocker === null || row.blocker === undefined ? null : safeText(row.blocker, 200);
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
  if (!isSafePlainObject(input)) {
    throw new TypeError('M11 agent status input must be a plain object');
  }
  const currentKeys = Object.keys(input);
  if (currentKeys.length !== 2 || !currentKeys.includes('schemaVersion') || !currentKeys.includes('rows')) {
    throw new TypeError('M11 agent status must contain schemaVersion and rows');
  }
  if (input.schemaVersion !== 1) {
    throw new TypeError('Unsupported M11 agent status schemaVersion');
  }

  const now = readClock(options);
  const rows = Array.isArray(input.rows) ? input.rows : null;
  if (!rows || rows.length === 0 || rows.length > 50 || !isSafeArray(rows)) {
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
  ensureFiniteClock(nowMs, 'now value');
  return validateRow(row, nowMs);
}

export function deriveM11Freshness(observedAt, expiresAt, nowMs = Date.now()) {
  ensureFiniteClock(nowMs, 'now value');
  return deriveFreshness(observedAt, expiresAt, nowMs);
}

export function validatePublicM11Url(value) {
  return safeGitHubUrl(value);
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
