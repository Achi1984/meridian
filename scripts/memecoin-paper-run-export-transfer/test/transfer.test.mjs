import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readdir, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, {before, after} from "node:test";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../../memecoin-paper/paper-pilot-composition.mjs";
import {canonicalCheckpointBytes} from "../../memecoin-paper/checkpoint-store.mjs";
import {
  createExportTransfer, createFileReceiver, createInProcessTransport, MAX_TRANSFER_BYTES
} from "../index.mjs";

const PRIVATE_ORIGIN = "https://paper-private.example";
const WRITE_AUTH = "fixture-write-authorization";
const READ_AUTH = "fixture-read-authorization";
const START = Date.parse("2026-01-01T19:00:00Z");
const BUDGETS = {
  requests: 12, bytes: 1_000_000, events: 128, candidates: 4, cycles: 4,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
};
let temporaryRoot;
let exportsByFault;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedFor(run) {
  return {
    runId: run.report.runId,
    configSha256: run.report.configSha256,
    producerRevision: run.report.producerRevision
  };
}

async function produce(runId, fault) {
  const config = {
    version: 1,
    mode: "SYNTHETIC_TEST_ONLY",
    enabled: true,
    runId,
    startedAt: START,
    budgets: {...BUDGETS}
  };
  const clock = createSyntheticClock({wallStart: START + 5_000, monotonicStart: 100});
  const result = await createPaperPilotComposition({
    config,
    dataDirectory: path.join(temporaryRoot, `run-${fault.toLowerCase()}`),
    clock,
    adapters: offlineFixtureAdapters({clock, fault})
  }).start();
  return {result, report: result.report};
}

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "paper-export-transfer-"));
  exportsByFault = {
    NONE: await produce("transfer-roundtrip", "NONE"),
    NO_MARK: await produce("transfer-open-unvalued", "NO_MARK")
  };
});

after(async () => {
  await rm(temporaryRoot, {recursive: true, force: true});
});

function makeReceiver(t, name = "receiver") {
  const receiver = createFileReceiver({
    directory: path.join(temporaryRoot, `${name}-${Math.random().toString(16).slice(2)}`),
    privateOrigin: PRIVATE_ORIGIN,
    authorizeWrite: authorization => authorization === WRITE_AUTH,
    authorizeRead: authorization => authorization === READ_AUTH
  });
  return receiver;
}

function makeClient(receiver, options = {}) {
  return createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: createInProcessTransport(receiver),
    ...options
  });
}

function bytesOf(run) {
  return Buffer.from(JSON.stringify(run.report), "utf8");
}

function requestFor(run, bytes, authorization = WRITE_AUTH) {
  const expected = expectedFor(run);
  return {
    schema: "memecoin-paper-run-export-transfer/v1",
    origin: PRIVATE_ORIGIN,
    identity: expected,
    exportSha256: hash(bytes),
    byteLength: bytes.byteLength,
    bytes,
    authorization
  };
}

test("disabled by default; transfer requires explicit one-shot authorization", async () => {
  let calls = 0;
  const disabled = createExportTransfer({
    transport: {put: async () => { calls++; }, get: async () => { calls++; }}
  });
  assert.deepEqual(await disabled.transfer(), {status: "DISABLED"});
  assert.deepEqual(await disabled.readback(), {status: "DISABLED"});
  assert.equal(calls, 0);

  const receiver = makeReceiver();
  const client = makeClient(receiver);
  const run = exportsByFault.NONE;
  assert.deepEqual(await client.transfer({
    exportBytes: bytesOf(run), expected: expectedFor(run), writeAuthorization: WRITE_AUTH
  }), {status: "REJECTED", code: "INVALID_TRANSFER_REQUEST"});
  assert.deepEqual(await client.transfer({
    exportBytes: bytesOf(run), expected: expectedFor(run), writeAuthorization: WRITE_AUTH,
    explicitlyAuthorized: true
  }), {status: "REJECTED", code: "ONE_SHOT_ALREADY_USED"});
});

test("actual canonical run-export roundtrips and the independent evaluator reads downloaded bytes", async t => {
  const run = exportsByFault.NONE;
  const expected = expectedFor(run);
  const bytes = bytesOf(run);
  const receiver = makeReceiver(t);
  const client = makeClient(receiver);
  const transfer = await client.transfer({
    exportBytes: (async function* () {
      yield bytes.subarray(0, Math.floor(bytes.byteLength / 2));
      yield bytes.subarray(Math.floor(bytes.byteLength / 2));
    })(),
    expected,
    writeAuthorization: WRITE_AUTH,
    explicitlyAuthorized: true
  });

  assert.equal(run.result.status, "FINISHED");
  assert.equal(transfer.status, "TRANSFER_ACKNOWLEDGED");
  assert.equal(transfer.checkpointAcknowledged, false);
  assert.equal(transfer.exportSha256, hash(bytes));
  const readback = await client.readback({expected, readAuthorization: READ_AUTH});
  assert.equal(readback.status, "READ_BACK");
  assert.equal(readback.exportSha256, hash(bytes));
  assert.equal(readback.byteLength, bytes.byteLength);
  assert.deepEqual(Buffer.from(JSON.stringify(readback.exportValue)), bytes);
  assert.equal(readback.evaluation.overall, "PASS");
  assert.equal(readback.evaluation.identity.runId, expected.runId);
  assert.equal(readback.evaluation.identity.configSha256, expected.configSha256);
  assert.equal(readback.evaluation.identity.producerRevision, expected.producerRevision);
});

