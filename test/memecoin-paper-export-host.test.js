import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {EventEmitter} from "node:events";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  chmod, lstat, mkdtemp, mkdir, open, readFile, rm, writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {
  PROTECTED_MODE, REQUIRED_GID, REQUIRED_UID
} from "../scripts/memecoin-paper/volume-protection.mjs";
import {createExportTransfer} from "../scripts/memecoin-paper-run-export-transfer/index.mjs";
import {
  createHttpsExportTransport, readExportOverHttps
} from "../scripts/memecoin-paper-run-export-https/https.mjs";
const WRITE_AUTH = "test-host-write-scope-001";
const READ_AUTH = "test-host-read-scope-002";
const START = Date.parse("2026-01-01T19:00:00Z");
const BUDGETS = {
  requests: 12, bytes: 1_000_000, events: 128, candidates: 4, cycles: 4,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
};

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createTlsFiles(directory) {
  const caKey = path.join(directory, "test-ca.key");
  const caFile = path.join(directory, "test-ca.pem");
  const serverKey = path.join(directory, "server.key");
  const serverCsr = path.join(directory, "server.csr");
  const serverCert = path.join(directory, "server.pem");
  const extension = path.join(directory, "server.ext");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", caFile,
    "-days", "1", "-subj", "/CN=Meridian local test CA"
  ], {stdio: "ignore"});
  execFileSync("openssl", [
    "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", serverKey, "-out", serverCsr,
    "-subj", "/CN=localhost"
  ], {stdio: "ignore"});
  await writeFile(extension, "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n");
  execFileSync("openssl", [
    "x509", "-req", "-in", serverCsr, "-CA", caFile, "-CAkey", caKey, "-CAcreateserial",
    "-out", serverCert, "-days", "1", "-extfile", extension
  ], {stdio: "ignore"});
  for (const filename of [caKey, serverKey, serverCert, caFile]) {
    await chmod(filename, 0o600);
  }
  return {
    ca: await readFile(caFile),
    certificateFile: serverCert,
    privateKeyFile: serverKey
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-export-host-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const mountRoot = path.join(root, "mount");
  await mkdir(mountRoot, {mode: 0o700});
  const tls = await createTlsFiles(root);
  const writeAuthorizationFile = path.join(root, "write-auth");
  const readAuthorizationFile = path.join(root, "read-auth");
  await writeFile(writeAuthorizationFile, WRITE_AUTH, {mode: 0o600});
  await writeFile(readAuthorizationFile, READ_AUTH, {mode: 0o600});
  const port = await reservePort();
  const privateOrigin = `https://localhost:${port}`;
  const storageRoot = path.join(mountRoot, "receiver");
  const config = {
    enabled: true,
    privateOrigin,
    listenHost: "127.0.0.1",
    port,
    mountRoot,
    storageRoot,
    ...tls,
    writeAuthorizationFile,
    readAuthorizationFile
  };
  const lstatPath = async filename => filename === mountRoot
    ? directoryInfo({uid: REQUIRED_UID, gid: REQUIRED_GID, mode: 0o040000 | PROTECTED_MODE})
    : lstat(filename);
  return {...config, config, ca: tls.ca, root, lstatPath};
}

function directoryInfo(overrides = {}) {
  return {
    uid: process.getuid(),
    gid: process.getgid(),
    mode: 0o040700,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    ...overrides
  };
}

