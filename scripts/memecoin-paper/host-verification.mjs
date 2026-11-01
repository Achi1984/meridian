import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {canonicalCheckpointBytes, CheckpointStore} from "./checkpoint-store.mjs";
import {PaperCheckpointSession} from "./checkpoint-session.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIXTURE_DIRECTORY = path.join(ROOT, "test/fixtures/memecoin-paper-host-verification");
const FIXTURE_PATH = path.join(FIXTURE_DIRECTORY, "run.json");
const CHILD_PATH = path.join(FIXTURE_DIRECTORY, "checkpoint-child.mjs");
const OWNED_DIRECTORY_PREFIX = "meridian-paper-host-verification-";
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FIXTURE_BYTES = 16 * 1024;
const MAX_CHILD_MS = 5_000;
const MAX_REAP_MS = 1_000;
const MAX_RESULT_BYTES = 64 * 1024;
const SOURCE_PATHS = [
  "scripts/memecoin-paper/host-verification.mjs",
  "scripts/memecoin-paper/checkpoint-store.mjs",
  "scripts/memecoin-paper/checkpoint-session.mjs",
  "scripts/memecoin-paper/ledger.mjs",
  "test/fixtures/memecoin-paper-host-verification/checkpoint-child.mjs"
];
const CHILD_FILE_PATTERN = /^\.checkpoint-[0-9]+-[a-f0-9]{16}\.tmp$/;
const OWNED_FILES = new Set(["checkpoint.json", ".checkpoint-pending", ".checkpoint-lock"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function boundedFileBytes(filename, maxBytes) {
  const fileInfo = await lstat(filename);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size > maxBytes) {
    throw new Error("verification input is not a bounded regular file");
  }
  const bytes = await readFile(filename);
  if (bytes.length !== fileInfo.size || bytes.length > maxBytes) {
    throw new Error("verification input changed or exceeded its byte limit");
  }
  return bytes;
}

async function withOwnedDirectory(callback) {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, OWNED_DIRECTORY_PREFIX));
  try {
    const actual = await realpath(directory);
    if (actual !== directory || path.dirname(actual) !== temporaryRoot ||
        !path.basename(actual).startsWith(OWNED_DIRECTORY_PREFIX)) {
      throw new Error("temporary verification directory escaped its owned boundary");
    }
    const result = await callback(directory);
    await removeOwnedDirectory(directory, temporaryRoot);
    return result;
  } catch (error) {
    if (error && typeof error === "object") error.syntheticEvidenceDirectory = directory;
    throw error;
  }
}

async function removeOwnedDirectory(directory, temporaryRoot) {
  const absolute = path.resolve(directory);
  if (absolute !== directory || path.dirname(absolute) !== temporaryRoot ||
      !path.basename(absolute).startsWith(OWNED_DIRECTORY_PREFIX)) {
    throw new Error("refusing cleanup outside the owned temporary directory");
  }
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(absolute) !== absolute) {
    throw new Error("refusing cleanup of a replaced or linked temporary directory");
  }
  const entries = [];
  for (const name of await readdir(absolute)) {
    if (!OWNED_FILES.has(name) && !CHILD_FILE_PATTERN.test(name)) {
      throw new Error("refusing cleanup of an unexpected temporary entry");
    }
    const entry = path.join(absolute, name);
    const entryInfo = await lstat(entry);
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
      throw new Error("refusing cleanup of a non-file temporary entry");
    }
    entries.push(entry);
  }
  for (const entry of entries) await unlink(entry);
  await rmdir(absolute);
}

async function openFixtureSession(directory, fixture, options = {}) {
  const store = await CheckpointStore.open(directory, options);
  const session = await PaperCheckpointSession.open({
    store,
    runId: fixture.runId,
    startedAt: fixture.startedAt
  });
  return {store, session};
}

function riskInputs(fixture) {
  return {now: fixture.startedAt + 1_000, marks: []};
}