test("open unvalued positions and missing valuation fields survive unchanged as UNKNOWN", async t => {
  const run = exportsByFault.NO_MARK;
  const expected = expectedFor(run);
  const bytes = bytesOf(run);
  const client = makeClient(makeReceiver(t));
  assert.equal((await client.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  })).status, "TRANSFER_ACKNOWLEDGED");

  const readback = await client.readback({expected, readAuthorization: READ_AUTH});
  assert.equal(readback.status, "READ_BACK");
  assert.deepEqual(Buffer.from(JSON.stringify(readback.exportValue)), bytes);
  assert.equal(readback.evaluation.overall, "UNKNOWN");
  assert.equal(readback.evaluation.evidence.openPositions, 1);
  assert.equal(readback.exportValue.runnerReport.terminalResult.openPositions[0].markStatus,
    "VALUATION_UNAVAILABLE");
  assert.equal(readback.exportValue.runnerReport.summary.pnl.unrealizedGrossCents, null);
  assert.equal(readback.exportValue.runnerReport.summary.pnl.unrealizedNetCents, null);
});

test("receiver requires separate scoped authorizers and binds identity, length, and digest", async t => {
  const run = exportsByFault.NONE;
  const bytes = bytesOf(run);
  const receiver = makeReceiver(t);
  const request = requestFor(run, bytes, "wrong-write-authorization");
  assert.equal((await receiver.put(request)).status, "REJECTED");
  assert.equal((await receiver.get({
    schema: request.schema,
    origin: PRIVATE_ORIGIN,
    identity: expectedFor(run),
    authorization: "wrong-read-authorization"
  })).status, "REJECTED");

  const wrongIdentity = requestFor(run, bytes);
  wrongIdentity.identity = {...wrongIdentity.identity, runId: "different-run"};
  assert.equal((await receiver.put(wrongIdentity)).status, "REJECTED");
  const wrongDigest = requestFor(run, bytes);
  wrongDigest.exportSha256 = "0".repeat(64);
  assert.equal((await receiver.put(wrongDigest)).status, "REJECTED");
  const wrongLength = requestFor(run, bytes);
  wrongLength.byteLength++;
  assert.equal((await receiver.put(wrongLength)).status, "REJECTED");

  const client = makeClient(receiver);
  const identity = expectedFor(run);
  const sent = await client.transfer({
    exportBytes: bytes, expected: identity, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  });
  assert.equal(sent.status, "TRANSFER_ACKNOWLEDGED");
  assert.deepEqual(await client.readback({expected: identity, readAuthorization: WRITE_AUTH}), {
    status: "REJECTED", code: "INVALID_READ_REQUEST"
  });
  assert.deepEqual(await client.readback({
    expected: {...identity, runId: "other-run"}, readAuthorization: READ_AUTH
  }), {status: "REJECTED", code: "INVALID_READ_REQUEST"});
});

test("same bytes are idempotent; different bytes conflict without changing the original", async t => {
  const run = exportsByFault.NONE;
  const original = bytesOf(run);
  const receiver = makeReceiver(t);
  assert.equal((await receiver.put(requestFor(run, original))).status, "STORED");
  assert.equal((await receiver.put(requestFor(run, original))).status, "DUPLICATE");

  const changed = Buffer.concat([original, Buffer.from("\n")]);
  assert.equal((await receiver.put(requestFor(run, changed))).status, "CONFLICT");
  const retrieved = await receiver.get({
    schema: "memecoin-paper-run-export-transfer/v1",
    origin: PRIVATE_ORIGIN,
    identity: expectedFor(run),
    authorization: READ_AUTH
  });
  assert.equal(retrieved.status, "FOUND");
  assert.deepEqual(retrieved.bytes, original);
  assert.equal(retrieved.exportSha256, hash(original));
});

test("an incomplete pre-existing run slot is never replaced", async t => {
  const run = exportsByFault.NONE;
  const directory = path.join(temporaryRoot, "preexisting-empty-slot");
  const slot = path.join(directory, hash(Buffer.from(run.report.runId)));
  await mkdir(slot, {recursive: true});
  const receiver = createFileReceiver({
    directory,
    privateOrigin: PRIVATE_ORIGIN,
    authorizeWrite: authorization => authorization === WRITE_AUTH,
    authorizeRead: authorization => authorization === READ_AUTH
  });

  assert.equal((await receiver.put(requestFor(run, bytesOf(run)))).status, "UNKNOWN");
  assert.deepEqual(await readdir(slot), []);
});

