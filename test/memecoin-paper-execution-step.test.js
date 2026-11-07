import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {
  canonicalCheckpointBytes, CheckpointStore, MAX_CHECKPOINT_BYTES
} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {createPaperExecutionStep} from "../scripts/memecoin-paper/execution-step.mjs";
import {
  createFixtureMarketQuoteAdapter, paperExplicitNetMethodologyDigest,
  reviewScenarioConfigSha256
} from "../scripts/memecoin-paper/market-quote-adapter.mjs";
import {syntheticOrderResponse} from "./fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs";
import {START, END, RUN, candidate, authorization, quote, entry} from "./fixtures/memecoin-paper-execution-step/scenario.mjs";

async function setup(t, {limits, wrapStore, wrapSession, storeOptions, runId = RUN} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-execution-step-"));
  const realStore = await CheckpointStore.open(directory, storeOptions);
  const store = wrapStore ? wrapStore(realStore) : realStore;
  const session = await PaperCheckpointSession.open({store, runId, startedAt: START});
  t.after(async () => {
    await session.close();
    await rm(directory, {recursive: true, force: true});
  });
  const step = createPaperExecutionStep({
    session: wrapSession ? wrapSession(session) : session, store,
    runId, startedAt: START, endAt: END, limits
  });
  return {step, session, store, directory};
}

async function filled(t, options) {
  const context = await setup(t, options);
  const auth = await context.step.authorizeEntry(authorization());
  assert.equal(auth.status, "AUTHORIZED");
  assert.equal((await context.step.executeEntry(entry(auth))).status, "FILLED_PAPER");
  return {...context, auth};
}

function proxy(target, overrides) {
  return new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    }
  });
}

