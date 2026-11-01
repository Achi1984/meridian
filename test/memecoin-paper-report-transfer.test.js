import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {readFileSync} from "node:fs";
import test from "node:test";
import {projectOperatorReport} from "../scripts/memecoin-paper/operator-report.mjs";
import {canonicalJson} from "../scripts/memecoin-paper/pilot-online.mjs";
import {
  PAPER_REPORT_TRANSFER_SCHEMA,
  transferPostRunReport
} from "../scripts/memecoin-paper-report-transfer/transfer.mjs";
import {
  handlePaperReportRead,
  handleReportGatewayRequest,
  handlePaperReportUpload,
  PAPER_REPORT_MAX_BODY_BYTES,
  readBoundedRequestBody
} from "../report-transfer-gateway.mjs";
import {createPrivateReportStore} from "../private-report-store.mjs";
import {
  PAPER_REPORT_POOL_OPTIONS,
  PAPER_REPORT_STORE_LIMITS
} from "../private-report-store.mjs";
import {reportFixtures} from "./fixtures/memecoin-paper-operator-report/scenarios.mjs";

const RUN_ID = "paper-transfer-run-20261101";
const NOW = Date.parse("2026-11-01T20:00:00.000Z");
const UPLOAD_TOKEN = "synthetic-upload-secret-that-is-never-real";
const configHash = bytes => createHash("sha256").update(bytes).digest("hex");
const uploadTokenHash = createHash("sha256").update(UPLOAD_TOKEN).digest("hex");
const gatewayConfig = {
  enabled: true,
  expectedRunId: RUN_ID,
  expectedConfigHash: "a".repeat(64),
  uploadTokenHash
};

function reportFixture() {
  const report = projectOperatorReport(reportFixtures.readOnlyCheckpoint());
  report.experiment.id = RUN_ID;
  report.experiment.reportStatus = "FINISHED";
  report.evidence.observedFrom = "2026-01-01T10:00:00.000Z";
  report.evidence.observedThrough = "2026-01-01T10:01:00.000Z";
  return report;
}

function transferEnvelope(report = reportFixture(), {
  runId = RUN_ID,
  hash = gatewayConfig.expectedConfigHash
} = {}) {
  return {
    schema: PAPER_REPORT_TRANSFER_SCHEMA,
    runId,
    configHash: hash,
    report
  };
}

function request(bytes, {
  method = "POST",
  authorization = ["Bearer", UPLOAD_TOKEN].join(" "),
  contentType = "application/json",
  url = "/api/private/paper-report/upload"
} = {}) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
    headers: {
      ...(authorization === null ? {} : {authorization}),
      "content-type": contentType,
      "content-length": String(bytes.length)
    }
  };
}

function bodyBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

class MemoryStore {
  constructor() {
    this.rows = new Map();
  }
  async insertImmutable(row) {
    const existing = this.rows.get(row.runId);
    if (!existing) {
      this.rows.set(row.runId, {
        run_id: row.runId,
        config_hash: row.configHash,
        content_sha256: row.digest,
        envelope: row.envelope
      });
      return "INSERTED";
    }
    return existing.config_hash === row.configHash &&
      existing.content_sha256 === row.digest ? "IDENTICAL" : "CONFLICT";
  }
  async get(runId) {
    return this.rows.get(runId) ?? null;
  }
}

