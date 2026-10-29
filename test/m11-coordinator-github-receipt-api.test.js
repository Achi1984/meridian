import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeM11ReceiptIntent,
  createM11CoordinatorGithubReceiptApi
} from '../scripts/autonomy/m11-coordinator-github-receipt-api.mjs';

const ROOT = 'https://api.github.com/repos/Achi1984/meridian';
const COMMENTS = `${ROOT}/issues/942/comments`;
const NOW = 1700000000000;
const clone = value => JSON.parse(JSON.stringify(value));
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');

function draft() {
  return {
    version: 1,
    receipt: {
      actionKey: 'review:logical-action', executionKey: 'review:execution:7001:1',
      reviewRequestId: 'request-1', sessionId: 'session-1',
      repository: 'Achi1984/meridian', pullRequest: 1020,
      headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), diffDigest: 'c'.repeat(64),
      completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'
    },
    publisher: {actorId: '42', login: 'meridian-publisher[bot]', type: 'Bot', appId: '7'},
    posting: {kind: 'RECEIPT_POSTING', transitionId: 'transition-1', fence: 'fence-1', committedAtMs: NOW - 1000},
    validUntilMs: NOW + 60000
  };
}

function response(url, value, {status = 200, headers = {}, body} = {}) {
  return {
    url: String(url), status, redirected: false,
    headers: new Headers({'content-type': 'application/json', ...headers}),
    body: body ?? new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
        controller.close();
      }
    })
  };
}

function fixture(options = {}) {
  const described = canonicalizeM11ReceiptIntent(options.draft ?? draft());
  const state = {
    now: NOW, evidence: {evidenceId: 'evidence-1', principal: 'github-app:7',
      host: 'api.github.com', scheme: 'https', tls: true, actorId: '42', appId: '7',
      verifiedAtMs: NOW - 1000, expiresAtMs: NOW + 60000},
    header: 'fixture-authorization-one', calls: [], rows: [], reads: 0, consumptions: 0
  };
  const binding = {
    intentHash: described.intentHash, canonicalBodyHash: described.intent.canonicalBodyHash,
    executionKey: described.intent.receipt.executionKey,
    transitionId: described.intent.posting.transitionId, fence: described.intent.posting.fence,
    evidenceId: state.evidence.evidenceId, principal: state.evidence.principal
  };
  // The trusted host pre-issues this at the posting transition, not during consume.
  state.authorization = {status: 'CONSUMED', authorizationId: 'authorization-1', ...binding,
    issuedAtMs: NOW - 500, expiresAtMs: NOW + 10000};
  const comment = (id = 101, changes = {}) => ({
    id, url: `${ROOT}/issues/comments/${id}`,
    issue_url: `${ROOT}/issues/942`,
    html_url: `https://github.com/Achi1984/meridian/issues/942#issuecomment-${id}`,
    body: described.body, user: {id: 42, login: 'meridian-publisher[bot]', type: 'Bot'},
    performed_via_github_app: {id: 7}, created_at: iso(NOW), updated_at: iso(NOW),
    ...changes
  });
  const dependencies = {
    enabled: true, now: () => state.now,
    credentials: {getAuthorizationHeader: () => state.header},
    getTrustedAuthEvidence: () => state.evidence,
    intentStore: {async getPublicationIntent({executionKey}) {
      state.reads++;
      assert.equal(executionKey, described.intent.receipt.executionKey);
      return clone(state.intent ?? described.intent);
    }},
    authorizationAuthority: {async consumePostingAuthorization(request) {
      state.consumptions++;
      const {signal, ...received} = request;
      assert.equal(signal.aborted, false);
      assert.deepEqual(received, binding);
      const grant = state.authorization;
      state.authorization = null;
      return grant;
    }},
    fetchImpl: async (url, init) => {
      state.calls.push({url: String(url), ...init});
      if (state.handle) return state.handle(String(url), init);
      if (init.method === 'POST') {
        const row = comment(101, {body: JSON.parse(init.body).body});
        state.rows.push(row);
        return response(url, row, {status: 201});
      }
      return response(url, state.rows);
    }
  };
  const adapter = (overrides = {}) => createM11CoordinatorGithubReceiptApi({...dependencies, ...options, ...overrides});
  const input = {
    actionKey: described.intent.receipt.executionKey, executionKey: described.intent.receipt.executionKey,
    receipt: clone(described.intent.receipt)
  };
  return {state, described, dependencies, adapter, input, comment};
}

