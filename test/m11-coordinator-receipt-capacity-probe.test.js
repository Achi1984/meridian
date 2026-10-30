import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createM11CoordinatorReceiptCapacityProbe}
  from '../scripts/autonomy/m11-coordinator-receipt-capacity-probe.mjs';

const COMMENTS = 'https://api.github.com/repos/Achi1984/meridian/issues/942/comments';
const NUMERIC = 'https://api.github.com/repositories/1342084551/issues/942/comments';
const url = page => `${COMMENTS}?per_page=100&page=${page}`;
const link = (page, rel = 'next', root = COMMENTS) =>
  `<${root}?per_page=100&page=${page}>; rel="${rel}"`;
const encode = text => new TextEncoder().encode(text);

function response(chunks = [encode('[]')], options = {}) {
  const counts = {reads: 0, cancels: 0, releases: 0};
  let index = 0;
  const reader = {
    async read() {
      counts.reads++;
      if (options.read) return options.read(counts.reads);
      return index < chunks.length ? {done: false, value: chunks[index++]} : {done: true};
    },
    cancel() {
      counts.cancels++;
      return options.cancel?.();
    },
    releaseLock() { counts.releases++; }
  };
  return {
    counts,
    status: 200, url: url(options.page ?? 1), redirected: false,
    headers: new Headers({'content-type': 'application/json', ...options.headers}),
    body: {getReader: () => reader, cancel: () => reader.cancel()},
    ...options.overrides
  };
}

async function setup(responses, options = {}) {
  const calls = [];
  let authCalls = 0;
  const probe = createM11CoordinatorReceiptCapacityProbe({
    enabled: true,
    now: () => 1000,
    credentials: {getAuthorizationHeader() { authCalls++; return 'Bearer synthetic-only'; }},
    fetchImpl: async (target, init) => {
      calls.push({target, init});
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(init.headers.authorization, 'Bearer synthetic-only');
      assert.equal(Object.hasOwn(init, 'body'), false);
      assert.equal(target, url(calls.length));
      const item = responses[calls.length - 1];
      if (item instanceof Error) throw item;
      return typeof item === 'function' ? item(init) : item;
    },
    ...options
  });
  return {probe, calls, authCalls: () => authCalls};
}

function diagnosticOnly(result) {
  assert.deepEqual(Object.keys(result).sort(), [
    'bytesObserved', 'cancellation', 'elapsedMs', 'measurement', 'pageBytes',
    'pagesCompleted', 'pagesStarted', 'reason', 'status'
  ]);
  for (const value of Object.values(result)) {
    if (typeof value === 'string') assert.match(value, /^[A-Z_]+$/);
    else if (Array.isArray(value)) assert.ok(value.every(Number.isSafeInteger));
    else assert.ok(Number.isSafeInteger(value));
  }
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pageBytes));
}

test('default disabled performs zero auth, clock, transport or signal I/O', async () => {
  const forbidden = () => { throw new Error('must not run'); };
  const probe = createM11CoordinatorReceiptCapacityProbe({
    fetchImpl: forbidden, now: forbidden,
    credentials: {getAuthorizationHeader: forbidden}
  });
  const result = await probe.probe({signal: new Proxy({}, {get: forbidden})});
  assert.equal(result.status, 'DISABLED');
  assert.equal(result.reason, 'DISABLED');
  assert.equal(result.bytesObserved, 0);
  assert.equal(result.measurement, 'LOWER_BOUND');
  diagnosticOnly(result);
});

test('actual UTF-8 bytes are counted without decoding across every chunk boundary', async () => {
  const bytes = encode('[{"body":"a\u00e9\u20ac\ud83d\ude80"}]');
  assert.ok(bytes.byteLength > '[{"body":"a\u00e9\u20ac\ud83d\ude80"}]'.length);
  for (let split = 1; split < bytes.length; split++) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      }
    });
    const item = response([], {overrides: {body: stream}});
    const {probe, calls} = await setup([item]);
    const result = await probe.probe();
    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.measurement, 'EXACT_STREAM_BYTES');
    assert.equal(result.bytesObserved, bytes.byteLength);
    assert.deepEqual(result.pageBytes, [bytes.byteLength]);
    assert.equal(result.pagesCompleted, 1);
    assert.equal(calls.length, 1);
    diagnosticOnly(result);
  }
});

