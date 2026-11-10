import {
  canonicalJson, validIdentity, validateProgress
} from './scripts/spot-paper-paired-progress/contract.mjs';
import {PAPER_REPORT_STORE_LIMITS} from './private-report-store.mjs';

const TABLE = 'meridian_spot_paper_paired_progress';
const failure = code => Object.assign(new Error(code), {code});

// Whole-JSON identity equality includes schema, feed/engine, models and account IDs.
export const PAIRED_PROGRESS_UPSERT_SQL = `
  INSERT INTO ${TABLE} AS current
    (run_id, identity, journal_sequence, journal_sha256, terminal_status, payload)
  VALUES ($1, $2::jsonb, $3, $4, $5, $6::jsonb)
  ON CONFLICT (run_id) DO UPDATE SET
    journal_sequence = EXCLUDED.journal_sequence,
    journal_sha256 = EXCLUDED.journal_sha256,
    terminal_status = EXCLUDED.terminal_status,
    payload = EXCLUDED.payload,
    updated_at = now()
  WHERE current.identity = EXCLUDED.identity
    AND current.journal_sequence < EXCLUDED.journal_sequence
    AND current.terminal_status = 'UNKNOWN'
    AND (current.payload->>'observedAt')::bigint <= (EXCLUDED.payload->>'observedAt')::bigint
    AND (current.payload->>'valuationAt')::bigint <= (EXCLUDED.payload->>'valuationAt')::bigint
    AND (current.payload->>'latestEventAt')::bigint <= (EXCLUDED.payload->>'latestEventAt')::bigint
  RETURNING payload`;

function checkpoint(value) {
  const {exportedAt, ...rest} = value;
  return canonicalJson(rest);
}

export function createPrivatePairedProgressStore(db, {
  maxConcurrent = PAPER_REPORT_STORE_LIMITS.maxConcurrent,
  operationTimeoutMs = PAPER_REPORT_STORE_LIMITS.operationTimeoutMs,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (!db || typeof db.query !== 'function') return null;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2 ||
      !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 ||
      operationTimeoutMs > 6_000 || typeof schedule !== 'function' ||
      typeof cancelSchedule !== 'function') throw new TypeError('invalid progress store limits');
  let active = 0;

  function bounded(write, signal, operation) {
    if (signal?.aborted) return Promise.reject(failure('STORE_CANCELLED'));
    if (active >= maxConcurrent) return Promise.reject(failure('STORE_BUSY'));
    active++;
    let timer;
    let stopped = false;
    let stop;
    const deadline = new Promise((_, reject) => {
      stop = code => {
        stopped = true;
        reject(failure(write ? 'PAIRED_PROGRESS_OUTCOME_UNKNOWN' : code));
      };
    });
    const abort = () => stop('STORE_CANCELLED');
    try {
      timer = schedule(() => stop('STORE_TIMEOUT'), operationTimeoutMs);
      if (timer === undefined || timer === null) throw failure('STORE_DEADLINE_UNAVAILABLE');
    } catch (error) {
      active--;
      return Promise.reject(error);
    }
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    const assertActive = () => {
      if (stopped) throw failure(write ? 'PAIRED_PROGRESS_OUTCOME_UNKNOWN' : 'STORE_TIMEOUT');
    };
    // Keep capacity until the actual database work settles, not just its deadline.
    const work = Promise.resolve().then(async () => {
      assertActive();
      const result = await operation(assertActive);
      assertActive();
      return result;
    }).finally(() => { active--; });
    return Promise.race([work, deadline]).finally(() => {
      signal?.removeEventListener('abort', abort);
      cancelSchedule(timer);
    });
  }

  return Object.freeze({
    get(identity, {signal} = {}) {
      if (!validIdentity(identity)) return Promise.reject(failure('INVALID_IDENTITY'));
      const identityJson = canonicalJson(identity);
      return bounded(false, signal, async () => {
        const result = await db.query(
          `SELECT payload FROM ${TABLE} WHERE run_id = $1 AND identity = $2::jsonb`,
          [identity.runId, identityJson]);
        return result.rows[0]?.payload ?? null;
      });
    },
    put(value, {signal} = {}) {
      const payload = validateProgress(value, value?.identity);
      if (!payload) return Promise.reject(failure('INVALID_PROGRESS'));
      return bounded(true, signal, async assertActive => {
        let result;
        try {
          result = await db.query(PAIRED_PROGRESS_UPSERT_SQL, [
            payload.identity.runId, canonicalJson(payload.identity),
            payload.journalSequence, payload.journalSha256,
            payload.terminal.status, canonicalJson(payload)
          ]);
        } catch {
          // An autocommit query can have committed before its connection failed.
          throw failure('PAIRED_PROGRESS_OUTCOME_UNKNOWN');
        }
        assertActive();
        if (result.rows.length) return {status: 'STORED'};
        const existing = await db.query(
          `SELECT payload FROM ${TABLE} WHERE run_id = $1 AND identity = $2::jsonb`,
          [payload.identity.runId, canonicalJson(payload.identity)]);
        const previous = validateProgress(existing.rows[0]?.payload, payload.identity);
        return {
          status: previous &&
            previous.journalSequence === payload.journalSequence &&
            previous.journalSha256 === payload.journalSha256 &&
            checkpoint(previous) === checkpoint(payload) ? 'IDEMPOTENT' : 'CONFLICT'
        };
      });
    }
  });
}