function fakeMountLstat(mountRoot, {uid = REQUIRED_UID, gid = REQUIRED_GID, mode = PROTECTED_MODE} = {}) {
  return async filename => filename === mountRoot
    ? directoryInfo({uid, gid, mode: 0o040000 | mode})
    : lstat(filename);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const {port} = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function createCanonicalExport(root) {
  const config = {
    version: 1,
    mode: "SYNTHETIC_TEST_ONLY",
    enabled: true,
    runId: "tls-bootstrap-roundtrip",
    startedAt: START,
    budgets: {...BUDGETS}
  };
  const clock = createSyntheticClock({wallStart: START + 5_000, monotonicStart: 100});
  const result = await createPaperPilotComposition({
    config,
    dataDirectory: path.join(root, "producer"),
    clock,
    adapters: offlineFixtureAdapters({clock, fault: "NONE"})
  }).start();
  const identity = {
    runId: result.report.runId,
    configSha256: result.report.configSha256,
    producerRevision: result.report.producerRevision
  };
  return {bytes: Buffer.from(JSON.stringify(result.report)), identity};
}

function directHttpsRequest({port, ca, method, route, headers = {}, body}) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "127.0.0.1",
      port,
      servername: "localhost",
      ca,
      method,
      path: route,
      headers: {host: `localhost:${port}`, ...headers}
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("end", () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks)
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function plainHttpAttempt(port) {
  return new Promise(resolve => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      method: "GET",
      path: "/private/run-exports/v1/tls-bootstrap-roundtrip",
      headers: {host: `localhost:${port}`},
      agent: false
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("end", () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks)
      }));
    });
    request.setTimeout(1_000, () => request.destroy(new Error("plaintext timeout")));
    request.once("error", () => resolve({statusCode: null, body: Buffer.alloc(0)}));
    request.end();
  });
}

