import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {runSyntheticPaperOrchestration} from "../scripts/memecoin-paper/orchestration.mjs";
const START = Date.parse("2026-01-01T19:00:00Z");
const manifest = JSON.parse(await readFile(new URL("../scripts/memecoin-paper/run-manifest.json", import.meta.url), "utf8"));

async function directory(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), "memecoin-orchestration-"));
  t.after(() => rm(value, {recursive: true, force: true}));
  return value;
}
async function run(dir, scenario = "baseline", extra = {}) {
  return runSyntheticPaperOrchestration({store: await CheckpointStore.open(dir), manifest,
    runId: "orchestration-test", startedAt: START, scenario, ...extra});
}
const named = (report, suffix) => report.results.find(item => item.commandId.endsWith(`:${suffix}`)).result;

test("golden baseline and reopen preserve acknowledged results, snapshot and audit digests", async t => {
  const dir = await directory(t);
  const first = await run(dir);
  assert.equal(first.goldenMatch, true);
  assert.equal(first.networkAccessed, false);
  assert.equal(named(first, "boundary").status, "FINISHED");
  const second = await run(dir);
  assert.deepEqual(second, first);
  assert.equal(first.metadata.sequence, 3);
  const store = await CheckpointStore.open(dir);
  const session = await PaperCheckpointSession.open({store, runId: "orchestration-test", startedAt: START});
  assert.deepEqual(session.snapshot(), first.snapshot);
  const prior = session.metadata;
  assert.equal((await session.riskSnapshot("backward", {now: START + 2001, marks: []})).reason, "NON_MONOTONIC_TIME");
  assert.deepEqual(session.metadata, prior);
  await session.close();
});

test("stale and mismatched generated quotes never debit balances or create positions", async t => {
  for (const scenario of ["stale-evidence", "mismatched-evidence"]) {
    const dir = await directory(t);
    const report = await run(dir, scenario);
    assert.equal(named(report, "authorize").status, "AUTHORIZED");
    assert.equal(named(report, "entry").status, "UNFILLED");
    assert.equal(report.snapshot.summary.cashCents, "100000");
    assert.deepEqual(report.snapshot.summary.openPositions, []);
    assert.deepEqual(await run(dir, scenario), report);
  }
});

test("Vienna 2999/3000-cent gate revokes a reservation and survives reopen", async t => {
  const dir = await directory(t);
  const report = await run(dir, "vienna-daily-gate");
  assert.equal(named(report, "unknown-marks").status, "EQUITY_UNKNOWN");
  assert.equal(named(report, "open-day").status, "PASS");
  assert.equal(named(report, "loss-2999").lossCents, 2999n);
  assert.equal(named(report, "loss-2999").entriesAllowed, true);
  assert.equal(named(report, "reserve").status, "AUTHORIZED");
  const gate = named(report, "loss-3000");
  assert.equal(gate.lossCents, 3000n);
  assert.equal(gate.status, "DAILY_LOSS_LIMIT");
  assert.equal(gate.reservedPositions, 0);
  assert.equal(gate.exitRequests[0].status, "CLOSED_PAPER");
  assert.equal(named(report, "revoked-entry").status, "REJECT");
  assert.equal(named(report, "still-tripped").status, "DAILY_LOSS_LIMIT");
  assert.deepEqual(await run(dir, "vienna-daily-gate"), report);
});

test("manual exact eight-hour finish succeeds, a new command 1 ms late is guarded", async t => {
  const exact = await run(await directory(t));
  const lateDir = await directory(t);
  const late = await run(lateDir, "manual-late");
  assert.equal(named(exact, "boundary").status, "FINISHED");
  assert.equal(named(late, "boundary").status, "INVALID_RUN_WINDOW");
  assert.equal(named(late, "boundary").entriesAllowed, false);
  assert.equal(late.snapshot.summary.cashCents, exact.snapshot.summary.cashCents);
  assert.deepEqual(await run(lateDir, "manual-late"), late);
});

test("enabled, nonempty, dated and mixed-input manifests fail before creating a checkpoint", async t => {
  for (const mutation of [m => m.enabled = true, m => m.providers[0].enabled = true,
    m => m.allowedMints.push("external"), m => m.allowedPools.push("external"),
    m => m.runId = "activated", m => m.startAt = START, m => m.endAt = START + 28_800_000,
    m => m.stopSwitch.engaged = false, m => m.syntheticFixturesMayNotMixWithRealScans = false]) {
    const altered = structuredClone(manifest);
    mutation(altered);
    const dir = await directory(t);
    await assert.rejects(run(dir, "baseline", {manifest: altered}), /disabled, empty, undated/);
    const store = await CheckpointStore.open(dir);
    assert.equal((await store.readCheckpoint()).status, "ABSENT");
    await store.close();
  }
  await assert.rejects(run(await directory(t), "baseline", {candidate: {source: "REAL"}}), /mixing/);
  await assert.rejects(run(await directory(t), "real-scan"), /external evidence/);
});

test("foreign plan and ambiguous publication cannot produce an acknowledged report", async t => {
  const dir = await directory(t);
  const original = await run(dir);
  await assert.rejects(run(dir, "manual-late"), /not this orchestration plan/);
  assert.deepEqual(await run(dir), original);
  const underlying = await CheckpointStore.open(await directory(t));
  let commits = 0;
  const store = {
    readCheckpoint: () => underlying.readCheckpoint(),
    commitCheckpoint: input => ++commits === 2 ? {status: "UNKNOWN"} : underlying.commitCheckpoint(input),
    close: () => underlying.close()
  };
  await assert.rejects(runSyntheticPaperOrchestration({store, manifest, runId: "ambiguous", startedAt: START}), /unresolved/);
});
