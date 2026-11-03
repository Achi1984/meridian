import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {lstat, mkdir, mkdtemp, open, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  runHostAcceptanceBatch
} from "../scripts/memecoin-paper/host-acceptance-batch.mjs";
import {
  validatePaperExportStorageRoot
} from "../scripts/memecoin-paper-export-host.mjs";

const IDENTITY = Object.freeze({
  sourceRevision: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  runId: "batch-test-001"
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-acceptance-batch-"));
  const mountRoot = path.join(root, "mount");
  await mkdir(mountRoot, {mode: 0o700});
  const storageRoot = path.join(mountRoot, "host-acceptance-batch");
  t.after(() => rm(root, {recursive: true, force: true}));
  const validate = (mount, storage, options) => validatePaperExportStorageRoot(
    mount, storage, {
      ...options,
      lstatPath: async filename => {
        const info = await options.lstatPath(filename);
        if (filename !== mountRoot) return info;
        return {
          ...info,
          uid: 0,
          gid: 1000,
          mode: (info.mode & ~0o7777) | 0o3775,
          isDirectory: () => info.isDirectory(),
          isSymbolicLink: () => info.isSymbolicLink()
        };
      }
    }
  );
  return {
    root, mountRoot, storageRoot, validate,
    validateMount: async () => {},
    runtimeUid: process.getuid(),
    runtimeGid: process.getgid()
  };
}

function options(harness, extra = {}) {
  return {
    ...IDENTITY,
    enabled: true,
    mountRoot: harness.mountRoot,
    storageRoot: harness.storageRoot,
    validateStorageRoot: harness.validate,
    validateMount: harness.validateMount,
    runtimeUid: harness.runtimeUid,
    runtimeGid: harness.runtimeGid,
    ...extra
  };
}

function fakeSpawn({stdout = "{}", stderr = "", code = 0, signal = null, onKill} = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = value => {
      onKill?.(value, child);
      return true;
    };
    setImmediate(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit("exit", code, signal);
      child.emit("close", code, signal);
    });
    return child;
  };
}

function mountInfoFileSystem(mountInfo) {
  const bytes = Buffer.from(mountInfo);
  return {
    open: async (filename, ...args) => {
      if (filename !== "/proc/self/mountinfo") return open(filename, ...args);
      let offset = 0;
      return {
        read: async (buffer, bufferOffset, length) => {
          const bytesRead = Math.min(length, bytes.byteLength - offset);
          bytes.copy(buffer, bufferOffset, offset, offset + bytesRead);
          offset += bytesRead;
          return {bytesRead};
        },
        close: async () => {}
      };
    }
  };
}

async function execute(harness, extra = {}) {
  return runHostAcceptanceBatch(options(harness, extra));
}

test("disabled by default without mount access or proof dispatch", async t => {
  const harness = await fixture(t);
  let dispatches = 0;
  const result = await runHostAcceptanceBatch({
    mountRoot: harness.mountRoot,
    storageRoot: harness.storageRoot,
    validateStorageRoot: async () => { throw new Error("disabled batches do not validate"); },
    spawnImpl: () => { dispatches += 1; throw new Error("unexpected proof"); }
  });
  assert.deepEqual(result, {status: "DISABLED", executionStarted: false});
  assert.equal(dispatches, 0);
});