async function workerFixture(t, {
  runId = RUN_ID,
  configRunId = runId,
  report = reportFixture(),
  linkReport = false
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-transfer-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const runDirectory = path.join(root, runId);
  await mkdir(runDirectory);
  const configBytes = Buffer.from(canonicalJson({
    mode: "READ_ONLY_PAPER",
    runId: configRunId
  }));
  const hash = configHash(configBytes);
  await writeFile(path.join(runDirectory, "run-config.json"), configBytes);
  await writeFile(path.join(runDirectory, "run.lock"), JSON.stringify({
    version: 1,
    runId,
    configHash: hash
  }));
  await writeFile(path.join(runDirectory, "terminal.json"), JSON.stringify({
    version: 1,
    status: "FINISHED",
    runId,
    configHash: hash
  }));
  if (linkReport) {
    const outside = path.join(root, "outside-report.json");
    await writeFile(outside, "{}");
    await symlink(outside, path.join(runDirectory, "operator-report.json"));
  } else {
    await writeFile(path.join(runDirectory, "operator-report.json"), "{}");
  }
  return {root, hash, report};
}

function makeWorkerOptions(fixture, extra = {}) {
  return {
    enabled: true,
    root: fixture.root,
    runId: RUN_ID,
    expectedRunId: RUN_ID,
    expectedConfigHash: fixture.hash,
    gatewayOrigin: "https://gateway.example",
    uploadToken: UPLOAD_TOKEN,
    now: () => NOW,
    readStatus: async () => ({
      status: "FINISHED",
      runId: RUN_ID,
      configHash: fixture.hash
    }),
    readReport: async () => ({
      status: "AVAILABLE",
      runStatus: "FINISHED",
      report: fixture.report
    }),
    ...extra
  };
}

test("exporter is disabled by default without reading or sending data", async t => {
  const fixture = await workerFixture(t);
  let reads = 0;
  const result = await transferPostRunReport({
    ...makeWorkerOptions(fixture),
    enabled: false,
    readStatus: async () => { reads++; },
    fetchImpl: async () => { reads++; }
  });
  assert.deepEqual(result, {status: "REJECTED", reason: "transfer_disabled"});
  assert.equal(reads, 0);
});

test("one-shot transfer validates terminal/config and sends only the fixed bounded envelope", async t => {
  const fixture = await workerFixture(t);
  const observed = [];
  const result = await transferPostRunReport(makeWorkerOptions(fixture, {
    fetchImpl: async (url, options) => {
      observed.push({url, options});
      return {status: 201};
    }
  }));
  assert.deepEqual(result, {status: "TRANSFERRED", httpStatus: 201});
  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, "https://gateway.example/api/private/paper-report/upload");
  assert.equal(observed[0].options.redirect, "error");
  assert.equal(observed[0].options.method, "POST");
  assert.equal(observed[0].options.headers.authorization, ["Bearer", UPLOAD_TOKEN].join(" "));
  assert.equal(observed[0].options.headers["content-type"], "application/json");
  assert.ok(observed[0].options.body.length <= 256 * 1024);
  assert.equal(observed[0].options.body.includes(UPLOAD_TOKEN), false);
  assert.deepEqual(JSON.parse(observed[0].options.body), transferEnvelope(fixture.report, {hash: fixture.hash}));
});

test("partial and UNKNOWN terminal states and expected run/config mismatches never send", async t => {
  const fixture = await workerFixture(t);
  let sends = 0;
  const base = makeWorkerOptions(fixture, {fetchImpl: async () => { sends++; return {status: 201}; }});
  for (const changed of [
    {readStatus: async () => ({status: "UNKNOWN", runId: RUN_ID, configHash: fixture.hash})},
    {readStatus: async () => ({status: "FINISHED", runId: RUN_ID, configHash: fixture.hash}),
      readReport: async () => ({status: "AVAILABLE", runStatus: "UNKNOWN", report: fixture.report})},
    {readReport: async () => ({
      status: "AVAILABLE",
      runStatus: "FINISHED",
      report: {...fixture.report, experiment: {...fixture.report.experiment, reportStatus: "INCOMPLETE"}}
    })},
    {runId: "another-run"},
    {expectedConfigHash: "b".repeat(64)}
  ]) {
    const result = await transferPostRunReport({...base, ...changed});
    assert.equal(result.status, "REJECTED");
  }
  assert.equal(sends, 0);
});