function portAcceptsConnections(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({host: "127.0.0.1", port});
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

test("host import and disabled or incomplete configuration never start a listener", async () => {
  const signalsBeforeImport = {
    int: process.listenerCount("SIGINT"),
    term: process.listenerCount("SIGTERM")
  };
  const hostModule = await import("../scripts/memecoin-paper-export-host.mjs");
  assert.equal(process.listenerCount("SIGINT"), signalsBeforeImport.int);
  assert.equal(process.listenerCount("SIGTERM"), signalsBeforeImport.term);

  let output = "";
  assert.equal(await hostModule.main({
    env: {},
    stdout: {write: value => { output += value; }}
  }), 0);
  assert.deepEqual(JSON.parse(output), {status: "DISABLED", listenerStarted: false});

  output = "";
  assert.equal(await hostModule.main({
    env: {PAPER_EXPORT_HOST_ENABLED: "true"},
    stdout: {write: value => { output += value; }}
  }), 2);
  assert.deepEqual(JSON.parse(output), {
    status: "BLOCKED",
    code: "HOST_CONFIGURATION_INVALID",
    listenerStarted: false
  });

  assert.throws(() => hostModule.paperExportHostConfigFromEnvironment({
    PAPER_EXPORT_HOST_ENABLED: "true",
    PAPER_EXPORT_HOST_ORIGIN: "https://example.invalid:4443",
    PAPER_EXPORT_HOST_LISTEN_HOST: "127.0.0.1",
    PAPER_EXPORT_HOST_PORT: "4443",
    PAPER_EXPORT_HOST_MOUNT_ROOT: "/var/data/other"
  }), /mount root/);
});

test("host bootstrap compares effective HTTPS ports and only normalizes standard 443", async t => {
  const {paperExportHostConfigFromEnvironment, createPaperExportServer, closePaperExportServer} =
    await import("../scripts/memecoin-paper-export-host.mjs");
  const env = {
    PAPER_EXPORT_HOST_ENABLED: "true",
    PAPER_EXPORT_HOST_LISTEN_HOST: "127.0.0.1",
    PAPER_EXPORT_HOST_MOUNT_ROOT: "/var/data/meridian-paper",
    PAPER_EXPORT_HOST_STORAGE_ROOT: "/var/data/meridian-paper/receiver",
    PAPER_EXPORT_HOST_TLS_CERT_FILE: "/private/cert",
    PAPER_EXPORT_HOST_TLS_KEY_FILE: "/private/key",
    PAPER_EXPORT_HOST_WRITE_AUTH_FILE: "/private/write",
    PAPER_EXPORT_HOST_READ_AUTH_FILE: "/private/read"
  };
  const hostFixture = await fixture(t);
  for (const [origin, port, normalized] of [
    ["https://localhost", "443", "https://localhost"],
    ["https://localhost:443", "443", "https://localhost"],
    ["https://localhost:4443", "4443", "https://localhost:4443"]
  ]) {
    const config = paperExportHostConfigFromEnvironment({
      ...env, PAPER_EXPORT_HOST_ORIGIN: origin, PAPER_EXPORT_HOST_PORT: port
    });
    assert.equal(config.privateOrigin, normalized);
    assert.equal(config.port, Number(port));
    const server = await createPaperExportServer({
      ...hostFixture.config, privateOrigin: origin, port: Number(port)
    }, {lstatPath: hostFixture.lstatPath});
    assert.equal(server.listening, false);
    await closePaperExportServer(server);
  }
  for (const [origin, port] of [
    ["https://localhost", "4443"],
    ["https://localhost:443", "4443"],
    ["https://localhost:4443", "443"],
    ["https://localhost:4443", "4444"]
  ]) {
    assert.throws(() => paperExportHostConfigFromEnvironment({
      ...env, PAPER_EXPORT_HOST_ORIGIN: origin, PAPER_EXPORT_HOST_PORT: port
    }), /port/);
    await assert.rejects(createPaperExportServer({
      ...hostFixture.config, privateOrigin: origin, port: Number(port)
    }, {lstatPath: hostFixture.lstatPath}), /configuration/);
  }
  for (const origin of ["https://localhost/", "https://LOCALHOST", "https://localhost:0443",
    "https://localhost:4443:443", "http://localhost:443", "https://user@localhost:443"]) {
    assert.throws(() => paperExportHostConfigFromEnvironment({
      ...env, PAPER_EXPORT_HOST_ORIGIN: origin, PAPER_EXPORT_HOST_PORT: "443"
    }), /origin/);
  }
});

test("generated-CA TLS bootstrap accepts only exact host and separate scopes, evaluates exact readback, and shuts down on signal", async t => {
  const hostFixture = await fixture(t);
  const {runPaperExportHost} = await import("../scripts/memecoin-paper-export-host.mjs");
  const signalSource = new EventEmitter();
  let hostOutput = "";
  let resolveListening;
  const listening = new Promise(resolve => { resolveListening = resolve; });
  const runPromise = runPaperExportHost(hostFixture.config, {
    signalSource,
    lstatPath: hostFixture.lstatPath,
    stdout: {write: value => {
      hostOutput += value;
      if (value.includes('"status":"LISTENING"')) resolveListening();
    }}
  });
  t.after(async () => {
    signalSource.emit("SIGTERM");
    await runPromise;
  });
  await listening;
  assert.deepEqual(JSON.parse(hostOutput), {status: "LISTENING", tls: true});

  const {bytes, identity} = await createCanonicalExport(hostFixture.root);
  const transport = createHttpsExportTransport({
    privateOrigin: hostFixture.privateOrigin,
    ca: hostFixture.ca
  });
  const transfer = () => createExportTransfer({
    enabled: true,
    privateOrigin: hostFixture.privateOrigin,
    transport
  });
  assert.equal((await transfer().transfer({
    exportBytes: bytes,
    expected: identity,
    writeAuthorization: "wrong-write-scope",
    explicitlyAuthorized: true
  })).status, "REJECTED");

  const write = await transfer().transfer({
    exportBytes: bytes,
    expected: identity,
    writeAuthorization: WRITE_AUTH,
    explicitlyAuthorized: true
  });
  assert.equal(write.status, "TRANSFER_ACKNOWLEDGED", JSON.stringify(write));
  assert.equal(write.checkpointAcknowledged, false);

  const badRead = await readExportOverHttps({
    transport,
    privateOrigin: hostFixture.privateOrigin,
    expected: identity,
    expectedExportSha256: hash(bytes),
    expectedByteLength: bytes.byteLength,
    readAuthorization: "wrong-read-scope"
  });
  assert.equal(badRead.status, "REJECTED");

  const hostRejected = await directHttpsRequest({
    port: hostFixture.port,
    ca: hostFixture.ca,
    method: "GET",
    route: `/private/run-exports/v1/${identity.runId}`,
    headers: {
      host: "wrong.example",
      "x-paper-transfer-schema": "memecoin-paper-run-export-transfer/v1"
    }
  });
  assert.equal(hostRejected.statusCode, 421);

  const plaintext = await plainHttpAttempt(hostFixture.port);
  assert.notEqual(plaintext.statusCode, 200);
  assert.equal(plaintext.body.includes(bytes), false);

  const readback = await readExportOverHttps({
    transport,
    privateOrigin: hostFixture.privateOrigin,
    expected: identity,
    expectedExportSha256: hash(bytes),
    expectedByteLength: bytes.byteLength,
    readAuthorization: READ_AUTH
  });
  assert.equal(readback.status, "READ_BACK");
  assert.deepEqual(readback.bytes, bytes);
  assert.equal(readback.evaluation.overall, "PASS");

  const {runSyntheticHostAcceptance} =
    await import("../scripts/memecoin-paper/synthetic-host-acceptance.mjs");
  const acceptanceRoot = path.join(hostFixture.root, "acceptance");
  await mkdir(acceptanceRoot, {mode: 0o700});
  for (const proof of ["PIPELINE_QUOTE", "ACTIVE_STOP"]) {
    const {summary} = await runSyntheticHostAcceptance({
      enabled: true, dataRoot: acceptanceRoot, proof,
      httpsOptions: {
        privateOrigin: hostFixture.privateOrigin, transport,
        writeAuthorization: WRITE_AUTH, readAuthorization: READ_AUTH
      }
    });
    assert.equal(summary.https.status, "READ_BACK");
    assert.equal(summary.https.overall, proof === "ACTIVE_STOP" ? "UNKNOWN" : "PASS");
    assert.equal(summary.status, proof === "ACTIVE_STOP" ? "UNKNOWN" : "PASS");
  }

  signalSource.emit("SIGTERM");
  assert.equal(await runPromise, 0);
});

test("protected storage accepts only the root:1000 sticky 03775 mount and a private direct child", async t => {
  const hostFixture = await fixture(t);
  const {validatePaperExportStorageRoot} = await import("../scripts/memecoin-paper-export-host.mjs");

  await validatePaperExportStorageRoot(
    hostFixture.mountRoot,
    hostFixture.storageRoot,
    {lstatPath: fakeMountLstat(hostFixture.mountRoot)}
  );
  const storage = await lstat(hostFixture.storageRoot);
  assert.equal(storage.uid, process.getuid());
  assert.equal(storage.isDirectory(), true);
  assert.equal(storage.mode & 0o7777, 0o700);

  for (const [label, metadata] of [
    ["missing sticky bit", {mode: 0o2775}],
    ["wrong owner", {uid: REQUIRED_UID + 1}],
    ["wrong group", {gid: REQUIRED_GID + 1}],
    ["symlinked mount", {symlink: true}]
  ]) {
    await t.test(label, async () => {
      const mountLstat = fakeMountLstat(hostFixture.mountRoot, metadata);
      const lstatPath = metadata.symlink
        ? async filename => filename === hostFixture.mountRoot
          ? directoryInfo({
            uid: REQUIRED_UID,
            gid: REQUIRED_GID,
            mode: 0o040000 | PROTECTED_MODE,
            isSymbolicLink: () => true
          })
          : lstat(filename)
        : mountLstat;
      const rejectedStorage = path.join(hostFixture.mountRoot, `rejected-${label.replaceAll(" ", "-")}`);
      await assert.rejects(
        validatePaperExportStorageRoot(hostFixture.mountRoot, rejectedStorage, {lstatPath}),
        /trusted directories/
      );
      await assert.rejects(lstat(rejectedStorage), {code: "ENOENT"});
    });
  }

  for (const [label, metadata] of [
    ["wrong runtime owner", {uid: process.getuid() + 1}],
    ["group writable", {mode: 0o040770}],
    ["symlinked child", {symlink: true}]
  ]) {
    await t.test(label, async () => {
      const storageRoot = path.join(hostFixture.mountRoot, `unsafe-${label.replaceAll(" ", "-")}`);
      const lstatPath = async filename => {
        if (filename === hostFixture.mountRoot) {
          return directoryInfo({
            uid: REQUIRED_UID, gid: REQUIRED_GID, mode: 0o040000 | PROTECTED_MODE
          });
        }
        if (filename === storageRoot) {
          return directoryInfo({
            ...metadata,
            mode: metadata.mode ?? 0o040700,
            isSymbolicLink: () => metadata.symlink === true
          });
        }
        return lstat(filename);
      };
      await assert.rejects(
        validatePaperExportStorageRoot(hostFixture.mountRoot, storageRoot, {lstatPath}),
        /runtime-owned private directory/
      );
    });
  }
});

test("setgid protected mount creates and accepts its inherited private 02700 child", async t => {
  const hostFixture = await fixture(t);
  const {validatePaperExportStorageRoot} = await import("../scripts/memecoin-paper-export-host.mjs");
  await chmod(hostFixture.mountRoot, 0o3775);

  const parent = await lstat(hostFixture.mountRoot);
  assert.equal(parent.mode & 0o7777, PROTECTED_MODE);
  const lstatPath = fakeMountLstat(hostFixture.mountRoot);
  await validatePaperExportStorageRoot(
    hostFixture.mountRoot,
    hostFixture.storageRoot,
    {lstatPath}
  );

  const child = await lstat(hostFixture.storageRoot);
  assert.equal(child.uid, process.getuid());
  assert.equal(child.gid, parent.gid);
  assert.equal(child.mode & 0o7777, 0o2700);
});

test("private file reads reject FIFOs without blocking and cap files that grow after fstat", async t => {
  const hostFixture = await fixture(t);
  const {readBoundedPrivateFile, runPaperExportHost} =
    await import("../scripts/memecoin-paper-export-host.mjs");
  const fifo = path.join(hostFixture.root, "authorization.fifo");
  execFileSync("mkfifo", ["-m", "600", fifo]);

  const startedAt = process.hrtime.bigint();
  await assert.rejects(readBoundedPrivateFile(fifo, 4096), /private file/);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  assert.ok(elapsedMs < 1_000, `FIFO rejection took ${elapsedMs} ms`);

  const growingFile = path.join(hostFixture.root, "growing-secret");
  await writeFile(growingFile, "x", {mode: 0o600});
  let grew = false;
  const openFile = async (filename, flags) => {
    const handle = await open(filename, flags);
    const originalStat = await handle.stat();
    return {
      stat: async () => originalStat,
      read: async (...args) => {
        if (!grew) {
          grew = true;
          await writeFile(growingFile, Buffer.alloc(4097, 0x41), {mode: 0o600});
        }
        return handle.read(...args);
      },
      close: () => handle.close()
    };
  };
  await assert.rejects(readBoundedPrivateFile(growingFile, 4096, {openFile}), /byte limit/);

  let output = "";
  const exitCode = await runPaperExportHost({
    ...hostFixture.config,
    writeAuthorizationFile: fifo
  }, {
    lstatPath: hostFixture.lstatPath,
    stdout: {write: value => { output += value; }}
  });
  assert.equal(exitCode, 2);
  assert.deepEqual(JSON.parse(output), {
    status: "BLOCKED",
    code: "HOST_NOT_STARTED",
    listenerStarted: false
  });
  assert.equal(await portAcceptsConnections(hostFixture.port), false);
});

test("bootstrap refuses identical authorization scopes before exposing a server", async t => {
  const hostFixture = await fixture(t);
  const {createPaperExportServer} = await import("../scripts/memecoin-paper-export-host.mjs");
  await writeFile(hostFixture.readAuthorizationFile, WRITE_AUTH, {mode: 0o600});
  await chmod(hostFixture.readAuthorizationFile, 0o600);
  await assert.rejects(createPaperExportServer(hostFixture.config, {
    lstatPath: hostFixture.lstatPath
  }), /scopes must differ/);
});
