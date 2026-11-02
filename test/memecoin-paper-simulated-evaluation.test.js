import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {evaluateSimulatedPilotEvidence} from "../scripts/memecoin-paper-simulated-evaluation/index.mjs";

const START = Date.parse("2026-01-01T22:00:00.000Z");
const RUN_ID = "simulated-evaluation-fixture";
const BUILD_ID = "fixture-build-1";
const HASH = value => createHash("sha256").update(value).digest("hex");
const COSTS = {feeCents: 2, spreadCents: 2, slippageCents: 2, priceImpactCents: 2, networkCents: 2};
const ZERO_COSTS = Object.fromEntries(Object.keys(COSTS).map(key => [key, 0]));

function artifactBytes(value) {
  return Buffer.from(JSON.stringify(value));
}

function resultDigest(value) {
  return HASH(canonicalCheckpointBytes(value));
}

function makeFixture({kind = "completed", restartStatus = "NOT_REQUIRED"} = {}) {
  const config = {
    schema: "MEMECOIN_SIMULATED_PILOT_CONFIG_V1",
    buildId: BUILD_ID,
    runId: RUN_ID,
    mode: "SIMULATED_PAPER",
    executionMode: "SIMULATED_ONLY",
    policyVersion: "memecoin-paper-ledger-v2-monotonic-time",
    startedAt: START,
    entryCutoffAt: START + 7 * 60 * 60 * 1000,
    deadlineAt: START + 8 * 60 * 60 * 1000,
    initialCapitalCents: "100000",
    maxEntryCents: "8000",
    maxOpenPositions: 3,
    initialStopBps: 600,
    trailingActivationBps: 1200,
    trailingDistanceBps: 600,
    dailyLossLimitCents: "3000",
    timezone: "Europe/Vienna",
    quoteMaxAgeMs: 30_000,
    costPolicy: {
      basis: "DECLARED_HYPOTHETICAL",
      revision: "cost-model-v1",
      source: "fixture-assumptions",
      measuredBasis: "NOT_MEASURED"
    }
  };
  const mint = "11111111111111111111111111111111";
  const markedOpen = [
    "marked-open", "missing-finish-event-id", "marked-open-wrong-status"
  ].includes(kind);
  const entryQuote = {
    ...(kind === "missing-event-id" ? {} : {eventId: "entry-event"}),
    chainId: "solana",
    mint,
    pool: "pool-fixture",
    quote: "USDC",
    source: "fixture-quote",
    observedAt: START + 1_000,
    priceMicros: 10_000,
    decimals: 6,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: {...COSTS}
  };
  const exitQuote = {
    ...entryQuote,
    eventId: "exit-event",
    observedAt: START + 3_000,
    priceMicros: 10_140,
    costs: {...COSTS}
  };
  const actions = [];
  let fills = 0;
  let exits = 0;
  let entryCosts = ZERO_COSTS;
  let exitCosts = ZERO_COSTS;
  let cash = 100_000n;
  let grossRealized = 0n;
  let netRealized = 0n;
  let openPositions = [];
  let accounting;
  let terminalAt = START + 4_000;

  if (kind !== "zero") {
    actions.push({
      commandId: "command-risk-initial",
      method: "riskSnapshot",
      inputs: {now: START + 400, marks: []},
      result: {
        status: "PASS",
        entriesAllowed: true,
        equityCents: "100000",
        lossCents: "0",
        dailyOpeningEquityCents: "100000",
        limitCents: "3000",
        cashAtMarkCents: "100000",
        grossOpenValueCents: "0",
        estimatedExitCostsCents: "0",
        reservedPositions: 0
      }
    });
    const candidate = {
      mint,
      chainId: "solana",
      pool: "pool-fixture",
      quote: "USDC",
      decimals: 6,
      source: "fixture-candidate",
      sampledAt: new Date(START + 300).toISOString()
    };
    const decisionIdentity = {
      chainId: candidate.chainId,
      mint: candidate.mint,
      pool: candidate.pool,
      quote: candidate.quote,
      source: kind === "authorization-decision-mismatch"
        ? "different-candidate" : candidate.source,
      sampledAt: candidate.sampledAt
    };
    const authResult = {
      status: "AUTHORIZED",
      authorizationId: kind === "authorization-request-mismatch" ? "auth-other" : "auth-1",
      mint,
      chainId: "solana",
      pool: "pool-fixture",
      quote: "USDC",
      decimals: 6,
      tickId: "tick-1",
      sampledAt: candidate.sampledAt,
      authorizedAt: new Date(START + 600).toISOString(),
      authorizedDay: "2026-01-01",
      maxSpendCents: "8000",
      stopLossBps: 600,
      trailingActivationBps: 1200,
      trailingDistanceBps: 600,
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false
    };
    actions.push({
      commandId: "command-auth",
      method: "authorizeEntry",
      inputs: {
        authorizationId: "auth-1",
        candidate,
        filterResult: {
          status: "PASS",
          accepted: true,
          identity: {...decisionIdentity}
        },
        scoreResult: {status: "PASS", score: 70, identity: {...decisionIdentity}},
        tickId: "tick-1",
        now: START + 600,
        marks: []
      },
      result: authResult
    });

    const entryNow = kind === "cutoff" ? config.entryCutoffAt : START + 2_000;
    const allInCents = kind === "oversize-entry" ? "9000" :
      kind === "zero-quantity-fill" ? "10" : "8000";
    const notionalCents = kind === "oversize-entry" ? "8990" :
      kind === "zero-quantity-fill" ? "0" : "7990";
    const entryResult = {
      status: "FILLED_PAPER",
      eventId: "entry-event",
      mint,
      tokenAtoms: kind === "zero-quantity-fill" ? "0" : "7990000000",
      decimals: 6,
      notionalCents,
      entryCostsCents: "10",
      allInCents,
      entryPriceMicros: kind === "wrong-entry-price" ? "9999" : "10000",
      initialStopPriceMicros: "9400",
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false
    };
    const quote = kind === "missing-quote" ? null :
      kind === "missing-event-id" ? {...entryQuote} :
      kind === "missing-costs" ? {...entryQuote, costs: null} :
        kind === "stale-quote" ? {...entryQuote, observedAt: START + 1_000} : entryQuote;
    const input = {
      authorizationId: "auth-1",
      quote,
      now: kind === "stale-quote" ? START + 60_000 : entryNow,
      marks: []
    };
    actions.push({commandId: "command-entry", method: "executeEntry", inputs: input, result: entryResult});
    fills = 1;
    entryCosts = {...COSTS};
    cash -= BigInt(allInCents);

    if ([
      "risk-snapshot-valid", "risk-snapshot-forged", "risk-exit-execution-mode"
    ].includes(kind)) {
      const riskExit = kind === "risk-exit-execution-mode";
      const mark = {
        ...entryQuote,
        eventId: riskExit ? "daily-loss-mark" : "risk-mark",
        observedAt: START + 2_500,
        priceMicros: riskExit ? 5_000 : 9_500,
        costs: {...(riskExit ? ZERO_COSTS : COSTS)}
      };
      const exitRequest = {
        status: "CLOSED_PAPER",
        eventId: mark.eventId,
        mint,
        fillPriceMicros: "5000",
        grossProceedsCents: "3995",
        exitCostsCents: "0",
        realizedGrossPnlCents: "-3995",
        realizedNetPnlCents: "-4005",
        reason: "DAILY_LOSS_LIMIT",
        executionMode: "SIMULATED_ONLY",
        executionRealistic: true
      };
      actions.push({
        commandId: "command-risk-open",
        method: "riskSnapshot",
        inputs: {now: START + 3_000, marks: [mark]},
        result: {
          status: riskExit ? "DAILY_LOSS_LIMIT" : "PASS",
          entriesAllowed: !riskExit,
          equityCents: riskExit ? "95995" :
            kind === "risk-snapshot-forged" ? "100000" : "99580",
          lossCents: riskExit ? "4005" :
            kind === "risk-snapshot-forged" ? "0" : "420",
          dailyOpeningEquityCents: "100000",
          limitCents: "3000",
          cashAtMarkCents: riskExit ? "92000" :
            kind === "risk-snapshot-forged" ? "100000" : "92000",
          grossOpenValueCents: riskExit ? "3995" :
            kind === "risk-snapshot-forged" ? "0" : "7590",
          estimatedExitCostsCents: riskExit ? "0" :
            kind === "risk-snapshot-forged" ? "0" : "10",
          ...(riskExit ? {exitRequests: [exitRequest]} : {})
        }
      });
      if (riskExit) {
        exits = 1;
        exitCosts = {...ZERO_COSTS};
        cash += 3_995n;
        grossRealized = -3_995n;
        netRealized = -4_005n;
      }
    }

    if (kind === "completed" || kind === "duplicate-event" ||
        kind === "wrong-exit-gross" || kind === "wrong-exit-decimals" ||
        kind === "daily-loss-rollover") {
      const exitResult = {
        status: "CLOSED_PAPER",
        eventId: "exit-event",
        mint,
        fillPriceMicros: kind === "daily-loss-rollover" ? "6000" : "10140",
        grossProceedsCents: kind === "wrong-exit-gross" ? "8100" :
          kind === "daily-loss-rollover" ? "4794" : "8101",
        exitCostsCents: "10",
        realizedGrossPnlCents: kind === "daily-loss-rollover" ? "-3196" : "111",
        realizedNetPnlCents: kind === "daily-loss-rollover" ? "-3216" : "91",
        reason: "OPERATOR",
        executionMode: "SIMULATED_ONLY",
        executionRealistic: false
      };
      actions.push({
        commandId: "command-exit",
        method: "observeExitQuote",
        inputs: {
          eventId: "exit-event",
          quote: kind === "daily-loss-rollover"
            ? {...exitQuote, observedAt: START + 3_000, priceMicros: 6_000} :
            kind === "duplicate-event" ? {...exitQuote, eventId: "entry-event"} :
            kind === "wrong-exit-decimals" ? {...exitQuote, decimals: 5} : exitQuote,
          now: START + 3_500
        },
        result: exitResult
      });
      exits = 1;
      exitCosts = {...COSTS};
      cash += kind === "daily-loss-rollover" ? 4_784n : 8_091n;
      grossRealized = kind === "daily-loss-rollover" ? -3_196n : 111n;
      netRealized = kind === "daily-loss-rollover" ? -3_216n : 91n;
    } else {
      openPositions = [{
        mint,
        markStatus: kind === "marked-open-wrong-status"
          ? "VALUATION_UNAVAILABLE" : markedOpen ? "MARKED" : "VALUATION_UNAVAILABLE"
      }];
    }
  }

  if (kind === "daily-loss-rollover") {
    actions.push({
      commandId: "command-daily-loss",
      method: "riskSnapshot",
      inputs: {now: START + 4_000, marks: []},
      result: {
        status: "DAILY_LOSS_LIMIT",
        entriesAllowed: false,
        equityCents: "96784",
        lossCents: "3216",
        dailyOpeningEquityCents: "100000",
        limitCents: "3000",
        cashAtMarkCents: "96784",
        grossOpenValueCents: "0",
        estimatedExitCostsCents: "0"
      }
    });
    actions.push({
      commandId: "command-next-day",
      method: "riskSnapshot",
      inputs: {now: START + 2 * 60 * 60 * 1000, marks: []},
      result: {
        status: "PASS",
        entriesAllowed: true,
        equityCents: "96784",
        lossCents: "0",
        dailyOpeningEquityCents: "96784",
        limitCents: "3000",
        cashAtMarkCents: "96784",
        grossOpenValueCents: "0",
        estimatedExitCostsCents: "0"
      }
    });
    terminalAt = START + 2 * 60 * 60 * 1000 + 1_000;
  }

  if (kind === "daily-loss-invalid") {
    actions.push({
      commandId: "command-risk",
      method: "riskSnapshot",
      inputs: {now: START + 3_000, marks: []},
      result: {
        status: "DAILY_LOSS_LIMIT",
        entriesAllowed: false,
        equityCents: "97001",
        lossCents: "2999",
        dailyOpeningEquityCents: "100000",
        limitCents: "3000",
        cashAtMarkCents: "92000",
        grossOpenValueCents: "5001",
        estimatedExitCostsCents: "0"
      }
    });
  }
  if (kind === "hidden-terminal-position") openPositions = [];

  if ([
    "completed", "zero", "daily-loss-rollover", "risk-exit-execution-mode"
  ].includes(kind)) {
    accounting = {
      cashCents: cash.toString(),
      grossOpenValueCents: "0",
      estimatedExitCostsCents: "0",
      grossUnrealizedPnlCents: "0",
      netUnrealizedPnlCents: "0",
      realizedGrossPnlCents: grossRealized.toString(),
      realizedNetPnlCents: netRealized.toString(),
      reconciliation: "equity = cash + gross open value - estimated exit costs"
    };
  } else {
    accounting = null;
  }
  let finishMarks = [];
  if (markedOpen) {
    finishMarks = [{
      ...entryQuote,
      eventId: kind === "missing-finish-event-id" ? null : "finish-mark",
      observedAt: START + 3_500,
      costs: {...COSTS}
    }];
    accounting = {
      cashCents: cash.toString(),
      grossOpenValueCents: "7990",
      estimatedExitCostsCents: "10",
      grossUnrealizedPnlCents: "0",
      netUnrealizedPnlCents: "-20",
      realizedGrossPnlCents: grossRealized.toString(),
      realizedNetPnlCents: netRealized.toString(),
      reconciliation: "equity = cash + gross open value - estimated exit costs"
    };
  }

  const finishResult = {
    status: "FINISHED",
    entriesAllowed: false,
    elapsedMs: terminalAt - START,
    openPositions,
    equityCents: accounting
      ? (cash + BigInt(accounting.grossOpenValueCents) -
        BigInt(accounting.estimatedExitCostsCents)).toString()
      : null,
    auditTruncated: false,
    accounting,
    note: "Open positions are not liquidated at run end; no end-of-run fill is invented."
  };
  if (kind === "duplicate-event") {
    actions.push({
      commandId: "command-duplicate",
      method: "riskSnapshot",
      inputs: {eventId: "entry-event", now: START + 3_800, marks: []},
      result: {
        status: "PASS",
        entriesAllowed: true,
        equityCents: "100091",
        lossCents: "0",
        dailyOpeningEquityCents: "100000",
        limitCents: "3000",
        cashAtMarkCents: "100091",
        grossOpenValueCents: "0",
        estimatedExitCostsCents: "0"
      }
    });
  }
  actions.push({
    commandId: "command-finish",
    method: "finishRun",
    inputs: {
      now: kind === "finish-command-time-mismatch" ? terminalAt - 1 : terminalAt,
      startedAt: START,
      marks: finishMarks
    },
    result: finishResult
  });

  const header = {
    runId: RUN_ID,
    startedAt: START,
    deadlineAt: config.deadlineAt,
    policyVersion: config.policyVersion
  };
  const records = [{
    sequence: 0,
    runId: RUN_ID,
    predecessorHash: null,
    commandId: "__header__",
    method: "constructor",
    inputs: header,
    resultDigest: resultDigest({...header, constructorStatus: "INITIALIZED"})
  }];
  for (const action of actions) {
    const sequence = records.length;
    records.push({
      sequence,
      runId: RUN_ID,
      predecessorHash: HASH(canonicalCheckpointBytes({
        formatVersion: 1,
        runHeader: header,
        sequence: sequence - 1,
        records: records.slice()
      })),
      commandId: action.commandId,
      method: action.method,
      inputs: action.inputs,
      resultDigest: resultDigest(action.result)
    });
  }
  const checkpoint = {
    formatVersion: 1,
    runHeader: header,
    sequence: records.length - 1,
    records
  };
  const checkpointBytes = canonicalCheckpointBytes(checkpoint);
  const terminal = {
    schema: "MEMECOIN_SIMULATED_PILOT_TERMINAL_V1",
    runId: RUN_ID,
    buildId: BUILD_ID,
    configSha256: "",
    status: "FINISHED",
    stopReason: "OPERATOR_STOP",
    terminalAt,
    checkpointReceipt: {
      runId: RUN_ID,
      sequence: checkpoint.sequence,
      hash: HASH(checkpointBytes),
      commandId: records.at(-1).commandId,
      method: records.at(-1).method,
      resultDigest: records.at(-1).resultDigest
    },
    operations: actions.map((action, index) => ({
      sequence: index + 1,
      commandId: action.commandId,
      method: action.method,
      resultDigest: records[index + 1].resultDigest,
      result: action.result
    })),
    stopEvidence: {
      status: "VERIFIED",
      reason: "OPERATOR_STOP",
      observedAt: terminalAt,
      source: "durable-terminal-receipt"
    },
    restartEvidence: restartStatus === "NOT_REQUIRED"
      ? {status: "NOT_REQUIRED", restartCount: 0, receipts: []}
      : {status: restartStatus, restartCount: 1, receipts: []}
  };
  const report = {
    schema: "MEMECOIN_PAPER_OPERATOR_REPORT_V1",
    experiment: {
      id: RUN_ID,
      reportStatus: "FINISHED",
      startAt: new Date(START).toISOString(),
      endAt: new Date(terminalAt).toISOString()
    },
    trading: {status: fills ? exits ? "TRADES_RECORDED" : "TRADES_RECORDED" : "ZERO_TRADES", paperEntryFills: fills},
    controls: {
      reservations: 0,
      openPositionCount: openPositions.length,
      openPositions: openPositions.map(position => ({
        mint: position.mint,
        tokenAtoms: kind === "zero-quantity-fill" ? "0" : "7990000000",
        decimals: 6,
        entryCostCents: kind === "oversize-entry" ? "9000" :
          kind === "zero-quantity-fill" ? "10" : "8000",
        markStatus: position.markStatus
      }))
    },
    valuation: {
      status: openPositions.length && !markedOpen
        ? "UNRESOLVED" : "MARKED_AT_RUN_END",
      cashCents: cash.toString(),
      realizedGrossPnlCents: grossRealized.toString(),
      realizedNetPnlCents: netRealized.toString(),
      grossOpenValueCents: accounting?.grossOpenValueCents ?? null,
      estimatedExitCostsCents: accounting?.estimatedExitCostsCents ?? null,
      unrealizedGrossPnlCents: accounting?.grossUnrealizedPnlCents ?? null,
      unrealizedNetPnlCents: accounting?.netUnrealizedPnlCents ?? null,
      unresolvedPositions: markedOpen ? 0 : openPositions.length
    },
    costs: {
      basis: "reported ledger cost totals; exact integer-cent addition only",
      entryByType: Object.fromEntries(Object.keys(COSTS).map(key => [key, String(entryCosts[key])])),
      exitByType: Object.fromEntries(Object.keys(COSTS).map(key => [key, String(exitCosts[key])])),
      totalCents: String(Object.values(entryCosts).reduce((sum, item) => sum + item, 0) +
        Object.values(exitCosts).reduce((sum, item) => sum + item, 0))
    }
  };
  if (kind === "quantity-mismatch") {
    report.controls.openPositions[0].tokenAtoms = "1";
  }
  if (kind === "unvalued") {
    report.valuation.status = "UNRESOLVED";
    report.valuation.unrealizedGrossPnlCents = null;
    report.valuation.unrealizedNetPnlCents = null;
  }
  const configBytes = artifactBytes(config);
  terminal.configSha256 = HASH(configBytes);
  const reportBytes = artifactBytes(report);
  const terminalBytes = artifactBytes(terminal);
  const manifest = {
    schema: "MEMECOIN_SIMULATED_PILOT_EXPORT_V1",
    runId: RUN_ID,
    buildId: BUILD_ID,
    configSha256: HASH(configBytes),
    revisions: Object.fromEntries([
      ["config", configBytes],
      ["checkpoint", checkpointBytes],
      ["terminal", terminalBytes],
      ["report", reportBytes]
    ].map(([name, bytes]) => [name, {revision: `${name}-rev1`, sha256: HASH(bytes)}]))
  };
  const artifact = {
    manifest: artifactBytes(manifest),
    config: configBytes,
    checkpoint: checkpointBytes,
    terminal: terminalBytes,
    report: reportBytes,
    expectedRunId: RUN_ID,
    expectedBuildId: BUILD_ID,
    expectedConfigSha256: HASH(configBytes)
  };
  return {artifact, config, checkpoint, terminal, report, actions};
}