function counts(state, post, get) {
  assert.equal(state.calls.filter(call => call.method === 'POST').length, post);
  assert.equal(state.calls.filter(call => call.method === 'GET').length, get);
  for (const call of state.calls) {
    assert.ok(call.url === COMMENTS || /^https:\/\/api\.github\.com\/repos\/Achi1984\/meridian\/issues\/942\/comments\?per_page=100&page=[1-9][0-9]*$/.test(call.url));
    assert.equal(call.redirect, 'error');
    assert.equal(call.credentials, 'omit');
    assert.ok(['GET', 'POST'].includes(call.method));
    if (call.method === 'GET') assert.equal(call.body, undefined);
  }
}

test('default disabled; booleans, tokens and posting state alone grant no authority', async () => {
  const f = fixture();
  assert.deepEqual(await createM11CoordinatorGithubReceiptApi().postOnce(f.input), {status: 'NOT_ATTEMPTED'});
  assert.equal((await f.adapter({enabled: false}).postOnce(f.input)).status, 'NOT_ATTEMPTED');
  assert.equal((await f.adapter({getTrustedAuthEvidence: () => true}).postOnce(f.input)).status, 'NOT_ATTEMPTED');
  assert.equal((await f.adapter({authorizationAuthority: {consumePostingAuthorization: () => true}}).postOnce(f.input)).status, 'NOT_ATTEMPTED');
  f.state.authorization = null;
  assert.equal((await f.adapter().postOnce(f.input)).status, 'NOT_ATTEMPTED');
  counts(f.state, 0, 0);
});

test('exact lifecycle-shaped create and durable JSON-reconstructed readback, not last POST memory', async () => {
  const f = fixture();
  const api = f.adapter();
  assert.deepEqual(await api.postOnce(f.input), {status: 'CREATED', receiptId: '101'});
  const lookup = {actionKey: f.input.executionKey};
  assert.deepEqual(await f.adapter().lookupByActionKey(lookup),
    {status: 'FOUND', complete: true, receiptIds: ['101']});
  assert.deepEqual(await api.postOnce(f.input), {status: 'NOT_ATTEMPTED'});
  assert.deepEqual(await f.adapter().postOnce(f.input), {status: 'NOT_ATTEMPTED'});
  assert.equal(f.state.authorization, null);
  assert.equal(f.state.reads, 3);
  assert.equal(JSON.parse(f.state.calls[0].body).body, f.described.body);
  assert.notEqual(f.input.receipt.actionKey, f.input.actionKey);
  counts(f.state, 1, 2);
});

test('concurrent calls consume locally before first await; reconstructed instances share durable consumption', async () => {
  const f = fixture();
  const api = f.adapter();
  const results = await Promise.all([api.postOnce(f.input), api.postOnce(f.input),
    f.adapter().postOnce(f.input), f.adapter().postOnce(f.input)]);
  assert.equal(results.filter(result => result.status === 'CREATED').length, 1);
  assert.equal(results.filter(result => result.status === 'NOT_ATTEMPTED').length, 3);
  counts(f.state, 1, 0);
});

test('lost ACK after server acceptance is UNKNOWN; restart performs GET only and cannot repost', async () => {
  const f = fixture();
  f.state.handle = async (url, init) => {
    if (init.method === 'POST') {
      f.state.rows.push(f.comment());
      throw new Error('lost ACK');
    }
    return response(url, f.state.rows);
  };
  assert.equal((await f.adapter().postOnce(f.input)).status, 'UNKNOWN');
  assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'FOUND');
  assert.equal((await f.adapter().postOnce(f.input)).status, 'NOT_ATTEMPTED');
  counts(f.state, 1, 2);
});