test("import and factory are inert: no fetch, timers, file writes, or commands", async t => {
  const url = new URL("../scripts/memecoin-paper/execution-step.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    globalThis.fetch = () => { throw Error("fetch forbidden"); };
    globalThis.setTimeout = globalThis.setInterval = () => { throw Error("timer forbidden"); };
    await import(${JSON.stringify(url)});
  `], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  const {session, directory} = await setup(t);
  assert.equal(session.metadata.sequence, 0);
  assert.deepEqual((await readdir(directory)).sort(), [".checkpoint-lock", "checkpoint.json"]);
});

test("recomputed hard gates and analyst evidence block absent inputs and caller PASS", async t => {
  const {step, session} = await setup(t);
  const forged = {...authorization(), filterResult: {status: "PASS"}, scoreResult: {status: "PASS", score: 100}};
  assert.equal((await step.authorizeEntry(forged)).status, "REJECT");
  const missing = authorization("missing");
  delete missing.candidate.evidence.top10OwnerPct;
  const hard = await step.authorizeEntry(missing);
  assert.equal(hard.status, "BLOCKED");
  assert.equal(hard.filterResult.status, "UNKNOWN");
  const analyst = authorization("analyst");
  delete analyst.candidate.analystEvidence.momentum15m;
  assert.equal((await step.authorizeEntry(analyst)).scoreResult.status, "SCORE_UNAVAILABLE");
  const allowlist = authorization("allowlist");
  allowlist.smartWalletAllowlist = {status: "UNSET", provenance: null};
  assert.equal((await step.authorizeEntry(allowlist)).status, "BLOCKED");
  assert.equal(session.metadata.sequence, 0);
  assert.equal(session.snapshot().summary.cashCents, "100000");
});

test("reserve is not fill; a strictly later quote fills once with an exact receipt", async t => {
  const {step, session, store} = await setup(t);
  const auth = await step.authorizeEntry(authorization());
  assert.equal(auth.status, "AUTHORIZED");
  assert.equal(session.snapshot().summary.cashCents, "100000");
  assert.equal(session.snapshot().summary.openPositions.length, 0);
  const early = entry(auth, candidate(), "early", START + 1000);
  assert.equal((await step.executeEntry(early)).status, "REJECT");
  const input = entry(auth);
  const fill = await step.executeEntry(input);
  assert.equal(fill.status, "FILLED_PAPER");
  assert.equal(fill.allInCents, "8000");
  assert.equal(fill.executionRealistic, false);
  assert.deepEqual(await step.executeEntry(input), fill);
  assert.equal(session.metadata.sequence, 2);
  assert.equal(session.snapshot().summary.cashCents, "92000");
  assert.equal((await step.executeEntry(entry(auth, candidate(), "second-fill", START + 3000))).status, "REJECT");
  const read = await store.readCheckpoint();
  const checkpoint = JSON.parse(read.bytes);
  const record = checkpoint.records.at(-1);
  assert.equal(fill.receipt.hash, createHash("sha256").update(read.bytes).digest("hex"));
  assert.equal(fill.receipt.sequence, read.sequence);
  assert.equal(fill.receipt.runId, RUN);
  assert.equal(fill.receipt.resultDigest, record.resultDigest);
  assert.equal(fill.commandId, record.commandId);
});

for (const [label, change] of [
  ["mint", q => { q.mint = candidate(START, 1).mint; }],
  ["pool", q => { q.pool = q.mint; }],
  ["chain", q => { q.chainId = "ethereum"; }],
  ["quote currency", q => { q.quote = q.mint; }],
  ["decimals", q => { q.decimals = 9; }],
  ["future", q => { q.observedAt += 1; }],
  ["stale", q => { q.observedAt -= 300_001; }],
  ["same sample", q => { q.observedAt = START; }],
  ["missing costs", q => { delete q.costs.networkCents; }],
  ["non-hypothetical", q => { q.mode = "LIVE"; }],
  ["source mixing", q => { q.source = "real-source"; }],
  ["quote event binding", q => { q.eventId = "other"; }]
]) {
  test(`entry rejects ${label} without consuming reservation or command`, async t => {
    const {step, session} = await setup(t);
    const auth = await step.authorizeEntry(authorization());
    const input = entry(auth);
    change(input.quote);
    assert.equal((await step.executeEntry(input)).status, "REJECT");
    assert.equal(session.metadata.sequence, 1);
    assert.equal(session.snapshot().summary.cashCents, "100000");
    assert.equal((await step.executeEntry(entry(auth, candidate(), "valid"))).status, "FILLED_PAPER");
  });
}

test("event collisions bind purpose and entire payload; duplicates detach returned data", async t => {
  const {step, session} = await setup(t);
  const input = authorization();
  const first = await step.authorizeEntry(input);
  first.receipt.hash = "mutated";
  assert.notEqual((await step.authorizeEntry(input)).receipt.hash, "mutated");
  assert.match((await step.authorizeEntry({...input, tickId: "different"})).reason, /collision/);
  assert.match((await step.riskSnapshot({eventId: input.eventId, now: input.now, marks: []})).reason, /collision/);
  assert.equal(session.metadata.sequence, 1);
});

for (const [label, makeMarks] of [
  ["named key replacing a hole", mark => {
    const marks = [mark];
    marks.length = 2;
    marks.evidence = {source: "lost"};
    return marks;
  }],
  ["named key replacing the only index", mark => {
    const marks = [];
    marks.length = 1;
    marks.evidence = mark;
    return marks;
  }],
  ["nested sparse array with a named key", mark => {
    const evidence = ["present"];
    evidence.length = 2;
    evidence.provenance = "lost";
    mark.evidence = evidence;
    return [mark];
  }],
  ["array accessor", mark => {
    const marks = [];
    Object.defineProperty(marks, "0", {get: () => mark, enumerable: true});
    return marks;
  }]
]) {
  test(`lossy evidence arrays are rejected before identity or ledger dispatch: ${label}`, async t => {
    const {step, session, store} = await filled(t);
    const token = candidate();
    const eventId = "array-evidence";
    const malformed = makeMarks(quote(token, "mark", START + 3000));
    const rejected = await step.riskSnapshot({eventId, now: START + 3000, marks: malformed});
    assert.equal(rejected.status, "REJECT");
    assert.equal(session.metadata.sequence, 2);

    const validInput = {eventId, now: START + 3000, marks: [quote(token, "mark", START + 3000)]};
    const accepted = await step.riskSnapshot(validInput);
    assert.equal(accepted.status, "PASS");
    assert.equal(accepted.receipt.sequence, 3);
    assert.deepEqual(await step.riskSnapshot(validInput), accepted);
    assert.equal(session.metadata.sequence, 3);
    const checkpoint = JSON.parse((await store.readCheckpoint()).bytes);
    assert.deepEqual(checkpoint.records.at(-1).inputs.marks, validInput.marks);
  });
}

test("duplicate storms coalesce onto one bounded operation without additional checkpoint reads", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let reads = 0;
  const {step, session} = await setup(t, {limits: {maxEvents: 1}, wrapStore: real => proxy(real, {
    readCheckpoint: async () => {
      reads += 1;
      if (reads === 2) await gate;
      return real.readCheckpoint();
    }
  })});
  const input = authorization();
  const pending = Array.from({length: 100}, () => step.authorizeEntry(input));
  release();
  const results = await Promise.all(pending);
  assert.ok(results.every(result => result.status === "AUTHORIZED"));
  assert.equal(session.metadata.sequence, 1);
  assert.equal(reads, 3);
  const historical = await Promise.all(Array.from({length: 100}, () => step.authorizeEntry(input)));
  assert.ok(historical.every(result => result.status === "AUTHORIZED"));
  assert.equal(reads, 3);
});

test("deterministic IDs bind run, event, purpose and payload", async t => {
  const a = await setup(t);
  const b = await setup(t);
  const first = await a.step.authorizeEntry(authorization());
  const second = await b.step.authorizeEntry(authorization());
  assert.equal(first.commandId, second.commandId);
  assert.equal(first.authorizationId, second.authorizationId);
  const c = await setup(t);
  assert.notEqual((await c.step.authorizeEntry(authorization("another"))).commandId, first.commandId);
});

test("concurrent operations serialize, snapshot queued data, and retain three-position/8% limits", async t => {
  const {step, session} = await setup(t);
  const inputs = [0, 1, 2, 3].map(index => authorization(`auth-${index}`, {candidate: candidate(START, index)}));
  const pending = inputs.map(input => step.authorizeEntry(input));
  inputs[0].candidate.decimals = 18;
  const results = await Promise.all(pending);
  assert.deepEqual(results.map(item => item.status), ["AUTHORIZED", "AUTHORIZED", "AUTHORIZED", "REJECT"]);
  const tokens = [0, 1, 2].map(index => candidate(START, index));
  const fills = await Promise.all(results.slice(0, 3).map((auth, index) => step.executeEntry({
    ...entry(auth, tokens[index], `fill-${index}`),
    marks: tokens.slice(0, index).map((token, mark) => quote(token, `mark-${mark}`, START + 2000))
  })));
  assert.deepEqual(fills.map(item => item.status), ["FILLED_PAPER", "FILLED_PAPER", "FILLED_PAPER"]);
  assert.ok(fills.every(item => Number(item.allInCents) <= 8000));
  assert.equal(session.snapshot().summary.cashCents, "76000");
  assert.equal(session.snapshot().summary.openPositions.length, 3);
});

test("missing marks keep equity unknown and prevent additional fills", async t => {
  const {step, session} = await filled(t);
  const risk = await step.riskSnapshot({eventId: "risk", now: START + 3000, marks: []});
  assert.equal(risk.status, "EQUITY_UNKNOWN");
  assert.equal(risk.entriesAllowed, false);
  const token = candidate(START + 3000, 1);
  const auth = await step.authorizeEntry(authorization("next", {
    candidate: token, now: START + 3000, marks: [quote(candidate(), "mark", START + 3000)]
  }));
  assert.equal(auth.status, "AUTHORIZED");
  const fill = await step.executeEntry(entry(auth, token, "next-fill", START + 4000));
  assert.equal(fill.status, "UNFILLED");
  assert.equal(session.snapshot().summary.openPositions.length, 1);
});

for (const [label, price, gap] of [["stop", 9400, false], ["gap", 9000, true]]) {
  test(`independent ${label} exit requires no new candidate and does not invent stop price`, async t => {
    const {step, session} = await filled(t);
    const input = {eventId: "exit", quote: quote(candidate(), "exit", START + 3000, price), now: START + 3000};
    const result = await step.observeExitQuote(input);
    assert.equal(result.status, "CLOSED_PAPER");
    assert.equal(result.eventId, input.eventId);
    assert.equal(result.fillPriceMicros, String(price));
    assert.equal(result.gapThroughStop, gap);
    assert.deepEqual(await step.observeExitQuote(input), result);
    assert.equal(session.snapshot().summary.openPositions.length, 0);
  });
}

test("trailing marks and exit remain independent of entry candidates; incomplete costs do not mutate stop", async t => {
  const {step, session} = await filled(t);
  const bad = quote(candidate(), "bad", START + 3000, 12_000);
  delete bad.costs.feeCents;
  assert.equal((await step.observeExitQuote({eventId: "bad", quote: bad, now: START + 3000})).status, "REJECT");
  assert.equal(session.metadata.sequence, 2);
  assert.equal(session.snapshot().summary.openPositions[0].stopPriceMicros, "9400");
  assert.equal((await step.observeExitQuote({
    eventId: "high", quote: quote(candidate(), "high", START + 4000, 12_000), now: START + 4000
  })).status, "MARKED");
  assert.equal(session.snapshot().summary.openPositions[0].stopPriceMicros, "11280");
  const exit = await step.observeExitQuote({
    eventId: "trailing", quote: quote(candidate(), "trailing", START + 5000, 11_000), now: START + 5000
  });
  assert.equal(exit.status, "CLOSED_PAPER");
  assert.equal(exit.eventId, "trailing");
  assert.equal(exit.gapThroughStop, true);
});

test("daily-loss risk gate revokes pending authorization and exits without new candidates", async t => {
  const {step, session} = await filled(t);
  const day = Date.parse("2026-01-01T23:00:00Z");
  const token = candidate();
  assert.equal((await step.riskSnapshot({
    eventId: "day", now: day, marks: [quote(token, "day-mark", day)]
  })).status, "PASS");
  const next = candidate(day, 1);
  const auth = await step.authorizeEntry(authorization("next", {
    candidate: next, now: day + 1000, marks: [quote(token, "pre-loss", day + 1000, 6252)]
  }));
  assert.equal(auth.status, "AUTHORIZED");
  const risk = await step.riskSnapshot({
    eventId: "loss", now: day + 2000, marks: [quote(token, "loss-mark", day + 2000, 6251)]
  });
  assert.equal(risk.status, "DAILY_LOSS_LIMIT");
  assert.equal(risk.lossCents, 3000n);
  assert.equal(risk.entriesAllowed, false);
  assert.equal(risk.reservedPositions, 0);
  assert.equal(risk.exitRequests[0].status, "CLOSED_PAPER");
  assert.equal((await step.executeEntry(entry(auth, next, "late-fill", day + 3000))).status, "REJECT");
  assert.equal(session.snapshot().summary.openPositions.length, 0);
});

test("ID-less daily-loss marks use bounded run-bound IDs and return an exact receipt", async t => {
  const runId = "r".repeat(120);
  const {step, session, store} = await filled(t, {runId});
  const day = Date.parse("2026-01-01T23:00:00Z");
  const token = candidate();
  const openingMark = quote(token, "opening-mark", day);
  delete openingMark.eventId;
  assert.equal((await step.riskSnapshot({
    eventId: "day", now: day, marks: [openingMark]
  })).status, "PASS");

  const lossMark = quote(token, "loss-mark", day + 2000, 6251);
  delete lossMark.eventId;
  const risk = await step.riskSnapshot({
    eventId: "loss", now: day + 2000, marks: [lossMark]
  });
  assert.equal(risk.status, "DAILY_LOSS_LIMIT");
  assert.equal(risk.exitRequests[0].status, "CLOSED_PAPER");
  assert.equal(risk.exitRequests[0].eventId.length <= 120, true);
  assert.match(risk.exitRequests[0].eventId, /^paper-mark:[a-f0-9]{64}:0$/);
  assert.equal(session.snapshot().summary.openPositions.length, 0);

  const read = await store.readCheckpoint();
  const checkpoint = JSON.parse(read.bytes);
  const record = checkpoint.records.at(-1);
  assert.equal(record.inputs.marks[0].eventId, risk.exitRequests[0].eventId);
  assert.equal(risk.receipt.runId, runId);
  assert.equal(risk.receipt.sequence, read.sequence);
  assert.equal(risk.receipt.hash, createHash("sha256").update(read.bytes).digest("hex"));
  assert.equal(risk.receipt.resultDigest, record.resultDigest);
  assert.equal(risk.commandId, record.commandId);
});

test("ACK loss latches UNKNOWN, including duplicates, with no second effect or finish", async t => {
  let lose = false;
  let commits = 0;
  const {step, store} = await setup(t, {wrapStore: real => proxy(real, {
    commitCheckpoint: async input => {
      commits += 1;
      const result = await real.commitCheckpoint(input);
      return lose ? {status: "UNKNOWN"} : result;
    }
  })});
  const auth = await step.authorizeEntry(authorization());
  lose = true;
  const input = entry(auth);
  assert.equal((await step.executeEntry(input)).status, "UNKNOWN");
  assert.equal(JSON.parse((await store.readCheckpoint()).bytes).sequence, 2);
  assert.equal((await step.executeEntry(input)).status, "UNKNOWN");
  assert.equal((await step.finishRun({eventId: "finish", now: END, marks: []})).status, "UNKNOWN");
  assert.equal(commits, 3);
});

test("actual after-rename persistence fault is terminal, even when candidate bytes are visible", async t => {
  let fail = false;
  const {step} = await setup(t, {storeOptions: {onPhase: phase => {
    if (fail && phase === "after-rename") throw new Error("generated ACK failure");
  }}});
  const auth = await step.authorizeEntry(authorization());
  fail = true;
  assert.equal((await step.executeEntry(entry(auth))).status, "UNKNOWN");
  assert.equal((await step.riskSnapshot({eventId: "risk", now: START + 3000, marks: []})).status, "UNKNOWN");
});

test("delayed finish ACK loss is UNKNOWN and never retries or resumes", async t => {
  let loseAck = false;
  let commits = 0;
  const {step, session, store, directory} = await setup(t, {
    wrapStore: real => proxy(real, {
      commitCheckpoint: async input => {
        commits += 1;
        const result = await real.commitCheckpoint(input);
        return loseAck ? {status: "UNKNOWN"} : result;
      }
    })
  });
  await step.riskSnapshot({eventId: "stop-at-deadline", now: END, marks: []});
  const before = session.metadata.sequence;
  loseAck = true;
  const input = {eventId: "late-finish-unknown", now: END + 60_000, marks: []};
  assert.equal((await step.finishRun(input)).status, "UNKNOWN");
  assert.equal(JSON.parse((await store.readCheckpoint()).bytes).sequence, before + 1);
  const afterFinishCommits = commits;
  assert.equal((await step.finishRun(input)).status, "UNKNOWN");
  assert.equal(commits, afterFinishCommits);

  await session.close();
  const reopenedStore = await CheckpointStore.open(directory);
  const reopenedSession = await PaperCheckpointSession.open({store: reopenedStore});
  assert.throws(() => createPaperExecutionStep({
    session: reopenedSession, store: reopenedStore,
    runId: RUN, startedAt: START, endAt: END
  }), /no resume/);
  await reopenedSession.close();
});

for (const field of ["hash", "sequence", "run", "receipt", "inputs"]) {
  test(`post-effect ${field} readback mismatch latches UNKNOWN`, async t => {
    let reads = 0;
    const {step} = await setup(t, {wrapStore: real => proxy(real, {
      readCheckpoint: async () => {
        const read = await real.readCheckpoint();
        reads += 1;
        if (reads !== 3) return read;
        if (field === "hash") return {...read, hash: "0".repeat(64)};
        if (field === "sequence") return {...read, sequence: 777};
        const checkpoint = JSON.parse(read.bytes);
        if (field === "run") checkpoint.runHeader.runId = "wrong-run";
        if (field === "receipt") checkpoint.records.at(-1).resultDigest = "0".repeat(64);
        if (field === "inputs") checkpoint.records.at(-1).inputs.tickId = "other";
        const bytes = canonicalCheckpointBytes(checkpoint);
        return {...read, bytes, hash: createHash("sha256").update(bytes).digest("hex")};
      }
    })});
    assert.equal((await step.authorizeEntry(authorization())).status, "UNKNOWN");
    assert.equal((await step.authorizeEntry(authorization("again"))).status, "UNKNOWN");
  });
}

test("lying session result is not accepted as a checkpoint receipt", async t => {
  const {step} = await setup(t, {wrapSession: real => proxy(real, {
    authorizeEntry: async (...args) => ({...await real.authorizeEntry(...args), maxSpendCents: 9999n})
  })});
  assert.equal((await step.authorizeEntry(authorization())).status, "UNKNOWN");
});

test("deadline stops dispatch; explicit finish values marks without liquidation or restart", async t => {
  const {step, session, store} = await filled(t);
  const before = session.metadata.sequence;
  assert.match((await step.riskSnapshot({eventId: "deadline", now: END, marks: []})).reason, /deadline/);
  assert.equal(session.metadata.sequence, before);
  assert.equal((await step.authorizeEntry(authorization("late", {now: END}))).status, "REJECT");
  const finish = await step.finishRun({eventId: "finish", now: END, marks: []});
  assert.equal(finish.status, "FINISHED");
  assert.equal(finish.equityCents, null);
  assert.equal(finish.openPositions[0].markStatus, "VALUATION_UNAVAILABLE");
  assert.equal(session.snapshot().summary.cashCents, "92000");
  assert.equal(session.snapshot().summary.openPositions.length, 1);
  assert.equal((await step.riskSnapshot({eventId: "after", now: END, marks: []})).status, "REJECT");
  assert.throws(() => createPaperExecutionStep({session, store, runId: RUN, startedAt: START, endAt: END}), /no resume/);
});

test("delayed stop callback finishes at observed time with an exact durable receipt", async t => {
  const {step, session, store} = await filled(t);
  const sequence = session.metadata.sequence;
  assert.match((await step.riskSnapshot({
    eventId: "stop-at-deadline", now: END, marks: []
  })).reason, /deadline/);
  assert.equal(session.metadata.sequence, sequence);
  assert.equal((await step.authorizeEntry(authorization("late-entry", {
    candidate: candidate(END + 1),
    now: END + 1
  }))).status, "REJECT");

  const finishedAt = END + 120_000;
  const finishInput = {eventId: "delayed-finish", now: finishedAt, marks: []};
  const finish = await step.finishRun(finishInput);
  assert.equal(finish.status, "FINISHED");
  assert.equal(finish.elapsedMs, 8 * 60 * 60 * 1000 + 120_000);
  assert.equal(finish.equityCents, null);
  assert.deepEqual(finish.openPositions, [{
    mint: candidate().mint,
    markStatus: "VALUATION_UNAVAILABLE"
  }]);
  assert.equal(session.snapshot().summary.cashCents, "92000");
  assert.equal(session.snapshot().summary.openPositions.length, 1);
  assert.equal(session.snapshot().auditEvents.some(event => event.type === "PAPER_EXIT"), false);

  const read = await store.readCheckpoint();
  assert.equal(read.status, "OK");
  const checkpoint = JSON.parse(read.bytes);
  const record = checkpoint.records.at(-1);
  assert.equal(record.method, "finishRun");
  assert.equal(record.inputs.now, finishedAt);
  assert.equal(record.inputs.startedAt, START);
  assert.equal(finish.receipt.sequence, read.sequence);
  assert.equal(finish.receipt.hash, createHash("sha256").update(read.bytes).digest("hex"));
  assert.equal(finish.receipt.resultDigest, record.resultDigest);
  assert.equal(finish.commandId, record.commandId);

  assert.deepEqual(await step.finishRun(finishInput), finish);
  assert.equal(session.metadata.sequence, read.sequence);
  assert.equal((await step.finishRun({eventId: "second-finish", now: finishedAt, marks: []})).status, "REJECT");
  assert.equal(session.metadata.sequence, read.sequence);
  assert.throws(() => createPaperExecutionStep({
    session, store, runId: RUN, startedAt: START, endAt: END
  }), /no resume/);
});

test("late entry quote is rejected before ledger dispatch while terminal finish remains allowed", async t => {
  const {step, session} = await setup(t);
  const auth = await step.authorizeEntry(authorization());
  const late = await step.executeEntry(entry(auth, candidate(), "late-entry", END + 1));
  assert.equal(late.status, "REJECT");
  assert.match(late.reason, /deadline/);
  assert.equal(session.metadata.sequence, 1);
  assert.equal(session.snapshot().summary.cashCents, "100000");
  assert.equal(session.snapshot().summary.openPositions.length, 0);
  assert.equal((await step.finishRun({eventId: "late-finish", now: END + 1, marks: []})).status, "FINISHED");
});

test("finish normalizes ID-less valuation marks without creating exits", async t => {
  const {step, session, store} = await filled(t);
  const mark = quote(candidate(), "finish-mark", END);
  delete mark.eventId;
  const finish = await step.finishRun({eventId: "finish", now: END, marks: [mark]});
  assert.equal(finish.status, "FINISHED");
  assert.equal(finish.openPositions.length, 1);
  assert.equal(session.snapshot().summary.openPositions.length, 1);
  assert.equal(session.snapshot().auditEvents.some(event => event.type === "PAPER_EXIT"), false);
  const read = await store.readCheckpoint();
  const record = JSON.parse(read.bytes).records.at(-1);
  assert.match(record.inputs.marks[0].eventId, /^paper-mark:[a-f0-9]{64}:0$/);
  assert.ok(record.inputs.marks[0].eventId.length <= 120);
});

test("event, command, byte and pending-authorization bounds fail before mutation but allow finish", async t => {
  const event = await setup(t, {limits: {maxEvents: 1}});
  await event.step.riskSnapshot({eventId: "one", now: START, marks: []});
  assert.match((await event.step.authorizeEntry(authorization())).reason, /capacity/);
  assert.equal((await event.step.finishRun({eventId: "finish", now: END, marks: []})).status, "FINISHED");
  const command = await setup(t, {limits: {maxCommands: 1}});
  assert.match((await command.step.authorizeEntry(authorization())).reason, /capacity/);
  assert.equal(command.session.metadata.sequence, 0);
  assert.equal((await command.step.finishRun({eventId: "finish", now: END, marks: []})).status, "FINISHED");
  const pending = await setup(t, {limits: {maxPendingAuthorizations: 1}});
  await pending.step.authorizeEntry(authorization());
  assert.match((await pending.step.authorizeEntry(authorization("two", {candidate: candidate(START, 1)}))).reason, /capacity/);
  const bytes = await setup(t, {limits: {maxBytes: 16_384}});
  const huge = authorization();
  huge.candidate.unused = "x".repeat(16_384);
  assert.match((await bytes.step.authorizeEntry(huge)).reason, /byte capacity/);
  assert.equal(bytes.session.metadata.sequence, 0);
  const checkpoint = await setup(t, {limits: {maxBytes: 4096}});
  let capacity;
  for (let index = 0; index < 20; index += 1) {
    capacity = await checkpoint.step.riskSnapshot({eventId: `risk-${index}`, now: START + index, marks: []});
    if (capacity.status === "REJECT") break;
    assert.equal(capacity.status, "PASS");
  }
  assert.match(capacity.reason, /checkpoint byte capacity/);
  const sequence = checkpoint.session.metadata.sequence;
  assert.match((await checkpoint.step.riskSnapshot({
    eventId: "still-full", now: START + 20, marks: []
  })).reason, /checkpoint byte capacity/);
  assert.equal(checkpoint.session.metadata.sequence, sequence);
  assert.equal((await checkpoint.step.finishRun({
    eventId: "finish", now: END, marks: []
  })).status, "FINISHED");
  assert.equal(checkpoint.session.snapshot().summary.cashCents, "100000");
});

test("configured 1,024-byte capacity rejects operations without latching checkpoint uncertainty", async t => {
  for (const method of ["riskSnapshot", "finishRun"]) {
    let dispatches = 0;
    const {step, session} = await setup(t, {
      limits: {maxBytes: 1024},
      wrapSession: real => proxy(real, Object.fromEntries(
        ["authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"]
          .map(name => [name, async (...args) => {
            dispatches += 1;
            return real[name](...args);
          }])
      ))
    });
    const input = method === "riskSnapshot"
      ? {eventId: method, now: START, marks: []}
      : {eventId: "finish", now: END, marks: []};
    const result = await step[method](input);
    assert.equal(result.status, "REJECT");
    assert.match(result.reason, /checkpoint byte capacity/);
    assert.equal(session.metadata.sequence, 0);
    assert.equal(dispatches, 0);
    assert.deepEqual(await step[method](input), result);
    assert.equal(dispatches, 0);
  }
});

test("corrupt or oversized checkpoint readback still latches UNKNOWN", async t => {
  for (const kind of ["corrupt", "oversized"]) {
    let dispatches = 0;
    const {step} = await setup(t, {
      wrapStore: real => proxy(real, {
        readCheckpoint: async () => {
          const read = await real.readCheckpoint();
          return kind === "corrupt"
            ? {...read, bytes: Buffer.from("{}")}
            : {...read, bytes: Buffer.alloc(MAX_CHECKPOINT_BYTES + 1)};
        }
      }),
      wrapSession: real => proxy(real, Object.fromEntries(
        ["authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"]
          .map(name => [name, async (...args) => {
            dispatches += 1;
            return real[name](...args);
          }])
      ))
    });
    assert.equal((await step.riskSnapshot({eventId: kind, now: START, marks: []})).status, "UNKNOWN");
    assert.equal((await step.riskSnapshot({eventId: `${kind}-again`, now: START, marks: []})).status, "UNKNOWN");
    assert.equal(dispatches, 0);
  }
});

test("malformed plain-data inputs reject without poisoning the adapter", async t => {
  const {step, session} = await setup(t);
  for (const patch of [{eventId: 42}, {tickId: 42}, {candidate: null},
    {now: "2026-01-01T19:00:00Z"}, {marks: [null]}]) {
    assert.equal((await step.authorizeEntry({...authorization(), ...patch})).status, "REJECT");
  }
  const cyclic = authorization();
  cyclic.candidate.cycle = cyclic;
  assert.equal((await step.authorizeEntry(cyclic)).status, "REJECT");
  const accessor = authorization();
  Object.defineProperty(accessor.candidate, "decimals", {
    enumerable: true, get() { throw new Error("must not invoke accessor"); }
  });
  assert.equal((await step.authorizeEntry(accessor)).status, "REJECT");
  for (const unused of [{startedAt: "bad-time"}, {text: "x".repeat(262_145)}]) {
    const invalid = authorization();
    invalid.candidate.unused = unused;
    assert.equal((await step.authorizeEntry(invalid)).status, "REJECT");
  }
  for (const [index, field] of ["mint", "pool", "quote"].entries()) {
    const invalid = authorization(`malformed-${index}`);
    invalid.candidate[field] = {toString: null};
    assert.equal((await step.authorizeEntry(invalid)).status, "REJECT");
    assert.equal(session.metadata.sequence, 0);
  }
  assert.equal((await step.executeEntry({eventId: "null", authorizationId: "auth", quote: null,
    now: START, marks: []})).status, "REJECT");
  assert.equal(session.metadata.sequence, 0);
  assert.equal((await step.authorizeEntry(authorization())).status, "AUTHORIZED");
});

test("aggregate input capacity reserves explicit empty-marks finish admission", async t => {
  const maxBytes = 16_384;
  const {step, session} = await setup(t, {limits: {maxBytes}});
  const input = {eventId: "large-invalid-mark", now: START, marks: [{padding: "x".repeat(15_500)}]};
  assert.equal((await step.riskSnapshot(input)).status, "REJECT");
  assert.equal(session.metadata.sequence, 0);
  assert.match((await step.riskSnapshot({
    eventId: "overflow", now: START, marks: [{padding: "x".repeat(700)}]
  })).reason, /capacity/);
  assert.equal((await step.finishRun({eventId: "f".repeat(120), now: END, marks: []})).status, "FINISHED");
});

test("definitely rejected finish can be corrected with a new event within bounded capacity", async t => {
  const {step, session} = await setup(t);
  await step.riskSnapshot({eventId: "risk", now: START + 5000, marks: []});
  assert.equal((await step.finishRun({
    eventId: "backward", now: START + 4000, marks: []
  })).reason, "NON_MONOTONIC_TIME");
  assert.equal(session.metadata.sequence, 1);
  assert.equal((await step.finishRun({eventId: "corrected", now: END, marks: []})).status, "FINISHED");
});

test("explicit risk expiration frees bounded pending authorization capacity", async t => {
  const {step} = await setup(t, {limits: {maxPendingAuthorizations: 1}});
  const auth = await step.authorizeEntry(authorization());
  const now = START + 301_001;
  const risk = await step.riskSnapshot({eventId: "expire", now, marks: []});
  assert.equal(risk.reservedPositions, 0);
  assert.equal((await step.executeEntry(entry(auth, candidate(), "expired", now))).status, "REJECT");
  assert.equal((await step.authorizeEntry(authorization("new", {
    candidate: candidate(now), now, marks: []
  }))).status, "AUTHORIZED");
});

test("marks must match decimals, source, time and complete costs before effect", async t => {
  const {step, session} = await filled(t);
  for (const [index, change] of [
    mark => { mark.decimals = 9; },
    mark => { mark.source = "real-source"; },
    mark => { mark.observedAt += 1; },
    mark => { delete mark.costs.spreadCents; }
  ].entries()) {
    const mark = quote(candidate(), `mark-${index}`, START + 3000);
    change(mark);
    assert.equal((await step.riskSnapshot({
      eventId: `risk-${index}`, now: START + 3000, marks: [mark]
    })).status, "REJECT");
    assert.equal(session.metadata.sequence, 2);
  }
  assert.equal((await step.riskSnapshot({
    eventId: "valid-risk", now: START + 3000, marks: [quote(candidate(), "valid-mark", START + 3000)]
  })).status, "PASS");
});

test("shorter run deadline stops work and late fixed-window finish uses actual time", async t => {
  const {session, store} = await setup(t);
  const step = createPaperExecutionStep({session, store, runId: RUN, startedAt: START, endAt: START + 5000});
  assert.match((await step.authorizeEntry(authorization("deadline", {now: START + 5000}))).reason, /deadline/);
  assert.equal(session.metadata.sequence, 0);
  const finish = await step.finishRun({eventId: "finish", now: START + 5000, marks: []});
  assert.equal(finish.status, "FINISHED");
  assert.equal(finish.elapsedMs, 5000);
  const late = await setup(t);
  const delayed = await late.step.finishRun({eventId: "late", now: END + 1, marks: []});
  assert.equal(delayed.status, "FINISHED");
  assert.equal(delayed.elapsedMs, 8 * 60 * 60 * 1000 + 1);
  assert.equal(late.session.metadata.sequence, 1);
});

test("backward time, invalid run bounds and attempts to loosen capacity are rejected", async t => {
  const {step, session, store} = await setup(t);
  await step.riskSnapshot({eventId: "risk", now: START + 5000, marks: []});
  assert.equal((await step.authorizeEntry(authorization())).reason, "NON_MONOTONIC_TIME");
  for (const patch of [{runId: "wrong"}, {endAt: END + 1}, {limits: {maxCommands: 10_000}},
    {limits: {maxPendingAuthorizations: 4}}, {limits: {unrecognized: 1}}]) {
    assert.throws(() => createPaperExecutionStep({session, store, runId: RUN, startedAt: START, endAt: END, ...patch}));
  }
});

const USD_ASSUMPTION =
  "1_USDC_EQUALS_1_MODELED_USD_UNSUPPORTED_BY_MARKET_ACCOUNTING_ASSUMPTION; NOT_OBSERVED_FX; NOT_DEPEG_PROTECTION";

function modeledKit() {
  const token = candidate();
  const identity = {chainId: token.chainId, mint: token.mint, pool: token.pool, quote: token.quote, decimals: 6};
  const scenario = {
    optIn: true, scenarioId: "MERIDIAN_PAPER_QUOTED_NET_V1", scenarioVersion: "1", scenario: "QUOTED_NET_V1",
    identity, usdcMint: token.quote, usdcDecimals: 6, usdcUsdMicrosPerToken: "1000000",
    quoteBasis: "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS", adverseAdjustmentBps: 300,
    networkReserveCents: "50", feeCents: "0", spreadCents: "0", priceImpactCents: "0",
    zeroChargeDisposition: "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS"
  };
  const sha = reviewScenarioConfigSha256(scenario);
  scenario.reviewEvidence = {
    evidenceId: "step-review", evidenceSha256: "a".repeat(64), scenarioConfigSha256: sha,
    identity: {...identity}, reviewerRef: "independent-methodology-review",
    purpose: "OFFLINE_SCENARIO_REVIEW_ONLY", decision: "APPROVE_SCENARIO_REVIEW_ONLY", recordedAt: START
  };
  const policy = {
    runId: RUN, runStartedAt: START, runEndAt: END, sourcePolicySha256: "b".repeat(64),
    modelVersion: "1", scenarioConfigSha256: sha, usdAssumption: USD_ASSUMPTION
  };
  const clock = {t: START + 2000};
  let body = syntheticOrderResponse({inputMint: token.quote, outputMint: token.mint}).body;
  const adapter = createFixtureMarketQuoteAdapter({
    clock: () => clock.t,
    transport: async () => new Response(JSON.stringify(body), {
      status: 200, headers: {"content-type": "application/json"}
    })
  });
  const issue = async (side, amountAtoms, at, overrides = {}, eventId = "entry") => {
    clock.t = at;
    body = side === "ENTRY"
      ? syntheticOrderResponse({inputMint: token.quote, outputMint: token.mint}).body
      : syntheticOrderResponse({inputMint: token.mint, outputMint: token.quote, inAmount: amountAtoms,
        outAmount: "65824730", otherAmountThreshold: "1"}).body;
    const request = {identity, side, amountAtoms, quoteDecimals: 6, candidateSampledAt: START,
      slippageBps: 50, ...(side === "ENTRY" ? {authorizedAt: START + 1000} : {positionOpenedAt: START + 2000})};
    const result = await adapter.getPaperQuote(request, {reviewScenario: scenario});
    const issued = adapter.issueModeledQuote(result, {identity, side, amountAtoms, policy: {...policy, ...overrides}});
    return {issued, eventId, at};
  };
  return {token, adapter, policy, issue, clock};
}

function explicitNetScenario(identity, {equityCents, availableCashCents, fxRate, fxObservedAt, recordedAt}) {
  const dispositions = {
    fee: "ADDITIONAL_MODELED_FEE_PENALTY_NOT_OBSERVED",
    spread: "ADDITIONAL_MODELED_SPREAD_PENALTY_NOT_OBSERVED",
    slippage: "ADDITIONAL_MODELED_ADVERSE_ADJUSTMENT_ROUNDED_UP",
    priceImpact: "ADDITIONAL_MODELED_IMPACT_PENALTY_NOT_OBSERVED",
    network: "ADDITIONAL_MODELED_NETWORK_RESERVE_NOT_SETTLED_COST"
  };
  const config = {
    optIn: true,
    scenarioId: "MERIDIAN_PAPER_EXPLICIT_NET_V1",
    scenarioVersion: "1",
    scenario: "EXPLICIT_NET_V1",
    identity: {...identity},
    quoteBasis: "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS",
    explicitAssumptions: {
      feeCents: "11",
      spreadCents: "13",
      slippageBps: "250",
      priceImpactCents: "17",
      networkCents: "37",
      equityCents,
      availableCashCents,
      units: {
        feeCents: "US_CENTS_PER_SIDE",
        spreadCents: "US_CENTS_PER_SIDE",
        slippageBps: "BASIS_POINTS_OF_QUOTED_NET_USD_VALUE",
        priceImpactCents: "US_CENTS_PER_SIDE",
        networkCents: "US_CENTS_PER_SIDE",
        equityCents: "US_CENTS",
        availableCashCents: "US_CENTS"
      },
      rationales: Object.fromEntries([
        "feeCents", "spreadCents", "slippageBps", "priceImpactCents",
        "networkCents", "equityCents", "availableCashCents"
      ].map(key => [key, `Synthetic execution-test assumption for ${key}.`])),
      zeroCostAssumptions: {},
      dispositions
    },
    quoteUsdConversion: {
      mint: identity.quote,
      decimals: 6,
      microUsdPerWholeToken: fxRate,
      observedAt: fxObservedAt,
      method: "MEASURED_SOURCE_RECEIPT",
      evidenceSha256: "c".repeat(64)
    }
  };
  config.reviewEvidence = {
    evidenceId: "explicit-step-review",
    evidenceSha256: "e".repeat(64),
    scenarioConfigSha256: reviewScenarioConfigSha256(config),
    identity: {...identity},
    reviewerRef: "synthetic-methodology-review",
    purpose: "OFFLINE_SCENARIO_REVIEW_ONLY",
    decision: "APPROVE_SCENARIO_REVIEW_ONLY",
    recordedAt
  };
  return config;
}

function explicitNetModeledKit() {
  const token = candidate();
  const identity = {
    chainId: token.chainId, mint: token.mint, pool: token.pool, quote: token.quote, decimals: 6
  };
  const clock = {t: START + 2000};
  const baseScenario = explicitNetScenario(identity, {
    equityCents: "50000", availableCashCents: "3500", fxRate: "800000",
    fxObservedAt: START + 1500, recordedAt: START + 1250
  });
  const policy = {
    schema: "PAPER_MODELED_POLICY_V2",
    runId: RUN,
    runStartedAt: START,
    runEndAt: END,
    sourcePolicySha256: "b".repeat(64),
    modelId: "MERIDIAN_PAPER_EXPLICIT_NET_V1",
    modelVersion: "1",
    methodologyDigest: paperExplicitNetMethodologyDigest(baseScenario)
  };
  let body = syntheticOrderResponse({
    inputMint: token.quote, outputMint: token.mint
  }).body;
  const adapter = createFixtureMarketQuoteAdapter({
    clock: () => clock.t,
    transport: async () => new Response(JSON.stringify(body), {
      status: 200, headers: {"content-type": "application/json"}
    })
  });
  let modeledOpenedAt = null;
  const issue = async (side, amountAtoms, at, {
    equityCents = "90000", availableCashCents = "95000", fxRate = "900000",
    positionOpenedAt = modeledOpenedAt, sourceOutAmount = "17057460",
    sourceThreshold = "16972172", authorizedAt
  } = {}) => {
    clock.t = at;
    body = side === "ENTRY"
      ? syntheticOrderResponse({
        inputMint: token.quote, outputMint: token.mint, inAmount: amountAtoms,
        outAmount: sourceOutAmount, otherAmountThreshold: sourceThreshold
      }).body
      : syntheticOrderResponse({
        inputMint: token.mint, outputMint: token.quote, inAmount: amountAtoms,
        outAmount: (BigInt(amountAtoms) * 100_000_000n / 17_057_460n).toString(),
        otherAmountThreshold: "1"
      }).body;
    const config = explicitNetScenario(identity, {
      equityCents, availableCashCents, fxRate,
      fxObservedAt: at - 500, recordedAt: at - 750
    });
    const request = {
      identity, side, amountAtoms, quoteDecimals: 6,
      candidateSampledAt: side === "ENTRY" ? START : at - 2000,
      slippageBps: 50,
      ...(side === "ENTRY" ? {authorizedAt: authorizedAt ?? at - 1000} : {positionOpenedAt})
    };
    const result = await adapter.getPaperQuote(request, {reviewScenario: config});
    const issued = adapter.issueModeledQuote(result, {identity, side, amountAtoms, policy});
    if (issued.ok && side === "ENTRY") modeledOpenedAt = issued.quote.modeled.sourceObservedAt;
    return {issued, result};
  };
  return {token, identity, adapter, policy, issue, clock};
}

async function modeledSetup(t, kit) {
  const context = await setup(t);
  const step = createPaperExecutionStep({
    session: context.session, store: context.store, runId: RUN, startedAt: START, endAt: END,
    modeledQuoteAuthority: {adapter: kit.adapter, policy: kit.policy}
  });
  return {...context, step};
}

test("modeled entry, exit and restart: exact quantity, bound policy, replayed provenance and digest", async t => {
  const kit = modeledKit();
  const {step, session, store, directory} = await modeledSetup(t, kit);
  const auth = await step.authorizeEntry(authorization());
  const entryIssue = await kit.issue("ENTRY", "100000000", START + 2000);
  assert.equal(entryIssue.issued.ok, true);
  const entryQuote = {...entryIssue.issued.quote, eventId: "entry"};
  const fill = await step.executeEntry({eventId: "entry", authorizationId: auth.authorizationId,
    quote: entryQuote, now: START + 2000, marks: []});
  assert.equal(fill.status, "FILLED_PAPER");
  assert.equal(fill.tokenAtoms, "13164946");
  assert.equal(fill.provenance, "MODELED");

  const exitIssue = await kit.issue("EXIT", "13164946", START + 5000);
  assert.equal(exitIssue.issued.ok, true);
  const exitQuote = {...exitIssue.issued.quote, eventId: "exit"};
  const closed = await step.observeExitQuote({eventId: "exit", quote: exitQuote, now: START + 5000});
  assert.equal(closed.status, "CLOSED_PAPER");
  assert.equal(closed.provenance, "MODELED");
  assert.equal(closed.actualCostCoverage, "UNKNOWN");
  const sequence = session.metadata.sequence;
  const live = session.snapshot();

  await session.close();
  const reopenedStore = await CheckpointStore.open(directory);
  const reopened = await PaperCheckpointSession.open({store: reopenedStore});
  assert.equal(reopened.metadata.sequence, sequence);
  const replay = reopened.snapshot();
  assert.deepEqual(replay.summary, live.summary);
  assert.deepEqual(replay.auditEvents, live.auditEvents);
  const records = JSON.parse((await reopenedStore.readCheckpoint()).bytes).records;
  const entryRecord = records.find(item => item.method === "executeEntry");
  const exitRecord = records.find(item => item.method === "observeExitQuote");
  assert.equal(entryRecord.inputs.quote.modeled.digest, entryQuote.modeled.digest);
  assert.equal(exitRecord.inputs.quote.modeled.digest, exitQuote.modeled.digest);
  assert.match(entryRecord.resultDigest, /^[0-9a-f]{64}$/);
  const entryAudit = replay.auditEvents.find(item => item.type === "PAPER_FILL");
  const exitAudit = replay.auditEvents.find(item => item.type === "PAPER_EXIT");
  assert.equal(entryAudit.tokenAtoms, "13164946");
  assert.equal(entryAudit.provenance, "MODELED");
  assert.equal(entryAudit.actualCostCoverage, "UNKNOWN");
  assert.equal(entryAudit.modeledDigest, entryQuote.modeled.digest);
  assert.equal(exitAudit.provenance, "MODELED");
  assert.equal(exitAudit.modeledDigest, exitQuote.modeled.digest);
  assert.equal(entryQuote.modeled.executionRealistic, false);
  await reopened.close();
});

test("V2 fixture entry and exit replay preserve one effect and read-only ledger provenance", async t => {
  const kit = explicitNetModeledKit();
  const {step, session, store, directory} = await modeledSetup(t, kit);
  const auth = await step.authorizeEntry(authorization());
  const entryIssue = await kit.issue("ENTRY", "100000000", START + 2000, {
    equityCents: "50000", availableCashCents: "3500", fxRate: "800000"
  });
  assert.equal(entryIssue.issued.ok, true);
  const entryQuote = {...entryIssue.issued.quote, eventId: "v2-entry"};
  const entryInput = {
    eventId: "v2-entry", authorizationId: auth.authorizationId,
    quote: entryQuote, now: START + 2000, marks: []
  };
  const fill = await step.executeEntry(entryInput);
  assert.equal(fill.status, "FILLED_PAPER");
  assert.equal(fill.provenance, "MODELED");
  const afterEntry = session.metadata.sequence;
  assert.deepEqual(await step.executeEntry(entryInput), fill);
  for (const mutate of [
    modeled => { modeled.scenarioBinding.scenarioConfiguration.explicitAssumptions.feeCents = "12"; },
    modeled => { modeled.methodologyDigest = "d".repeat(64); }
  ]) {
    const modeled = structuredClone(entryQuote.modeled);
    mutate(modeled);
    assert.equal((await step.executeEntry({
      ...entryInput, quote: {...entryQuote, modeled}
    })).status, "REJECT");
  }
  const alteredCosts = structuredClone(entryQuote);
  alteredCosts.costs.networkCents = String(BigInt(alteredCosts.costs.networkCents) + 1n);
  assert.equal((await step.executeEntry({...entryInput, quote: alteredCosts})).status, "REJECT");
  assert.equal(session.metadata.sequence, afterEntry);
  assert.equal(session.snapshot().summary.openPositions.length, 1);
  assert.equal(session.snapshot().summary.openPositions[0].tokenAtoms, fill.tokenAtoms);

  const exitIssue = await kit.issue("EXIT", fill.tokenAtoms, START + 5000, {
    equityCents: "90000", availableCashCents: "95000", fxRate: "750000"
  });
  assert.equal(exitIssue.issued.ok, true);
  const exitQuote = {...exitIssue.issued.quote, eventId: "v2-exit"};
  const exitInput = {eventId: "v2-exit", quote: exitQuote, now: START + 5000};
  const closed = await step.observeExitQuote(exitInput);
  assert.equal(closed.status, "CLOSED_PAPER");
  assert.equal(closed.provenance, "MODELED");
  const afterExit = session.metadata.sequence;
  assert.deepEqual(await step.observeExitQuote(exitInput), closed);
  const alteredExit = structuredClone(exitQuote);
  alteredExit.modeled.scenarioBinding.scenarioConfiguration.explicitAssumptions.networkCents = "38";
  assert.equal((await step.observeExitQuote({...exitInput, quote: alteredExit})).status, "REJECT");
  assert.equal(session.metadata.sequence, afterExit);

  const live = session.snapshot();
  assert.equal(live.summary.openPositions.length, 0);
  assert.equal(live.auditEvents.filter(event => event.type === "PAPER_FILL").length, 1);
  assert.equal(live.auditEvents.filter(event => event.type === "PAPER_EXIT").length, 1);
  const entryAudit = live.auditEvents.find(event => event.type === "PAPER_FILL");
  const exitAudit = live.auditEvents.find(event => event.type === "PAPER_EXIT");
  assert.equal(entryAudit.tokenAtoms, fill.tokenAtoms);
  assert.equal(entryAudit.provenance, "MODELED");
  assert.equal(entryAudit.modeledDigest, entryQuote.modeled.digest);
  assert.equal(exitAudit.provenance, "MODELED");
  assert.equal(exitAudit.modeledDigest, exitQuote.modeled.digest);

  const beforeClose = await store.readCheckpoint();
  const records = JSON.parse(beforeClose.bytes).records;
  const entryRecord = records.find(record => record.method === "executeEntry");
  const exitRecord = records.find(record => record.method === "observeExitQuote");
  assert.equal(entryRecord.inputs.quote.modeled.digest, entryQuote.modeled.digest);
  assert.equal(exitRecord.inputs.quote.modeled.digest, exitQuote.modeled.digest);
  assert.equal(entryRecord.resultDigest, fill.receipt.resultDigest);
  assert.equal(exitRecord.resultDigest, closed.receipt.resultDigest);

  await session.close();
  const reopenedStore = await CheckpointStore.open(directory);
  const reopened = await PaperCheckpointSession.open({store: reopenedStore});
  const replay = reopened.snapshot();
  assert.deepEqual(replay, live);
  assert.equal(replay.summary.cashCents, live.summary.cashCents);
  assert.equal(replay.summary.openPositions.length, live.summary.openPositions.length);
  assert.deepEqual(replay.auditEvents, live.auditEvents);
  assert.equal(replay.auditEvents.find(event => event.type === "PAPER_FILL").tokenAtoms, fill.tokenAtoms);
  const replayedCheckpoint = await reopenedStore.readCheckpoint();
  assert.deepEqual(replayedCheckpoint.bytes, beforeClose.bytes);
  assert.deepEqual(
    JSON.parse(replayedCheckpoint.bytes).records.map(record => record.resultDigest),
    records.map(record => record.resultDigest)
  );
  await reopened.close();
});

test("explicit-net fixture execution rebinds fresh FX and budgets under stable methodology", async t => {
  const kit = explicitNetModeledKit();
  const {step, session} = await modeledSetup(t, kit);
  const auth = await step.authorizeEntry(authorization());
  const entryIssue = await kit.issue("ENTRY", "100000000", START + 2000, {
    equityCents: "50000", availableCashCents: "3500", fxRate: "800000"
  });
  assert.equal(entryIssue.issued.ok, true);
  const entryQuote = {...entryIssue.issued.quote, eventId: "explicit-entry"};
  const sequence = session.metadata.sequence;
  for (const [index, mutate] of [
    facts => { facts.methodologyDigest = "d".repeat(64); },
    facts => { facts.scenarioBinding.quoteUsdConversion.microUsdPerWholeToken = "1"; },
    facts => { facts.scenarioBinding.scenarioConfiguration.explicitAssumptions.units.feeCents = "USD"; },
    facts => { facts.scenarioBinding.scenarioConfiguration.explicitAssumptions.dispositions.network = "OBSERVED"; },
    facts => { facts.scenarioBinding.sourceQuote.outAmount = "1"; },
    facts => { facts.scenarioBinding.request.identity.pool = kit.token.mint; },
    facts => { facts.responseSha256 = "f".repeat(64); },
    facts => { facts.modelDigest = "a".repeat(64); },
    facts => { facts.runId = "other-run"; },
    facts => { facts.sourcePolicySha256 = "c".repeat(64); }
  ].entries()) {
    const modeled = structuredClone(entryQuote.modeled);
    mutate(modeled);
    const eventId = `explicit-invalid-${index}`;
    const refused = await step.executeEntry({
      eventId, authorizationId: auth.authorizationId,
      quote: {...entryQuote, eventId, modeled}, now: START + 2000, marks: []
    });
    assert.equal(refused.status, "REJECT");
    assert.equal(session.metadata.sequence, sequence);
    assert.equal(session.snapshot().summary.cashCents, "100000");
  }
  const fill = await step.executeEntry({
    eventId: "explicit-entry", authorizationId: auth.authorizationId,
    quote: entryQuote, now: START + 2000, marks: []
  });
  assert.equal(fill.status, "FILLED_PAPER", JSON.stringify(fill));
  assert.equal(fill.provenance, "MODELED");
  assert.equal(entryQuote.modeled.schema, "PAPER_MODELED_QUOTE_V2");

  const delayedExitAt = START + 302_001;
  const exitIssue = await kit.issue("EXIT", fill.tokenAtoms, delayedExitAt, {
    equityCents: "90000", availableCashCents: "95000", fxRate: "750000"
  });
  assert.equal(exitIssue.issued.ok, true);
  const exitQuote = {...exitIssue.issued.quote, eventId: "explicit-exit"};
  assert.notEqual(entryQuote.modeled.scenarioConfigSha256, exitQuote.modeled.scenarioConfigSha256);
  assert.notEqual(entryQuote.modeled.modelDigest, exitQuote.modeled.modelDigest);
  assert.equal(entryQuote.modeled.methodologyDigest, exitQuote.modeled.methodologyDigest);
  const closed = await step.observeExitQuote({
    eventId: "explicit-exit", quote: exitQuote, now: delayedExitAt
  });
  assert.equal(closed.status, "CLOSED_PAPER");
  assert.equal(closed.provenance, "MODELED");
  assert.equal(closed.actualCostCoverage, "UNKNOWN");
  assert.equal(session.snapshot().summary.openPositions.length, 0);
  const afterCloseSequence = session.metadata.sequence;
  assert.deepEqual(await step.observeExitQuote({
    eventId: "explicit-exit", quote: exitQuote, now: delayedExitAt
  }), closed);
  assert.equal(session.metadata.sequence, afterCloseSequence);
});

test("explicit-net exit must bind the actual opening time and retains fresh quote/FX requirements", async t => {
  const kit = explicitNetModeledKit();
  const {step, session} = await modeledSetup(t, kit);
  const auth = await step.authorizeEntry(authorization());
  const entryIssue = await kit.issue("ENTRY", "100000000", START + 2000, {
    equityCents: "50000", availableCashCents: "3500", fxRate: "800000"
  });
  const fill = await step.executeEntry({
    eventId: "opening-entry", authorizationId: auth.authorizationId,
    quote: {...entryIssue.issued.quote, eventId: "opening-entry"},
    now: START + 2000, marks: []
  });
  assert.equal(fill.status, "FILLED_PAPER");
  const sequence = session.metadata.sequence;

  const wrongOpen = await kit.issue("EXIT", fill.tokenAtoms, START + 302_001, {
    positionOpenedAt: START + 2001
  });
  assert.equal(wrongOpen.issued.ok, true);
  assert.equal((await step.observeExitQuote({
    eventId: "wrong-open-exit",
    quote: {...wrongOpen.issued.quote, eventId: "wrong-open-exit"},
    now: START + 302_001
  })).status, "REJECT");
  assert.equal(session.metadata.sequence, sequence);
  assert.equal(session.snapshot().summary.openPositions.length, 1);
});

test("explicit-net entry sized to an earlier budget is not resized to current ledger equity", async t => {
  const kit = explicitNetModeledKit();
  const {step, session} = await modeledSetup(t, kit);
  const firstAuth = await step.authorizeEntry(authorization("authorize-first"));
  const firstIssue = await kit.issue("ENTRY", "100000000", START + 2000, {
    equityCents: "100000", availableCashCents: "100000", fxRate: "800000"
  });
  assert.equal(firstIssue.issued.ok, true);
  const firstFill = await step.executeEntry({
    eventId: "budget-first-entry", authorizationId: firstAuth.authorizationId,
    quote: {...firstIssue.issued.quote, eventId: "budget-first-entry"},
    now: START + 2000, marks: []
  });
  assert.equal(firstFill.status, "FILLED_PAPER", JSON.stringify(firstFill));
  assert.equal(firstFill.allInCents, firstIssue.issued.quote.modeled.scenarioBinding.result.afterCents);

  const firstExit = await kit.issue("EXIT", firstFill.tokenAtoms, START + 5000, {
    equityCents: "100000", availableCashCents: "100000", fxRate: "750000"
  });
  assert.equal(firstExit.issued.ok, true);
  const closed = await step.observeExitQuote({
    eventId: "budget-first-exit",
    quote: {...firstExit.issued.quote, eventId: "budget-first-exit"},
    now: START + 5000
  });
  assert.equal(closed.status, "CLOSED_PAPER");
  const cashAfterExit = session.snapshot().summary.cashCents;
  assert.ok(BigInt(cashAfterExit) < 100_000n);
  assert.ok(100_000n - BigInt(cashAfterExit) < 3_000n);

  const secondAuth = await step.authorizeEntry(authorization("authorize-second", {
    now: START + 6000
  }));
  assert.equal(secondAuth.status, "AUTHORIZED");
  const oversized = await kit.issue("ENTRY", "100000000", START + 7000, {
    equityCents: "100000", availableCashCents: "100000", fxRate: "800000"
  });
  assert.equal(oversized.issued.ok, true);
  assert.equal(oversized.issued.quote.modeled.baseAtoms, firstIssue.issued.quote.modeled.baseAtoms);
  const refused = await step.executeEntry({
    eventId: "budget-second-entry", authorizationId: secondAuth.authorizationId,
    quote: {...oversized.issued.quote, eventId: "budget-second-entry"},
    now: START + 7000, marks: []
  });
  assert.equal(refused.status, "UNFILLED");
  assert.match(refused.reason, /current risk budget/);
  assert.equal(session.snapshot().summary.cashCents, cashAfterExit);
  assert.equal(session.snapshot().summary.openPositions.length, 0);

  const pending = await step.riskSnapshot({
    eventId: "budget-reservation-pending", now: START + 18_000, marks: []
  });
  assert.equal(pending.reservedPositions, 1);
  assert.equal(pending.openPositions, 0);
  const smallerIssue = await kit.issue("ENTRY", "50000000", START + 20_000, {
    equityCents: "100000", availableCashCents: "100000", fxRate: "800000",
    sourceOutAmount: "8528730", sourceThreshold: "8480000", authorizedAt: START + 6000
  });
  assert.equal(smallerIssue.issued.ok, true, JSON.stringify(smallerIssue));
  assert.ok(BigInt(smallerIssue.issued.quote.modeled.baseAtoms) <
    BigInt(oversized.issued.quote.modeled.baseAtoms));
  const smallerInput = {
    eventId: "budget-smaller-entry", authorizationId: secondAuth.authorizationId,
    quote: {...smallerIssue.issued.quote, eventId: "budget-smaller-entry"},
    now: START + 20_000, marks: []
  };
  const smallerFill = await step.executeEntry(smallerInput);
  assert.equal(smallerFill.status, "FILLED_PAPER", JSON.stringify(smallerFill));
  assert.equal(smallerFill.tokenAtoms, smallerIssue.issued.quote.modeled.baseAtoms);
  assert.equal(session.snapshot().summary.cashCents,
    (BigInt(cashAfterExit) - BigInt(smallerFill.allInCents)).toString());
  const cashAfterRetry = session.snapshot().summary.cashCents;
  const retrySequence = session.metadata.sequence;
  assert.deepEqual(await step.executeEntry(smallerInput), smallerFill);
  assert.equal(session.metadata.sequence, retrySequence);
  assert.equal(session.snapshot().summary.cashCents, cashAfterRetry);
  const consumed = await step.riskSnapshot({
    eventId: "budget-reservation-consumed", now: START + 21_000, marks: []
  });
  assert.equal(consumed.reservedPositions, 0);
  assert.equal(consumed.openPositions, 1);
  assert.equal(consumed.cashCents.toString(), cashAfterRetry);
});

test("a valid issuer quote under a changed policy is refused before any state mutation", async t => {
  for (const override of [{sourcePolicySha256: "c".repeat(64)}, {runEndAt: END - 1}, {runStartedAt: START + 1}]) {
    const kit = modeledKit();
    const {step, session} = await modeledSetup(t, kit);
    const auth = await step.authorizeEntry(authorization());
    const before = session.metadata.sequence;
    const issue = await kit.issue("ENTRY", "100000000", START + 2000, override);
    assert.equal(issue.issued.ok, true);
    const result = await step.executeEntry({eventId: "entry", authorizationId: auth.authorizationId,
      quote: {...issue.issued.quote, eventId: "entry"}, now: START + 2000, marks: []});
    assert.equal(result.status, "REJECT");
    assert.equal(session.metadata.sequence, before);
    assert.equal(session.snapshot().summary.cashCents, "100000");
  }
});

test("changed event identity or altered modeled quote cannot duplicate or re-bind a modeled fill", async t => {
  const kit = modeledKit();
  const {step, session} = await modeledSetup(t, kit);
  const auth = await step.authorizeEntry(authorization());
  const issue = await kit.issue("ENTRY", "100000000", START + 2000);
  const quote = {...issue.issued.quote, eventId: "entry"};
  const input = {eventId: "entry", authorizationId: auth.authorizationId, quote, now: START + 2000, marks: []};
  assert.equal((await step.executeEntry(input)).status, "FILLED_PAPER");
  const sequence = session.metadata.sequence;
  const cash = session.snapshot().summary.cashCents;

  const renamed = await step.executeEntry({...input, eventId: "entry-2", quote: {...quote, eventId: "entry-2"}});
  assert.equal(renamed.status, "REJECT");
  const altered = await step.executeEntry({...input,
    quote: {...quote, modeled: {...quote.modeled, baseAtoms: "13164945"}}});
  assert.equal(altered.status, "REJECT");
  assert.equal(session.metadata.sequence, sequence);
  assert.equal(session.snapshot().summary.cashCents, cash);
  assert.equal(session.snapshot().summary.openPositions.length, 1);
});

test("a partial exit quote and an unmodeled quote are refused before mutating the modeled position", async t => {
  const kit = modeledKit();
  const {step, session} = await modeledSetup(t, kit);
  const auth = await step.authorizeEntry(authorization());
  const entryIssue = await kit.issue("ENTRY", "100000000", START + 2000);
  await step.executeEntry({eventId: "entry", authorizationId: auth.authorizationId,
    quote: {...entryIssue.issued.quote, eventId: "entry"}, now: START + 2000, marks: []});
  const sequence = session.metadata.sequence;
  const partial = await kit.issue("EXIT", "13000000", START + 5000);
  assert.equal(partial.issued.ok, true);
  assert.equal((await step.observeExitQuote({eventId: "exit-partial",
    quote: {...partial.issued.quote, eventId: "exit-partial"}, now: START + 5000})).status, "REJECT");
  assert.equal((await step.observeExitQuote({eventId: "exit-legacy",
    quote: quote(candidate(), "exit-legacy", START + 5000, 5_000_000), now: START + 5000})).status, "REJECT");
  assert.equal(session.metadata.sequence, sequence);
  assert.equal(session.snapshot().summary.openPositions.length, 1);
});