function evaluate(fixture) {
  return evaluateSimulatedPilotEvidence(fixture.artifact);
}

function replaceArtifact(fixture, name, value) {
  const bytes = artifactBytes(value);
  fixture.artifact[name] = bytes;
  const manifest = JSON.parse(fixture.artifact.manifest);
  manifest.revisions[name].sha256 = HASH(bytes);
  if (name === "config") {
    manifest.configSha256 = HASH(bytes);
    fixture.artifact.expectedConfigSha256 = HASH(bytes);
  }
  fixture.artifact.manifest = artifactBytes(manifest);
}

async function runCli(t, fixture, {fifoCheckpoint = false} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meridian-simulated-evaluation-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const files = {};
  for (const name of ["manifest", "config", "checkpoint", "terminal", "report"]) {
    files[name] = path.join(directory, `${name}.json`);
    await writeFile(files[name], fixture.artifact[name], {flag: "wx"});
  }
  if (fifoCheckpoint) {
    const fifo = path.join(directory, "checkpoint.fifo");
    const creator = spawn("mkfifo", [fifo], {stdio: "ignore"});
    const [code] = await new Promise((resolve, reject) => {
      creator.once("error", reject);
      creator.once("close", exitCode => resolve([exitCode]));
    });
    assert.equal(code, 0);
    files.checkpoint = fifo;
  }
  const cli = fileURLToPath(new URL(
    "../scripts/memecoin-paper-simulated-evaluation/index.mjs", import.meta.url
  ));
  const args = [
    cli,
    ...Object.entries(files).flatMap(([name, filename]) => [`--${name}`, filename]),
    "--run-id", fixture.artifact.expectedRunId,
    "--build-id", fixture.artifact.expectedBuildId,
    "--config-sha256", fixture.artifact.expectedConfigSha256,
    "--format", "json"
  ];
  const child = spawn(process.execPath, args, {stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 2_000);
  const {code, signal} = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => resolve({code: exitCode, signal: exitSignal}));
  });
  clearTimeout(timeout);
  return {code, signal, stdout, stderr};
}

