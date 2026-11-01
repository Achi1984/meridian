import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {canonicalCheckpointBytes, CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {analyzeCandidate, filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {
  SYNTHETIC_SOURCE,
  SYNTHETIC_SMART_WALLET_ALLOWLIST,
  syntheticCandidate
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";

const START = Date.parse("2026-01-01T19:00:00Z");
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const ZERO_COSTS = {
  feeCents: 0,
  spreadCents: 0,
  slippageCents: 0,
  priceImpactCents: 0,
  networkCents: 0
};
const CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/memecoin-paper/checkpoint-child.mjs", import.meta.url));

async function tempDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-checkpoint-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function candidateFor(mint, now) {
  const candidate = syntheticCandidate(now, {mint});
  for (const item of [...Object.values(candidate.evidence), ...Object.values(candidate.analystEvidence)]) {
    item.binding.mint = mint;
  }
  return candidate;
}

function decisions(candidate, now) {
  const filterResult = filterCandidate(candidate, {now, holdUntil: now + EIGHT_HOURS});
  const scoreResult = analyzeCandidate(candidate, {
    now,
    filterResult,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  assert.equal(filterResult.status, "PASS");
  assert.equal(scoreResult.status, "PASS");
  return {filterResult, scoreResult};
}

function authorizeInput(candidate, now, {authorizationId = `auth-${candidate.mint}`, marks = []} = {}) {
  const {filterResult, scoreResult} = decisions(candidate, now);
  return {
    authorizationId,
    candidate,
    filterResult,
    scoreResult,
    tickId: `tick-${candidate.mint}`,
    now: now + 1000,
    marks
  };
}

function entryQuote(candidate, observedAt) {
  return {
    eventId: `entry-${candidate.mint}`,
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: SYNTHETIC_SOURCE,
    observedAt,
    priceMicros: 10_000,
    decimals: candidate.decimals,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: ZERO_COSTS
  };
}

function markQuote(candidate, observedAt, priceMicros = 10_000) {
  return {
    eventId: `mark-${candidate.mint}-${observedAt}`,
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: SYNTHETIC_SOURCE,
    observedAt,
    priceMicros,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: ZERO_COSTS
  };
}

async function openSession(directory, options = {}) {
  const store = await CheckpointStore.open(directory, options);
  const session = await PaperCheckpointSession.open({
    store,
    runId: "checkpoint-test",
    startedAt: START
  });
  return {store, session};
}

test("reopen replays actual authorization references, fills once, and restores Map marks", async t => {
  const directory = await tempDirectory(t);
  const candidate = candidateFor("So11111111111111111111111111111111111111112", START);
  const authorization = authorizeInput(candidate, START);
  const quote = entryQuote(candidate, START + 2000);

  const first = await openSession(directory);
  const auth = await first.session.authorizeEntry("authorize-1", authorization);
  assert.equal(auth.status, "AUTHORIZED");
  await first.session.close();

  const reopened = await openSession(directory);
  const fillInputs = {
    authorizationId: authorization.authorizationId,
    quote,
    now: START + 2000,
    marks: []
  };
  const fill = await reopened.session.executeEntry("fill-1", fillInputs);
  assert.equal(fill.status, "FILLED_PAPER");
  assert.equal((await reopened.session.executeEntry("fill-1", fillInputs)).allInCents, "8000");
  assert.equal((await reopened.session.executeEntry("fill-1", {
    ...fillInputs,
    quote: {...quote, priceMicros: 9999}
  })).status, "REJECT");

  const mark = markQuote(candidate, START + 3000);
  const riskInputs = {now: START + 3000, marks: [mark]};
  const risk = await reopened.session.riskSnapshot("risk-1", riskInputs);
  assert.equal(risk.status, "PASS");
  assert.ok(risk.marksByMint instanceof Map);
  const checkpointBytes = await readFile(path.join(directory, "checkpoint.json"));
  assert.ok(canonicalCheckpointBytes(JSON.parse(checkpointBytes)).equals(checkpointBytes));
  assert.equal(createHash("sha256").update(checkpointBytes).digest("hex"), reopened.session.metadata.hash);
  await reopened.session.close();

  const recovered = await openSession(directory);
  assert.deepEqual(await recovered.session.riskSnapshot("risk-1", riskInputs), risk);
  assert.equal(recovered.session.snapshot().summary.cashCents, "92000");
  assert.equal(recovered.session.snapshot().summary.openPositions.length, 1);
  await recovered.session.close();
});

test("journaled riskSnapshot restores the fixed 2999/3000-cent gate and rejected fill", async t => {
  const directory = await tempDirectory(t);
  const {session} = await openSession(directory);
  const candidate = candidateFor("So11111111111111111111111111111111111111112", START);
  const auth = authorizeInput(candidate, START);
  await session.authorizeEntry("authorize-a", auth);
  await session.executeEntry("fill-a", {
    authorizationId: auth.authorizationId,
    quote: entryQuote(candidate, START + 2000),
    now: START + 2000,
    marks: []
  });
  const unknownMarks = await session.riskSnapshot("unknown-marks", {
    now: START + 3000,
    marks: []
  });
  assert.equal(unknownMarks.status, "EQUITY_UNKNOWN");
  assert.equal(unknownMarks.entriesAllowed, false);

  const nextViennaDay = Date.parse("2026-01-01T23:00:00Z");
  assert.equal((await session.riskSnapshot("open-day", {
    now: nextViennaDay,
    marks: [markQuote(candidate, nextViennaDay)]
  })).status, "PASS");
  const allowed = await session.riskSnapshot("loss-2999", {
    now: nextViennaDay + 1000,
    marks: [markQuote(candidate, nextViennaDay + 1000, 6252)]
  });
  assert.equal(allowed.lossCents, 2999n);
  assert.equal(allowed.entriesAllowed, true);

  const second = candidateFor("11111111111111111111111111111112", nextViennaDay + 1500);
  const secondAuth = authorizeInput(second, nextViennaDay + 1500, {
    marks: [markQuote(candidate, nextViennaDay + 2500, 6252)]
  });
  assert.equal((await session.authorizeEntry("authorize-b", secondAuth)).status, "AUTHORIZED");

  const tripped = await session.riskSnapshot("loss-3000", {
    now: nextViennaDay + 3000,
    marks: [markQuote(candidate, nextViennaDay + 3000, 6251)]
  });
  assert.equal(tripped.status, "DAILY_LOSS_LIMIT");
  assert.equal(tripped.lossCents, 3000n);
  assert.equal(tripped.exitRequests[0].status, "CLOSED_PAPER");
  assert.equal(tripped.reservedPositions, 0);

  const rejected = await session.executeEntry("fill-after-trip", {
    authorizationId: secondAuth.authorizationId,
    quote: entryQuote(second, nextViennaDay + 3500),
    now: nextViennaDay + 4000,
    marks: []
  });
  assert.equal(rejected.status, "REJECT");
  assert.equal((await session.riskSnapshot("still-tripped", {
    now: nextViennaDay + 5000,
    marks: []
  })).status, "DAILY_LOSS_LIMIT");
  const expectedSnapshot = session.snapshot();
  const expectedMetadata = session.metadata;
  for (const now of [START - 1, START, nextViennaDay + 4999]) {
    assert.equal((await session.riskSnapshot(`backwards-${now}`, {now, marks: []})).reason,
      "NON_MONOTONIC_TIME");
    assert.equal((await session.finishRun(`backwards-finish-${now}`, {now, marks: []})).reason,
      "NON_MONOTONIC_TIME");
    assert.deepEqual(session.snapshot(), expectedSnapshot);
    assert.deepEqual(session.metadata, expectedMetadata);
  }
  await session.close();

  const resumedStore = await CheckpointStore.open(directory);
  const resumed = await PaperCheckpointSession.open({store: resumedStore});
  assert.deepEqual(resumed.snapshot(), expectedSnapshot);
  assert.equal((await resumed.riskSnapshot("old-day-after-reopen", {now: START, marks: []})).reason,
    "NON_MONOTONIC_TIME");
  assert.deepEqual(resumed.metadata, expectedMetadata);
  assert.equal((await resumed.riskSnapshot("equal-time-after-reopen", {
    now: nextViennaDay + 5000, marks: []
  })).status, "DAILY_LOSS_LIMIT");
  assert.deepEqual(await resumed.riskSnapshot("loss-3000", {
    now: nextViennaDay + 3000,
    marks: [markQuote(candidate, nextViennaDay + 3000, 6251)]
  }), tripped);
  assert.equal(resumed.snapshot().summary.openPositions.length, 0);
  await resumed.close();
});

test("fixed start and eight-hour deadline are replayed and enforced on invocation", async t => {
  const directory = await tempDirectory(t);
  const {session} = await openSession(directory);
  const finished = await session.finishRun("finish-at-deadline", {
    now: START + EIGHT_HOURS,
    marks: []
  });
  assert.equal(finished.status, "FINISHED");
  const late = await session.finishRun("finish-late", {
    now: START + EIGHT_HOURS + 1,
    marks: []
  });
  assert.equal(late.status, "INVALID_RUN_WINDOW");
  await session.close();

  const resumed = await openSession(directory);
  const lateSnapshot = await resumed.session.riskSnapshot("late-command", {
    now: START + EIGHT_HOURS + 2,
    marks: []
  });
  assert.equal(lateSnapshot.status, "INVALID_RUN_WINDOW");
  await resumed.session.close();

  const mismatchedStore = await CheckpointStore.open(directory);
  await assert.rejects(PaperCheckpointSession.open({
    store: mismatchedStore,
    runId: "checkpoint-test",
    startedAt: START + 1
  }), {code: "CHECKPOINT_INCOMPATIBLE"});
});

test("pre-publication failure keeps the old checkpoint and requires explicit reopen", async t => {
  const directory = await tempDirectory(t);
  let fail = false;
  const first = await openSession(directory, {
    onPhase(phase) {
      if (fail && phase === "before-rename") throw new Error("injected write failure");
    }
  });
  fail = true;
  const result = await first.session.riskSnapshot("not-committed", {now: START + 1000, marks: []});
  assert.equal(result.status, "UNKNOWN");
  assert.throws(() => first.session.snapshot(), {code: "CHECKPOINT_UNKNOWN"});
  assert.equal((await first.session.reconcilePending()).status, "OK");
  await first.session.close();

  const reopened = await openSession(directory);
  assert.equal(reopened.session.metadata.sequence, 0);
  assert.equal((await reopened.session.riskSnapshot("not-committed", {
    now: START + 1000,
    marks: []
  })).status, "PASS");
  await reopened.session.close();
});

test("checkpoint rejects corrupt and oversized bytes", async t => {
  const corruptDirectory = await tempDirectory(t);
  const created = await openSession(corruptDirectory);
  await created.session.close();
  const checkpointPath = path.join(corruptDirectory, "checkpoint.json");
  const bytes = await readFile(checkpointPath);
  bytes[bytes.length - 2] ^= 1;
  await writeFile(checkpointPath, bytes);
  const corruptStore = await CheckpointStore.open(corruptDirectory);
  await assert.rejects(PaperCheckpointSession.open({store: corruptStore}), {code: "CHECKPOINT_CORRUPT"});

  const oversizedDirectory = await tempDirectory(t);
  const oversized = await openSession(oversizedDirectory);
  await oversized.session.close();
  await writeFile(path.join(oversizedDirectory, "checkpoint.json"), Buffer.alloc(1025, 0x61));
  const smallStore = await CheckpointStore.open(oversizedDirectory, {maxBytes: 1024});
  await assert.rejects(PaperCheckpointSession.open({store: smallStore}), {code: "CHECKPOINT_CORRUPT"});
});

test("exclusive ownership rejects concurrent writers without lock stealing", {timeout: 10_000}, async t => {
  const directory = await tempDirectory(t);
  const first = await CheckpointStore.open(directory);
  await assert.rejects(CheckpointStore.open(directory), {code: "CHECKPOINT_BUSY"});
  await first.close();
  const next = await CheckpointStore.open(directory);
  await next.close();

  const child = spawn(process.execPath, [CHILD_FIXTURE, directory, "hold"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  // Subscribe before any await: an early child exit must fail, never be missed.
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited.catch(() => {});
  });
  const message = () => Promise.race([
    once(child, "message").then(([value]) => value),
    exited.then(([code, signal]) => { throw new Error(`lock holder exited early: ${code ?? signal}`); })
  ]);
  assert.equal(await message(), "ready");
  await assert.rejects(CheckpointStore.open(directory), {code: "CHECKPOINT_BUSY"});
  const holding = message();
  child.send("ping");
  assert.equal(await holding, "holding");
  await assert.rejects(CheckpointStore.open(directory), {code: "CHECKPOINT_BUSY"});
  assert.equal(child.kill("SIGTERM"), true);
  assert.deepEqual(await exited, [null, "SIGTERM"]);
  await rm(path.join(directory, ".checkpoint-lock"));
  const afterExit = await CheckpointStore.open(directory);
  await afterExit.close();
});

test("child crashes distinguish unpublished data from ambiguous publication", async t => {
  for (const [phase, expected] of [
    ["before-rename", "NOT_PUBLISHED"],
    ["after-rename", "UNKNOWN"],
    ["after-directory-sync", "UNKNOWN"],
    ["before-ack", "UNKNOWN"]
  ]) {
    const directory = await tempDirectory(t);
    const child = spawn(process.execPath, [CHILD_FIXTURE, directory, phase], {stdio: "ignore"});
    const [code] = await once(child, "exit");
    assert.equal(code, 74, `${phase} child did not reach its crash point`);
    await assert.rejects(CheckpointStore.open(directory), {code: "CHECKPOINT_BUSY"});
    await rm(path.join(directory, ".checkpoint-lock"));

    const store = await CheckpointStore.open(directory);
    const reconciled = await store.reconcilePending();
    assert.equal(reconciled.status, expected, phase);
    if (expected === "UNKNOWN") {
      assert.equal((await store.readCheckpoint()).status, "UNKNOWN");
    }
    await store.close();
  }
});


test("restore rejects internally rehashed backward command time before replay", async t => {
  const directory = await tempDirectory(t);
  const {session} = await openSession(directory);
  await session.riskSnapshot("risk", {now: START + 1, marks: []});
  await session.close();
  const filename = path.join(directory, "checkpoint.json");
  const checkpoint = JSON.parse(await readFile(filename, "utf8"));
  checkpoint.records[1].inputs.now = START - 1;
  await writeFile(filename, canonicalCheckpointBytes(checkpoint));
  await assert.rejects(openSession(directory), error =>
    error.code === "CHECKPOINT_CORRUPT" && /time moves backwards/.test(error.message));
});

test("old clock policy checkpoints are not silently migrated", async t => {
  const directory = await tempDirectory(t);
  const {session} = await openSession(directory);
  await session.close();
  const filename = path.join(directory, "checkpoint.json");
  const checkpoint = JSON.parse(await readFile(filename, "utf8"));
  checkpoint.runHeader.policyVersion = "memecoin-paper-ledger-v1";
  await writeFile(filename, canonicalCheckpointBytes(checkpoint));
  await assert.rejects(openSession(directory), {code: "CHECKPOINT_INCOMPATIBLE"});
});
