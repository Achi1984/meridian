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

function safeText(value, fallback = 'Unbekannt') {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length ? text : fallback;
  }
  return fallback;
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
    ['Anbieter angefragt', safeText(row.providerRequested)],
    ['Anbieter verifiziert', safeText(row.providerVerified, 'Unbekannt')],
    ['Modell angefragt', safeText(row.modelRequested)],
    ['Modell verifiziert', safeText(row.modelVerified, 'Unbekannt')]
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
  const block = row.blocker === null ? '—' : row.blocker;
  const next = row.nextAction || 'Keine weitere Aktion angegeben';
  summary.textContent = `Blocker: ${block} · Nächste Aktion: ${next}`;
  details.append(summary);

  const noteList = node(document, 'ul');
  noteList.className = 'm11-agent-status__notes';
  const observed = node(document, 'li', `Beobachtet: ${row.observedAt}`);
  const expires = node(document, 'li', `Gültig bis: ${row.expiresAt}`);
  const evidence = node(document, 'li', `Beleg: ${row.evidenceType || 'unknown'}`);
  noteList.append(observed, expires, evidence);
  details.append(noteList);

  if (row.ownerDecisionRequired) {
    const owner = node(document, 'p', `Entscheidung erforderlich: ${row.ownerDecisionReason}`);
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

  const normalize = typeof globalThis !== 'undefined' && globalThis.M11AgentStatusContract
    ? globalThis.M11AgentStatusContract.normalizeM11AgentStatus
    : null;
  if (typeof normalize !== 'function') {
    throw new Error('M11 agent status browser contract is unavailable');
  }

  const normalized = normalize(input, {now: typeof options.now === 'function' ? options.now : Date.now});
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
