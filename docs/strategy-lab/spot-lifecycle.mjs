// Pure hypothetical long-spot lifecycle. No I/O, orders, sizing or PnL.
const MAX_IDS = 10000;
const CLOSE_ID_LIMIT = MAX_IDS + 3;
const MAX_QUOTE_AGE_MS = 1000;
const flags = { executionAuthorized: false, researchOnly: true };
const keys = (o, names) => o !== null && typeof o === 'object' &&
  Object.getPrototypeOf(o) === Object.prototype &&
  Object.keys(o).length === names.length && names.every(k => Object.hasOwn(o, k));
const time = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => Number.isFinite(n) && n > 0;
const id = s => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,80}(?![\s\S])/.test(s);
const fail = message => { throw new Error(message); };

export function initialState() {
  return { phase: 'FLAT', lastAt: -1, lastQuoteAt: -1, lastExitAt: -1,
    consumedIds: [], pending: null, position: null, ...flags };
}

function validateState(s) {
  if (!keys(s, ['phase', 'lastAt', 'lastQuoteAt', 'lastExitAt', 'consumedIds',
    'pending', 'position', 'executionAuthorized', 'researchOnly']) ||
    s.executionAuthorized !== false || s.researchOnly !== true ||
    !['FLAT', 'PENDING_ENTRY', 'LONG', 'PENDING_EXIT'].includes(s.phase) ||
    ![s.lastAt, s.lastQuoteAt, s.lastExitAt].every(n => n === -1 || time(n)) ||
    s.lastQuoteAt > s.lastAt || s.lastExitAt > s.lastAt ||
    !Array.isArray(s.consumedIds) || s.consumedIds.length > CLOSE_ID_LIMIT)
    fail('INVALID_STATE');
  const seen = new Set();
  for (const value of s.consumedIds) {
    if (!id(value) || seen.has(value)) fail('INVALID_STATE_IDS');
    seen.add(value);
  }
  if ((s.lastAt === -1) !== (seen.size === 0)) fail('INVALID_INITIAL_STATE');
  const hasPosition = s.phase === 'LONG' || s.phase === 'PENDING_EXIT';
  const hasPending = s.phase === 'PENDING_ENTRY' || s.phase === 'PENDING_EXIT';
  if ((hasPosition && seen.size >= CLOSE_ID_LIMIT) ||
    (s.phase === 'PENDING_ENTRY' && seen.size > MAX_IDS)) fail('INVALID_CLOSE_HEADROOM');
  if (hasPosition) {
    const p = s.position;
    if (!keys(p, ['initialStop', 'entryAsk', 'entryBid', 'entryQuoteAt', 'entryAt',
      'signalAvailableAt', 'signalId']) ||
      ![p.initialStop, p.entryAsk, p.entryBid].every(positive) ||
      p.initialStop >= p.entryBid || p.entryBid > p.entryAsk ||
      ![p.entryQuoteAt, p.entryAt, p.signalAvailableAt].every(time) ||
      p.signalAvailableAt <= s.lastExitAt || p.signalAvailableAt >= p.entryQuoteAt ||
      p.entryQuoteAt > p.entryAt || p.entryAt > s.lastAt ||
      p.entryQuoteAt > s.lastQuoteAt || p.entryAt - p.entryQuoteAt > MAX_QUOTE_AGE_MS ||
      !seen.has(p.signalId)) fail('INVALID_POSITION');
  } else if (s.position !== null) fail('UNEXPECTED_POSITION');
  if (hasPending) {
    const p = s.pending;
    if (!keys(p, ['signalId', 'availableAt', 'receivedAt', 'expiresAt', 'initialStop']) ||
      !seen.has(p.signalId) || ![p.availableAt, p.receivedAt, p.expiresAt].every(time) ||
      p.availableAt > p.receivedAt || p.receivedAt > s.lastAt ||
      p.expiresAt <= s.lastAt ||
      (s.phase === 'PENDING_ENTRY' ? !positive(p.initialStop) ||
        p.availableAt <= s.lastExitAt : p.initialStop !== null ||
        p.availableAt < s.position.entryAt)) fail('INVALID_PENDING');
  } else if (s.pending !== null) fail('UNEXPECTED_PENDING');
}

function validateEvent(e, s) {
  const quote = e?.type === 'QUOTE';
  const entry = e?.type === 'ENTRY_SIGNAL';
  const names = quote ? ['type', 'id', 'at', 'quoteAt', 'bid', 'ask'] :
    ['type', 'id', 'at', 'signalId', 'availableAt', 'expiresAt', ...(entry ? ['initialStop'] : [])];
  if (!keys(e, names) || !['QUOTE', 'ENTRY_SIGNAL', 'EXIT_SIGNAL'].includes(e.type) ||
    !id(e.id) || !time(e.at) || e.at <= s.lastAt) fail('INVALID_EVENT');
  const additions = quote ? [e.id] : [e.id, e.signalId];
  if (additions.some(v => !id(v) || s.consumedIds.includes(v)) ||
    new Set(additions).size !== additions.length) fail('ID_REPLAY_OR_COLLISION');
  if (s.consumedIds.length + additions.length > CLOSE_ID_LIMIT) fail('ID_CAPACITY');
  if (quote) {
    if (!time(e.quoteAt) || e.quoteAt <= s.lastQuoteAt || e.quoteAt > e.at ||
      e.at - e.quoteAt > MAX_QUOTE_AGE_MS || !positive(e.bid) ||
      !positive(e.ask) || e.bid > e.ask || !Number.isFinite(e.ask - e.bid))
      fail('INVALID_QUOTE');
  } else if (!time(e.availableAt) || !time(e.expiresAt) ||
    e.availableAt > e.at || e.expiresAt <= e.at ||
    (entry && (!positive(e.initialStop) || e.availableAt <= s.lastExitAt))) {
    fail('INVALID_SIGNAL');
  }
  return additions;
}

