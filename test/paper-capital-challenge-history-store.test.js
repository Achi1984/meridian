import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalCheckpointBytes} from
  "../scripts/memecoin-paper/checkpoint-store.mjs";
import {
  ChallengeHistoryStore, inspectChallengeHistory, reconcileChallengeHistory
} from "../scripts/paper-capital-challenge/history-store.mjs";
import {getExposureGate} from "../scripts/paper-capital-challenge/guard.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../scripts/paper-capital-challenge/policy.mjs";

const BASE = Date.UTC(2025, 0, 1);
const CHILD_FIXTURE = fileURLToPath(new URL(
  "./paper-capital-challenge-history-child.mjs", import.meta.url));

async function tempDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "usd-challenge-history-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function historyPath(directory) {
  return path.join(directory, "history");
}

function observation(id, netEquityCents, offset, strategyVersion = "strategy-v1") {
  const observedAtMs = BASE + offset;
  return {
    id,
    campaignId: POLICY.campaignId,
    currency: POLICY.currency,
    strategyVersion,
    observedAtMs,
    netEquityCents,
    valuation: {
      status: "FRESH",
      currency: POLICY.currency,
      monetaryUnit: POLICY.monetaryUnit,
      marketPair: POLICY.marketPair,
      method: "CASH_PLUS_EXECUTABLE_ADVERSE_BID",
      asOfMs: observedAtMs,
      bidQuoteAtMs: observedAtMs,
      maxAgeMs: 1_000,
      quoteSourceId: "synthetic-usd-book",
      cashCents: netEquityCents,
      inventoryAtAdverseBidCents: 0,
      unbookedAccruedFeesCents: 0,
      modeledExitCostsCents: 0
    }
  };
}

async function runChild(directory, action, tip, nextObservation) {
  const child = spawn(process.execPath, [
    CHILD_FIXTURE,
    directory,
    action,
    JSON.stringify(tip),
    nextObservation ? JSON.stringify(nextObservation) : ""
  ], {stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return {code, signal, stdout, stderr};
}

test("create and child-process reopen replay peak and latched USD100 loss pause", async t => {
  const directory = await tempDirectory(t);
  const store = await ChallengeHistoryStore.createNew(historyPath(directory));
  await store.append(observation("initial", 100_000, 1_000));
  await store.append(observation("peak", 110_000, 2_000));
  await store.append(observation("loss", 100_000, 3_000, "strategy-v2"));
  const expectedTip = store.tip;
  await store.close();

  const child = await runChild(historyPath(directory), "reopen", expectedTip);
  assert.equal(child.code, 0, child.stderr);
  const resumed = JSON.parse(child.stdout);
  assert.deepEqual(resumed.tip, expectedTip);
  assert.equal(resumed.state.highWaterEquityCents, 110_000);
  assert.equal(resumed.state.paused, true);
  assert.equal(resumed.state.pauseObservationId, "loss");
  assert.equal(resumed.state.observations.at(-1).strategyVersion, "strategy-v2");
  assert.deepEqual(getExposureGate(resumed.state, BASE + 3_000), {
    allowed: false, reason: "DRAWDOWN_PAUSED"
  });
});

test("create-new and reopen-existing never initialize missing or existing history", async t => {
  const directory = await tempDirectory(t);
  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: {}
  }), /INVALID_EXPECTED_TIP/);
  await assert.rejects(ChallengeHistoryStore.reopenExisting(path.join(directory, "missing"), {
    expectedTip: {
      schemaVersion: "PAPER_CAPITAL_CHALLENGE_TIP_V1",
      campaignId: POLICY.campaignId,
      currency: POLICY.currency,
      policyVersion: POLICY.version,
      revision: 0,
      digest: "a".repeat(64)
    }
  }), /HISTORY_NOT_FOUND/);

  const created = await ChallengeHistoryStore.createNew(historyPath(directory));
  const tip = created.tip;
  await assert.rejects(ChallengeHistoryStore.createNew(historyPath(directory)),
    /HISTORY_ALREADY_EXISTS/);
  await created.close();
  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: { ...tip, arbitraryState: true }
  }), /INVALID_EXPECTED_TIP/);
});

test("corrupt, truncated, and unexpected identity histories fail closed", async t => {
  for (const mutation of [
    bytes => bytes.subarray(0, Math.max(1, bytes.length - 7)),
    bytes => {
      const checkpoint = JSON.parse(bytes.toString("utf8"));
      checkpoint.campaignId = "unexpected-campaign";
      return canonicalCheckpointBytes(checkpoint);
    },
    bytes => {
      const checkpoint = JSON.parse(bytes.toString("utf8"));
      checkpoint.currency = "EUR";
      return canonicalCheckpointBytes(checkpoint);
    },
    bytes => {
      const checkpoint = JSON.parse(bytes.toString("utf8"));
      checkpoint.policyVersion = "unexpected-policy";
      return canonicalCheckpointBytes(checkpoint);
    }
  ]) {
    const directory = await tempDirectory(t);
    const store = await ChallengeHistoryStore.createNew(historyPath(directory));
    const tip = store.tip;
    await store.close();
    const file = path.join(historyPath(directory), "checkpoint.json");
    const bytes = await readFile(file);
    await writeFile(file, mutation(bytes));
    await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
      expectedTip: tip
    }));
  }
});

