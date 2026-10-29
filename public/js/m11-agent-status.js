const TASK_LABELS = Object.freeze({
  QUEUED: 'Wartend',
  RUNNING: 'Laufend',
  REVIEWING: 'Prüfung',
  BLOCKED: 'Blockiert',
  DONE: 'Erledigt',
  UNKNOWN: 'Unbekannt'
});

const COORDINATOR_LABELS = Object.freeze({
  PREPARATION: 'Vorbereitung',
  PILOT: 'Pilot',
  ACTIVE: 'Aktiv',
  STOPPED: 'Gestoppt',
  UNKNOWN: 'Unbekannt'
});

const FRESHNESS_LABELS = Object.freeze({
  CURRENT: 'Aktuell',
  STALE: 'Veraltet',
  UNKNOWN: 'Unbekannt'
});

const ALLOWED_GITHUB_PATHS = new Set(['issues', 'pull', 'actions', 'commit', 'discussions', 'releases']);
const VALID_EVIDENCE_TYPES = new Set(['github-workflow', 'github-issue', 'github-pr', 'copilot-session', 'manual', 'unknown']);
const SAFE_TEXT_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength || SAFE_TEXT_RE.test(text)) return null;
  return text;
}

function validateGithubUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\x00-\x1F\x7F<>]/.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port || parsed.hostname.toLowerCase() !== 'github.com') return null;
    if (parsed.search) return null;
    const hash = parsed.hash ? parsed.hash.slice(1) : '';
    if (hash && !/^(?:issuecomment|discussioncomment)-\d+$/.test(hash)) return null;
    const path = parsed.pathname.split('/').filter(Boolean);
    if (path.length < 2) return null;
    const [owner, repo, kind, ...rest] = path;
    if (!owner || !repo || owner.includes('.') || repo.includes('.')) return null;
    if (!kind || !ALLOWED_GITHUB_PATHS.has(kind)) return null;
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
  const observed = isoMs(observedAt);
  const expires = isoMs(expiresAt);
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return 'UNKNOWN';
  if (observed === null || expires === null) return 'UNKNOWN';
  if (observed > nowMs) return 'UNKNOWN';
  if (expires <= nowMs) return 'STALE';
  return 'CURRENT';
}

function validateEvidenceBinding(binding, expectedAgentId, expectedTaskId, expectedValue, nowMs) {
  if (binding === null || binding === undefined) return null;
  if (!isPlainObject(binding)) return null;
  const keys = Reflect.ownKeys(binding);
  const expectedKeys = ['agentId', 'taskId', 'value', 'observedAt', 'expiresAt', 'evidenceUrl', 'evidenceType'];
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) {
    return null;
  }
  const agentId = safeText(binding.agentId, 120);
  const taskId = safeText(binding.taskId, 120);
  const value = safeText(binding.value, 200);
  const evidenceType = safeText(binding.evidenceType, 80);
  if (!agentId || !taskId || !value || !evidenceType) return null;
  if (agentId !== expectedAgentId || taskId !== expectedTaskId) return null;
  if (expectedValue !== undefined && value !== expectedValue) {
    return null;
  }
  const evidenceUrl = validateGithubUrl(binding.evidenceUrl);
  if (!evidenceUrl) return null;
  const observedAt = isoMs(binding.observedAt);
  const expiresAt = isoMs(binding.expiresAt);
  if (observedAt === null || expiresAt === null || observedAt > expiresAt) return null;
  if (!VALID_EVIDENCE_TYPES.has(evidenceType)) return null;
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