/** Rejections preserve the supplied state. valid means schema/transition accepted only. */
export function transition(state, event) {
  try {
    validateState(state);
    const additions = validateEvent(event, state);
    const s = structuredClone(state);
    const e = event;
    let reason = 'NO_ACTION';
    let fill = null;
    if (s.pending && e.at >= s.pending.expiresAt) {
      if (!s.position) s.lastExitAt = e.at;
      s.phase = s.position ? 'LONG' : 'FLAT';
      s.pending = null;
      reason = 'SIGNAL_EXPIRED';
    }
    const close = (why, signalAvailableAt, signalId) => {
      fill = { side: 'SELL', price: e.bid, reason: why, quoteAt: e.quoteAt,
        receivedAt: e.at, fillAt: e.at, signalAvailableAt, signalId, ...flags };
      s.phase = 'FLAT'; s.position = null; s.pending = null;
      s.lastExitAt = e.at; reason = why;
    };
    if (e.type === 'EXIT_SIGNAL') {
      if (s.position && e.availableAt < s.position.entryAt) fail('EXIT_PREDATES_ENTRY');
      if (s.phase === 'PENDING_ENTRY') {
        s.phase = 'FLAT'; s.pending = null; s.lastExitAt = e.at;
        reason = 'ENTRY_CANCELLED_BY_EXIT';
      } else if (s.position) {
        s.phase = 'PENDING_EXIT';
        s.pending = { signalId: e.signalId, availableAt: e.availableAt,
          receivedAt: e.at, expiresAt: e.expiresAt, initialStop: null };
        reason = 'EXIT_PENDING';
      } else { s.lastExitAt = e.at; reason = 'EXIT_WHILE_FLAT'; }
    } else if (e.type === 'ENTRY_SIGNAL') {
      if (s.phase !== 'FLAT') fail('ENTRY_WHILE_BUSY');
      if (e.availableAt <= s.lastExitAt) fail('ENTRY_BEFORE_BARRIER');
      s.phase = 'PENDING_ENTRY';
      s.pending = { signalId: e.signalId, availableAt: e.availableAt,
        receivedAt: e.at, expiresAt: e.expiresAt, initialStop: e.initialStop };
      reason = 'ENTRY_PENDING';
    } else {
      s.lastQuoteAt = e.quoteAt;
      if (s.position && e.quoteAt > s.position.entryAt && e.bid <= s.position.initialStop) {
        close('STOP', s.position.signalAvailableAt, s.position.signalId);
      } else if (s.phase === 'PENDING_EXIT' && e.quoteAt > s.pending.availableAt) {
        close('EXIT_SIGNAL', s.pending.availableAt, s.pending.signalId);
      } else if (s.phase === 'PENDING_ENTRY' && e.quoteAt > s.pending.availableAt) {
        const p = s.pending;
        if (e.bid <= p.initialStop) {
          s.phase = 'FLAT'; s.pending = null; s.lastExitAt = e.at;
          reason = 'ENTRY_CANCELLED_AT_STOP';
        } else {
          fill = { side: 'BUY', price: e.ask, reason: 'ENTRY_SIGNAL', quoteAt: e.quoteAt,
            receivedAt: e.at, fillAt: e.at, signalAvailableAt: p.availableAt,
            signalId: p.signalId, ...flags };
          s.position = { initialStop: p.initialStop, entryAsk: e.ask, entryBid: e.bid,
            entryQuoteAt: e.quoteAt, entryAt: e.at, signalAvailableAt: p.availableAt,
            signalId: p.signalId };
          s.phase = 'LONG'; s.pending = null; reason = 'ENTRY_FILLED';
        }
      }
    }
    const totalIds = s.consumedIds.length + additions.length;
    if (totalIds > MAX_IDS) {
      const heldBefore = state.phase === 'LONG' || state.phase === 'PENDING_EXIT';
      const reserveClose = heldBefore && fill?.side === 'SELL';
      const reserveExit = heldBefore && e.type === 'EXIT_SIGNAL' && totalIds < CLOSE_ID_LIMIT;
      if (!reserveClose && !reserveExit) fail('CLOSE_ONLY_ID_RESERVE');
    }
    s.lastAt = e.at;
    s.consumedIds.push(...additions);
    validateState(s);
    return { valid: true, state: s, reason, fill, ...flags };
  } catch (error) {
    return { valid: false, state, error: error.message, fill: null, ...flags };
  }
}