test('closed schemas, body hash, key, publisher, and durable fence bindings reject before POST', async t => {
  const mutations = {
    'outer logical key': f => { f.input.actionKey = f.input.receipt.actionKey; },
    'inner execution': f => { f.input.receipt.executionKey = 'other'; },
    'extra markdown': f => { f.input.receipt.markdown = '@someone /run'; },
    'endpoint': f => { f.input.endpoint = 'https://example.invalid'; },
    'wrong digest': f => { f.input.receipt.diffDigest = 'x'; },
    'SHA is not a string': f => { f.input.receipt.headSha = {toString: () => 'a'.repeat(40)}; },
    'wrong verdict pair': f => { f.input.receipt.verdict = 'REVISION_REQUIRED'; },
    'bad hash': f => { f.state.intent.canonicalBodyHash = 'd'.repeat(64); },
    'changed session': f => { f.input.receipt.sessionId = 'other'; },
    'changed PR': f => { f.input.receipt.pullRequest++; },
    'wrong fence': f => { f.state.authorization.fence = 'stale-fence'; },
    'wrong authorization principal': f => { f.state.authorization.principal = 'other'; },
    'expired authorization': f => { f.state.authorization.expiresAtMs = NOW; },
    'authorization before transition': f => { f.state.authorization.issuedAtMs = NOW - 2000; },
    'wrong intent version': f => { f.state.intent.version = 2; },
    'posting is not permission': f => { f.state.authorization = null; }
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const f = fixture();
      f.state.intent = clone(f.described.intent);
      mutate(f);
      assert.equal((await f.adapter().postOnce(f.input)).status, 'NOT_ATTEMPTED');
      counts(f.state, 0, 0);
    });
  }
});

test('canonical body is bounded, deterministic, mention/command safe, and binds every intent field', () => {
  const original = draft();
  original.receipt.actionKey = '@all\n/run';
  assert.throws(() => canonicalizeM11ReceiptIntent(original));
  original.receipt.actionKey = '@all /run';
  const result = canonicalizeM11ReceiptIntent(original);
  assert.ok(!result.body.includes('@all') && !result.body.includes('/run'));
  assert.deepEqual(canonicalizeM11ReceiptIntent(clone(original)), result);
  for (const key of ['actionKey', 'executionKey', 'reviewRequestId', 'sessionId', 'headSha', 'baseSha', 'diffDigest']) {
    const changed = draft();
    changed.receipt[key] = ['headSha', 'baseSha', 'diffDigest'].includes(key)
      ? 'd'.repeat(key === 'diffDigest' ? 64 : 40) : 'changed';
    assert.notEqual(canonicalizeM11ReceiptIntent(changed).intentHash, fixture().described.intentHash);
  }
  for (const mutate of [
    value => { value.receipt.actionKey = 'x'.repeat(201); },
    value => { value.publisher.actorId = '042'; },
    value => { value.posting.kind = 'RECEIPT_PREPARING'; },
    value => { value.validUntilMs = NOW + 1000000; },
    value => { Object.defineProperty(value.receipt, 'sessionId', {get() { throw new Error('getter'); }}); }
  ]) {
    const value = draft();
    mutate(value);
    assert.throws(() => canonicalizeM11ReceiptIntent(value));
  }
  const revision = draft();
  revision.receipt.completionState = 'REVISION_REQUIRED';
  revision.receipt.verdict = 'REVISION_REQUIRED';
  assert.ok(canonicalizeM11ReceiptIntent(revision).body.length < 8192);
});