test("oversize input is rejected before dispatch and missing readback stays UNKNOWN", async t => {
  let calls = 0;
  const run = exportsByFault.NONE;
  const client = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: {
      put: async () => { calls++; return {}; },
      get: async () => ({status: "NOT_FOUND", redirected: false})
    }
  });
  const oversized = (async function* () {
    yield Buffer.alloc(MAX_TRANSFER_BYTES);
    yield Buffer.from("x");
  })();
  assert.deepEqual(await client.transfer({
    exportBytes: oversized, expected: expectedFor(run), writeAuthorization: WRITE_AUTH,
    explicitlyAuthorized: true
  }), {status: "REJECTED", code: "INVALID_EXPORT"});
  assert.equal(calls, 0);
  assert.deepEqual(await client.readback({
    expected: expectedFor(run), readAuthorization: READ_AUTH
  }), {status: "UNKNOWN", code: "EXPORT_NOT_FOUND"});
});

test("deadline, cancellation, redirects, partial writes and lost ACKs are UNKNOWN with no retry", async t => {
  const run = exportsByFault.NONE;
  const bytes = bytesOf(run);
  const expected = expectedFor(run);

  let timeoutCalls = 0;
  const timeoutClient = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    timeoutMs: 10,
    transport: {
      put: async () => { timeoutCalls++; return new Promise(() => {}); },
      get: async () => ({status: "NOT_FOUND", redirected: false})
    }
  });
  assert.deepEqual(await timeoutClient.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  }), {status: "UNKNOWN", code: "DEADLINE_EXCEEDED"});
  assert.equal(timeoutCalls, 1);

  let cancelCalls = 0;
  const cancelClient = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: {
      put: async () => { cancelCalls++; return {}; },
      get: async () => ({status: "NOT_FOUND", redirected: false})
    }
  });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await cancelClient.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH,
    explicitlyAuthorized: true, signal: controller.signal
  }), {status: "UNKNOWN", code: "CANCELLED"});
  assert.equal(cancelCalls, 0);

  let redirectCalls = 0;
  const redirectClient = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: {
      put: async () => { redirectCalls++; return {status: "STORED", redirected: true}; },
      get: async () => ({status: "NOT_FOUND", redirected: false})
    }
  });
  assert.deepEqual(await redirectClient.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  }), {status: "UNKNOWN", code: "REDIRECT_REJECTED"});
  assert.equal(redirectCalls, 1);

  let partialCalls = 0;
  const partialClient = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: {
      put: async request => {
        partialCalls++;
        assert.ok(request.bytes.subarray(0, Math.floor(request.byteLength / 2)).byteLength > 0);
        return {status: "UNKNOWN", redirected: false};
      },
      get: async () => ({status: "NOT_FOUND", redirected: false})
    }
  });
  assert.deepEqual(await partialClient.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  }), {status: "UNKNOWN", code: "WRITE_OUTCOME_UNKNOWN"});
  assert.equal(partialCalls, 1);

  const receiver = makeReceiver(t);
  let ackLossCalls = 0;
  const localTransport = createInProcessTransport(receiver);
  const ackLossClient = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: {
      put: async request => {
        ackLossCalls++;
        await localTransport.put(request);
        throw new Error("ACK intentionally discarded");
      },
      get: request => localTransport.get(request)
    }
  });
  assert.deepEqual(await ackLossClient.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  }), {status: "UNKNOWN", code: "WRITE_OUTCOME_UNKNOWN"});
  assert.equal(ackLossCalls, 1);
  const readback = await ackLossClient.readback({expected, readAuthorization: READ_AUTH});
  assert.equal(readback.status, "READ_BACK");
  assert.equal(readback.exportSha256, hash(bytes));
});

test("readback rejects altered bytes and identity instead of evaluating them", async () => {
  const run = exportsByFault.NONE;
  const bytes = bytesOf(run);
  const expected = expectedFor(run);
  const client = createExportTransfer({
    enabled: true,
    privateOrigin: PRIVATE_ORIGIN,
    transport: {
      put: async request => ({
        status: "STORED", redirected: false, identity: request.identity,
        exportSha256: request.exportSha256, byteLength: request.byteLength
      }),
      get: async request => ({
        status: "FOUND", redirected: false, identity: request.identity,
        exportSha256: hash(bytes), byteLength: bytes.byteLength,
        bytes: Buffer.from(bytes).fill(0x20, 0, 1)
      })
    }
  });
  assert.equal((await client.transfer({
    exportBytes: bytes, expected, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  })).status, "TRANSFER_ACKNOWLEDGED");
  assert.deepEqual(await client.readback({expected, readAuthorization: READ_AUTH}), {
    status: "REJECTED", code: "READBACK_DIGEST_OR_IDENTITY_MISMATCH"
  });
});