test("completed simulated entry and exit are receipt-bound without a profitability claim", () => {
  const result = evaluate(makeFixture());
  assert.equal(result.outcome, "SIMULATED_ENTRY_EXIT_COMPLETE", JSON.stringify(result.checks));
  assert.equal(result.evidence.entryFills, 1);
  assert.equal(result.evidence.exits, 1);
  assert.equal(result.overall, "PASS");
  assert.deepEqual(result.claims, {liveExecution: false, profitability: false, activation: false});
  assert.equal(result.costProvenance.measured, "NOT_SUPPLIED");
});

test("completed zero-entry run is distinct from an entry/exit cycle", () => {
  const result = evaluate(makeFixture({kind: "zero"}));
  assert.equal(result.outcome, "ZERO_ENTRY_COMPLETE");
  assert.equal(result.evidence.entryFills, 0);
  assert.equal(result.evidence.exits, 0);
  assert.equal(result.overall, "PASS");
});

test("honest open and unvalued terminal position remains explicit and non-successful", () => {
  const result = evaluate(makeFixture({kind: "unvalued"}));
  assert.equal(result.outcome, "OPEN_UNVALUED_TERMINAL_POSITION");
  assert.equal(result.evidence.openPositions, 1);
  assert.equal(result.overall, "UNKNOWN");
  assert.ok(result.checks.some(check => check.id === "fixedpoint_accounting" && check.status === "UNKNOWN"));
});

