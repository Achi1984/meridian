import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {canonicalCheckpointBytes, CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {createPaperExecutionStep} from "../scripts/memecoin-paper/execution-step.mjs";
import {START, END, RUN, candidate, authorization, quote, entry} from "./fixtures/memecoin-paper-execution-step/scenario.mjs";

async function setup(t, {limits, wrapStore, wrapSession, storeOptions} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-execution-step-"));
  const realStore = await CheckpointStore.open(directory, storeOptions);
  const store = wrapStore ? wrapStore(realStore) : realStore;
  const session = await PaperCheckpointSession.open({store, runId: RUN, startedAt: START});
  t.after(async () => {
    await session.close();
    await rm(directory, {recursive: true, force: true});
  });
  const step = createPaperExecutionStep({
    session: wrapSession ? wrapSession(session) : session, store,
    runId: RUN, startedAt: START, endAt: END, limits
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

test("shorter run deadline and late fixed-window finish never dispatch or fabricate time", async t => {
  const {session, store} = await setup(t);
  const step = createPaperExecutionStep({session, store, runId: RUN, startedAt: START, endAt: START + 5000});
  assert.match((await step.authorizeEntry(authorization("deadline", {now: START + 5000}))).reason, /deadline/);
  assert.equal(session.metadata.sequence, 0);
  const finish = await step.finishRun({eventId: "finish", now: START + 5000, marks: []});
  assert.equal(finish.status, "FINISHED");
  assert.equal(finish.elapsedMs, 5000);
  const late = await setup(t);
  assert.match((await late.step.finishRun({eventId: "late", now: END + 1, marks: []})).reason, /deadline/);
  assert.equal(late.session.metadata.sequence, 0);
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