async function acknowledgedReceipt(directory, fixture) {
  const first = await openFixtureSession(directory, fixture);
  const input = riskInputs(fixture);
  const acknowledged = await first.session.riskSnapshot(fixture.commandId, input);
  assert.equal(acknowledged.status, "PASS");

  const metadata = first.session.metadata;
  assert.equal(metadata.runId, fixture.runId);
  assert.equal(metadata.sequence, 1);
  const checkpoint = await first.store.readCheckpoint();
  assert.equal(checkpoint.status, "OK");
  assert.equal(checkpoint.sequence, metadata.sequence);
  assert.equal(checkpoint.hash, metadata.hash);
  assert.equal(sha256(checkpoint.bytes), metadata.hash);
  const parsed = JSON.parse(checkpoint.bytes.toString("utf8"));
  assert.equal(parsed.runHeader.runId, fixture.runId);
  assert.equal(parsed.records[1].runId, fixture.runId);
  assert.equal(parsed.records[1].commandId, fixture.commandId);

  const duplicate = await first.session.riskSnapshot(fixture.commandId, input);
  assert.deepEqual(duplicate, acknowledged);
  assert.equal(first.session.metadata.sequence, metadata.sequence);
  const mismatch = await first.session.riskSnapshot(fixture.commandId, {
    ...input,
    now: input.now + 1
  });
  assert.equal(mismatch.status, "REJECT");
  assert.equal(first.session.metadata.sequence, metadata.sequence);

  const staleReceipt = await first.store.commitCheckpoint({
    expectedSequence: metadata.sequence - 1,
    expectedHash: "0".repeat(64),
    candidateBytes: checkpoint.bytes
  });
  assert.equal(staleReceipt.status, "NOT_COMMITTED");
  assert.equal((await first.store.readCheckpoint()).hash, metadata.hash);
  await first.session.close();

  let mismatchedRunCode;
  const mismatchStore = await CheckpointStore.open(directory);
  try {
    await PaperCheckpointSession.open({
      store: mismatchStore,
      runId: `${fixture.runId}-different`,
      startedAt: fixture.startedAt
    });
  } catch (error) {
    mismatchedRunCode = error.code;
  }
  assert.equal(mismatchedRunCode, "CHECKPOINT_INCOMPATIBLE");

  const reopened = await openFixtureSession(directory, fixture);
  assert.equal(reopened.session.metadata.sequence, metadata.sequence);
  assert.equal(reopened.session.metadata.hash, metadata.hash);
  assert.deepEqual(await reopened.session.riskSnapshot(fixture.commandId, input), acknowledged);
  assert.equal(reopened.session.metadata.sequence, metadata.sequence);
  await reopened.session.close();
  return {
    status: acknowledged.status,
    runId: metadata.runId,
    sequence: metadata.sequence,
    hash: metadata.hash,
    exactReadback: true,
    duplicateDidNotAdvance: true,
    staleOrMismatchedReceiptRejected: true,
    changedPayloadRejected: true,
    mismatchedRunRejected: true
  };
}