test('all response ambiguities after invocation are UNKNOWN, never NOT_ATTEMPTED', async t => {
  for (const [name, make] of Object.entries({
    'wrong status': (f, url) => response(url, f.comment(), {status: 200}),
    'redirect': (f, url) => ({...response(url, f.comment(), {status: 201}), redirected: true}),
    'off origin': (f) => response('https://example.invalid', f.comment(), {status: 201}),
    'missing URL': (f) => response('', f.comment(), {status: 201}),
    'malformed JSON': (f, url) => response(url, null, {status: 201, body: new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.close(); }
    })}),
    'auth rejection': (f, url) => response(url, {}, {status: 401}),
    'wrong body': (f, url) => response(url, f.comment(101, {body: 'copied marker only'}), {status: 201}),
    'unsafe numeric id': (f, url) => response(url, f.comment(Number.MAX_SAFE_INTEGER + 1), {status: 201}),
    'noncanonical id': (f, url) => response(url, f.comment('00101'), {status: 201}),
    'wrong timestamp': (f, url) => response(url, f.comment(101, {created_at: iso(NOW - 2000)}), {status: 201})
  })) {
    await t.test(name, async () => {
      const f = fixture();
      f.state.handle = url => make(f, url);
      assert.equal((await f.adapter().postOnce(f.input)).status, 'UNKNOWN');
      assert.equal((await f.adapter().postOnce(f.input)).status, 'NOT_ATTEMPTED');
      counts(f.state, 1, 0);
    });
  }
});

test('canonical decimal strings preserve IDs above JavaScript safe integer range', async () => {
  const f = fixture();
  const id = '9007199254740993';
  f.state.handle = url => response(url, f.comment(id), {status: 201});
  assert.deepEqual(await f.adapter().postOnce(f.input), {status: 'CREATED', receiptId: id});
});

test('GitHub second precision accepts publication in the posting commit second', async () => {
  const value = draft();
  value.posting.committedAtMs = NOW - 500;
  const f = fixture({draft: value});
  f.state.handle = url => response(url, f.comment(101, {
    created_at: iso(NOW - 1000), updated_at: iso(NOW - 1000)
  }), {status: 201});
  assert.equal((await f.adapter().postOnce(f.input)).status, 'CREATED');
  counts(f.state, 1, 0);
});

test('GET inventory zero/one/many; NOT_FOUND and readback never authorize another POST', async t => {
  for (const count of [0, 1, 2]) {
    await t.test(String(count), async () => {
      const f = fixture();
      f.state.authorization = null;
      f.state.rows = Array.from({length: count}, (_, i) => f.comment(101 + i));
      const result = await f.adapter().lookupByActionKey({actionKey: f.input.actionKey});
      assert.equal(result.status, ['NOT_FOUND', 'FOUND', 'UNKNOWN'][count]);
      assert.equal(result.complete, count < 2);
      assert.equal((await f.adapter().postOnce(f.input)).status, 'NOT_ATTEMPTED');
      counts(f.state, 0, 2);
    });
  }
});

test('wrong actor/app, copied marker, edits, destination, timestamps and hash fail readback', async t => {
  const mutations = {
    'shared bot login is not ID': raw => { raw.user.id = 43; },
    'wrong login': raw => { raw.user.login = 'other'; },
    'wrong type': raw => { raw.user.type = 'User'; },
    'wrong app': raw => { raw.performed_via_github_app.id = 8; },
    'absent app': raw => { raw.performed_via_github_app = null; },
    'wrong destination': raw => { raw.issue_url = `${ROOT}/issues/571`; },
    'wrong comment URL': raw => { raw.url += '/wrong'; },
    'edited': raw => { raw.updated_at = iso(NOW + 1000); },
    'edited flag': raw => { raw.edited_at = iso(NOW); },
    'future creation': raw => { raw.created_at = raw.updated_at = iso(NOW + 1000); },
    'before intent': raw => { raw.created_at = raw.updated_at = iso(NOW - 2000); },
    'copied marker': raw => { raw.body = raw.body.slice(raw.body.indexOf('<!--')); },
    'changed body hash': raw => { raw.body += ' '; },
    'wrong marker hash': raw => { raw.body = raw.body.replace(/:[a-f0-9]{64} -->/, `:${'0'.repeat(64)} -->`); }
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const f = fixture();
      const raw = f.comment();
      mutate(raw);
      f.state.rows = [raw];
      assert.deepEqual(await f.adapter().lookupByActionKey({actionKey: f.input.actionKey}),
        {status: 'UNKNOWN', complete: false, receiptIds: []});
      counts(f.state, 0, 1);
    });
  }
});