test("exporter rejects symlinked run files and run directories", async t => {
  const linkedFile = await workerFixture(t, {linkReport: true});
  let reads = 0;
  assert.equal((await transferPostRunReport(makeWorkerOptions(linkedFile, {
    readReport: async () => { reads++; }
  }))).reason, "run_directory_unsafe_or_missing");
  assert.equal(reads, 0);

  const root = await mkdtemp(path.join(os.tmpdir(), "paper-transfer-link-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const real = await workerFixture(t);
  const outside = path.join(root, "outside");
  await symlink(path.join(real.root, RUN_ID), outside);
  const result = await transferPostRunReport(makeWorkerOptions(real, {root, fetchImpl: async () => ({status: 201})}));
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "run_directory_unsafe_or_missing");
});

test("invalid origins and redirects fail without retries or credential leakage", async t => {
  const fixture = await workerFixture(t);
  let calls = 0;
  const options = makeWorkerOptions(fixture, {
    fetchImpl: async () => { calls++; throw new Error("redirect rejected"); }
  });
  assert.equal((await transferPostRunReport({...options, gatewayOrigin: "http://gateway.example"})).reason,
    "gateway_origin_invalid");
  assert.equal((await transferPostRunReport({...options, gatewayOrigin: "https://gateway.example/path"})).reason,
    "gateway_origin_invalid");
  const result = await transferPostRunReport(options);
  assert.equal(result.reason, "transfer_unavailable");
  assert.equal(calls, 1);
});

test("exporter deadline aborts transport and bounds transfer duration", async t => {
  const fixture = await workerFixture(t);
  const result = await transferPostRunReport(makeWorkerOptions(fixture, {
    timeoutMs: 50,
    schedule(callback) {
      const timer = setTimeout(callback, 0);
      return timer;
    },
    fetchImpl: async (_url, options) => {
      assert.equal(options.signal instanceof AbortSignal, true);
      await new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
      });
      return {status: 201};
    }
  }));
  assert.equal(result.reason, "transfer_outcome_unknown");
});

test("never-settling fetch returns UNKNOWN once and retains a single in-flight transfer", async t => {
  const fixture = await workerFixture(t);
  let releaseFetch;
  const options = makeWorkerOptions(fixture, {
    timeoutMs: 5,
    schedule(callback) { return setTimeout(callback, 0); },
    fetchImpl: () => new Promise(resolve => { releaseFetch = resolve; })
  });
  const first = await transferPostRunReport(options);
  assert.equal(first.reason, "transfer_outcome_unknown");
  assert.equal((await transferPostRunReport(options)).reason, "transfer_busy");
  releaseFetch({status: 201});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await transferPostRunReport({
    ...options,
    fetchImpl: async () => ({status: 201})
  })).status, "TRANSFERRED");
});

test("late HTTP response body is cancelled before releasing the transfer slot", async t => {
  const fixture = await workerFixture(t);
  let resolveFetch;
  let finishCancel;
  let cancelStarted = false;
  const options = makeWorkerOptions(fixture, {
    timeoutMs: 5,
    schedule(callback) { return setTimeout(callback, 0); },
    fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; })
  });
  assert.equal((await transferPostRunReport(options)).reason, "transfer_outcome_unknown");
  resolveFetch({
    status: 201,
    body: {cancel: () => {
      cancelStarted = true;
      return new Promise(resolve => { finishCancel = resolve; });
    }}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelStarted, true);
  assert.equal((await transferPostRunReport(options)).reason, "transfer_busy");
  finishCancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await transferPostRunReport({
    ...options,
    fetchImpl: async () => ({status: 201})
  })).status, "TRANSFERRED");
});

test("gateway checks enablement and the dedicated upload credential before reading the body", async () => {
  const bytes = bodyBytes(transferEnvelope());
  const store = new MemoryStore();
  let bodyReads = 0;
  const readBody = async () => { bodyReads++; return bytes; };
  const disabled = await handlePaperReportUpload(request(bytes), {
    config: {...gatewayConfig, enabled: false}, store, readBody
  });
  const wrongCredential = await handlePaperReportUpload(request(bytes, {
    authorization: ["Bearer", "not-the-upload-secret"].join(" ")
  }), {config: gatewayConfig, store, readBody});
  assert.equal(disabled.status, 503);
  assert.equal(wrongCredential.status, 401);
  assert.equal(bodyReads, 0);
});