async function ambiguousWrite(fixture) {
  return withOwnedDirectory(async directory => {
    const initial = await openFixtureSession(directory, fixture);
    await initial.session.close();

    let injectFailure = false;
    const store = await CheckpointStore.open(directory, {
      onPhase(phase, details) {
        if (injectFailure && phase === "after-directory-sync" && details.sequence === 1) {
          throw new Error("synthetic acknowledgement interruption");
        }
      }
    });
    const session = await PaperCheckpointSession.open({store});
    injectFailure = true;
    const result = await session.riskSnapshot(fixture.commandId, riskInputs(fixture));
    assert.equal(result.status, "UNKNOWN");
    assert.throws(() => session.snapshot(), {code: "CHECKPOINT_UNKNOWN"});
    await session.close();

    const pendingBytes = await boundedFileBytes(path.join(directory, ".checkpoint-pending"), 16 * 1024);
    const restartedStore = await CheckpointStore.open(directory);
    assert.equal((await restartedStore.readCheckpoint()).status, "UNKNOWN");
    const reconciliation = await restartedStore.reconcilePending();
    assert.equal(reconciliation.status, "UNKNOWN");
    await assert.rejects(
      PaperCheckpointSession.open({store: restartedStore}),
      {code: "CHECKPOINT_UNKNOWN"}
    );
    assert.deepEqual(await boundedFileBytes(path.join(directory, ".checkpoint-pending"), 16 * 1024), pendingBytes);
    const visibleBytes = await boundedFileBytes(path.join(directory, "checkpoint.json"), 8 * 1024 * 1024);
    const visibleCheckpoint = JSON.parse(visibleBytes.toString("utf8"));
    return {
      result: result.status,
      restartRead: "UNKNOWN",
      reconciliation: "UNKNOWN",
      unresolvedRecordRetained: true,
      automaticReplay: false,
      unresolvedEvidence: {
        pendingMarker: {
          sha256: sha256(pendingBytes),
          record: JSON.parse(pendingBytes.toString("utf8"))
        },
        visibleCheckpoint: {
          sha256: sha256(visibleBytes),
          sequence: visibleCheckpoint.sequence,
          runId: visibleCheckpoint.runHeader.runId,
          commandId: visibleCheckpoint.records.at(-1).commandId
        },
        reconcileVisibleSequence: reconciliation.visibleSequence,
        reconcileVisibleHash: reconciliation.visibleHash
      }
    };
  });
}

async function boundedExit(exitPromise, timeoutMs) {
  let timer;
  return Promise.race([
    exitPromise,
    new Promise(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function boundedChild(childPath, directory, fixture, phase) {
  const child = spawn(process.execPath, [
    childPath,
    directory,
    phase,
    fixture.runId,
    String(fixture.startedAt)
  ], {stdio: "ignore", windowsHide: true});
  let exitObserved = false;
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      exitObserved = true;
      resolveExit({code, signal});
    });
  });
  try {
    const outcome = await boundedExit(exit.then(value => ({value})), MAX_CHILD_MS);
    const timedOut = outcome === null;
    if (timedOut && !exitObserved) child.kill("SIGKILL");
    const exitResult = timedOut ? await boundedExit(exit, MAX_REAP_MS) : outcome.value;
    if (!exitResult) throw new Error("synthetic child could not be reaped within the bound");
    return {
      pid: child.pid,
      ...exitResult,
      timedOut,
      reaped: exitObserved
    };
  } finally {
    if (!exitObserved && child.pid) {
      child.kill("SIGKILL");
      const reaped = await boundedExit(exit.catch(() => null), MAX_REAP_MS);
      if (!reaped || !exitObserved) {
        throw new Error("synthetic child could not be reaped within the bound");
      }
    }
  }
}

async function clearObservedChildLock(directory, child) {
  if (!child.reaped || !Number.isSafeInteger(child.pid)) {
    throw new Error("child lock cannot be cleared before observing child exit");
  }
  const lockPath = path.join(directory, ".checkpoint-lock");
  const lock = await boundedFileBytes(lockPath, 128);
  assert.equal(lock.toString("utf8"), `${child.pid}\n`);
  await unlink(lockPath);
}