test('opaque invalid UTF-8 and inaccurate Content-Length do not invent byte evidence', async () => {
  const item = response([new Uint8Array([0xff, 0xc3]), new Uint8Array([0x28])], {
    headers: {'content-length': '999999999'}
  });
  const {probe} = await setup([item]);
  const result = await probe.probe();
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.bytesObserved, 3);
});

test('exact page and aggregate budget is accepted', async () => {
  const {probe} = await setup([response([new Uint8Array(4)])], {
    maxResponseBytes: 4, maxTotalBytes: 4
  });
  assert.equal((await probe.probe()).status, 'COMPLETE');
});

for (const [name, chunks] of [
  ['oversized first chunk', [new Uint8Array(100), new Uint8Array(1)]],
  ['crossing chunk', [new Uint8Array(3), new Uint8Array(2), new Uint8Array(1)]]
]) {
  test(`${name} stops before another read and reports observed lower bound`, async () => {
    const item = response(chunks, {headers: {link: link(2)}});
    const {probe, calls} = await setup([item], {maxResponseBytes: 4});
    const result = await probe.probe();
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.reason, 'PAGE_BYTES_EXCEEDED');
    assert.equal(result.measurement, 'LOWER_BOUND');
    assert.equal(result.bytesObserved, name === 'oversized first chunk' ? 100 : 5);
    assert.equal(item.counts.reads, name === 'oversized first chunk' ? 1 : 2);
    assert.equal(item.counts.cancels, 1);
    assert.equal(item.counts.releases, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.signal.aborted, true);
    diagnosticOnly(result);
  });
}

test('aggregate budget crosses on second page and prevents third request', async () => {
  const first = response([new Uint8Array(3)], {headers: {link: link(2)}});
  const second = response([new Uint8Array(3), new Uint8Array(1)], {
    page: 2, headers: {link: link(3)}
  });
  const {probe, calls} = await setup([first, second], {
    maxResponseBytes: 10, maxTotalBytes: 5
  });
  const result = await probe.probe();
  assert.equal(result.reason, 'TOTAL_BYTES_EXCEEDED');
  assert.equal(result.bytesObserved, 6);
  assert.deepEqual(result.pageBytes, [3, 3]);
  assert.equal(result.pagesCompleted, 1);
  assert.equal(second.counts.reads, 1);
  assert.equal(second.counts.cancels, 1);
  assert.equal(calls.length, 2);
});

test('page-count bound stops despite valid next link', async () => {
  const {probe, calls} = await setup([
    response([encode('[]')], {headers: {link: link(2)}})
  ], {maxPages: 1});
  const result = await probe.probe();
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.reason, 'PAGE_COUNT_EXCEEDED');
  assert.equal(result.bytesObserved, 2);
  assert.equal(result.pagesCompleted, 1);
  assert.equal(calls.length, 1);
});

test('mixed pinned numeric and named Link relations produce only named GETs', async () => {
  const {probe, calls} = await setup([
    response([], {headers: {link: `${link(2, 'next', NUMERIC)}, ${link(2, 'last')}`}}),
    response([], {page: 2, headers: {link:
      `${link(1, 'prev', NUMERIC)}, ${link(1, 'first')}, ${link(2, 'last', NUMERIC)}`}})
  ]);
  const result = await probe.probe();
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.pagesCompleted, 2);
  assert.equal(calls.length, 2);
});