test("gateway rejects run/config mismatch, future data, wrong media type, and query selectors", async () => {
  const store = new MemoryStore();
  const mismatch = await handlePaperReportUpload(request(bodyBytes(transferEnvelope(undefined, {
    runId: "different-run"
  }))), {config: gatewayConfig, store});
  const badHash = await handlePaperReportUpload(request(bodyBytes(transferEnvelope(undefined, {
    hash: "b".repeat(64)
  }))), {config: gatewayConfig, store});
  const futureReport = reportFixture();
  futureReport.evidence.observedThrough = "2026-12-01T00:00:00.000Z";
  const future = await handlePaperReportUpload(request(bodyBytes(transferEnvelope(futureReport))), {
    config: gatewayConfig, store, now: () => NOW
  });
  const media = await handlePaperReportUpload(request(bodyBytes(transferEnvelope()), {
    contentType: "text/plain"
  }), {config: gatewayConfig, store});
  const query = await handlePaperReportUpload(request(bodyBytes(transferEnvelope()), {
    url: "/api/private/paper-report/upload?runId=other"
  }), {config: gatewayConfig, store});
  const malformed = await handlePaperReportUpload(request(Buffer.from("{not-json")), {
    config: gatewayConfig, store
  });
  assert.deepEqual([mismatch.status, badHash.status, future.status, media.status, query.status,
    malformed.status], [400, 400, 400, 415, 400, 400]);
});

test("gateway rejects an oversized declared body without consuming it", async () => {
  const bytes = bodyBytes(transferEnvelope());
  const req = request(bytes);
  req.headers["content-length"] = String(PAPER_REPORT_MAX_BODY_BYTES + 1);
  let consumed = false;
  const response = await handlePaperReportUpload(req, {
    config: gatewayConfig,
    store: new MemoryStore(),
    readBody: async () => { consumed = true; return bytes; }
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.error, "request_body_too_large");
  assert.equal(consumed, false);
});

test("gateway stores immutable reports, serves a fixed read envelope, and validates stored digest", async () => {
  const store = new MemoryStore();
  const bytes = bodyBytes(transferEnvelope());
  const first = await handlePaperReportUpload(request(bytes), {config: gatewayConfig, store, now: () => NOW});
  const retry = await handlePaperReportUpload(request(bytes), {config: gatewayConfig, store, now: () => NOW});
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  const read = await handlePaperReportRead({
    method: "GET",
    url: "/api/private/paper-report",
    headers: {}
  }, {config: gatewayConfig, store, now: () => NOW});
  assert.equal(read.status, 200);
  assert.equal(read.body.schema, "MEMECOIN_PAPER_REPORT_BRIDGE_ENVELOPE_V1");
  assert.equal(read.body.runId, RUN_ID);
  assert.equal(Object.hasOwn(read.body, "configHash"), false);
  assert.equal(JSON.stringify(read.body).length <= PAPER_REPORT_MAX_BODY_BYTES, true);

  const row = store.rows.get(RUN_ID);
  row.content_sha256 = "f".repeat(64);
  const corrupt = await handlePaperReportRead({
    method: "GET", url: "/api/private/paper-report", headers: {}
  }, {config: gatewayConfig, store, now: () => NOW});
  assert.equal(corrupt.status, 503);
  assert.equal(corrupt.body.error, "paper_report_corrupt");
});

test("gateway GET reports absent, disabled, and unavailable states without exposing storage errors", async () => {
  const request = {method: "GET", url: "/api/private/paper-report", headers: {}};
  assert.equal((await handlePaperReportRead(request, {
    config: {...gatewayConfig, enabled: false}, store: new MemoryStore()
  })).body.error, "paper_report_disabled");
  assert.equal((await handlePaperReportRead(request, {
    config: gatewayConfig, store: new MemoryStore()
  })).status, 404);
  const unavailable = await handlePaperReportRead(request, {
    config: gatewayConfig,
    store: {get: async () => { throw new Error("/private/path/database-password"); }}
  });
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.stringify(unavailable).includes("/private/path"), false);
  assert.equal((await handlePaperReportRead({
    ...request, url: "/api/private/paper-report?path=/etc/passwd"
  }, {config: gatewayConfig, store: new MemoryStore()})).status, 400);
});