test("mount validation fails closed before claim creation or proof dispatch", async t => {
  const harness = await fixture(t);
  let dispatches = 0;
  const result = await execute(harness, {
    validateMount: undefined,
    fileSystem: mountInfoFileSystem(
      "123 22 8:1 / /var/data/not-the-paper-volume rw - ext4 /dev/example rw\n"
    ),
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "BATCH_MOUNT_IDENTITY_INVALID");
  assert.equal(result.executionStarted, false);
  assert.equal(dispatches, 0);
  await assert.rejects(lstat(path.join(harness.storageRoot, "batch-claim.json")), {
    code: "ENOENT"
  });
});

test("stale rehearsal source and local image IDs are rejected", async t => {
  const harness = await fixture(t);
  await assert.rejects(runHostAcceptanceBatch(options(harness, {
    sourceRevision: "fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa"
  })), {code: "BATCH_SOURCE_PIN_STALE"});
  await assert.rejects(runHostAcceptanceBatch(options(harness, {
    imageDigest: "sha256:ec191ba1fbd70d858940bd5e934c79fd000bf1e1a61fdbd442766cd01f2e63b5"
  })), {code: "BATCH_IMAGE_DIGEST_NOT_PUBLISHED"});
  await assert.rejects(lstat(path.join(harness.storageRoot, "batch-claim.json")), {
    code: "ENOENT"
  });
});

test("hold mode remains inert after a failure until termination", async t => {
  const harness = await fixture(t);
  const signalSource = new EventEmitter();
  let settled = false;
  const pending = execute(harness, {
    hold: true,
    signalSource,
    spawnImpl: fakeSpawn({stdout: "{}", code: 0})
  }).finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(settled, false);
  signalSource.emit("SIGTERM");
  const result = await pending;
  assert.equal(result.status, "UNKNOWN");
  assert.equal(settled, true);
});

test("one generated-data batch composes all existing proofs and restart never dispatches", async t => {
  const harness = await fixture(t);
  const first = await execute(harness);
  assert.equal(first.status, "BATCH_COMPLETE");
  assert.equal(first.executionStarted, true);
  assert.equal(first.hostAcceptance, "NOT_ASSESSED");
  assert.equal(first.liveExecution, false);
  assert.deepEqual(first.proofs.map(proof => proof.proof), [
    "PIPELINE_QUOTE", "ACTIVE_STOP", "CONTROLLER_SOURCE_POLICY_NO_ENTRY"
  ]);
  assert.deepEqual(first.proofs.map(proof => proof.exitCode), [0, 2, 2]);
  assert.equal(first.proofs[0].summary.status, "PASS");
  assert.equal(first.proofs[1].summary.outcome, "OPEN_UNVALUED_TERMINAL_POSITION");
  assert.equal(first.proofs[2].result.exportStatus, "ACKNOWLEDGED");

  const claim = await readFile(path.join(harness.storageRoot, "batch-claim.json"));
  assert.match(claim.toString("utf8"), /"status":"CLAIMED"/);
  for (const proof of ["pipeline_quote", "active_stop", "controller-no-entry"]) {
    assert.ok(await lstat(path.join(harness.storageRoot, IDENTITY.runId, proof)));
  }
  let dispatches = 0;
  const restarted = await execute(harness, {
    spawnImpl: (...args) => { dispatches += 1; return fakeSpawn()(...args); }
  });
  assert.equal(restarted.status, "ALREADY_CLAIMED");
  assert.equal(restarted.executionStarted, false);
  assert.equal(dispatches, 0);
});

test("simultaneous starts have one exclusive claim and at most one proof dispatch", async t => {
  const harness = await fixture(t);
  let dispatches = 0;
  const fake = (...args) => {
    dispatches += 1;
    return fakeSpawn()(...args);
  };
  const [left, right] = await Promise.all([
    execute(harness, {spawnImpl: fake}),
    execute(harness, {spawnImpl: fake})
  ]);
  assert.equal([left, right].filter(value => value.status === "ALREADY_CLAIMED").length, 1);
  assert.equal(dispatches, 1);
  assert.ok([left, right].some(value => value.status === "UNKNOWN"));
  assert.ok(await lstat(path.join(harness.storageRoot, "batch-claim.json")));
});

test("failure after durable claim and ambiguous claim fsync leave a permanent no-rerun latch", async t => {
  const afterClaim = await fixture(t);
  const filesystem = {
    mkdir: async (directory, ...args) => {
      if (directory === path.join(afterClaim.storageRoot, IDENTITY.runId)) {
        throw new Error("simulated crash before first proof");
      }
      return mkdir(directory, ...args);
    }
  };
  let dispatches = 0;
  const stopped = await execute(afterClaim, {
    fileSystem: filesystem,
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(stopped.status, "UNKNOWN");
  assert.equal(stopped.executionStarted, false);
  assert.equal(dispatches, 0);
  const restart = await execute(afterClaim, {
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(restart.status, "ALREADY_CLAIMED");
  assert.equal(dispatches, 0);

  const ambiguous = await fixture(t);
  let failedSync = false;
  const ambiguousFs = {
    open: async (...args) => {
      const handle = await open(...args);
      if (path.basename(args[0]) !== "batch-claim.json" || failedSync) return handle;
      failedSync = true;
      return {
        writeFile: (...values) => handle.writeFile(...values),
        sync: async () => {
          await handle.sync();
          throw new Error("ambiguous claim fsync");
        },
        stat: (...values) => handle.stat(...values),
        read: (...values) => handle.read(...values),
        close: (...values) => handle.close(...values)
      };
    }
  };
  const uncertain = await execute(ambiguous, {
    fileSystem: ambiguousFs,
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(uncertain.status, "UNKNOWN");
  assert.equal(uncertain.executionStarted, false);
  assert.equal(dispatches, 0);
  const noRetry = await execute(ambiguous, {
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(noRetry.status, "ALREADY_CLAIMED");
  assert.equal(dispatches, 0);
});

test("unexpected exit and result are captured as partial evidence without a second dispatch", async t => {
  const harness = await fixture(t);
  let dispatches = 0;
  const result = await execute(harness, {
    spawnImpl: (...args) => {
      dispatches += 1;
      return fakeSpawn({
        stdout: JSON.stringify({
          status: "PASS",
          contractChecks: "PASS",
          proof: "SYNTHETIC_ACTIVE_STOP"
        }),
        code: 2
      })(...args);
    }
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.executionStarted, true);
  assert.equal(dispatches, 1);
  const proofDirectory = path.join(
    harness.storageRoot, IDENTITY.runId, "pipeline_quote"
  );
  assert.equal(await readFile(path.join(proofDirectory, "PIPELINE_QUOTE.stdout"), "utf8"),
    JSON.stringify({
      status: "PASS",
      contractChecks: "PASS",
      proof: "SYNTHETIC_ACTIVE_STOP"
    }));
  assert.equal(JSON.parse(await readFile(
    path.join(proofDirectory, "PIPELINE_QUOTE.exit.json"), "utf8"
  )).exit.code, 2);
  const restart = await execute(harness, {
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(restart.status, "ALREADY_CLAIMED");
  assert.equal(dispatches, 1);
});

test("late filesystem completion cannot dispatch a proof or clear the claim", async t => {
  const harness = await fixture(t);
  let spawnCount = 0;
  let delayedOpen = false;
  const delayedFs = {
    open: async (...args) => {
      if (path.basename(args[0]) === "batch-claim.json" && !delayedOpen) {
        delayedOpen = true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return open(...args);
    }
  };
  const timedOut = await execute(harness, {
    timeoutMs: 15,
    fileSystem: delayedFs,
    spawnImpl: () => { spawnCount += 1; return fakeSpawn()(); }
  });
  assert.equal(timedOut.status, "UNKNOWN");
  assert.equal(spawnCount, 0);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.ok(await lstat(path.join(harness.storageRoot, "batch-claim.json")));
  const restart = await execute(harness, {
    spawnImpl: () => { spawnCount += 1; return fakeSpawn()(); }
  });
  assert.equal(restart.status, "ALREADY_CLAIMED");
  assert.equal(spawnCount, 0);
});

test("timeout and termination during a child are fenced and preserve partial output", async t => {
  const harness = await fixture(t);
  const signalSource = new EventEmitter();
  const kills = [];
  let dispatches = 0;
  const spawnImpl = () => {
    dispatches += 1;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = signal => {
      kills.push(signal);
      setTimeout(() => {
        child.stdout.end("{}");
        child.stderr.end();
        child.emit("exit", 2, signal);
        child.emit("close", 2, signal);
      }, 5);
      return true;
    };
    setTimeout(() => signalSource.emit("SIGTERM"), 10);
    return child;
  };
  const stopped = await execute(harness, {signalSource, spawnImpl});
  assert.equal(stopped.status, "UNKNOWN");
  assert.equal(stopped.code, "BATCH_PROOF_EXIT_UNEXPECTED");
  assert.deepEqual(kills, ["SIGTERM"]);
  assert.equal(dispatches, 1);
  const proofDirectory = path.join(
    harness.storageRoot, IDENTITY.runId, "pipeline_quote"
  );
  assert.equal(await readFile(path.join(proofDirectory, "PIPELINE_QUOTE.stdout"), "utf8"), "{}");
  const restart = await execute(harness, {
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(restart.status, "ALREADY_CLAIMED");
  assert.equal(dispatches, 1);
});

test("a child that emits output after the global deadline cannot become a late success", async t => {
  const harness = await fixture(t);
  let dispatches = 0;
  const spawnImpl = () => {
    dispatches += 1;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setTimeout(() => {
      child.stdout.end(JSON.stringify({status: "PASS"}));
      child.stderr.end();
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    }, 60);
    return child;
  };
  const result = await execute(harness, {timeoutMs: 15, spawnImpl});
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.code, "BATCH_DEADLINE_EXCEEDED");
  assert.equal(dispatches, 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  await assert.rejects(lstat(path.join(
    harness.storageRoot, IDENTITY.runId, "pipeline_quote", "PIPELINE_QUOTE.stdout"
  )), {code: "ENOENT"});
  const restart = await execute(harness, {
    spawnImpl: () => { dispatches += 1; return fakeSpawn()(); }
  });
  assert.equal(restart.status, "ALREADY_CLAIMED");
  assert.equal(dispatches, 1);
});
