export const PAPER_REPORT_POOL_OPTIONS = Object.freeze({
  max: 2,
  connectionTimeoutMillis: 1_500,
  statement_timeout: 3_500,
  lock_timeout: 1_000,
  idle_in_transaction_session_timeout: 4_500
});

export const PAPER_REPORT_STORE_LIMITS = Object.freeze({
  maxConcurrent: 2,
  operationTimeoutMs: 6_000
});

function storeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertActive(signal) {
  if (signal.aborted) throw storeError("STORE_CANCELLED");
}

export function createPrivateReportStore(db, {
  maxConcurrent = PAPER_REPORT_STORE_LIMITS.maxConcurrent,
  operationTimeoutMs = PAPER_REPORT_STORE_LIMITS.operationTimeoutMs,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (!db || typeof db.connect !== "function" || typeof db.query !== "function") return null;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2 ||
      !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 ||
      operationTimeoutMs > 10_000 || typeof schedule !== "function" ||
      typeof cancelSchedule !== "function") {
    throw new TypeError("invalid private report store limits");
  }

  let active = 0;

  function runBounded(kind, externalSignal, operation) {
    if (externalSignal?.aborted) {
      return Promise.reject(storeError("STORE_CANCELLED"));
    }
    if (active >= maxConcurrent) return Promise.reject(storeError("STORE_BUSY"));
    active += 1;

    const controller = new AbortController();
    let timer;
    let resolveDeadline;
    let removeAbort = () => {};
    const deadline = new Promise(resolve => { resolveDeadline = resolve; });
    const abort = code => {
      if (controller.signal.aborted) return;
      controller.abort();
      resolveDeadline({type: code});
    };

    try {
      timer = schedule(() => abort("timeout"), operationTimeoutMs);
      if (timer === undefined || timer === null) {
        active -= 1;
        return Promise.reject(storeError("STORE_DEADLINE_UNAVAILABLE"));
      }
    } catch {
      active -= 1;
      return Promise.reject(storeError("STORE_DEADLINE_UNAVAILABLE"));
    }

    if (externalSignal) {
      const onAbort = () => abort("cancelled");
      externalSignal.addEventListener("abort", onAbort, {once: true});
      removeAbort = () => externalSignal.removeEventListener("abort", onAbort);
      if (externalSignal.aborted) onAbort();
    }

    const work = Promise.resolve().then(() => operation(controller.signal)).finally(() => {
      active -= 1;
    });
    const observedWork = work.then(
      value => ({type: "value", value}),
      error => ({type: "error", error})
    );

    return Promise.race([observedWork, deadline]).then(outcome => {
      if (outcome.type === "value") return outcome.value;
      if (outcome.type === "error") throw outcome.error;
      if (kind === "write") throw storeError("PAPER_REPORT_OUTCOME_UNKNOWN");
      throw storeError(outcome.type === "timeout" ? "STORE_TIMEOUT" : "STORE_CANCELLED");
    }).finally(() => {
      removeAbort();
      if (timer !== undefined && timer !== null) {
        try { cancelSchedule(timer); } catch { }
      }
    });
  }

  async function connectAndBegin(signal) {
    assertActive(signal);
    const client = await db.connect();
    let transaction = false;
    try {
      assertActive(signal);
      await client.query("BEGIN");
      transaction = true;
      assertActive(signal);
      await client.query("SET LOCAL statement_timeout = '3500ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '4500ms'");
      assertActive(signal);
      return {client, transaction: true};
    } catch (error) {
      let releaseError;
      if (transaction) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          releaseError = rollbackError;
        }
      } else {
        releaseError = error;
      }
      client.release(releaseError);
      throw error;
    }
  }

  async function rollback(client, transaction, error, writeAttempted, commitStarted, kind) {
    if (!transaction) return true;
    if (commitStarted && kind === "write") error.code = "PAPER_REPORT_OUTCOME_UNKNOWN";
    try {
      await client.query("ROLLBACK");
      return true;
    } catch {
      if (kind === "write" && (commitStarted || writeAttempted)) {
        error.code = "PAPER_REPORT_OUTCOME_UNKNOWN";
      }
      return false;
    }
  }

  async function withTransaction(signal, kind, operation) {
    const {client} = await connectAndBegin(signal);
    let transaction = true;
    let writeAttempted = false;
    let commitStarted = false;
    let released = false;
    try {
      const result = await operation(client, signal, () => { writeAttempted = true; });
      assertActive(signal);
      commitStarted = true;
      await client.query("COMMIT");
      transaction = false;
      return result;
    } catch (error) {
      const rolledBack = await rollback(
        client, transaction, error, writeAttempted, commitStarted, kind
      );
      if (!rolledBack) {
        client.release(error);
        released = true;
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }

  return Object.freeze({
    insertImmutable({runId, configHash, digest, envelope, signal}) {
      return runBounded("write", signal, internalSignal => withTransaction(
        internalSignal,
        "write",
        async (client, activeSignal, markWrite) => {
          markWrite();
          const inserted = await client.query(
            `INSERT INTO meridian_paper_reports
               (run_id, config_hash, content_sha256, envelope)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (run_id) DO NOTHING
             RETURNING run_id`,
            [runId, configHash, digest, JSON.stringify(envelope)]
          );
          assertActive(activeSignal);
          if (inserted.rowCount === 1) return "INSERTED";

          const existing = await client.query(
            `SELECT config_hash, content_sha256
               FROM meridian_paper_reports
              WHERE run_id = $1
              FOR SHARE`,
            [runId]
          );
          const row = existing.rows[0];
          if (!row) throw storeError("PAPER_REPORT_OUTCOME_UNKNOWN");
          return row.config_hash === configHash && row.content_sha256 === digest
            ? "IDENTICAL"
            : "CONFLICT";
        }
      ));
    },

    get(runId, {signal} = {}) {
      return runBounded("read", signal, internalSignal => withTransaction(
        internalSignal,
        "read",
        async (client, activeSignal) => {
          const result = await client.query(
            `SELECT run_id, config_hash, content_sha256, envelope
               FROM meridian_paper_reports
              WHERE run_id = $1`,
            [runId]
          );
          assertActive(activeSignal);
          return result.rows[0] ?? null;
        }
      ));
    },

    activeCount() {
      return active;
    }
  });
}