function validateSerializedStatus(raw, nowMs) {
  if (!isPlainObject(raw)) throw new TypeError('M11 agent status input must be a plain object');
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 2 || !keys.includes('schemaVersion') || !keys.includes('rows')) {
    throw new TypeError('M11 agent status must contain schemaVersion and rows');
  }
  if (raw.schemaVersion !== 1) throw new TypeError('Unsupported M11 agent status schemaVersion');
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new TypeError('Invalid injected clock');
  if (!Array.isArray(raw.rows) || raw.rows.length === 0 || raw.rows.length > 50) {
    throw new TypeError('M11 agent status rows must be a non-empty array up to 50 items');
  }
  const rows = [];
  for (const row of raw.rows) {
    if (!isPlainObject(row)) throw new TypeError('M11 agent status row must be a plain object');
    const rowKeys = Reflect.ownKeys(row);
    const expected = ['agentId','agentName','taskId','taskLabel','taskState','coordinatorMode','providerRequested','providerVerified','modelRequested','modelVerified','providerEvidence','modelEvidence','coordinatorEvidence','taskUrl','observedAt','expiresAt','evidenceUrl','evidenceType','blocker','nextAction','ownerDecisionRequired','ownerDecisionReason'];
    if (rowKeys.length !== expected.length || rowKeys.some(key => typeof key !== 'string' || !expected.includes(key))) {
      throw new TypeError('M11 agent status row field set is invalid');
    }
    const agentId = safeText(row.agentId, 120);
    const agentName = safeText(row.agentName, 120);
    const taskId = safeText(row.taskId, 120);
    const taskLabel = safeText(row.taskLabel, 160);
    if (!agentId || !agentName || !taskId || !taskLabel) throw new TypeError('Agent and task identity are required');
    if (!['QUEUED','RUNNING','REVIEWING','BLOCKED','DONE','UNKNOWN'].includes(row.taskState)) throw new TypeError('Invalid taskState');
    if (!['PREPARATION','PILOT','ACTIVE','STOPPED','UNKNOWN'].includes(row.coordinatorMode)) throw new TypeError('Invalid coordinatorMode');
    const providerRequested = safeText(row.providerRequested, 80);
    const modelRequested = safeText(row.modelRequested, 120);
    if (!providerRequested || !modelRequested) throw new TypeError('Requested provider and model are required');
    const taskUrl = validateGithubUrl(row.taskUrl);
    if (!taskUrl) throw new TypeError('Task URL must be a valid public GitHub URL');
    const observedAt = isoMs(row.observedAt);
    const expiresAt = isoMs(row.expiresAt);
    if (observedAt === null || expiresAt === null || observedAt > expiresAt) throw new TypeError('Observation and expiry timestamps are invalid');
    const evidenceType = safeText(row.evidenceType, 80);
    const evidenceUrl = row.evidenceUrl === null || row.evidenceUrl === undefined ? null : validateGithubUrl(row.evidenceUrl);
    if (evidenceType && !VALID_EVIDENCE_TYPES.has(evidenceType)) throw new TypeError('Evidence type is invalid');
    const freshness = deriveFreshness(row.observedAt, row.expiresAt, nowMs);
    const providerEvidence = validateEvidenceBinding(row.providerEvidence, agentId, taskId, undefined, nowMs);
    const modelEvidence = validateEvidenceBinding(row.modelEvidence, agentId, taskId, undefined, nowMs);
    const coordinatorEvidence = validateEvidenceBinding(row.coordinatorEvidence, agentId, taskId, row.coordinatorMode, nowMs);
    const providerVerified = providerEvidence ? providerEvidence.value : 'UNKNOWN';
    const modelVerified = modelEvidence ? modelEvidence.value : 'UNKNOWN';
    const effectiveCoordinatorMode = row.coordinatorMode === 'ACTIVE' && (!coordinatorEvidence || coordinatorEvidence.value !== 'ACTIVE') ? 'UNKNOWN' : row.coordinatorMode;
    const effectiveTaskState = (row.taskState === 'RUNNING' || row.taskState === 'REVIEWING') && freshness !== 'CURRENT' ? 'UNKNOWN' : row.taskState;
    const blocker = row.blocker === null || row.blocker === undefined ? null : safeText(row.blocker, 200);
    const nextAction = safeText(row.nextAction, 200);
    if (!nextAction) throw new TypeError('Next action is required');
    const ownerDecisionRequired = row.ownerDecisionRequired === true || row.ownerDecisionRequired === false;
    if (!ownerDecisionRequired) throw new TypeError('ownerDecisionRequired must be a boolean');
    const ownerDecisionReason = row.ownerDecisionRequired === true
      ? safeText(row.ownerDecisionReason, 200)
      : (row.ownerDecisionReason === null || row.ownerDecisionReason === undefined ? null : safeText(row.ownerDecisionReason, 200));
    if (row.ownerDecisionRequired === true && (!ownerDecisionReason || ownerDecisionReason.length === 0)) {
      throw new TypeError('An owner decision reason is required when ownerDecisionRequired is true');
    }
    if (row.ownerDecisionRequired === false && ownerDecisionReason !== null) {
      throw new TypeError('A false ownerDecisionRequired must not include a reason');
    }
    rows.push(Object.freeze({
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
      freshness
    }));
  }
  const normalized = {schemaVersion: 1, status: 'READY', freshness: rows.every(r => r.freshness === 'CURRENT') ? 'CURRENT' : rows.some(r => r.freshness === 'STALE') ? 'STALE' : 'UNKNOWN', rows: Object.freeze(rows)};
  return Object.freeze(normalized);
}

function node(doc, tag, text) {
  const element = doc.createElement(tag);
  if (text !== undefined && text !== null) {
    element.textContent = String(text);
  }
  return element;
}

function appendMetaList(parent, entries) {
  for (const [label, value] of entries) {
    const row = node(parent.ownerDocument, 'div');
    row.className = 'm11-agent-status__meta-row';
    const labelNode = node(parent.ownerDocument, 'span', label);
    labelNode.className = 'm11-agent-status__meta-label';
    const valueNode = node(parent.ownerDocument, 'span', value);
    valueNode.className = 'm11-agent-status__meta-value';
    row.append(labelNode, valueNode);
    parent.append(row);
  }
}