test("independently retained expected tip detects stale history and rollback", async t => {
  const directory = await tempDirectory(t);
  const store = await ChallengeHistoryStore.createNew(historyPath(directory));
  const initialTip = store.tip;
  const initialBytes = await readFile(path.join(historyPath(directory), "checkpoint.json"));
  await store.append(observation("one", 100_000, 1_000));
  const latestTip = store.tip;
  await store.close();

  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: initialTip
  }), /STALE_EXPECTED_TIP/);
  await writeFile(path.join(historyPath(directory), "checkpoint.json"), initialBytes);
  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: latestTip
  }), /STALE_EXPECTED_TIP/);
  const inspected = await inspectChallengeHistory(historyPath(directory));
  assert.equal(inspected.status, "OK");
  assert.equal(inspected.state.observations.length, 0);
});

test("identical retry is idempotent while contradictory reuse is rejected", async t => {
  const directory = await tempDirectory(t);
  const store = await ChallengeHistoryStore.createNew(historyPath(directory));
  const first = observation("retry", 100_000, 1_000);
  const committed = await store.append(first);
  const repeated = await store.append(structuredClone(first));
  assert.equal(committed.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.deepEqual(repeated.tip, committed.tip);
  assert.equal(repeated.state.observations.length, 1);
  const conflicting = observation("retry", 99_000, 1_000);
  await assert.rejects(store.append(conflicting), /CONTRADICTORY_DUPLICATE_OBSERVATION/);
  await store.close();
});

test("exclusive writer and stale receipt admission reject concurrent updates", async t => {
  const directory = await tempDirectory(t);
  const creator = await ChallengeHistoryStore.createNew(historyPath(directory));
  const initialTip = creator.tip;
  await creator.close();
  const child = spawn(process.execPath, [
    CHILD_FIXTURE, historyPath(directory), "hold", JSON.stringify(initialTip), ""
  ], {stdio: ["pipe", "pipe", "pipe"]});
  const exited = once(child, "exit");
  const [ready] = await once(child.stdout, "data");
  assert.ok(ready.toString().includes('"tip"'));
  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: initialTip
  }), {code: "CHECKPOINT_BUSY"});
  child.stdin.end();
  assert.deepEqual(await exited, [0, null]);

  const nextWriter = await ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: initialTip
  });
  await nextWriter.append(observation("one", 100_000, 1_000));
  const latestTip = nextWriter.tip;
  await nextWriter.close();
  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: initialTip
  }), /STALE_EXPECTED_TIP/);
  const current = await ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: latestTip
  });
  await current.close();
});

test("phase-injected write, fsync-boundary, and rename failures block further writes", async t => {
  for (const [phase, label] of [
    ["after-pending", "write"],
    ["after-file-sync", "fsync"],
    ["before-rename", "rename"]
  ]) {
    const directory = await tempDirectory(t);
    const store = await ChallengeHistoryStore.createNew(historyPath(directory));
    const tip = store.tip;
    await store.close();

    let inject = false;
    const writer = await ChallengeHistoryStore.reopenExisting(historyPath(directory), {
      expectedTip: tip,
      onPhase(name) {
        if (inject && name === phase) throw new Error(`injected ${label} failure`);
      }
    });
    inject = true;
    await assert.rejects(writer.append(observation(`failed-${label}`, 100_000, 1_000)),
      {code: "HISTORY_COMMIT_FAILED"});
    assert.throws(() => writer.state, /HISTORY_RECOVERY_REQUIRED/);
    await assert.rejects(writer.close(), /HISTORY_RECOVERY_REQUIRED/);
    assert.equal((await inspectChallengeHistory(historyPath(directory))).status, "OK");
    await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
      expectedTip: tip
    }), {code: "CHECKPOINT_BUSY"});
  }
});

test("uncertain post-rename commit remains inspectable but never auto-recovers writer claim", async t => {
  const directory = await tempDirectory(t);
  const store = await ChallengeHistoryStore.createNew(historyPath(directory));
  const tip = store.tip;
  await store.close();

  const child = await runChild(historyPath(directory), "crash-after-rename", tip,
    observation("uncertain", 100_000, 1_000));
  assert.equal(child.code, 74);
  const inspection = await inspectChallengeHistory(historyPath(directory));
  assert.equal(inspection.status, "UNKNOWN");
  assert.equal((await reconcileChallengeHistory(historyPath(directory))).status, "UNKNOWN");
  await assert.rejects(ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: tip
  }), {code: "CHECKPOINT_BUSY"});
});

test("the complete 256-observation journal is retained and the next observation fails closed", async t => {
  const directory = await tempDirectory(t);
  const store = await ChallengeHistoryStore.createNew(historyPath(directory));
  for (let index = 0; index < POLICY.maxJournalObservations; index += 1) {
    await store.append(observation(
      `bounded-${index}`,
      100_000,
      (index + 1) * 1_000
    ));
  }
  assert.equal(store.state.observations.length, POLICY.maxJournalObservations);
  await assert.rejects(store.append(observation(
    "beyond-bound",
    100_000,
    (POLICY.maxJournalObservations + 1) * 1_000
  )), /OBSERVATION_JOURNAL_LIMIT_REACHED/);
  const tip = store.tip;
  await store.close();

  const reopened = await ChallengeHistoryStore.reopenExisting(historyPath(directory), {
    expectedTip: tip
  });
  assert.equal(reopened.state.observations.length, POLICY.maxJournalObservations);
  await reopened.close();
});