test('unrelated comments are inventory, not matches; lookup requires durable intent even without POST', async () => {
  const f = fixture();
  f.state.rows = [f.comment(100, {body: 'unrelated', user: {id: 55, login: 'someone', type: 'User'}}), f.comment(101)];
  assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'FOUND');
  f.state.intent = {...f.described.intent, canonicalBodyHash: '0'.repeat(64)};
  assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'UNKNOWN');
  counts(f.state, 0, 2);
});

test('complete bounded pagination is scanned twice; no direct GET substitutes for uniqueness', async () => {
  const f = fixture();
  const page1 = Array.from({length: 100}, (_, i) => f.comment(i + 1, {body: 'unrelated'}));
  f.state.handle = url => url.endsWith('page=1')
    ? response(url, page1, {headers: {link: `<${COMMENTS}?per_page=100&page=2>; rel="next", <${COMMENTS}?per_page=100&page=2>; rel="last"`}})
    : response(url, [f.comment(101)], {headers: {link: `<${COMMENTS}?per_page=100&page=1>; rel="prev"`}});
  assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'FOUND');
  counts(f.state, 0, 4);
});

test('truncated, malformed, looping, off-origin, off-path and conflicting pagination fail closed', async t => {
  for (const [name, link] of Object.entries({
    'off-origin': '<https://example.invalid/comments?per_page=100&page=2>; rel="next"',
    'off-path': `<${ROOT}/issues/571/comments?per_page=100&page=2>; rel="next"`,
    'loop': `<${COMMENTS}?per_page=100&page=1>; rel="next"`,
    'skip': `<${COMMENTS}?per_page=100&page=3>; rel="next"`,
    'extra query': `<${COMMENTS}?per_page=100&page=2&extra=1>; rel="next"`,
    'duplicate query': `<${COMMENTS}?per_page=100&page=2&page=2>; rel="next"`,
    'malformed': 'not a link',
    'truncated last': `<${COMMENTS}?per_page=100&page=2>; rel="last"`,
    'contradictory last': `<${COMMENTS}?per_page=100&page=2>; rel="next", <${COMMENTS}?per_page=100&page=1>; rel="last"`,
    'unknown relation': `<${COMMENTS}?per_page=100&page=2>; rel="alternate"`,
    'duplicate relation': `<${COMMENTS}?per_page=100&page=2>; rel="next", <${COMMENTS}?per_page=100&page=2>; rel="next"`
  })) {
    await t.test(name, async () => {
      const f = fixture();
      f.state.handle = url => response(url, [f.comment()], {headers: {link}});
      assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'UNKNOWN');
      counts(f.state, 0, 1);
    });
  }
});

test('pagination last-page drift, disappearing pages and cross-page conflicting IDs are UNKNOWN', async t => {
  for (const mode of ['last-drift', 'empty-next', 'conflicting-id', 'missing-next']) {
    await t.test(mode, async () => {
      const f = fixture();
      f.state.handle = url => {
        if (url.endsWith('page=1')) return response(url,
          Array.from({length: 100}, (_, i) => f.comment(i + 1, {body: 'unrelated'})),
          {headers: {link: `<${COMMENTS}?per_page=100&page=2>; rel="next", <${COMMENTS}?per_page=100&page=${mode === 'missing-next' ? 3 : 2}>; rel="last"`}});
        if (mode === 'empty-next') return response(url, []);
        if (mode === 'conflicting-id') return response(url, [f.comment(100)]);
        return response(url, [f.comment(101)], mode === 'last-drift' ? {
          headers: {link: `<${COMMENTS}?per_page=100&page=3>; rel="last"`}
        } : {});
      };
      assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'UNKNOWN');
      counts(f.state, 0, 2);
    });
  }
});

