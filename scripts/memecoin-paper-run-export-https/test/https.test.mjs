import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {EventEmitter} from "node:events";
import https from "node:https";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, {before, after} from "node:test";
import {fileURLToPath} from "node:url";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../../memecoin-paper/paper-pilot-composition.mjs";
import {
  createExportTransfer, createFileReceiver, TRANSFER_SCHEMA
} from "../../memecoin-paper-run-export-transfer/index.mjs";
import {
  claimDurableAttempt, publishReadbackOutput, recordDurableOutcome, writeExactBytes
} from "../cli.mjs";
import {createHttpsExportTransport, createPrivateReceiverHandler, readExportOverHttps} from "../https.mjs";

const WRITE_AUTH = "test-write-scope";
const READ_AUTH = "test-read-scope";
const START = Date.parse("2026-01-01T19:00:00Z");
const BUDGETS = {
  requests: 12, bytes: 1_000_000, events: 128, candidates: 4, cycles: 4,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
};
let temporaryRoot;
let ca;
let certificate;
let privateKey;
let report;
let exportBytes;
let identity;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function produce(runId) {
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
    dataDirectory: path.join(temporaryRoot, `run-${runId}`),
    clock,
    adapters: offlineFixtureAdapters({clock, fault: "NONE"})
  }).start();
  return result.report;
}

async function createTlsFiles() {
  const caKey = path.join(temporaryRoot, "ca.key");
  const caFile = path.join(temporaryRoot, "ca.pem");
  const serverKey = path.join(temporaryRoot, "server.key");
  const serverCsr = path.join(temporaryRoot, "server.csr");
  const serverCert = path.join(temporaryRoot, "server.pem");
  const extension = path.join(temporaryRoot, "server.ext");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", caFile,
    "-days", "1", "-subj", "/CN=Meridian test-only CA"
  ], {stdio: "ignore"});
  execFileSync("openssl", [
    "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", serverKey, "-out", serverCsr,
    "-subj", "/CN=127.0.0.1"
  ], {stdio: "ignore"});
  await writeFile(extension, "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  execFileSync("openssl", [
    "x509", "-req", "-in", serverCsr, "-CA", caFile, "-CAkey", caKey, "-CAcreateserial",
    "-out", serverCert, "-days", "1", "-extfile", extension
  ], {stdio: "ignore"});
  return Promise.all([readFile(caFile), readFile(serverCert), readFile(serverKey)]);
}

async function startService(t, {
  authorizeWrite = authorization => authorization === WRITE_AUTH,
  authorizeRead = authorization => authorization === READ_AUTH,
  decorate = handler => handler
} = {}) {
  let handler = (_request, response) => {
    response.writeHead(503);
    response.end();
  };
  const server = https.createServer({key: privateKey, cert: certificate, maxHeaderSize: 8 * 1024},
    (request, response) => handler(request, response));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const privateOrigin = `https://127.0.0.1:${address.port}`;
  const receiver = createFileReceiver({
    directory: path.join(temporaryRoot, `receiver-${address.port}`),
    privateOrigin,
    authorizeWrite,
    authorizeRead
  });
  handler = decorate(createPrivateReceiverHandler({receiver, privateOrigin}));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    receiver,
    privateOrigin,
    transport: createHttpsExportTransport({privateOrigin, ca})
  };
}

function makeTransfer(service, options = {}) {
  return createExportTransfer({
    enabled: true,
    privateOrigin: service.privateOrigin,
    transport: service.transport,
    ...options
  });
}

async function transfer(service, bytes = exportBytes, writeAuthorization = WRITE_AUTH) {
  return makeTransfer(service).transfer({
    exportBytes: bytes,
    expected: identity,
    writeAuthorization,
    explicitlyAuthorized: true
  });
}

async function independentRead(service, {
  expected = identity,
  expectedExportSha256 = hash(exportBytes),
  expectedByteLength = exportBytes.byteLength,
  readAuthorization = READ_AUTH,
  transport = service.transport,
  timeoutMs
} = {}) {
  return readExportOverHttps({
    transport,
    privateOrigin: service.privateOrigin,
    expected,
    expectedExportSha256,
    expectedByteLength,
    readAuthorization,
    ...(timeoutMs ? {timeoutMs} : {})
  });
}

function runCli(cliPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {env, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", status => resolve({status, stdout, stderr}));
  });
}

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "paper-export-https-"));
  [ca, certificate, privateKey] = await createTlsFiles();
  report = await produce("https-export-roundtrip");
  identity = {
    runId: report.runId,
    configSha256: report.configSha256,
    producerRevision: report.producerRevision
  };
  exportBytes = Buffer.from(JSON.stringify(report), "utf8");
});