function renderRow(document, row) {
  const card = node(document, 'article');
  card.className = 'm11-agent-status__card';
  card.setAttribute('data-task-state', row.taskState);
  card.setAttribute('data-freshness', row.freshness);

  const heading = node(document, 'div');
  heading.className = 'm11-agent-status__heading';
  const title = node(document, 'h3', `${row.agentName} · ${row.taskLabel}`);
  title.className = 'm11-agent-status__title';
  const badge = node(document, 'span', TASK_LABELS[row.taskState] || 'Unbekannt');
  badge.className = 'm11-agent-status__badge';
  heading.append(title, badge);
  card.append(heading);

  const meta = node(document, 'div');
  meta.className = 'm11-agent-status__meta';
  appendMetaList(meta, [
    ['Agent', row.agentId],
    ['Aufgabe', row.taskId],
    ['Status', TASK_LABELS[row.taskState] || 'Unbekannt'],
    ['Koordinator', COORDINATOR_LABELS[row.coordinatorMode] || 'Unbekannt'],
    ['Frische', FRESHNESS_LABELS[row.freshness] || 'Unbekannt'],
    ['Anbieter angefragt', safeText(row.providerRequested, 80) || 'Unbekannt'],
    ['Anbieter verifiziert', safeText(row.providerVerified, 80) || 'Unbekannt'],
    ['Modell angefragt', safeText(row.modelRequested, 120) || 'Unbekannt'],
    ['Modell verifiziert', safeText(row.modelVerified, 120) || 'Unbekannt']
  ]);
  card.append(meta);

  const links = node(document, 'div');
  links.className = 'm11-agent-status__links';
  const taskLink = node(document, 'a', 'Aufgabe öffnen');
  taskLink.href = row.taskUrl;
  taskLink.className = 'm11-agent-status__link';
  taskLink.rel = 'noreferrer noopener';
  taskLink.target = '_blank';
  links.append(taskLink);
  if (row.evidenceUrl) {
    const evidenceLink = node(document, 'a', 'Beleg öffnen');
    evidenceLink.href = row.evidenceUrl;
    evidenceLink.className = 'm11-agent-status__link';
    evidenceLink.rel = 'noreferrer noopener';
    evidenceLink.target = '_blank';
    links.append(evidenceLink);
  }
  card.append(links);

  const details = node(document, 'div');
  details.className = 'm11-agent-status__details';
  const summary = node(document, 'div');
  summary.className = 'm11-agent-status__summary';
  summary.textContent = `Blocker: ${row.blocker === null ? '—' : row.blocker} · Nächste Aktion: ${row.nextAction || 'Keine weitere Aktion angegeben'}`;
  details.append(summary);

  const noteList = node(document, 'ul');
  noteList.className = 'm11-agent-status__notes';
  const observed = node(document, 'li', `Beobachtet: ${row.observedAt}`);
  const expires = node(document, 'li', `Gültig bis: ${row.expiresAt}`);
  const evidence = node(document, 'li', `Beleg: ${row.evidenceType || 'unknown'}`);
  noteList.append(observed, expires, evidence);
  details.append(noteList);

  if (row.ownerDecisionRequired) {
    const owner = node(document, 'p', `Entscheidung erforderlich: ${row.ownerDecisionReason || 'Unbekannt'}`);
    owner.className = 'm11-agent-status__owner-decision';
    details.append(owner);
  }
  card.append(details);
  return card;
}

export function renderM11AgentStatus(root, input, options = {}) {
  if (!root || typeof root !== 'object') {
    throw new TypeError('M11 agent status root element is required');
  }
  const document = root.ownerDocument || (typeof globalThis.document !== 'undefined' ? globalThis.document : null);
  if (!document) {
    throw new TypeError('M11 agent status rendering requires a document');
  }
  if (typeof input !== 'string') {
    throw new TypeError('M11 agent status renderer expects a JSON string');
  }
  if (typeof options.now !== 'function') {
    throw new TypeError('M11 agent status requires a valid injected clock');
  }
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new TypeError('M11 agent status payload is not valid JSON');
  }
  const nowMs = options.now();
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError('Invalid injected clock');
  }
  const normalized = validateSerializedStatus(parsed, nowMs);
  root.replaceChildren();
  const section = node(document, 'section');
  section.className = 'm11-agent-status';
  section.setAttribute('data-status', normalized.freshness);
  section.setAttribute('aria-live', 'polite');

  const header = node(document, 'div');
  header.className = 'm11-agent-status__header';
  const heading = node(document, 'h2', 'M11 Agent Status');
  heading.className = 'm11-agent-status__header-title';
  const state = node(document, 'span', FRESHNESS_LABELS[normalized.freshness] || 'Unbekannt');
  state.className = 'm11-agent-status__state';
  header.append(heading, state);
  section.append(header);

  const list = node(document, 'div');
  list.className = 'm11-agent-status__list';
  for (const row of normalized.rows) {
    list.append(renderRow(document, row));
  }
  section.append(list);
  root.append(section);
  return section;
}

export function mountM11AgentStatus(target, input, options = {}) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('M11 agent status mount target is required');
  }
  return renderM11AgentStatus(target, input, options);
}

if (typeof globalThis !== 'undefined') {
  globalThis.M11AgentStatus = Object.freeze({
    renderM11AgentStatus,
    mountM11AgentStatus
  });
}