test('page cap, duplicate IDs, conflicting snapshots and changing inventories cannot prove FOUND', async t => {
  for (const mode of ['page-cap', 'duplicate', 'conflicting', 'mutation', 'reorder']) {
    await t.test(mode, async () => {
      const f = fixture({maxPages: 1});
      f.state.handle = url => {
        const call = f.state.calls.length;
        if (mode === 'page-cap') return response(url,
          Array.from({length: 100}, (_, i) => f.comment(i + 1, {body: 'unrelated'})),
          {headers: {link: `<${COMMENTS}?per_page=100&page=2>; rel="next"`}});
        if (mode === 'duplicate') return response(url, [f.comment(), f.comment()]);
        if (mode === 'reorder') return response(url, [f.comment(102), f.comment(101)]);
        if (mode === 'conflicting') return response(url, [f.comment(101, call === 1 ? {} : {body: 'different'})]);
        return response(url, call === 1 ? [] : [f.comment()]);
      };
      assert.equal((await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})).status, 'UNKNOWN');
      counts(f.state, 0, ['conflicting', 'mutation'].includes(mode) ? 2 : 1);
    });
  }
});

test('total deadline covers uncooperative fetch, stalled stream, intent and authority', async t => {
  for (const mode of ['fetch', 'stream', 'intent', 'authority']) {
    await t.test(mode, async () => {
      const f = fixture({defaultDeadlineMs: 15});
      let release;
      const stalled = new Promise(resolve => { release = resolve; });
      const overrides = {};
      if (mode === 'intent') overrides.intentStore = {getPublicationIntent: () => stalled};
      else if (mode === 'authority') overrides.authorizationAuthority = {consumePostingAuthorization: () => stalled};
      else f.state.handle = url => mode === 'fetch' ? stalled
        : response(url, null, {status: 201, body: new ReadableStream({pull: () => stalled})});
      const before = Date.now();
      const result = await f.adapter(overrides).postOnce(f.input);
      assert.equal(result.status, ['fetch', 'stream'].includes(mode) ? 'UNKNOWN' : 'NOT_ATTEMPTED');
      assert.ok(Date.now() - before < 1000);
      release(mode === 'intent' ? clone(f.described.intent)
        : mode === 'authority' ? clone(f.state.authorization) : response(COMMENTS, f.comment(), {status: 201}));
      await new Promise(resolve => setImmediate(resolve));
      counts(f.state, ['fetch', 'stream'].includes(mode) ? 1 : 0, 0);
    });
  }
});

test('abort before POST is NOT_ATTEMPTED; abort during POST/stream or GET is UNKNOWN', async t => {
  for (const mode of ['before', 'post', 'stream', 'get']) {
    await t.test(mode, async () => {
      const f = fixture();
      const abort = new AbortController();
      if (mode === 'before') abort.abort();
      f.state.handle = url => {
        if (mode === 'stream') return response(url, null, {status: 201, body: new ReadableStream({
          pull(controller) { abort.abort(); controller.close(); }
        })});
        abort.abort();
        return response(url, mode === 'get' ? [f.comment()] : f.comment(), {status: mode === 'get' ? 200 : 201});
      };
      const result = mode === 'get'
        ? await f.adapter().lookupByActionKey({actionKey: f.input.actionKey, signal: abort.signal})
        : await f.adapter().postOnce({...f.input, signal: abort.signal});
      assert.equal(result.status, mode === 'before' ? 'NOT_ATTEMPTED' : 'UNKNOWN');
      counts(f.state, ['post', 'stream'].includes(mode) ? 1 : 0, mode === 'get' ? 1 : 0);
    });
  }
});