async function interruptedChild(fixture, phase, expectedSequence, expectedPendingStatus) {
  return withOwnedDirectory(async directory => {
    const child = await boundedChild(CHILD_PATH, directory, fixture, phase);
    assert.equal(child.timedOut, false);
    assert.equal(child.reaped, true);
    assert.equal(child.code, 74);
    await clearObservedChildLock(directory, child);

    const store = await CheckpointStore.open(directory);
    const checkpoint = await store.readCheckpoint();
    assert.equal(checkpoint.status, "UNKNOWN");
    const reconciliation = await store.reconcilePending();
    assert.equal(reconciliation.status, expectedPendingStatus);
    if (expectedSequence === 0) {
      assert.equal(reconciliation.sequence, 0);
    } else {
      assert.equal(reconciliation.visibleSequence, expectedSequence);
    }
    const pendingBefore = await boundedFileBytes(path.join(directory, ".checkpoint-pending"), 16 * 1024);
    const pendingRecord = JSON.parse(pendingBefore.toString("utf8"));
    const visibleBytes = await boundedFileBytes(path.join(directory, "checkpoint.json"), 8 * 1024 * 1024);
    const visibleCheckpoint = JSON.parse(visibleBytes.toString("utf8"));
    await assert.rejects(PaperCheckpointSession.open({store}), {code: "CHECKPOINT_UNKNOWN"});
    assert.deepEqual(await boundedFileBytes(path.join(directory, ".checkpoint-pending"), 16 * 1024), pendingBefore);
    return {
      phase,
      childPid: child.pid,
      childExit: child.code,
      childReaped: child.reaped,
      restartRead: checkpoint.status,
      reconciliation: reconciliation.status,
      visibleSequence: expectedSequence,
      automaticReplay: false,
      unresolvedRecordRetained: true,
      unresolvedEvidence: {
        pendingMarker: {sha256: sha256(pendingBefore), record: pendingRecord},
        visibleCheckpoint: {
          sha256: sha256(visibleBytes),
          sequence: visibleCheckpoint.sequence,
          runId: visibleCheckpoint.runHeader.runId,
          commandId: visibleCheckpoint.records.at(-1).commandId
        },
        reconcileVisibleSequence: reconciliation.visibleSequence ?? null,
        reconcileVisibleHash: reconciliation.visibleHash ?? null
      }
    };
  });
}

async function acknowledgedChildRestart(fixture) {
  return withOwnedDirectory(async directory => {
    const child = await boundedChild(CHILD_PATH, directory, fixture, "complete");
    assert.equal(child.timedOut, false);
    assert.equal(child.reaped, true);
    assert.equal(child.code, 0);
    const restarted = await openFixtureSession(directory, fixture);
    assert.equal(restarted.session.metadata.runId, fixture.runId);
    assert.equal(restarted.session.metadata.sequence, 1);
    const duplicate = await restarted.session.riskSnapshot(fixture.commandId, riskInputs(fixture));
    assert.equal(duplicate.status, "PASS");
    assert.equal(restarted.session.metadata.sequence, 1);
    const hash = restarted.session.metadata.hash;
    await restarted.session.close();
    return {
      childExit: child.code,
      childReaped: child.reaped,
      restartSequence: 1,
      exactDuplicateRead: true,
      hash
    };
  });
}

async function corruptCheckpoint(fixture) {
  return withOwnedDirectory(async directory => {
    const created = await openFixtureSession(directory, fixture);
    await created.session.close();
    const checkpointPath = path.join(directory, "checkpoint.json");
    const checkpoint = await boundedFileBytes(checkpointPath, 8 * 1024 * 1024);
    await writeFile(checkpointPath, checkpoint.subarray(0, Math.max(1, checkpoint.length - 7)));
    const store = await CheckpointStore.open(directory);
    const result = await store.readCheckpoint();
    assert.equal(result.status, "CORRUPT");
    await store.close();
    return {read: result.status, automaticRecovery: false};
  });
}

async function fixedDeadline(fixture) {
  return withOwnedDirectory(async directory => {
    const {session} = await openFixtureSession(directory, fixture);
    const deadline = fixture.startedAt + 8 * 60 * 60 * 1_000;
    assert.equal(deadline, fixture.deadlineAt);
    const finished = await session.finishRun(fixture.finishCommandId, {
      now: deadline,
      marks: []
    });
    assert.equal(finished.status, "FINISHED");
    assert.equal(session.metadata.deadlineAt, fixture.deadlineAt);
    await session.close();
    return {
      clock: "FIXTURE_TIME_ONLY",
      hostClockUsed: false,
      clockProvenance: "UNVERIFIED",
      stopAtFixedDeadline: finished.status
    };
  });
}

async function withCheck(checks, name, operation) {
  try {
    checks.push({name, status: "PASS", evidence: await operation()});
  } catch (error) {
    const check = {
      name,
      status: "FAIL",
      errorCode: typeof error?.code === "string" ? error.code.slice(0, 80) : "CHECK_FAILED"
    };
    if (typeof error?.syntheticEvidenceDirectory === "string") {
      check.preservedFixtureDirectory = error.syntheticEvidenceDirectory.slice(0, 1_024);
    }
    checks.push(check);
  }
}

