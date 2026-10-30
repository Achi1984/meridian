import {setImmediate as yieldToEventLoop} from 'node:timers/promises';

const COMMENTS = 'https://api.github.com/repos/Achi1984/meridian/issues/942/comments';
const NUMERIC_COMMENTS = 'https://api.github.com/repositories/1342084551/issues/942/comments';
const positive = value => Number.isSafeInteger(value) && value > 0;

function pagination(headers, page) {
  const link = headers.get('link');
  if (link === null) return {next: false, last: null};
  if (typeof link !== 'string' || !link.length || link.length > 4096) return null;
  const relations = new Set();
  let next = false;
  let last = null;
  for (const part of link.split(',')) {
    const match = /^<([^>]+)>;\s*rel="(next|prev|first|last)"$/.exec(part.trim());
    if (!match || relations.has(match[2])) return null;
    relations.add(match[2]);
    // Compare the raw spelling too: URL normalization must not expand the allowlist.
    const target = /[?]per_page=100&page=([1-9][0-9]*)$/.exec(match[1])?.[1];
    if (!target || !positive(Number(target))
      || ![COMMENTS, NUMERIC_COMMENTS].some(path =>
        match[1] === `${path}?per_page=100&page=${target}`)) return null;
    const number = Number(target);
    if (match[2] === 'next') {
      if (number !== page + 1) return null;
      next = true;
    }
    if (match[2] === 'prev' && (page <= 1 || number !== page - 1)) return null;
    if (match[2] === 'first' && number !== 1) return null;
    if (match[2] === 'last') {
      if (number < page) return null;
      last = number;
    }
  }
  if (last !== null && (next ? last <= page : last !== page)) return null;
  return {next, last};
}

