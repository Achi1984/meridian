import {createHash} from 'node:crypto';
import {types} from 'node:util';

const ROOT = 'https://api.github.com/repos/Achi1984/meridian';
const MAILBOX = `${ROOT}/issues/942`;
const COMMENTS = `${MAILBOX}/comments`;
const NUMERIC_COMMENTS = 'https://api.github.com/repositories/1342084551/issues/942/comments';
const REPOSITORY = 'Achi1984/meridian';
const MARKER = 'meridian-m11-receipt:v1';
const RECEIPT_KEYS = ['actionKey', 'executionKey', 'reviewRequestId', 'sessionId', 'repository',
  'pullRequest', 'headSha', 'baseSha', 'diffDigest', 'completionState', 'verdict'];
const INTENT_KEYS = ['version', 'receipt', 'publisher', 'posting', 'validUntilMs', 'canonicalBodyHash'];
const need = value => { if (!value) throw new Error('RECEIPT_EVIDENCE_REJECTED'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;
const decimal = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && value.length > 0
  && value.isWellFormed() && Buffer.byteLength(value) <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
const encoded = value => Buffer.from(value).toString('base64url');
const canonical = value => JSON.stringify(value);

function record(input, keys) {
  need(input && typeof input === 'object' && !types.isProxy(input)
    && Object.getPrototypeOf(input) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  need(Reflect.ownKeys(descriptors).length === keys.length
    && keys.every(key => Object.hasOwn(descriptors, key)
      && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable));
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function receipt(input) {
  const value = record(input, RECEIPT_KEYS);
  need(['actionKey', 'executionKey', 'reviewRequestId', 'sessionId'].every(key => identifier(value[key]))
    && value.repository === REPOSITORY && positive(value.pullRequest)
    && typeof value.headSha === 'string' && /^[a-f0-9]{40}$/.test(value.headSha)
    && typeof value.baseSha === 'string' && /^[a-f0-9]{40}$/.test(value.baseSha)
    && digest(value.diffDigest)
    && ((value.completionState === 'COMPLETE' && value.verdict === 'GREEN_LIGHT')
      || (value.completionState === 'REVISION_REQUIRED' && value.verdict === 'REVISION_REQUIRED')));
  return value;
}

function publisher(input) {
  const value = record(input, ['actorId', 'login', 'type', 'appId']);
  need(decimal(value.actorId) && typeof value.login === 'string'
    && /^[A-Za-z0-9-]{1,39}(?:\[bot\])?$/.test(value.login)
    && ['Bot', 'User'].includes(value.type) && (value.appId === null || decimal(value.appId)));
  return value;
}

function describe(input, includeHash) {
  const value = record(input, includeHash ? INTENT_KEYS : INTENT_KEYS.slice(0, -1));
  need(value.version === 1);
  value.receipt = receipt(value.receipt);
  value.publisher = publisher(value.publisher);
  value.posting = record(value.posting, ['kind', 'transitionId', 'fence', 'committedAtMs']);
  need(value.posting.kind === 'RECEIPT_POSTING' && identifier(value.posting.transitionId)
    && identifier(value.posting.fence) && positive(value.posting.committedAtMs)
    && positive(value.validUntilMs) && value.validUntilMs > value.posting.committedAtMs
    && value.validUntilMs - value.posting.committedAtMs <= 900000);
  const core = Object.fromEntries(INTENT_KEYS.slice(0, -1).map(key => [key, value[key]]));
  const intentHash = hash(canonical(core));
  const payload = encoded(canonical(value.receipt));
  const body = `M11 coordinator receipt v1\nExecution: ${encoded(value.receipt.executionKey)}\n`
    + `Receipt: ${payload}\n<!-- ${MARKER}:${intentHash}:${hash(payload)} -->`;
  need(Buffer.byteLength(body) <= 8192);
  const canonicalBodyHash = hash(body);
  if (includeHash) need(value.canonicalBodyHash === canonicalBodyHash);
  return {intent: {...core, canonicalBodyHash}, body, intentHash};
}

// Pure serialization only: this neither persists intent nor issues authorization.
export function canonicalizeM11ReceiptIntent(draft) {
  return describe(draft, false);
}

function commentId(value) {
  if (positive(value)) return String(value);
  need(decimal(value));
  return value;
}

function timestamp(value) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value));
  const result = Date.parse(value);
  need(Number.isFinite(result) && new Date(result).toISOString() === value.replace('Z', '.000Z'));
  return result;
}

function comment(raw, expected, nowMs, authoritative) {
  need(raw && typeof raw === 'object' && !Array.isArray(raw));
  const id = commentId(raw.id);
  need(raw.url === `${ROOT}/issues/comments/${id}` && raw.issue_url === MAILBOX
    && raw.html_url === `https://github.com/Achi1984/meridian/issues/942#issuecomment-${id}`
    && typeof raw.body === 'string' && Buffer.byteLength(raw.body) <= 65536);
  const created = timestamp(raw.created_at);
  const updated = timestamp(raw.updated_at);
  need(updated >= created && updated <= nowMs);
  if (authoritative) {
    const {intent, body} = expected;
    const actor = intent.publisher;
    need(raw.body === body && hash(raw.body) === intent.canonicalBodyHash
      && commentId(raw.user?.id) === actor.actorId
      && raw.user?.login === actor.login && raw.user?.type === actor.type
      && (actor.appId === null ? raw.performed_via_github_app === null
        : commentId(raw.performed_via_github_app?.id) === actor.appId)
      && raw.created_at === raw.updated_at
      && (raw.edited_at === undefined || raw.edited_at === null)
      && created >= Math.floor(intent.posting.committedAtMs / 1000) * 1000
      && created <= intent.validUntilMs);
  }
  return id;
}

function authSnapshot(evidence, actor, nowMs) {
  const value = record(evidence, ['evidenceId', 'principal', 'host', 'scheme', 'tls',
    'actorId', 'appId', 'verifiedAtMs', 'expiresAtMs']);
  need(identifier(value.evidenceId) && identifier(value.principal)
    && value.host === 'api.github.com' && value.scheme === 'https' && value.tls === true
    && decimal(value.actorId) && (value.appId === null || decimal(value.appId))
    && (!actor || (value.actorId === actor.actorId && value.appId === actor.appId))
    && positive(value.verifiedAtMs) && value.verifiedAtMs <= nowMs
    && positive(value.expiresAtMs) && value.expiresAtMs > nowMs
    && value.expiresAtMs > value.verifiedAtMs
    && value.expiresAtMs - value.verifiedAtMs <= 900000);
  return value;
}

function nextPage(headers, page) {
  const link = headers.get('link');
  if (link === null) return {next: false, last: null};
  need(typeof link === 'string' && link.length <= 4096 && link.length > 0);
  const relations = new Set();
  let next = false;
  let last = null;
  for (const part of link.split(',')) {
    const match = /^<([^>]+)>;\s*rel="(next|prev|first|last)"$/.exec(part.trim());
    need(match && !relations.has(match[2]));
    relations.add(match[2]);
    const url = new URL(match[1]);
    const target = url.searchParams.get('page');
    need(/^[1-9][0-9]*$/.test(target) && positive(Number(target))
      && [COMMENTS, NUMERIC_COMMENTS].some(resource =>
        match[1] === `${resource}?per_page=100&page=${target}`));
    const number = Number(target);
    if (match[2] === 'next') { need(number === page + 1); next = true; }
    if (match[2] === 'prev') need(page > 1 && number === page - 1);
    if (match[2] === 'first') need(number === 1);
    if (match[2] === 'last') { need(number >= page); last = number; }
  }
  // A last page beyond this page without a next link is truncated.
  if (last !== null) need(next ? last > page : last === page);
  return {next, last};
}

export function createM11CoordinatorGithubReceiptApi({
  enabled = false,
  fetchImpl,
  now = Date.now,
  credentials,
  getTrustedAuthEvidence,
  intentStore,
  authorizationAuthority,
  publicationEvidenceStore,
  defaultDeadlineMs = 4500,
  maxResponseBytes = 131072,
  maxTotalBytes = 1048576,
  maxPages = 10
} = {}) {
  need(typeof now === 'function'
    && positive(defaultDeadlineMs) && defaultDeadlineMs <= 10000
    && positive(maxResponseBytes) && maxResponseBytes <= 1048576
    && positive(maxTotalBytes) && maxTotalBytes <= 4194304
    && positive(maxPages) && maxPages <= 20);
  // Endpoints are private constants, not caller-configurable capabilities.
  let consumed = false;

  async function operation(signal, work) {
    need(enabled === true && typeof fetchImpl === 'function'
      && typeof credentials?.getAuthorizationHeader === 'function'
      && typeof getTrustedAuthEvidence === 'function'
      && typeof intentStore?.getPublicationIntent === 'function');
    const controller = new AbortController();
    const started = now();
    const snapshot = authSnapshot(getTrustedAuthEvidence(), null, started);
    const header = credentials.getAuthorizationHeader();
    need(typeof header === 'string' && /^[\x21-\x7e ]{1,2048}$/.test(header) && header.trim().length > 0);
    let timer;
    let stop;
    const deadline = new Promise((_, reject) => {
      stop = () => { controller.abort(); reject(new Error('RECEIPT_DEADLINE')); };
      timer = setTimeout(stop, defaultDeadlineMs);
      signal?.addEventListener('abort', stop, {once: true});
      if (signal?.aborted) stop();
    });
    const check = () => {
      need(!controller.signal.aborted && now() >= started && now() - started < defaultDeadlineMs);
    };
    try {
      return await Promise.race([Promise.resolve().then(() => {
        check();
        return work({signal: controller.signal, check, snapshot, header});
      }), deadline]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      controller.abort();
    }
  }

  async function resolve(actionKey, scope) {
    need(identifier(actionKey));
    const stored = await intentStore.getPublicationIntent({executionKey: actionKey, signal: scope.signal});
    scope.check();
    const expected = describe(stored, true);
    need(expected.intent.receipt.executionKey === actionKey);
    return expected;
  }

  function transport(expected, scope) {
    const {snapshot, header} = scope;
    let total = 0;
    const check = () => {
      scope.check();
      need(canonical(authSnapshot(getTrustedAuthEvidence(), expected.intent.publisher, now()))
        === canonical(snapshot) && credentials.getAuthorizationHeader() === header);
    };
    check();
    async function request(url, method, body, beforeInvocation = () => {}) {
      check();
      beforeInvocation();
      const response = await fetchImpl(url, {
        method, redirect: 'error', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: scope.signal,
        headers: {accept: 'application/vnd.github+json', authorization: header,
          'content-type': 'application/json', 'x-github-api-version': '2022-11-28'},
        ...(body === undefined ? {} : {body: JSON.stringify({body})})
      });
      let reader;
      const cancel = () => {
        try { Promise.resolve(reader ? reader.cancel() : response?.body?.cancel()).catch(() => {}); } catch {}
      };
      scope.signal.addEventListener('abort', cancel, {once: true});
      try {
        check();
        need(response?.status === (method === 'POST' ? 201 : 200)
          && response.url === url && response.redirected === false
          && response.headers?.get('content-type')?.split(';')[0].trim() === 'application/json');
        const length = response.headers.get('content-length');
        need(length === null || (/^(0|[1-9][0-9]*)$/.test(length)
          && Number(length) <= maxResponseBytes && Number(length) <= maxTotalBytes - total));
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', {fatal: true});
        let text = '';
        let size = 0;
        for (;;) {
          check();
          const {done, value} = await reader.read();
          check();
          if (done) break;
          need(value instanceof Uint8Array);
          size += value.byteLength;
          total += value.byteLength;
          need(size <= maxResponseBytes && total <= maxTotalBytes);
          text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
        check();
        return {value: JSON.parse(text), headers: response.headers};
      } finally {
        scope.signal.removeEventListener('abort', cancel);
        cancel();
        try { reader?.releaseLock(); } catch {}
      }
    }
    return {snapshot, check, request};
  }

  return Object.freeze({
    async postOnce(input) {
      let mayHaveStarted = false;
      try {
        const value = record(input, Object.hasOwn(input ?? {}, 'signal')
          ? ['actionKey', 'executionKey', 'receipt', 'signal'] : ['actionKey', 'executionKey', 'receipt']);
        const payload = receipt(value.receipt);
        need(!consumed && enabled === true && value.actionKey === value.executionKey
          && value.executionKey === payload.executionKey);
        // Local consumption is synchronous, before any durable read or other await.
        consumed = true;
        return await operation(value.signal, async scope => {
          const expected = await resolve(value.actionKey, scope);
          need(canonical(payload) === canonical(expected.intent.receipt)
            && now() >= expected.intent.posting.committedAtMs && now() < expected.intent.validUntilMs
            && typeof authorizationAuthority?.consumePostingAuthorization === 'function');
          const wire = transport(expected, scope);
          const binding = {
            intentHash: expected.intentHash,
            canonicalBodyHash: expected.intent.canonicalBodyHash,
            executionKey: value.executionKey,
            transitionId: expected.intent.posting.transitionId,
            fence: expected.intent.posting.fence,
            evidenceId: wire.snapshot.evidenceId,
            principal: wire.snapshot.principal
          };
          const grant = record(await authorizationAuthority.consumePostingAuthorization({
            ...binding, signal: scope.signal
          }), ['status', 'authorizationId', ...Object.keys(binding), 'issuedAtMs', 'expiresAtMs']);
          wire.check();
          need(grant.status === 'CONSUMED' && identifier(grant.authorizationId)
            && Object.entries(binding).every(([key, item]) => grant[key] === item)
            && positive(grant.issuedAtMs) && grant.issuedAtMs >= expected.intent.posting.committedAtMs
            && grant.issuedAtMs <= now() && positive(grant.expiresAtMs)
            && grant.expiresAtMs > now() && grant.expiresAtMs <= expected.intent.validUntilMs
            && grant.expiresAtMs <= wire.snapshot.expiresAtMs
            && grant.expiresAtMs - grant.issuedAtMs <= 60000);
          const response = await wire.request(COMMENTS, 'POST', expected.body, () => {
            need(now() < grant.expiresAtMs && now() < expected.intent.validUntilMs);
            mayHaveStarted = true;
          });
          wire.check();
          const id = comment(response.value, expected, now(), true);
          return Object.freeze({status: 'CREATED', receiptId: id});
        });
      } catch {
        return Object.freeze({status: mayHaveStarted ? 'UNKNOWN' : 'NOT_ATTEMPTED'});
      }
    },

    async lookupByActionKey(input) {
      try {
        const value = record(input, Object.hasOwn(input ?? {}, 'signal')
          ? ['actionKey', 'signal'] : ['actionKey']);
        return await operation(value.signal, async scope => {
          const expected = await resolve(value.actionKey, scope);
          const wire = transport(expected, scope);
          const requireSendEvidence = async id => {
            need(typeof publicationEvidenceStore?.getPublicationEvidence === 'function');
            wire.check();
            const evidence = record(await publicationEvidenceStore.getPublicationEvidence({
              executionKey: value.actionKey, signal: scope.signal
            }), ['status', 'commentId', 'executionKey', 'intentHash', 'canonicalBodyHash',
              'transitionId', 'fence', 'authorizationId']);
            wire.check();
            need(evidence.status === 'RECORDED' && decimal(evidence.commentId)
              && evidence.commentId === id && evidence.executionKey === value.actionKey
              && evidence.intentHash === expected.intentHash
              && evidence.canonicalBodyHash === expected.intent.canonicalBodyHash
              && evidence.transitionId === expected.intent.posting.transitionId
              && evidence.fence === expected.intent.posting.fence
              && identifier(evidence.authorizationId));
            return canonical(evidence);
          };
          const relevant = raw => raw.body === expected.body
            || raw.body.includes(`Execution: ${encoded(value.actionKey)}`)
            || raw.body.includes(expected.intentHash);
          const scan = async () => {
            const snapshots = new Map();
            const matches = [];
            let previous = 0n;
            let last = null;
            for (let page = 1; page <= maxPages; page++) {
              const {value: rows, headers} = await wire.request(`${COMMENTS}?per_page=100&page=${page}`, 'GET');
              need(Array.isArray(rows) && rows.length <= 100 && (page === 1 || rows.length > 0));
              for (const raw of rows) {
                const id = comment(raw, expected, now(), false);
                need(!snapshots.has(id) && BigInt(id) > previous);
                previous = BigInt(id);
                snapshots.set(id, canonical(raw));
                if (relevant(raw)) {
                  comment(raw, expected, now(), true);
                  matches.push(id);
                }
              }
              const pagination = nextPage(headers, page);
              if (pagination.last !== null) {
                need(last === null || last === pagination.last);
                last = pagination.last;
              }
              if (!pagination.next) {
                need(last === null || last === page);
                return {snapshots: [...snapshots], matches, last};
              }
              need(rows.length === 100 && (last === null || page < last));
            }
            throw new Error('RECEIPT_INVENTORY_INCOMPLETE');
          };
          const first = await scan();
          const sendEvidence = first.matches.length === 1
            ? await requireSendEvidence(first.matches[0]) : null;
          const second = await scan();
          wire.check();
          need(canonical(first) === canonical(second) && first.matches.length <= 1);
          if (sendEvidence !== null) {
            need(await requireSendEvidence(first.matches[0]) === sendEvidence);
          }
          return Object.freeze({status: first.matches.length === 1 ? 'FOUND' : 'NOT_FOUND',
            complete: true, receiptIds: Object.freeze(first.matches)});
        });
      } catch {
        return Object.freeze({status: 'UNKNOWN', complete: false, receiptIds: Object.freeze([])});
      }
    }
  });
}