const malformedLinks = [
  '', 'not-a-link', link(3), link(1), `${link(2)}, ${link(2)}`,
  link(2, 'unknown'), link(2, 'prev'), link(2, 'first'),
  link(2, 'last'), `${link(2)}, ${link(1, 'last')}`,
  link(2, 'next', 'https://evil.invalid/comments'),
  link(2, 'next', COMMENTS.replace('942', '943')),
  link(2, 'next', COMMENTS.replace('meridian', 'foreign')),
  link(2, 'next', NUMERIC.replace('1342084551', '1342084552')),
  link(2, 'next', COMMENTS.replace('https:', 'http:')),
  link(2, 'next', COMMENTS.replace('api.github.com', 'user:pass@api.github.com')),
  link(2, 'next', COMMENTS.replace('api.github.com', 'api.github.com:443')),
  link(2).replace('page=2', 'page=02'),
  link(2).replace('page=2', 'page=9007199254740992'),
  link(2).replace('per_page=100&page=2', 'page=2&per_page=100'),
  link(2).replace('page=2', 'page=2&since=2026-01-01'),
  link(2).replace('page=2', 'page=2&page=2'),
  link(2).replace('page=2', 'page=2#fragment'),
  link(2).replace('/issues/', '/%69ssues/'),
  `${link(2)}, <https://evil.invalid/>; rel="last"`,
  'x'.repeat(4097)
];
for (const [index, value] of malformedLinks.entries()) {
  test(`malformed/foreign pagination ${index + 1} is UNKNOWN without following it`, async () => {
    const {probe, calls} = await setup([response([], {headers: {link: value}})]);
    const result = await probe.probe();
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.reason, 'PAGINATION_INVALID');
    assert.equal(result.measurement, 'LOWER_BOUND');
    assert.equal(calls.length, 1);
    diagnosticOnly(result);
  });
}

for (const [name, links] of [
  ['last drift', [link(2, 'last'), link(3, 'last')]],
  ['premature end', [link(3, 'last'), null]],
  ['beyond pinned last', [link(2, 'last'), link(3)]]
]) {
  test(`${name} is rejected before third request`, async () => {
    const {probe, calls} = await setup([
      response([], {headers: {link: `${link(2)}, ${links[0]}`}}),
      response([], {page: 2, headers: links[1] === null ? {} : {link: links[1]}})
    ]);
    assert.equal((await probe.probe()).reason, 'PAGINATION_INVALID');
    assert.equal(calls.length, 2);
  });
}

test('injected deadline boundary aborts before next read', async () => {
  let time = 0;
  const item = response([], {
    read: async () => { time = 10; return {done: false, value: encode('secret')}; }
  });
  const {probe, calls} = await setup([item], {now: () => time, defaultDeadlineMs: 10});
  const result = await probe.probe();
  assert.equal(result.reason, 'DEADLINE_EXCEEDED');
  assert.equal(result.bytesObserved, 0);
  assert.equal(result.elapsedMs, 10);
  assert.equal(item.counts.reads, 1);
  assert.equal(item.counts.cancels, 1);
  assert.equal(calls[0].init.signal.aborted, true);
});

test('real deadline bounds ignored fetch abort and cancels late response without reading', async () => {
  let deliver;
  const item = response();
  const {probe, calls} = await setup([() => new Promise(resolve => { deliver = resolve; })], {
    defaultDeadlineMs: 15
  });
  const result = await probe.probe();
  assert.equal(result.reason, 'DEADLINE_EXCEEDED');
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(calls[0].init.signal.aborted, true);
  deliver(item);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(item.counts.cancels, 1);
  assert.equal(item.counts.reads, 0);
  assert.equal(calls.length, 1);
  assert.equal(result.bytesObserved, 0);
});

test('real deadline bounds ignored read and never consumes late chunks or starts next page', async () => {
  let deliver;
  const item = response([], {
    headers: {link: link(2)},
    read: () => new Promise(resolve => { deliver = resolve; }),
    cancel: () => new Promise(() => {})
  });
  const {probe, calls} = await setup([item], {defaultDeadlineMs: 15});
  const result = await probe.probe();
  assert.equal(result.reason, 'DEADLINE_EXCEEDED');
  assert.equal(result.cancellation, 'REQUESTED');
  deliver({done: false, value: new Uint8Array(100)});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(item.counts.reads, 1);
  assert.equal(item.counts.cancels, 1);
  assert.equal(calls.length, 1);
  assert.equal(result.bytesObserved, 0);
});