after(async () => {
  await rm(temporaryRoot, {recursive: true, force: true});
});

test("real HTTPS transfers original generated export and independently evaluates exact readback", async t => {
  const service = await startService(t);
  const sent = await transfer(service);
  assert.equal(sent.status, "TRANSFER_ACKNOWLEDGED");
  assert.equal(sent.checkpointAcknowledged, false);

  const sameInstance = makeTransfer(service);
  const second = await sameInstance.transfer({
    exportBytes, expected: identity, writeAuthorization: WRITE_AUTH, explicitlyAuthorized: true
  });
  assert.equal(second.status, "TRANSFER_ACKNOWLEDGED");
  const coreReadback = await sameInstance.readback({expected: identity, readAuthorization: READ_AUTH});
  assert.equal(coreReadback.status, "READ_BACK");
  assert.deepEqual(coreReadback.bytes, exportBytes);
  assert.equal(coreReadback.evaluation.overall, "PASS");

  const independent = await independentRead(service);
  assert.equal(independent.status, "READ_BACK");
  assert.deepEqual(independent.bytes, exportBytes);
  assert.equal(independent.evaluation.overall, "PASS");
  assert.equal(independent.evaluation.identity.runId, identity.runId);
});

test("read and write scopes, complete identity, digest, and immutable conflict are enforced", async t => {
  const service = await startService(t);
  assert.equal((await transfer(service, exportBytes, "bad-write-scope")).status, "REJECTED");
  assert.equal((await transfer(service)).status, "TRANSFER_ACKNOWLEDGED");
  assert.equal((await independentRead(service, {readAuthorization: "bad-read-scope"})).status, "REJECTED");
  assert.equal((await independentRead(service, {
    expected: {...identity, configSha256: "0".repeat(64)}
  })).status, "UNKNOWN");

  const duplicate = await transfer(service);
  assert.equal(duplicate.status, "TRANSFER_ACKNOWLEDGED");
  const differentBytes = Buffer.concat([exportBytes, Buffer.from("\n")]);
  const conflict = await transfer(service, differentBytes);
  assert.equal(conflict.status, "REJECTED");
  assert.equal(conflict.code, "EXPORT_CONFLICT");
  const readback = await independentRead(service);
  assert.deepEqual(readback.bytes, exportBytes);
});

test("independent readback rejects bytes altered after HTTPS metadata binding", async t => {
  const service = await startService(t);
  assert.equal((await transfer(service)).status, "TRANSFER_ACKNOWLEDGED");
  const transport = {
    get: async request => {
      const response = await service.transport.get(request);
      if (response.status !== "FOUND") return response;
      return {
        ...response,
        bytes: (async function* () {
          let changed = false;
          for await (const chunk of response.bytes) {
            const copy = Buffer.from(chunk);
            if (!changed && copy.length) {
              copy[0] ^= 1;
              changed = true;
            }
            yield copy;
          }
        })()
      };
    }
  };
  const result = await independentRead(service, {transport});
  assert.equal(result.status, "REJECTED");
  assert.equal(result.code, "READBACK_DIGEST_OR_IDENTITY_MISMATCH");
});