test("gateway dispatcher applies the existing read authorizer only to GET and keeps upload credentials separate", async () => {
  const getRequest = {
    method: "GET",
    url: "/api/private/paper-report",
    headers: {}
  };
  let storeLookups = 0;
  const denied = await handleReportGatewayRequest(getRequest, {
    config: gatewayConfig,
    authorizedRead: () => false,
    getStore: () => { storeLookups++; return new MemoryStore(); }
  });
  assert.equal(denied.status, 401);
  assert.equal(storeLookups, 0);

  const authorized = await handleReportGatewayRequest(getRequest, {
    config: gatewayConfig,
    authorizedRead: () => true,
    getStore: () => { storeLookups++; return new MemoryStore(); }
  });
  assert.equal(authorized.status, 404);
  assert.equal(storeLookups, 1);
});

test("bounded body reader enforces byte and deadline caps and cancels input", async () => {
  const oversized = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(5);
    },
    pause() { this.paused = true; }
  };
  await assert.rejects(readBoundedRequestBody(oversized, {maxBytes: 4}), error =>
    error.code === "BODY_TOO_LARGE");
  assert.equal(oversized.paused, true);

  const stalled = {
    [Symbol.asyncIterator]() { return {next: () => new Promise(() => {}), return: async () => ({done: true})}; },
    pause() { this.paused = true; }
  };
  await assert.rejects(readBoundedRequestBody(stalled, {
    timeoutMs: 5,
    schedule(callback) { return setTimeout(callback, 0); }
  }), error => error.code === "BODY_TIMEOUT");
  assert.equal(stalled.paused, true);
});