test('pre-aborted caller makes no auth-independent transport request', async () => {
  const controller = new AbortController();
  controller.abort();
  const {probe, calls} = await setup([]);
  const result = await probe.probe({signal: controller.signal});
  assert.equal(result.reason, 'CANCELLED');
  assert.equal(calls.length, 0);
});

test('caller cancellation interrupts a pending read and requests cancellation once', async () => {
  const controller = new AbortController();
  const item = response([], {
    read: () => { controller.abort(); return new Promise(() => {}); }
  });
  const {probe, calls} = await setup([item]);
  const result = await probe.probe({signal: controller.signal});
  assert.equal(result.reason, 'CANCELLED');
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(item.counts.cancels, 1);
  assert.equal(calls[0].init.signal.aborted, true);
});

for (const [name, cancel] of [
  ['synchronous', () => { throw new Error('sensitive cancel exception'); }],
  ['asynchronous', () => Promise.reject(new Error('sensitive cancel rejection'))]
]) {
  test(`${name} cancellation failure is diagnostic, not leaked or mistaken for success`, async () => {
    const item = response([new Uint8Array(2)], {cancel});
    const {probe} = await setup([item], {maxResponseBytes: 1});
    const result = await probe.probe();
    assert.equal(result.reason, 'PAGE_BYTES_EXCEEDED');
    assert.equal(result.cancellation, 'FAILED');
    diagnosticOnly(result);
  });
}

for (const [name, item, expected] of [
  ['fetch rejection', new Error('secret response credential'), 'TRANSPORT_UNKNOWN'],
  ['missing response', undefined, 'RESPONSE_INVALID'],
  ['HTTP error', response([], {overrides: {status: 429}}), 'RESPONSE_INVALID'],
  ['redirect', response([], {overrides: {redirected: true}}), 'RESPONSE_INVALID'],
  ['wrong URL', response([], {overrides: {url: 'https://evil.invalid'}}), 'RESPONSE_INVALID'],
  ['wrong content type', response([], {headers: {'content-type': 'text/html'}}), 'RESPONSE_INVALID'],
  ['missing stream', response([], {overrides: {body: null}}), 'RESPONSE_INVALID'],
  ['read rejection', response([], {read: async () => { throw new Error('secret body'); }}),
    'TRANSPORT_UNKNOWN'],
  ['string chunk', response(['secret']), 'STREAM_INVALID'],
  ['untyped buffer', response([new ArrayBuffer(4)]), 'STREAM_INVALID'],
  ['malformed read', response([], {read: async () => ({})}), 'STREAM_INVALID']
]) {
  test(`${name} reports UNKNOWN without retaining transport details`, async () => {
    const {probe, calls} = await setup([item]);
    const result = await probe.probe();
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.reason, expected);
    assert.equal(calls.length, 1);
    diagnosticOnly(result);
  });
}

test('clock rollback or invalid clock fails closed', async () => {
  for (const invalid of [-1, NaN, Infinity, 1.5]) {
    const {probe, calls} = await setup([], {now: () => invalid});
    assert.equal((await probe.probe()).reason, 'CLOCK_INVALID');
    assert.equal(calls.length, 0);
  }
  let reads = 0;
  const {probe, calls} = await setup([], {now: () => reads++ === 0 ? 100 : 99});
  assert.equal((await probe.probe()).reason, 'CLOCK_INVALID');
  assert.equal(calls.length, 0);
});

test('zero-byte chunks cannot bypass deadline', async () => {
  let time = 0;
  const item = response([], {
    read: async () => { time++; return {done: false, value: new Uint8Array(0)}; }
  });
  const {probe} = await setup([item], {now: () => time, defaultDeadlineMs: 5});
  assert.equal((await probe.probe()).reason, 'DEADLINE_EXCEEDED');
  assert.equal(item.counts.reads, 5);
});

test('always-ready empty stream yields so the real deadline can interrupt a frozen clock', async () => {
  const item = response([], {
    read: async () => ({done: false, value: new Uint8Array(0)})
  });
  const {probe, calls} = await setup([item], {defaultDeadlineMs: 15});
  const result = await probe.probe();
  assert.equal(result.reason, 'DEADLINE_EXCEEDED');
  assert.equal(result.bytesObserved, 0);
  assert.equal(item.counts.cancels, 1);
  assert.equal(calls.length, 1);
});