test("independent readback shares a monotonic deadline through synchronous evaluation", async () => {
  let now = 100;
  let calls = 0;
  const transport = {
    get: async () => {
      calls++;
      return {
        status: "FOUND",
        redirected: false,
        identity,
        exportSha256: hash(exportBytes),
        byteLength: exportBytes.byteLength,
        bytes: (async function* () { yield exportBytes; })()
      };
    }
  };
  const result = await readExportOverHttps({
    transport,
    privateOrigin: "https://paper-private.example",
    expected: identity,
    expectedExportSha256: hash(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization: READ_AUTH,
    timeoutMs: 100,
    monotonicNow: () => now,
    evaluate: () => {
      now = 200;
      return {overall: "PASS"};
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {status: "UNKNOWN", code: "DEADLINE_EXCEEDED"});
});

test("monotonic deadline expiry aborts a pending transport before returning UNKNOWN", async () => {
  let now = 100;
  let requestSignal;
  const result = await readExportOverHttps({
    transport: {
      get: request => {
        requestSignal = request.signal;
        now = 201;
        return new Promise(() => {});
      }
    },
    privateOrigin: "https://paper-private.example",
    expected: identity,
    expectedExportSha256: hash(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization: READ_AUTH,
    timeoutMs: 100,
    monotonicNow: () => now
  });
  assert.deepEqual(result, {status: "UNKNOWN", code: "DEADLINE_EXCEEDED"});
  assert.equal(requestSignal.aborted, true);
});

test("independent readback does not dispatch when already cancelled or after clock rollback", async () => {
  let calls = 0;
  const response = {
    status: "FOUND",
    redirected: false,
    identity,
    exportSha256: hash(exportBytes),
    byteLength: exportBytes.byteLength,
    bytes: (async function* () { yield exportBytes; })()
  };
  const transport = {get: async () => { calls++; return response; }};
  const controller = new AbortController();
  controller.abort();
  const cancelled = await readExportOverHttps({
    transport,
    privateOrigin: "https://paper-private.example",
    expected: identity,
    expectedExportSha256: hash(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization: READ_AUTH,
    signal: controller.signal
  });
  assert.deepEqual(cancelled, {status: "UNKNOWN", code: "CANCELLED"});
  assert.equal(calls, 0);

  const time = [100, 150, 120, 110, 140, 130, 125, 115, 160, 150, 145, 140, 135, 130, 125, 200];
  const rolledBack = await readExportOverHttps({
    transport,
    privateOrigin: "https://paper-private.example",
    expected: identity,
    expectedExportSha256: hash(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization: READ_AUTH,
    timeoutMs: 100,
    monotonicNow: () => time.length ? time.shift() : 200
  });
  assert.equal(rolledBack.status, "UNKNOWN");
  assert.equal(rolledBack.code, "DEADLINE_EXCEEDED");
});

test("redirects are not followed and cancellation closes the HTTPS request", async t => {
  let redirects = 0;
  const redirectServer = https.createServer({key: privateKey, cert: certificate}, (_request, response) => {
    redirects++;
    response.writeHead(302, {location: "https://127.0.0.1:1/private/run-exports/v1/nope"});
    response.end();
  });
  await new Promise(resolve => redirectServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => redirectServer.close(resolve)));
  const redirectOrigin = `https://127.0.0.1:${redirectServer.address().port}`;
  const redirectTransport = createHttpsExportTransport({privateOrigin: redirectOrigin, ca});
  const redirected = await redirectTransport.put({
    schema: TRANSFER_SCHEMA,
    origin: redirectOrigin,
    identity,
    exportSha256: hash(exportBytes),
    byteLength: exportBytes.byteLength,
    bytes: exportBytes,
    authorization: WRITE_AUTH
  });
  assert.equal(redirected.status, "UNKNOWN");
  assert.equal(redirected.redirected, true);
  assert.equal(redirects, 1);

  let requestClosed = false;
  const hangingServer = https.createServer({key: privateKey, cert: certificate}, request => {
    request.on("close", () => { requestClosed = true; });
  });
  await new Promise(resolve => hangingServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => hangingServer.close(resolve)));
  const hangingOrigin = `https://127.0.0.1:${hangingServer.address().port}`;
  const hangingTransport = createHttpsExportTransport({privateOrigin: hangingOrigin, ca});
  const controller = new AbortController();
  const operation = readExportOverHttps({
    transport: hangingTransport,
    privateOrigin: hangingOrigin,
    expected: identity,
    expectedExportSha256: hash(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization: READ_AUTH,
    signal: controller.signal,
    timeoutMs: 5_000
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  controller.abort();
  const cancelled = await operation;
  assert.equal(cancelled.status, "UNKNOWN");
  assert.equal(cancelled.code, "CANCELLED");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requestClosed, true);
});

test("oversized and hanging streams remain bounded and timeout before dispatch", async () => {
  const slowTransport = {
    get: async () => ({
      status: "FOUND",
      redirected: false,
      identity,
      exportSha256: hash(exportBytes),
      byteLength: exportBytes.byteLength,
      bytes: (async function* () {
        yield Buffer.alloc(16 * 1024 * 1024 + 1);
      })()
    })
  };
  const oversized = await readExportOverHttps({
    transport: slowTransport,
    privateOrigin: "https://paper-private.example",
    expected: identity,
    expectedExportSha256: hash(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization: READ_AUTH
  });
  assert.equal(oversized.status, "UNKNOWN");

  let actualDispatches = 0;
  const transport = {
    put: async () => { actualDispatches++; return {status: "STORED"}; },
    get: async () => { actualDispatches++; return {status: "NOT_FOUND"}; }
  };
  const timed = createExportTransfer({
    enabled: true,
    privateOrigin: "https://paper-private.example",
    transport,
    timeoutMs: 25
  });
  const hanging = (async function* () {
    await new Promise(() => {});
  })();
  const result = await timed.transfer({
    exportBytes: hanging,
    expected: identity,
    writeAuthorization: WRITE_AUTH,
    explicitlyAuthorized: true
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(actualDispatches, 0);
});

test("receiver rejects unknown-length, partial, and chunk-flood requests", async () => {
  const privateOrigin = "https://receiver.example";
  const receiver = createFileReceiver({
    directory: path.join(temporaryRoot, "receiver-stream-bounds"),
    privateOrigin,
    authorizeWrite: authorization => authorization === WRITE_AUTH,
    authorizeRead: authorization => authorization === READ_AUTH
  });
  const handler = createPrivateReceiverHandler({receiver, privateOrigin, timeoutMs: 2_000});
  const baseHeaders = [
    "host", "receiver.example",
    "x-paper-transfer-schema", TRANSFER_SCHEMA,
    "x-paper-run-id", identity.runId,
    "x-paper-config-sha256", identity.configSha256,
    "x-paper-producer-revision", identity.producerRevision,
    "x-paper-export-sha256", hash(exportBytes),
    "x-paper-byte-length", String(exportBytes.byteLength),
    "content-type", "application/octet-stream",
    "authorization", "Bearer " + WRITE_AUTH
  ];
  const invoke = async (rawHeaders, chunks, {
    method = "PUT",
    url = `/private/run-exports/v1/${encodeURIComponent(identity.runId)}`,
    targetHandler = handler
  } = {}) => {
    const request = new EventEmitter();
    request.socket = {encrypted: true};
    request.rawHeaders = rawHeaders;
    request.method = method;
    request.url = url;
    request.destroy = () => { request.destroyed = true; };
    request[Symbol.asyncIterator] = async function* () {
      for (const chunk of chunks) yield chunk;
    };
    const response = new EventEmitter();
    response.headersSent = false;
    response.destroyed = false;
    response.writableEnded = false;
    response.setHeader = () => {};
    response.writeHead = (statusCode, headers) => {
      response.statusCode = statusCode;
      response.headers = headers;
      response.headersSent = true;
    };
    response.end = body => {
      response.body = body;
      response.writableEnded = true;
      return response;
    };
    response.destroy = () => { response.destroyed = true; };
    await targetHandler(request, response);
    return response;
  };
  assert.equal((await invoke(baseHeaders, [], {url: "/private/run-exports/v1/other/extra"})).statusCode, 404);
  assert.equal((await invoke(baseHeaders, [], {method: "PATCH"})).statusCode, 405);
  assert.equal((await invoke(
    baseHeaders.map((value, index) => index === 1 ? "another.example" : value), []
  )).statusCode, 421);
  const headersWithLength = length => {
    const headers = [...baseHeaders];
    headers[headers.indexOf("x-paper-byte-length") + 1] = String(length);
    headers.push("content-length", String(length));
    return headers;
  };
  assert.equal((await invoke(baseHeaders, [])).statusCode, 400);

  const partialHeaders = headersWithLength(4);
  assert.equal((await invoke(partialHeaders, [Buffer.from("abc")])).statusCode, 403);

  const floodHeaders = headersWithLength(4097);
  const flood = Array.from({length: 4097}, () => Buffer.from("x"));
  assert.equal((await invoke(floodHeaders, flood)).statusCode, 403);

  const hangingReceiver = createFileReceiver({
    directory: path.join(temporaryRoot, "receiver-hanging-auth"),
    privateOrigin,
    authorizeWrite: () => new Promise(() => {}),
    authorizeRead: authorization => authorization === READ_AUTH
  });
  const hangingHandler = createPrivateReceiverHandler({
    receiver: hangingReceiver, privateOrigin, timeoutMs: 10
  });
  const hangingResponse = await invoke(headersWithLength(exportBytes.byteLength), [], {
    targetHandler: hangingHandler
  });
  assert.equal(hangingResponse.statusCode, 504);
});

test("operator CLI uses a durable one-shot gate and independent read-only authorization", async t => {
  let putRequests = 0;
  const service = await startService(t, {
    decorate: handler => async (request, response) => {
      if (request.method === "PUT") putRequests++;
      await handler(request, response);
    }
  });
  const exportPath = path.join(temporaryRoot, "cli-export.json");
  const attemptDirectory = path.join(temporaryRoot, "cli-attempts");
  const outputPath = path.join(temporaryRoot, "cli-readback.json");
  await writeFile(exportPath, exportBytes);
  const cliPath = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  const env = {
    PATH: process.env.PATH,
    NODE_EXTRA_CA_CERTS: path.join(temporaryRoot, "ca.pem"),
    PAPER_EXPORT_HTTPS_ENABLED: "true",
    PAPER_EXPORT_HTTPS_ORIGIN: service.privateOrigin,
    PAPER_EXPORT_HTTPS_WRITE_AUTHORIZATION: WRITE_AUTH,
    PAPER_EXPORT_HTTPS_READ_AUTHORIZATION: READ_AUTH,
    PAPER_EXPORT_HTTPS_ATTEMPT_DIRECTORY: attemptDirectory
  };
  const uploadArgs = [
    cliPath, "upload", "--export", exportPath, "--run-id", identity.runId,
    "--config-sha256", identity.configSha256, "--producer-revision", identity.producerRevision
  ];
  const upload = await runCli(cliPath, uploadArgs.slice(1), env);
  assert.equal(upload.status, 0, upload.stderr);
  assert.equal(JSON.parse(upload.stdout).status, "TRANSFER_ACKNOWLEDGED");
  assert.equal(putRequests, 1);

  const restartedUpload = await runCli(cliPath, uploadArgs.slice(1), env);
  assert.equal(restartedUpload.status, 2);
  assert.equal(JSON.parse(restartedUpload.stdout).status, "UNKNOWN");
  assert.equal(putRequests, 1);

  const readEnv = {...env};
  delete readEnv.PAPER_EXPORT_HTTPS_WRITE_AUTHORIZATION;
  const readback = await runCli(cliPath, [
    "readback", "--run-id", identity.runId,
    "--config-sha256", identity.configSha256, "--producer-revision", identity.producerRevision,
    "--export-sha256", hash(exportBytes), "--byte-length", String(exportBytes.byteLength),
    "--output", outputPath
  ], readEnv);
  assert.equal(readback.status, 0, readback.stderr);
  assert.equal(JSON.parse(readback.stdout).evaluation.overall, "PASS");
  assert.deepEqual(await readFile(outputPath), exportBytes);
});

test("post-link directory sync failure is bound UNKNOWN and never overwrites output", async () => {
  const output = path.join(temporaryRoot, "published-before-sync-failure.json");
  const identityBinding = {...identity};
  const outcome = await publishReadbackOutput({
    output,
    bytes: exportBytes,
    identity: identityBinding,
    exportSha256: hash(exportBytes),
    byteLength: exportBytes.byteLength,
    evaluation: {overall: "PASS"}
  }, (filename, bytes) => writeExactBytes(filename, bytes, {
    syncDirectory: async () => { throw new Error("injected directory sync fault"); }
  }));
  assert.deepEqual(outcome, {
    result: {
    status: "UNKNOWN",
    code: "OUTPUT_OUTCOME_UNKNOWN",
    identity: identityBinding,
    exportSha256: hash(exportBytes),
    byteLength: exportBytes.byteLength,
    evaluation: {overall: "PASS"},
    output
    },
    exitCode: 2
  });
  assert.deepEqual(await readFile(output), exportBytes);
  await assert.rejects(() => writeExactBytes(output, Buffer.from("replacement")), {code: "EEXIST"});
  assert.deepEqual(await readFile(output), exportBytes);
});

test("stored upload with lost ACK is UNKNOWN and durable gate survives restart", async t => {
  let putRequests = 0;
  const service = await startService(t, {
    decorate: handler => async (request, response) => {
      if (request.method === "PUT") {
        putRequests++;
        const end = response.end.bind(response);
        response.end = (...args) => {
          response.socket.destroy();
          return response;
        };
        await handler(request, response);
        response.end = end;
        return;
      }
      await handler(request, response);
    }
  });
  const result = await transfer(service);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(putRequests, 1);

  const attemptDirectory = path.join(temporaryRoot, "durable-attempts");
  const binding = {
    directory: attemptDirectory,
    identity,
    exportSha256: hash(exportBytes),
    byteLength: exportBytes.byteLength
  };
  const claimed = await claimDurableAttempt(binding);
  assert.equal(claimed.status, "CLAIMED");
  await recordDurableOutcome(claimed.filename, {status: "UNKNOWN", code: "WRITE_OUTCOME_UNKNOWN"});
  const afterRestart = await claimDurableAttempt(binding);
  assert.equal(afterRestart.status, "UNKNOWN");
  assert.equal(afterRestart.code, "ATTEMPT_ALREADY_RECORDED");

  const independent = await independentRead(service);
  assert.equal(independent.status, "READ_BACK");
  assert.deepEqual(independent.bytes, exportBytes);
});