test("open valuation is recomputed from finish marks and never inferred from receipt totals", () => {
  const marked = evaluate(makeFixture({kind: "marked-open"}));
  assert.equal(marked.outcome, "OPEN_POSITION_TERMINAL");
  assert.equal(marked.overall, "PASS");
  assert.equal(marked.evidence.openPositions, 1);

  const altered = makeFixture({kind: "marked-open"});
  const terminal = JSON.parse(altered.artifact.terminal);
  terminal.operations.at(-1).result.accounting.grossOpenValueCents = "8990";
  terminal.operations.at(-1).result.equityCents = "100980";
  replaceArtifact(altered, "terminal", terminal);
  const mismatch = evaluateSimulatedPilotEvidence(altered.artifact);
  assert.equal(mismatch.outcome, "INVALID_EVIDENCE");
  assert.ok(mismatch.checks.some(check =>
    check.id === "fixedpoint_accounting" && check.status === "FAIL"));

  const missingEvent = evaluate(makeFixture({kind: "missing-finish-event-id"}));
  assert.equal(missingEvent.outcome, "INVALID_EVIDENCE");

  const wrongStatus = evaluate(makeFixture({kind: "marked-open-wrong-status"}));
  assert.equal(wrongStatus.outcome, "INVALID_EVIDENCE");
  assert.ok(wrongStatus.checks.some(check =>
    check.id === "terminal_positions" && check.status === "FAIL"));
});