test('deadline between pages prevents the next GET', async () => {
  let time = 0;
  const item = response([], {
    overrides: {headers: {
      get(name) {
        if (name === 'link') { time = 10; return link(2); }
        return 'application/json';
      }
    }}
  });
  const {probe, calls} = await setup([item], {now: () => time, defaultDeadlineMs: 10});
  const result = await probe.probe();
  assert.equal(result.reason, 'DEADLINE_EXCEEDED');
  assert.equal(result.pagesCompleted, 1);
  assert.equal(calls.length, 1);
});

test('caller cancellation bounds a fetch that never settles', async () => {
  const controller = new AbortController();
  const {probe, calls} = await setup([() => {
    controller.abort();
    return new Promise(() => {});
  }]);
  const result = await probe.probe({signal: controller.signal});
  assert.equal(result.reason, 'CANCELLED');
  assert.equal(result.cancellation, 'NOT_REQUESTED');
  assert.equal(calls[0].init.signal.aborted, true);
});

test('auth validation, dependency failures and header drift do not issue another request', async () => {
  assert.equal((await createM11CoordinatorReceiptCapacityProbe({enabled: true}).probe()).reason,
    'DEPENDENCY_INVALID');
  for (const header of ['', ' ', 'Bearer\nsecret', 123]) {
    const {probe, calls} = await setup([], {
      credentials: {getAuthorizationHeader: () => header}
    });
    assert.equal((await probe.probe()).reason, 'AUTH_INVALID');
    assert.equal(calls.length, 0);
  }
  let count = 0;
  const {probe, calls} = await setup([response([], {headers: {link: link(2)}})], {
    credentials: {getAuthorizationHeader: () => ++count < 3
      ? 'Bearer synthetic-only' : 'Bearer changed'}
  });
  assert.equal((await probe.probe()).reason, 'AUTH_CHANGED');
  assert.equal(calls.length, 1);
});

test('configuration rejects cap increases and invalid bounds', async () => {
  for (const options of [
    {maxResponseBytes: 1048577}, {maxTotalBytes: 4194305}, {maxPages: 21},
    {defaultDeadlineMs: 10001}, {maxResponseBytes: 0}, {maxTotalBytes: -1},
    {maxPages: 1.5}, {defaultDeadlineMs: NaN}, {enabled: 'true'}, {now: null}
  ]) {
    assert.throws(() => createM11CoordinatorReceiptCapacityProbe(options),
      /^Error: CAPACITY_PROBE_CONFIGURATION_REJECTED$/);
  }
});

test('default byte, aggregate, page and clock thresholds are enforced unchanged', async () => {
  const oversized = await setup([response([new Uint8Array(131073)])]);
  const pageResult = await oversized.probe.probe();
  assert.equal(pageResult.reason, 'PAGE_BYTES_EXCEEDED');
  assert.equal(pageResult.bytesObserved, 131073);

  const pages = Array.from({length: 9}, (_, index) => response([
    new Uint8Array(index < 8 ? 131072 : 1)
  ], {page: index + 1, headers: {link: link(index + 2)}}));
  const aggregate = await setup(pages);
  const aggregateResult = await aggregate.probe.probe();
  assert.equal(aggregateResult.reason, 'TOTAL_BYTES_EXCEEDED');
  assert.equal(aggregateResult.bytesObserved, 1048577);
  assert.equal(aggregate.calls.length, 9);

  const count = await setup(Array.from({length: 10}, (_, index) => response([], {
    page: index + 1, headers: {link: link(index + 2)}
  })));
  assert.equal((await count.probe.probe()).reason, 'PAGE_COUNT_EXCEEDED');
  assert.equal(count.calls.length, 10);

  let time = 0;
  const deadline = await setup([response([], {read: async () => {
    time = 4500;
    return {done: true};
  }})], {now: () => time});
  assert.equal((await deadline.probe.probe()).reason, 'DEADLINE_EXCEEDED');
});