export async function runSyntheticHostVerification({mode} = {}) {
  if (mode !== "SYNTHETIC_TEST_ONLY") {
    throw new TypeError("explicit SYNTHETIC_TEST_ONLY mode is required");
  }

  const fixtureBytes = await boundedFileBytes(FIXTURE_PATH, MAX_FIXTURE_BYTES);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  if (fixture.scope !== "SYNTHETIC_TEST_ONLY" ||
      typeof fixture.runId !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(fixture.runId) ||
      !Number.isSafeInteger(fixture.startedAt) ||
      fixture.deadlineAt !== fixture.startedAt + 8 * 60 * 60 * 1_000 ||
      typeof fixture.commandId !== "string" ||
      typeof fixture.finishCommandId !== "string") {
    throw new TypeError("synthetic run fixture identity is invalid");
  }
  const sourceIdentities = [];
  for (const relativePath of SOURCE_PATHS) {
    const bytes = await boundedFileBytes(path.join(ROOT, relativePath), MAX_SOURCE_BYTES);
    sourceIdentities.push({path: relativePath, sha256: sha256(bytes)});
  }
  const runFixture = {
    fixtureSha256: sha256(fixtureBytes),
    runId: fixture.runId,
    startedAt: fixture.startedAt,
    commandId: fixture.commandId,
    inputSha256: sha256(canonicalCheckpointBytes(riskInputs(fixture)))
  };
  runFixture.identitySha256 = sha256(canonicalCheckpointBytes(runFixture));

  const checks = [];
  await withCheck(checks, "acknowledgement-receipt-and-restart", () =>
    withOwnedDirectory(directory => acknowledgedReceipt(directory, fixture)));
  await withCheck(checks, "ambiguous-write-retains-unknown", () => ambiguousWrite(fixture));
  await withCheck(checks, "interruption-before-publication", () =>
    interruptedChild(fixture, "before-rename", 0, "NOT_PUBLISHED"));
  await withCheck(checks, "interruption-after-publication-before-ack", () =>
    interruptedChild(fixture, "before-ack", 1, "UNKNOWN"));
  await withCheck(checks, "process-exit-after-acknowledgement", () => acknowledgedChildRestart(fixture));
  await withCheck(checks, "torn-checkpoint-fails-closed", () => corruptCheckpoint(fixture));
  await withCheck(checks, "fixed-stop-deadline-and-clock-provenance", () => fixedDeadline(fixture));

  const result = {
    schemaVersion: 1,
    status: checks.every(check => check.status === "PASS") ? "PASS" : "FAIL",
    scope: "SYNTHETIC_ONLY",
    runtimeAuthorization: false,
    hostDurability: "NOT_VERIFIED",
    hostClockProvenance: "UNVERIFIED",
    sourceIdentities,
    configIdentity: {
      path: "test/fixtures/memecoin-paper-host-verification/run.json",
      sha256: sha256(fixtureBytes)
    },
    runFixtureIdentity: runFixture,
    syntheticEvidence: {checks},
    hostEvidence: {
      status: "NOT_PROVIDED",
      records: []
    },
    limitations: [
      "Process termination tests do not prove power-loss, fsync, volume, or real-host recovery durability.",
      "Hashes and booleans identify bytes and observations; they are not authentication.",
      "Fixture timestamps are not trusted host clock evidence."
    ]
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw new RangeError("verification result exceeds its output limit");
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.env.SYNTHETIC_TEST_ONLY !== "SYNTHETIC_TEST_ONLY") {
    process.stderr.write("Set SYNTHETIC_TEST_ONLY=SYNTHETIC_TEST_ONLY to run offline fixtures.\n");
    process.exitCode = 64;
  } else {
    try {
      const result = await runSyntheticHostVerification({mode: "SYNTHETIC_TEST_ONLY"});
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status !== "PASS") process.exitCode = 1;
    } catch {
      process.stderr.write('{"status":"FAIL","scope":"SYNTHETIC_ONLY"}\n');
      process.exitCode = 1;
    }
  }
}