test("PostgreSQL store uses unique-key transactions for identical and conflicting concurrent imports", async () => {
  const rows = new Map();
  const commands = [];
  const db = {
    async connect() {
      return {
        async query(sql, values = []) {
          commands.push(sql.trim().split(/\s+/)[0]);
          if (sql.includes("INSERT INTO meridian_paper_reports")) {
            const [runId, config, digest, envelope] = values;
            if (rows.has(runId)) return {rowCount: 0, rows: []};
            rows.set(runId, {
              run_id: runId,
              config_hash: config,
              content_sha256: digest,
              envelope: JSON.parse(envelope)
            });
            return {rowCount: 1, rows: [{run_id: runId}]};
          }
          if (sql.includes("SELECT config_hash")) {
            const row = rows.get(values[0]);
            return {rows: row ? [{config_hash: row.config_hash, content_sha256: row.content_sha256}] : []};
          }
          if (sql.includes("SELECT run_id")) {
            const row = rows.get(values[0]);
            return {rows: row ? [row] : []};
          }
          return {rowCount: 0, rows: []};
        },
        release() {}
      };
    },
    async query(sql, values) {
      const row = rows.get(values[0]);
      return {rows: row ? [row] : []};
    }
  };
  const store = createPrivateReportStore(db);
  const envelope = transferEnvelope();
  const digest = configHash(bodyBytes(envelope));
  const first = {runId: RUN_ID, configHash: gatewayConfig.expectedConfigHash, digest, envelope};
  const differentEnvelope = transferEnvelope(reportFixture());
  differentEnvelope.report.valuation.cashCents = "123";
  const different = {...first, digest: configHash(bodyBytes(differentEnvelope)), envelope: differentEnvelope};
  const identicalResults = await Promise.all([
    store.insertImmutable(first),
    store.insertImmutable(first)
  ]);
  assert.deepEqual(identicalResults.sort(), ["IDENTICAL", "INSERTED"]);
  assert.equal(await store.insertImmutable(different), "CONFLICT");
  assert.deepEqual(commands.filter(value => ["BEGIN", "COMMIT"].includes(value)).length, 6);
  assert.equal((await store.get(RUN_ID)).content_sha256, digest);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return {promise, resolve, reject};
}

function rowFor(input) {
  return {
    run_id: input.runId,
    config_hash: input.configHash,
    content_sha256: input.digest,
    envelope: input.envelope
  };
}

test("report store has bounded dedicated pool, statement, lock, and operation budgets", () => {
  assert.deepEqual(PAPER_REPORT_POOL_OPTIONS, {
    max: 2,
    connectionTimeoutMillis: 1_500,
    statement_timeout: 3_500,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 4_500
  });
  assert.deepEqual(PAPER_REPORT_STORE_LIMITS, {maxConcurrent: 2, operationTimeoutMs: 6_000});
});

test("stalled connection acquisition times out to UNKNOWN but retains admission until it settles", async () => {
  let connectCalls = 0;
  const db = {
    connect() {
      connectCalls++;
      return new Promise(() => {});
    },
    query() { throw new Error("pool query must not be used"); }
  };
  const store = createPrivateReportStore(db, {maxConcurrent: 1, operationTimeoutMs: 5});
  const input = {
    runId: RUN_ID, configHash: gatewayConfig.expectedConfigHash,
    digest: "b".repeat(64), envelope: transferEnvelope()
  };
  await assert.rejects(store.insertImmutable(input), error =>
    error.code === "PAPER_REPORT_OUTCOME_UNKNOWN");
  assert.equal(store.activeCount(), 1);
  await assert.rejects(store.insertImmutable(input), error => error.code === "STORE_BUSY");
  assert.equal(connectCalls, 1);
  assert.equal(store.activeCount(), 1);
});

test("cancelled pending query rolls back before releasing the held store slot", async () => {
  const pendingInsert = deferred();
  let insertStarted;
  insertStarted = deferred();
  let rollbackCount = 0;
  let commitCount = 0;
  const db = {
    async connect() {
      return {
        async query(sql) {
          if (sql === "INSERT INTO meridian_paper_reports") return pendingInsert.promise;
          if (sql.startsWith("INSERT INTO")) {
            insertStarted.resolve();
            return pendingInsert.promise;
          }
          if (sql === "ROLLBACK") rollbackCount++;
          if (sql === "COMMIT") commitCount++;
          return {rowCount: 0, rows: []};
        },
        release() {}
      };
    },
    async query() { return {rows: []}; }
  };
  const store = createPrivateReportStore(db, {operationTimeoutMs: 1_000});
  const controller = new AbortController();
  const operation = store.insertImmutable({
    runId: RUN_ID, configHash: gatewayConfig.expectedConfigHash,
    digest: "c".repeat(64), envelope: transferEnvelope(), signal: controller.signal
  });
  await insertStarted.promise;
  controller.abort();
  await assert.rejects(operation, error => error.code === "PAPER_REPORT_OUTCOME_UNKNOWN");
  assert.equal(store.activeCount(), 1);
  pendingInsert.resolve({rowCount: 1, rows: [{run_id: RUN_ID}]});
  for (let tries = 0; store.activeCount() && tries < 10; tries++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(rollbackCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(store.activeCount(), 0);
});

test("timed-out insert lock wait reports UNKNOWN and retains the slot until rollback settles", async () => {
  const pendingLock = deferred();
  const lockStarted = deferred();
  let rollbackCount = 0;
  let commitCount = 0;
  const db = {
    async connect() {
      return {
        async query(sql) {
          if (sql.startsWith("INSERT INTO")) {
            lockStarted.resolve();
            return pendingLock.promise;
          }
          if (sql === "ROLLBACK") rollbackCount++;
          if (sql === "COMMIT") commitCount++;
          return {rowCount: 0, rows: []};
        },
        release() {}
      };
    },
    async query() { return {rows: []}; }
  };
  const store = createPrivateReportStore(db, {maxConcurrent: 1, operationTimeoutMs: 5});
  const operation = store.insertImmutable({
    runId: RUN_ID, configHash: gatewayConfig.expectedConfigHash,
    digest: "d".repeat(64), envelope: transferEnvelope()
  });
  await lockStarted.promise;
  await assert.rejects(operation, error => error.code === "PAPER_REPORT_OUTCOME_UNKNOWN");
  assert.equal(store.activeCount(), 1);
  pendingLock.resolve({rowCount: 1, rows: [{run_id: RUN_ID}]});
  for (let tries = 0; store.activeCount() && tries < 10; tries++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(rollbackCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(store.activeCount(), 0);
});

test("failed rollback destroys the client and keeps the write outcome UNKNOWN", async () => {
  let releaseError = null;
  const db = {
    async connect() {
      return {
        async query(sql) {
          if (sql.startsWith("INSERT INTO")) return {rowCount: 0, rows: []};
          if (sql.startsWith("SELECT config_hash")) return {rows: []};
          if (sql === "ROLLBACK") throw new Error("rollback failed");
          return {rowCount: 0, rows: []};
        },
        release(error) { releaseError = error; }
      };
    },
    async query() { return {rows: []}; }
  };
  const store = createPrivateReportStore(db);
  await assert.rejects(store.insertImmutable({
    runId: RUN_ID, configHash: gatewayConfig.expectedConfigHash,
    digest: "e".repeat(64), envelope: transferEnvelope()
  }), error => error.code === "PAPER_REPORT_OUTCOME_UNKNOWN");
  assert.equal(releaseError?.code, "PAPER_REPORT_OUTCOME_UNKNOWN");
});

test("late database commit returns UNKNOWN, caps repeated requests, and permits idempotent retry", async () => {
  const commitGate = deferred();
  const committed = new Map();
  let delayedCommit = true;
  const db = {
    async connect() {
      let pending = null;
      return {
        async query(sql, values = []) {
          if (sql.startsWith("INSERT INTO meridian_paper_reports")) {
            const [runId, configHashValue, digestValue, json] = values;
            if (committed.has(runId)) return {rowCount: 0, rows: []};
            pending = {
              run_id: runId,
              config_hash: configHashValue,
              content_sha256: digestValue,
              envelope: JSON.parse(json)
            };
            return {rowCount: 1, rows: [{run_id: runId}]};
          }
          if (sql.startsWith("SELECT config_hash")) {
            const row = committed.get(values[0]);
            return {rows: row ? [{
              config_hash: row.config_hash,
              content_sha256: row.content_sha256
            }] : []};
          }
          if (sql === "COMMIT") {
            if (delayedCommit) {
              delayedCommit = false;
              await commitGate.promise;
            }
            if (pending) committed.set(pending.run_id, pending);
            return {rowCount: 0, rows: []};
          }
          return {rowCount: 0, rows: []};
        },
        release() {}
      };
    },
    async query(sql, values) {
      const row = committed.get(values[0]);
      return {rows: row ? [row] : []};
    }
  };
  const store = createPrivateReportStore(db, {maxConcurrent: 1, operationTimeoutMs: 5});
  const envelope = transferEnvelope();
  const bytes = bodyBytes(envelope);
  const first = await handlePaperReportUpload(request(bytes), {
    config: gatewayConfig,
    store,
    now: () => NOW
  });
  assert.equal(first.status, 503);
  assert.equal(first.body.error, "paper_report_outcome_unknown");
  assert.equal(committed.has(RUN_ID), false);
  assert.equal(store.activeCount(), 1);

  const repeated = await handlePaperReportUpload(request(bytes), {
    config: gatewayConfig,
    store,
    now: () => NOW
  });
  assert.equal(repeated.status, 503);
  assert.equal(repeated.body.error, "paper_report_busy");

  commitGate.resolve();
  for (let tries = 0; store.activeCount() && tries < 10; tries++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(store.activeCount(), 0);
  assert.equal(committed.has(RUN_ID), true);

  const retry = await handlePaperReportUpload(request(bytes), {
    config: gatewayConfig,
    store,
    now: () => NOW
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.idempotent, true);
});

test("bounded route admissions reject repeated body requests before reading beyond the cap", async () => {
  const bytes = bodyBytes(transferEnvelope());
  const store = new MemoryStore();
  const waiting = [];
  const readBody = () => new Promise(resolve => waiting.push(resolve));
  const pending = Array.from({length: 4}, () => handlePaperReportUpload(request(bytes), {
    config: gatewayConfig,
    store,
    readBody,
    now: () => NOW
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waiting.length, 4);
  let fifthRead = false;
  const fifth = await handlePaperReportUpload(request(bytes), {
    config: gatewayConfig,
    store,
    readBody: async () => { fifthRead = true; return bytes; },
    now: () => NOW
  });
  assert.equal(fifth.status, 503);
  assert.equal(fifth.body.error, "paper_report_busy");
  assert.equal(fifthRead, false);
  for (const resolve of waiting) resolve(bytes);
  const results = await Promise.all(pending);
  assert.equal(results.length, 4);
});

test("gateway route is fixed, upload precedes the read guard, and existing routes remain present", () => {
  const source = readFileSync(new URL("../server-gateway.js", import.meta.url), "utf8");
  const dispatch = source.indexOf("handleReportGatewayRequest(req");
  const readGuard = source.indexOf("if(isProtected(u.pathname)&&!authorizedRead(req))");
  const reportRoutes = readFileSync(new URL("../report-transfer-gateway.mjs", import.meta.url), "utf8");
  assert.ok(dispatch > 0 && dispatch < readGuard);
  assert.match(reportRoutes, /pathname === "\/api\/private\/paper-report\/upload"/);
  assert.match(reportRoutes, /pathname === "\/api\/private\/paper-report"/);
  assert.match(reportRoutes, /authorizedRead\(req\)/);
  assert.doesNotMatch(source, /paper-report/);
  for (const route of [
    "/api/private/dashboard",
    "/api/private/paper-execution-audit-v2",
    "/api/private/portfolio-history"
  ]) assert.ok(source.includes(`u.pathname==="${route}"`));
});

test("gateway config requires only a hash and a dedicated bearer cannot be confused with read auth", async () => {
  const env = {
    MERIDIAN_PAPER_REPORT_UPLOAD_ENABLED: "true",
    MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID: RUN_ID,
    MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256: gatewayConfig.expectedConfigHash,
    MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN_SHA256: uploadTokenHash,
    MERIDIAN_READ_TOKEN_SHA256: createHash("sha256").update("read-only-token").digest("hex")
  };
  const {reportTransferGatewayConfig} = await import("../report-transfer-gateway.mjs");
  const config = reportTransferGatewayConfig(env);
  assert.equal(Object.hasOwn(config, "uploadToken"), false);
  const bytes = bodyBytes(transferEnvelope());
  const result = await handlePaperReportUpload(request(bytes, {
    authorization: ["Bearer", "read-only-token"].join(" ")
  }), {config, store: new MemoryStore()});
  assert.equal(result.status, 401);
});

test("test fixture module exports the existing report contract without mutating dependency files", () => {
  assert.equal(typeof reportFixture().experiment.id, "string");
  assert.equal(readFileSync(new URL("../scripts/memecoin-paper-report-bridge/contract.mjs", import.meta.url), "utf8")
    .includes("export function decodePaperReportEnvelope"), true);
});