export function createM11CoordinatorReceiptCapacityProbe({
  enabled = false,
  fetchImpl,
  credentials,
  now = Date.now,
  defaultDeadlineMs = 4500,
  maxResponseBytes = 131072,
  maxTotalBytes = 1048576,
  maxPages = 10
} = {}) {
  if (typeof enabled !== 'boolean' || typeof now !== 'function'
    || !positive(defaultDeadlineMs) || defaultDeadlineMs > 10000
    || !positive(maxResponseBytes) || maxResponseBytes > 1048576
    || !positive(maxTotalBytes) || maxTotalBytes > 4194304
    || !positive(maxPages) || maxPages > 20) {
    throw new Error('CAPACITY_PROBE_CONFIGURATION_REJECTED');
  }

  return Object.freeze({
    async probe({signal} = {}) {
      let bytesObserved = 0;
      let pagesStarted = 0;
      let pagesCompleted = 0;
      let elapsedMs = 0;
      const pageBytes = [];
      let reader;
      let response;
      let cancelledTarget;
      let cancellation = 'NOT_REQUESTED';
      let stopped = false;
      let reason = 'TRANSPORT_UNKNOWN';
      const controller = new AbortController();
      const result = status => Object.freeze({
        status, reason, bytesObserved, pageBytes: Object.freeze([...pageBytes]),
        pagesStarted, pagesCompleted, elapsedMs,
        measurement: status === 'COMPLETE' ? 'EXACT_STREAM_BYTES' : 'LOWER_BOUND',
        cancellation
      });
      if (!enabled) {
        reason = 'DISABLED';
        return result('DISABLED');
      }
      if (typeof fetchImpl !== 'function'
        || typeof credentials?.getAuthorizationHeader !== 'function'
        || (signal !== undefined && !(signal instanceof AbortSignal))) {
        reason = 'DEPENDENCY_INVALID';
        return result('UNKNOWN');
      }
      let wake;
      const interrupted = new Promise(resolve => { wake = resolve; });
      const cancel = () => {
        const target = reader ?? response?.body;
        if (!target || target === cancelledTarget) return;
        cancelledTarget = target;
        cancellation = 'REQUESTED';
        try {
          // Do not wait for an uncooperative transport's cancellation acknowledgement.
          Promise.resolve(target.cancel())
            .catch(() => { cancellation = 'FAILED'; });
        } catch {
          cancellation = 'FAILED';
        }
      };
      const stop = value => {
        if (stopped) return;
        stopped = true;
        reason = value;
        controller.abort();
        cancel();
        wake();
      };
      let started;
      let header;
      let timer;
      const abort = () => stop('CANCELLED');
      const check = () => {
        if (stopped) return false;
        const time = now();
        if (!Number.isSafeInteger(time) || time < started) stop('CLOCK_INVALID');
        else {
          elapsedMs = time - started;
          if (elapsedMs >= defaultDeadlineMs) stop('DEADLINE_EXCEEDED');
        }
        return !stopped;
      };
      const work = async () => {
        let last = null;
        for (let page = 1; page <= maxPages; page++) {
          if (!check()) return;
          if (credentials.getAuthorizationHeader() !== header) {
            stop('AUTH_CHANGED');
            return;
          }
          const url = `${COMMENTS}?per_page=100&page=${page}`;
          pagesStarted++;
          pageBytes.push(0);
          response = await fetchImpl(url, {
            method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
            referrerPolicy: 'no-referrer', signal: controller.signal,
            headers: {accept: 'application/vnd.github+json', authorization: header,
              'x-github-api-version': '2022-11-28'}
          });
          if (!check()) { cancel(); return; }
          if (response?.status !== 200 || response.url !== url || response.redirected !== false
            || response.headers?.get('content-type')?.split(';')[0].trim() !== 'application/json'
            || typeof response.body?.getReader !== 'function') {
            stop('RESPONSE_INVALID');
            return;
          }
          reader = response.body.getReader();
          let chunks = 0;
          for (;;) {
            if (!check()) return;
            const chunk = await reader.read();
            if (!check()) return;
            if (!chunk || typeof chunk.done !== 'boolean') {
              stop('STREAM_INVALID');
              return;
            }
            if (chunk.done) break;
            if (!(chunk.value instanceof Uint8Array)) {
              stop('STREAM_INVALID');
              return;
            }
            // Count the delivered chunk, but never copy, decode, concatenate or retain it.
            const size = chunk.value.byteLength;
            bytesObserved += size;
            pageBytes[page - 1] += size;
            if (pageBytes[page - 1] > maxResponseBytes) {
              stop('PAGE_BYTES_EXCEEDED');
              return;
            }
            if (bytesObserved > maxTotalBytes) {
              stop('TOTAL_BYTES_EXCEEDED');
              return;
            }
            // Even an always-ready empty stream must let the real timer and abort run.
            if (++chunks % 64 === 0) await yieldToEventLoop();
          }
          reader.releaseLock();
          reader = undefined;
          pagesCompleted++;
          const links = pagination(response.headers, page);
          response = undefined;
          if (!links || (links.last !== null && last !== null && links.last !== last)
            || (!links.next && last !== null && page !== last)
            || (links.next && last !== null && page >= last)) {
            stop('PAGINATION_INVALID');
            return;
          }
          if (links.last !== null) last = links.last;
          if (!links.next) {
            reason = 'SCAN_COMPLETE';
            return;
          }
          if (page === maxPages) stop('PAGE_COUNT_EXCEEDED');
        }
      };
      try {
        started = now();
        if (!Number.isSafeInteger(started) || started < 0) {
          stop('CLOCK_INVALID');
        } else {
          header = credentials.getAuthorizationHeader();
          if (typeof header !== 'string' || !/^[\x21-\x7e ]{1,2048}$/.test(header)
            || !header.trim()) stop('AUTH_INVALID');
          signal?.addEventListener('abort', abort, {once: true});
          if (signal?.aborted) abort();
          timer = setTimeout(() => stop('DEADLINE_EXCEEDED'), defaultDeadlineMs);
          await Promise.race([
            Promise.resolve().then(() => !stopped && work()).catch(() => {
              if (!stopped) stop('TRANSPORT_UNKNOWN');
            }),
            interrupted
          ]);
          if (!stopped) check();
        }
      } catch {
        if (!stopped) stop('TRANSPORT_UNKNOWN');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (stopped) {
          cancel();
          try { reader?.releaseLock(); } catch { cancellation = 'FAILED'; }
        }
        // Late fetch/read completions are fenced by stopped, even if abort is ignored.
        stopped = true;
        controller.abort();
      }
      const status = reason === 'SCAN_COMPLETE' ? 'COMPLETE'
        : ['PAGE_BYTES_EXCEEDED', 'TOTAL_BYTES_EXCEEDED', 'PAGE_COUNT_EXCEEDED',
          'DEADLINE_EXCEEDED', 'CANCELLED'].includes(reason) ? 'INCOMPLETE' : 'UNKNOWN';
      return result(status);
    }
  });
}