test('streaming byte limits do not trust content-length and apply across the whole inventory', async t => {
  for (const mode of ['header', 'stream', 'total', 'get-stalled']) {
    await t.test(mode, async () => {
      const f = fixture({maxResponseBytes: 8192, maxTotalBytes: mode === 'total' ? 8192 : 16384, defaultDeadlineMs: 20});
      f.state.handle = url => {
        if (mode === 'get-stalled') return response(url, null, {body: new ReadableStream({pull: () => new Promise(() => {})})});
        const rows = [f.comment(), f.comment(102, {body: 'x'.repeat(4000)})];
        if (mode === 'total') return response(url, rows);
        return response(url, f.comment(101, {body: 'x'.repeat(9000)}),
          {status: 201, headers: {'content-length': mode === 'header' ? '999999' : '1'}});
      };
      const result = ['total', 'get-stalled'].includes(mode)
        ? await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})
        : await f.adapter().postOnce(f.input);
      assert.equal(result.status, 'UNKNOWN');
      counts(f.state, ['header', 'stream'].includes(mode) ? 1 : 0, mode === 'total' ? 2 : mode === 'get-stalled' ? 1 : 0);
    });
  }
});

test('fresh evidence binds principal/origin/TLS/evidence ID/expiry and actor/app', async t => {
  for (const [key, changed] of Object.entries({
    host: 'example.invalid', scheme: 'http', tls: false, evidenceId: '',
    principal: '', actorId: '43', appId: '8', verifiedAtMs: NOW + 1, expiresAtMs: NOW
  })) {
    await t.test(key, async () => {
      const f = fixture();
      f.state.evidence[key] = changed;
      assert.equal((await f.adapter().postOnce(f.input)).status, 'NOT_ATTEMPTED');
      counts(f.state, 0, 0);
    });
  }
});

test('evidence and credential rotation while resolving durable intent blocks both operations', async t => {
  for (const method of ['postOnce', 'lookupByActionKey']) {
    for (const field of ['evidence', 'credential']) {
      await t.test(`${method} ${field}`, async () => {
        const f = fixture();
        const api = f.adapter({intentStore: {getPublicationIntent: async request => {
          const value = await f.dependencies.intentStore.getPublicationIntent(request);
          if (field === 'evidence') f.state.evidence.evidenceId = 'new-evidence';
          else f.state.header = 'fixture-authorization-two';
          return value;
        }}});
        const result = await api[method](method === 'postOnce' ? f.input : {actionKey: f.input.actionKey});
        assert.equal(result.status, method === 'postOnce' ? 'NOT_ATTEMPTED' : 'UNKNOWN');
        assert.equal(f.state.consumptions, 0);
        counts(f.state, 0, 0);
      });
    }
  }
});

test('auth expiry/rotation during request, streaming, pagination, or authorization blocks success', async t => {
  for (const mode of ['expiry', 'evidence', 'principal', 'credential', 'stream', 'pagination', 'authority']) {
    await t.test(mode, async () => {
      const f = fixture();
      const rotate = () => {
        if (mode === 'expiry') f.state.evidence.expiresAtMs = NOW;
        else if (mode === 'principal') f.state.evidence.principal = 'rotated';
        else if (mode === 'credential') f.state.header = 'fixture-authorization-two';
        else f.state.evidence.evidenceId = 'rotated-evidence';
      };
      const overrides = mode === 'authority' ? {
        authorizationAuthority: {consumePostingAuthorization: async request => {
          const grant = await f.dependencies.authorizationAuthority.consumePostingAuthorization(request);
          rotate();
          return grant;
        }}
      } : {};
      f.state.handle = url => {
        if (mode === 'stream') return response(url, null, {status: 201, body: new ReadableStream({
          pull(controller) { rotate(); controller.enqueue(new TextEncoder().encode('{}')); controller.close(); }
        })});
        if (mode !== 'pagination' || f.state.calls.length === 2) rotate();
        return response(url, mode === 'pagination' ? [f.comment()] : f.comment(),
          {status: mode === 'pagination' ? 200 : 201});
      };
      const result = mode === 'pagination'
        ? await f.adapter().lookupByActionKey({actionKey: f.input.actionKey})
        : await f.adapter(overrides).postOnce(f.input);
      assert.equal(result.status, mode === 'authority' ? 'NOT_ATTEMPTED' : 'UNKNOWN');
      counts(f.state, mode === 'authority' || mode === 'pagination' ? 0 : 1, mode === 'pagination' ? 2 : 0);
    });
  }
});