test("risk snapshots reconcile to cash and marks, and the daily gate resets only on a new local day", () => {
  const validSnapshot = evaluate(makeFixture({kind: "risk-snapshot-valid"}));
  assert.ok(validSnapshot.checks.some(check =>
    check.id === "risk_snapshot_reconciliation" && check.status === "PASS"));

  const forgedSnapshot = evaluate(makeFixture({kind: "risk-snapshot-forged"}));
  assert.equal(forgedSnapshot.outcome, "INVALID_EVIDENCE");
  assert.ok(forgedSnapshot.checks.some(check =>
    check.id === "risk_snapshot_reconciliation" && check.status === "FAIL"));

  const unrealRiskExit = evaluate(makeFixture({kind: "risk-exit-execution-mode"}));
  assert.equal(unrealRiskExit.outcome, "INVALID_EVIDENCE");
  assert.ok(unrealRiskExit.checks.some(check =>
    check.id === "causal_quotes" && check.status === "FAIL"));

  const rolloverFixture = makeFixture({kind: "daily-loss-rollover"});
  const rollover = evaluate(rolloverFixture);
  assert.equal(rollover.outcome, "SIMULATED_ENTRY_EXIT_COMPLETE");
  assert.equal(rollover.overall, "PASS");
  assert.ok(rollover.checks.some(check =>
    check.id === "risk_snapshot_reconciliation" && check.status === "PASS"));
});

