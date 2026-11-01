import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {PaperCheckpointSession} from "./checkpoint-session.mjs";
import {canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {runSyntheticReplay} from "./replay.mjs";
import {analyzeCandidate, filterCandidate} from "./stages.mjs";
import {SYNTHETIC_SOURCE, SYNTHETIC_SMART_WALLET_ALLOWLIST, syntheticCandidate} from "./synthetic-fixtures.mjs";

const HOURS_8 = 28_800_000;
const VIENNA_START = Date.parse("2026-01-01T19:00:00Z");
const DISABLED_MANIFEST = canonicalCheckpointBytes(JSON.parse(readFileSync(new URL("./run-manifest.json", import.meta.url), "utf8")));
const SCENARIOS = new Set(["baseline", "stale-evidence", "mismatched-evidence", "vienna-daily-gate", "manual-late"]);
const COSTS = {feeCents: 0, spreadCents: 0, slippageCents: 0, priceImpactCents: 0, networkCents: 0};
const digest = value => createHash("sha256").update(canonicalCheckpointBytes(value)).digest("hex");

function quote(candidate, at, priceMicros = 10_000, eventId = `mark-${at}`) {
  return {eventId, mint: candidate.mint, chainId: candidate.chainId, pool: candidate.pool,
    quote: candidate.quote, source: SYNTHETIC_SOURCE, observedAt: at, priceMicros,
    decimals: candidate.decimals, mode: "HYPOTHETICAL", executable: true, costs: {...COSTS}};
}

function authorization(candidate, at, authorizationId, tickId, marks = []) {
  const filterResult = filterCandidate(candidate, {now: at, holdUntil: at + HOURS_8});
  const scoreResult = analyzeCandidate(candidate, {now: at, filterResult, smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST});
  return {authorizationId, candidate, filterResult, scoreResult, tickId, now: at + 1000, marks};
}

function planFor(scenario, at, golden) {
  const candidate = syntheticCandidate(at);
  const commands = [];
  const add = (name, method, inputs) => commands.push({commandId: `orchestration-v1:${scenario}:${name}`, method, inputs});
  // Reuse the golden pipeline decisions as well as its financial reference.
  add("authorize", "authorizeEntry", {authorizationId: "synthetic-auth-1", candidate,
    filterResult: golden.filters, scoreResult: golden.analysis, tickId: "synthetic-tick-1", now: at + 1000, marks: []});
  const entry = quote(candidate, at + 2000, 10_000, "synthetic-entry-1");
  if (scenario === "stale-evidence") entry.observedAt = at - 600_000;
  if (scenario === "mismatched-evidence") entry.pool = "11111111111111111111111111111112";
  add("entry", "executeEntry", {authorizationId: "synthetic-auth-1", quote: entry, now: at + 2000, marks: []});
  if (scenario === "vienna-daily-gate") {
    const midnight = at + 4 * 60 * 60 * 1000;
    add("unknown-marks", "riskSnapshot", {now: at + 3000, marks: []});
    add("open-day", "riskSnapshot", {now: midnight, marks: [quote(candidate, midnight)]});
    add("loss-2999", "riskSnapshot", {now: midnight + 1000, marks: [quote(candidate, midnight + 1000, 6252)]});
    const second = syntheticCandidate(midnight + 1500, {mint: "11111111111111111111111111111112"});
    for (const item of [...Object.values(second.evidence), ...Object.values(second.analystEvidence)]) item.binding.mint = second.mint;
    add("reserve", "authorizeEntry", authorization(second, midnight + 1500, "second-auth", "second-tick", [quote(candidate, midnight + 2500, 6252)]));
    add("loss-3000", "riskSnapshot", {now: midnight + 3000, marks: [quote(candidate, midnight + 3000, 6251)]});
    add("revoked-entry", "executeEntry", {authorizationId: "second-auth", quote: quote(second, midnight + 3500), now: midnight + 4000, marks: []});
    add("still-tripped", "riskSnapshot", {now: midnight + 5000, marks: []});
  }
  add("boundary", scenario === "manual-late" ? "riskSnapshot" : "finishRun",
    {now: at + HOURS_8 + (scenario === "manual-late" ? 1 : 0), marks: []});
  return commands;
}

async function acknowledgedCheckpoint(store, session) {
  const current = await store.readCheckpoint();
  const metadata = session.metadata; // Throws if publication is unresolved.
  if (current.status !== "OK" || current.hash !== metadata.hash || current.sequence !== metadata.sequence) {
    throw new Error("Orchestration has no acknowledged checkpoint; report withheld");
  }
  return JSON.parse(current.bytes.toString("utf8"));
}

function checkPrefix(checkpoint, plan, startedAt) {
  if (checkpoint.records.length > plan.length + 1) throw new Error("Checkpoint is not this orchestration plan");
  for (let index = 1; index < checkpoint.records.length; index += 1) {
    const actual = checkpoint.records[index];
    const expected = plan[index - 1];
    const inputs = expected.method === "finishRun" ? {...expected.inputs, startedAt} : expected.inputs;
    if (actual.commandId !== expected.commandId || actual.method !== expected.method || digest(actual.inputs) !== digest(inputs)) {
      throw new Error("Checkpoint is not this orchestration plan");
    }
  }
}

/** Consumes an exclusively owned store; always closes it. No provider or timer runs. */
export async function runSyntheticPaperOrchestration(options) {
  const {store, manifest, runId, startedAt, scenario = "baseline"} = options ?? {};
  let session;
  try {
    if (!options || Object.keys(options).some(key => !["store", "manifest", "runId", "startedAt", "scenario"].includes(key))) {
      throw new TypeError("Only generated scenario inputs are accepted; real/synthetic mixing is forbidden");
    }
    if (!canonicalCheckpointBytes(manifest).equals(DISABLED_MANIFEST) || manifest.enabled !== false ||
        manifest.stopSwitch.engaged !== true || manifest.providers.some(provider => provider.enabled !== false) ||
        manifest.allowedMints.length || manifest.allowedPools.length ||
        manifest.runId !== null || manifest.startAt !== null || manifest.endAt !== null) {
      throw new TypeError("Exact disabled, empty, undated manifest required");
    }
    if (!SCENARIOS.has(scenario)) throw new TypeError("Unknown generated scenario; external evidence is forbidden");
    if (!Number.isSafeInteger(startedAt) || !Number.isFinite(new Date(startedAt + HOURS_8 + 1).getTime())) throw new TypeError("Explicit safe startedAt required");
    if (scenario === "vienna-daily-gate" && startedAt !== VIENNA_START) throw new TypeError("Vienna fixture requires 2026-01-01T19:00:00Z");
    const golden = runSyntheticReplay({now: startedAt});
    const plan = planFor(scenario, startedAt, golden);
    session = await PaperCheckpointSession.open({store, runId, startedAt});
    checkPrefix(await acknowledgedCheckpoint(store, session), plan, startedAt);
    const results = [];
    for (const command of plan) {
      const result = await session[command.method](command.commandId, command.inputs);
      const checkpoint = await acknowledgedCheckpoint(store, session);
      const record = checkpoint.records[results.length + 1];
      // A session-level REJECT is not necessarily persisted. Check the actual receipt.
      if (!record || record.commandId !== command.commandId || record.resultDigest !== digest(result)) {
        throw new Error("Command has no acknowledged result; report withheld");
      }
      results.push({commandId: command.commandId, method: command.method, result, resultDigest: record.resultDigest});
    }
    const snapshot = session.snapshot();
    const normalized = {...snapshot.summary, runId: golden.ledger.runId};
    const goldenMatch = scenario === "baseline" ? digest(normalized) === digest(golden.ledger) &&
      digest(results[1].result) === digest(golden.simulatedFill) && digest(results.at(-1).result) === digest(golden.runEnd) &&
      digest(snapshot.auditEvents) === digest(golden.audit.slice(-snapshot.auditEvents.length)) : null;
    if (goldenMatch === false) throw new Error("Golden replay mismatch; report withheld");
    return {reportType: "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY", source: SYNTHETIC_SOURCE,
      networkAccessed: false, liveCandidateEvidence: false, scenario, metadata: session.metadata,
      results, snapshot, snapshotDigest: digest(snapshot), auditDigest: digest(snapshot.auditEvents),
      resultsDigest: digest(results), goldenMatch,
      caveat: "Generated fixtures only. No live scanning, scheduling, activation, or execution-realistic fills."};
  } finally {
    if (session) await session.close();
    else if (store && typeof store.close === "function") await store.close();
  }
}
