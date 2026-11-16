import {createHash} from "node:crypto";
import {lstat, readFile, readdir, realpath} from "node:fs/promises";
import {isAbsolute, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,54}$/;
const WAIT_FOR_SIGTERM_MS = 180_000;
const IO_TIMEOUT_MS = 5_000;
const monotonicNow = () => performance.now();
const ioContext = () => ({deadlineAt: monotonicNow() + IO_TIMEOUT_MS, monotonicNow});
const digest = value => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report = value => console.log(JSON.stringify(value));

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function waitForSigterm(signal) {
  if (signal.aborted) throw new Error("EARLY_SIGTERM");
  await new Promise((resolveSignal, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("SIGTERM_NOT_OBSERVED"));
    }, WAIT_FOR_SIGTERM_MS);
    function onAbort() {
      clearTimeout(timer);
      resolveSignal();
    }
    signal.addEventListener("abort", onAbort, {once: true});
  });
}

async function main([dataRoot, candidateRunId, ...extra]) {
  assert(!extra.length && typeof candidateRunId === "string" && RUN_ID.test(candidateRunId),
    "INVALID_CANDIDATE_RUN_ID");
  assert(typeof dataRoot === "string" && isAbsolute(dataRoot) && resolve(dataRoot) === dataRoot &&
    await realpath(dataRoot) === dataRoot && (await lstat(dataRoot)).isDirectory(),
    "INVALID_DATA_ROOT");
  const uid = process.getuid?.();
  assert(Number.isInteger(uid) && uid > 0, "NONROOT_RUNTIME_REQUIRED");
  const entries = await readdir(dataRoot);
  if (entries.length === 1 && entries[0] === "lost+found") {
    const recoveryDirectory = await lstat(join(dataRoot, "lost+found"));
    assert(recoveryDirectory.isDirectory() && !recoveryDirectory.isSymbolicLink() &&
      recoveryDirectory.uid === 0, "UNVERIFIED_FILESYSTEM_METADATA");
    report({status: "FILESYSTEM_METADATA_ONLY", entry: "lost+found"});
  } else {
    assert(entries.length === 0, "REHEARSAL_REQUIRES_EMPTY_ROOT");
  }

  const runId = `${candidateRunId}-sigterm`;
  const runDirectory = join(dataRoot, candidateRunId);
  const moduleUrl = path => pathToFileURL(resolve(path)).href;
  const {createRunJournal, readRunJournal} = await import(moduleUrl("scripts/spot-paper-pilot/journal.mjs"));
  const {runSpotPaperPairedWithSignals} = await import(moduleUrl("scripts/spot-paper-paired/host.mjs"));
  const startedAt = Date.now();
  const checkpoint = {states: [], counters: {requests: 0, bytes: 0}, cycle: 0};
  const journal = await createRunJournal({
    dataRoot, runId, manifest: {runId, startedAt, syntheticFixture: true}, ...ioContext()
  });

  let before;
  try {
    await runSpotPaperPairedWithSignals(async signal => {
      await journal.append({id: "start", type: "start", at: startedAt}, checkpoint, ioContext());
      const raw = JSON.parse(await readFile(join(dataRoot, runId, "journal.json"), "utf8"));
      before = raw.payload;
      assert(before?.sequence === 1 && before.events?.length === 1 &&
        raw.sha256 === digest(before).slice(7), "CHECKPOINT_READBACK_MISMATCH");
      assert((await readdir(dataRoot)).includes(candidateRunId) === false, "CANDIDATE_DIRECTORY_PRESENT");
      report({status: "READY_FOR_SIGTERM", syntheticFixture: true, candidateRunId,
        rehearsalRunId: runId, dataRoot, runDirectory, runtimeUid: uid,
        checkpointBefore: {sequence: before.sequence, digest: digest(before.checkpoint)}});
      await waitForSigterm(signal);
    });
    const receivedAt = monotonicNow();
    await journal.append({
      id: "terminal", type: "terminal", at: Date.now(),
      report: {runId, outcome: "OPERATOR_STOP", stopReason: "OPERATOR_STOP", liveTrading: false}
    }, {...checkpoint, stopReason: "OPERATOR_STOP"}, ioContext());
    await journal.close(ioContext());

    const after = await readRunJournal({dataRoot, runId, ...ioContext()});
    const preserved = digest(after.events.slice(0, before.sequence)) === digest(before.events);
    assert(preserved && after.sequence === before.sequence + 1 &&
      after.events.at(-1)?.report?.stopReason === "OPERATOR_STOP" &&
      after.reconciliationStatus === "READ_ONLY_VERIFIED", "TERMINAL_READBACK_MISMATCH");
    assert((await readdir(dataRoot)).includes(candidateRunId) === false, "CANDIDATE_DIRECTORY_PRESENT");
    report({status: "STOPPED", syntheticFixture: true, candidateRunId, rehearsalRunId: runId,
      checkpointBefore: {sequence: before.sequence, digest: digest(before.checkpoint)},
      checkpointAfter: {sequence: after.sequence, digest: digest(after.checkpoint)},
      applicationStopMs: Math.ceil(monotonicNow() - receivedAt),
      evidenceDigestUnchanged: preserved, reconciliationStatus: after.reconciliationStatus});
  } finally {
    await journal.close(ioContext());
  }
}

try {
  await main(process.argv.slice(1));
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.message) ? error.message : "REHEARSAL_FAILED";
  report({status: "UNKNOWN", code});
  process.exitCode = 1;
}