test("missing, tampered, and identity-mismatched artifacts fail closed", () => {
  const fixture = makeFixture();
  const absent = evaluateSimulatedPilotEvidence({...fixture.artifact, report: undefined});
  assert.equal(absent.outcome, "INVALID_EVIDENCE");

  const changed = Buffer.from(fixture.artifact.checkpoint);
  changed[changed.length - 2] ^= 1;
  const tampered = evaluateSimulatedPilotEvidence({...fixture.artifact, checkpoint: changed});
  assert.equal(tampered.outcome, "INVALID_EVIDENCE");
  assert.ok(tampered.checks.some(check => check.id === "artifact_revisions" && check.status === "FAIL"));

  const mismatched = evaluateSimulatedPilotEvidence({
    ...fixture.artifact,
    expectedRunId: "different-run"
  });
  assert.equal(mismatched.outcome, "INVALID_EVIDENCE");

  const configChanged = makeFixture();
  const originalConfigDigest = configChanged.artifact.expectedConfigSha256;
  const changedConfig = JSON.parse(configChanged.artifact.config);
  changedConfig.quoteMaxAgeMs = 300_000;
  replaceArtifact(configChanged, "config", changedConfig);
  configChanged.artifact.expectedConfigSha256 = originalConfigDigest;
  const changedTerminal = JSON.parse(configChanged.artifact.terminal);
  changedTerminal.configSha256 = HASH(configChanged.artifact.config);
  replaceArtifact(configChanged, "terminal", changedTerminal);
  const configMismatch = evaluateSimulatedPilotEvidence(configChanged.artifact);
  assert.equal(configMismatch.outcome, "INVALID_EVIDENCE");
  assert.ok(configMismatch.checks.some(check =>
    check.id === "config_identity" && check.status === "FAIL"));
});

test("duplicate events and stale or missing execution quotes are never accepted", () => {
  const duplicate = evaluate(makeFixture({kind: "duplicate-event"}));
  assert.equal(duplicate.outcome, "INVALID_EVIDENCE");
  assert.ok(duplicate.checks.some(check => check.id === "event_identity" && check.status === "FAIL"));

  for (const kind of ["stale-quote", "missing-quote", "missing-costs", "missing-event-id"]) {
    const result = evaluate(makeFixture({kind}));
    assert.equal(result.outcome, "INVALID_EVIDENCE", kind);
    assert.ok(result.checks.some(check => check.id === "causal_quotes" && check.status === "FAIL"));
  }

  for (const kind of ["wrong-entry-price", "wrong-exit-gross", "wrong-exit-decimals"]) {
    const result = evaluate(makeFixture({kind}));
    assert.equal(result.outcome, "INVALID_EVIDENCE", kind);
    assert.ok(result.checks.some(check => check.id === "causal_quotes" && check.status === "FAIL"));
  }
});

test("accounting, entry-cutoff, and restart violations are not passed", () => {
  const accountingFixture = makeFixture();
  const alteredReport = JSON.parse(accountingFixture.artifact.report);
  alteredReport.valuation.cashCents = "99999";
  replaceArtifact(accountingFixture, "report", alteredReport);
  const accounting = evaluateSimulatedPilotEvidence(accountingFixture.artifact);
  assert.equal(accounting.outcome, "INVALID_EVIDENCE");

  const cutoff = evaluate(makeFixture({kind: "cutoff"}));
  assert.equal(cutoff.outcome, "INVALID_EVIDENCE");
  assert.ok(cutoff.checks.some(check => check.id === "exposure_and_daily_loss" && check.status === "FAIL"));

  for (const kind of ["authorization-request-mismatch", "authorization-decision-mismatch"]) {
    const invalidAuthorization = evaluate(makeFixture({kind}));
    assert.equal(invalidAuthorization.outcome, "INVALID_EVIDENCE", kind);
    assert.ok(invalidAuthorization.checks.some(check =>
      check.id === "exposure_and_daily_loss" && check.status === "FAIL"));
  }

  const zeroQuantity = evaluate(makeFixture({kind: "zero-quantity-fill"}));
  assert.equal(zeroQuantity.outcome, "INVALID_EVIDENCE");
  assert.ok(zeroQuantity.checks.some(check =>
    check.id === "causal_quotes" && check.status === "FAIL"));

  const restart = evaluate(makeFixture({restartStatus: "INCOMPLETE"}));
  assert.equal(restart.outcome, "INCOMPLETE_UNKNOWN");
  assert.ok(restart.checks.some(check => check.id === "restart_evidence" && check.status === "UNKNOWN"));

  const unsupportedRestart = evaluate(makeFixture({restartStatus: "VERIFIED"}));
  assert.equal(unsupportedRestart.outcome, "INCOMPLETE_UNKNOWN");
  assert.ok(unsupportedRestart.checks.some(check =>
    check.id === "restart_evidence" && check.status === "UNKNOWN"));

  const oversized = evaluate(makeFixture({kind: "oversize-entry"}));
  assert.equal(oversized.outcome, "INVALID_EVIDENCE");
  assert.ok(oversized.checks.some(check =>
    check.id === "exposure_and_daily_loss" && check.status === "FAIL"));

  const lossGate = evaluate(makeFixture({kind: "daily-loss-invalid"}));
  assert.equal(lossGate.outcome, "INVALID_EVIDENCE");
  assert.ok(lossGate.checks.some(check =>
    check.id === "exposure_and_daily_loss" && check.status === "FAIL"));
});

test("UNKNOWN terminal is not completion even with a durable checkpoint", () => {
  const fixture = makeFixture();
  const terminal = JSON.parse(fixture.artifact.terminal);
  terminal.status = "UNKNOWN";
  replaceArtifact(fixture, "terminal", terminal);
  const report = JSON.parse(fixture.artifact.report);
  report.experiment.reportStatus = "INCOMPLETE";
  report.experiment.endAt = null;
  replaceArtifact(fixture, "report", report);
  const result = evaluateSimulatedPilotEvidence(fixture.artifact);
  assert.equal(result.outcome, "INCOMPLETE_UNKNOWN");
  assert.equal(result.overall, "UNKNOWN");
  assert.equal(result.claims.activation, false);
});

test("missing terminal operation and stop receipts cannot be upgraded to completion", () => {
  const missingOperation = makeFixture();
  const terminal = JSON.parse(missingOperation.artifact.terminal);
  terminal.operations.shift();
  replaceArtifact(missingOperation, "terminal", terminal);
  assert.equal(evaluate(missingOperation).outcome, "INVALID_EVIDENCE");

  const missingStop = makeFixture();
  const terminalWithoutStop = JSON.parse(missingStop.artifact.terminal);
  terminalWithoutStop.stopEvidence = {status: "UNKNOWN"};
  replaceArtifact(missingStop, "terminal", terminalWithoutStop);
  assert.equal(evaluate(missingStop).outcome, "INVALID_EVIDENCE");

  const mismatchedTime = evaluate(makeFixture({kind: "finish-command-time-mismatch"}));
  assert.equal(mismatchedTime.outcome, "INVALID_EVIDENCE");
  assert.ok(mismatchedTime.checks.some(check =>
    check.id === "terminal_completion" && check.status === "FAIL"));
});

test("terminal inventory cannot hide an entry that has no matching exit receipt", () => {
  const result = evaluate(makeFixture({kind: "hidden-terminal-position"}));
  assert.equal(result.outcome, "INVALID_EVIDENCE");
  assert.ok(result.checks.some(check =>
    check.id === "fill_position_reconciliation" && check.status === "FAIL"));

  const quantityMismatch = evaluate(makeFixture({kind: "quantity-mismatch"}));
  assert.equal(quantityMismatch.outcome, "INVALID_EVIDENCE");
  assert.ok(quantityMismatch.checks.some(check =>
    check.id === "terminal_positions" && check.status === "FAIL"));
});

test("offline CLI emits its versioned JSON result and maps UNKNOWN to exit code 2", async t => {
  const complete = await runCli(t, makeFixture());
  assert.equal(complete.code, 0, complete.stderr);
  assert.equal(complete.signal, null);
  assert.equal(JSON.parse(complete.stdout).schema, "MEMECOIN_SIMULATED_PILOT_EVALUATION_V1");

  const unresolved = await runCli(t, makeFixture({kind: "unvalued"}));
  assert.equal(unresolved.code, 2, unresolved.stderr);
  assert.equal(JSON.parse(unresolved.stdout).outcome, "OPEN_UNVALUED_TERMINAL_POSITION");
});

test("CLI rejects a FIFO input without blocking", async t => {
  const result = await runCli(t, makeFixture(), {fifoCheckpoint: true});
  assert.equal(result.code, 2);
  assert.equal(result.signal, null);
});
