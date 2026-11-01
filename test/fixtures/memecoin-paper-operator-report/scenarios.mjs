const START = Date.parse("2026-01-01T10:00:00.000Z");
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const MINT = "So11111111111111111111111111111111111111112";
const POOL = "11111111111111111111111111111112";
const OTHER_POOL = "11111111111111111111111111111113";
const QUOTE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const COSTS_ZERO = Object.fromEntries([
  "feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"
].map(key => [key, "0"]));

function ledgerSummary({
  cashCents = "92000",
  realizedGrossCents = "50",
  realizedNetCents = "30",
  unrealizedGrossCents = "-999",
  unrealizedNetCents = "-999",
  costs = null,
  openPositions = null
} = {}) {
  return {
    runId: "operator-fixture-run",
    initialCapitalCents: "100000",
    cashCents,
    pnl: {realizedGrossCents, realizedNetCents, unrealizedGrossCents, unrealizedNetCents},
    costs: costs ?? {
      entry: {feeCents: "10", spreadCents: "2", slippageCents: "3", priceImpactCents: "4", networkCents: "5"},
      exit: {feeCents: "1", spreadCents: "1", slippageCents: "1", priceImpactCents: "1", networkCents: "1"}
    },
    lastKnownEquityCents: null,
    openPositions: openPositions ?? [{
      mint: MINT,
      tokenAtoms: "10000000",
      decimals: 6,
      entryCostCents: "8000",
      entryNotionalCents: "7980",
      entryCostsCents: COSTS_ZERO,
      stopPriceMicros: "9400",
      trailingActive: false,
      highWaterPriceMicros: "10000"
    }],
    eventCount: 3,
    auditTruncated: false,
    restartDisposition: "UNRECOVERABLE_FAIL_CLOSED",
    executionRealistic: false
  };
}

function replay({
  filterStatus = "PASS",
  filterReason = null,
  analysisStatus = "PASS",
  fill = {status: "FILLED_PAPER", allInCents: "8000"},
  runEndStatus = "FINISHED",
  markStatus = "MARKED",
  cashCents = "92000",
  realizedGrossCents = "50",
  realizedNetCents = "30",
  costs = null,
  accounting = {
    cashCents: "92000",
    grossOpenValueCents: "7990",
    estimatedExitCostsCents: "20",
    grossUnrealizedPnlCents: "0",
    netUnrealizedPnlCents: "-20",
    realizedGrossPnlCents: "50",
    realizedNetPnlCents: "30",
    reconciliation: "equity = cash + gross open value - estimated exit costs"
  },
  positions = ledgerSummary().openPositions,
  extraAudit = []
} = {}) {
  const endAt = START + EIGHT_HOURS;
  const selected = {
    stage: "Scout",
    status: "SELECTED",
    mint: MINT,
    selectedPool: POOL,
    quote: QUOTE,
    chainId: "solana",
    sampledAt: new Date(START).toISOString(),
    source: "SYNTHETIC_FIXTURE_ONLY"
  };
  const duplicate = {
    stage: "Scout",
    status: "REJECT",
    reason: "duplicate mint; selected pool evidence is not mixed",
    mint: MINT,
    selectedPool: POOL,
    duplicatePool: OTHER_POOL,
    source: "SYNTHETIC_FIXTURE_ONLY"
  };
  const checkStatus = filterStatus === "PASS" ? "PASS" : filterStatus;
  const report = {
    reportType: "SYNTHETIC_FIXTURE_REPLAY_ONLY",
    source: "SYNTHETIC_FIXTURE_ONLY",
    networkAccessed: false,
    liveCandidateEvidence: false,
    discovery: {
      source: "SYNTHETIC_FIXTURE_ONLY",
      observedRecords: 2,
      truncated: false,
      exhaustive: false
    },
    filters: {
      status: filterStatus,
      accepted: filterStatus === "PASS",
      checks: {
        liquidity: {
          status: checkStatus,
          reason: filterReason ?? (checkStatus === "PASS" ? "threshold satisfied" : "liquidity evidence unavailable"),
          source: "SYNTHETIC_FIXTURE_ONLY",
          observedAt: new Date(START).toISOString()
        }
      }
    },
    analysis: {
      status: analysisStatus,
      components: {
        momentum15m: {
          status: analysisStatus === "PASS" ? "PASS" : "UNKNOWN",
          reason: analysisStatus === "PASS" ? "evidence available" : "score evidence unavailable",
          source: "SYNTHETIC_FIXTURE_ONLY",
          observedAt: new Date(START).toISOString()
        }
      }
    },
    realDataPreparation: {status: "BLOCKED"},
    simulatedFill: fill,
    runEnd: {
      status: runEndStatus,
      entriesAllowed: false,
      elapsedMs: EIGHT_HOURS,
      openPositions: positions.map(position => ({mint: position.mint, markStatus})),
      equityCents: accounting ? "99970" : null,
      accounting,
      note: "Open positions are not liquidated at run end; no end-of-run fill is invented."
    },
    ledger: ledgerSummary({cashCents, realizedGrossCents, realizedNetCents, costs, openPositions: positions}),
    audit: [
      selected,
      duplicate,
      {type: "RUN_FINISHED", observedAt: new Date(endAt).toISOString(), openMints: positions.map(item => item.mint)},
      ...extraAudit
    ],
    auditTruncated: false
  };
  if (!accounting) {
    report.ledger.pnl.unrealizedGrossCents = "123456";
    report.ledger.pnl.unrealizedNetCents = "123456";
  }
  return report;
}

function checkpoint({
  results = [],
  positions = [],
  cashCents = "100000",
  realizedNetCents = "0",
  clockAdmissionBlocked = false
} = {}) {
  const metadata = {
    runId: "operator-fixture-run",
    startedAt: START,
    deadlineAt: START + EIGHT_HOURS,
    sequence: results.length,
    hash: "a".repeat(64),
    policyVersion: "fixture-v1",
    clockMode: clockAdmissionBlocked ? "external" : undefined,
    clockAdmissionBlocked
  };
  if (metadata.clockMode === undefined) delete metadata.clockMode;
  return {
    reportType: "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY",
    source: "SYNTHETIC_FIXTURE_ONLY",
    networkAccessed: false,
    liveCandidateEvidence: false,
    metadata,
    results,
    snapshot: {
      summary: ledgerSummary({
        cashCents,
        realizedGrossCents: realizedNetCents,
        realizedNetCents,
        unrealizedGrossCents: null,
        unrealizedNetCents: null,
        costs: {entry: {...COSTS_ZERO}, exit: {...COSTS_ZERO}},
        openPositions: positions
      }),
      auditEvents: []
    }
  };
}

function receipt(commandId, method, result) {
  return {commandId, method, result, resultDigest: "b".repeat(64)};
}

function emptyPosition() {
  return [];
}

export const reportFixtures = Object.freeze({
  positiveReplay: () => replay(),
  negativeReplay: () => replay({
    fill: {status: "FILLED_PAPER", allInCents: "8000"},
    accounting: {
      cashCents: "92000",
      grossOpenValueCents: "7500",
      estimatedExitCostsCents: "40",
      grossUnrealizedPnlCents: "-480",
      netUnrealizedPnlCents: "-520",
      realizedGrossPnlCents: "-123",
      realizedNetPnlCents: "-145",
      reconciliation: "fixture supplied totals"
    },
    positions: ledgerSummary().openPositions.map(position => ({...position, entryCostCents: "8000"})),
    realizedGrossCents: "-123",
    realizedNetCents: "-145"
  }),
  zeroTradeReplay: () => replay({
    filterStatus: "REJECT",
    filterReason: "liquidity is below the documented threshold",
    analysisStatus: "UNKNOWN",
    fill: null,
    accounting: {
      cashCents: "100000",
      grossOpenValueCents: "0",
      estimatedExitCostsCents: "0",
      grossUnrealizedPnlCents: "0",
      netUnrealizedPnlCents: "0",
      realizedGrossPnlCents: "0",
      realizedNetPnlCents: "0",
      reconciliation: "fixture supplied totals"
    },
    cashCents: "100000",
    realizedGrossCents: "0",
    realizedNetCents: "0",
    costs: {entry: {...COSTS_ZERO}, exit: {...COSTS_ZERO}},
    positions: emptyPosition(),
    markStatus: "MARKED",
    extraAudit: []
  }),
  blockedScan: () => replay({
    filterStatus: "UNKNOWN",
    filterReason: "required liquidity evidence is unavailable",
    analysisStatus: "UNKNOWN",
    fill: null,
    accounting: {
      cashCents: "100000",
      grossOpenValueCents: "0",
      estimatedExitCostsCents: "0",
      grossUnrealizedPnlCents: "0",
      netUnrealizedPnlCents: "0",
      realizedGrossPnlCents: "0",
      realizedNetPnlCents: "0",
      reconciliation: "fixture supplied totals"
    },
    cashCents: "100000",
    realizedGrossCents: "0",
    realizedNetCents: "0",
    costs: {entry: {...COSTS_ZERO}, exit: {...COSTS_ZERO}},
    positions: emptyPosition()
  }),
  missingMarksReplay: () => replay({
    accounting: null,
    markStatus: "VALUATION_UNAVAILABLE"
  }),
  incompleteReplay: () => {
    const report = replay({fill: null});
    delete report.runEnd;
    return report;
  },
  unresolvedExit: () => {
    const position = ledgerSummary().openPositions[0];
    const baseTime = new Date(START).toISOString();
    const end = {
      status: "FINISHED",
      entriesAllowed: false,
      elapsedMs: 60 * 60 * 1000,
      openPositions: [{mint: MINT, markStatus: "VALUATION_UNAVAILABLE"}],
      equityCents: null,
      accounting: null,
      note: "Open position remains unresolved; no terminal fill is inferred."
    };
    const results = [
      receipt("fixture:authorize", "authorizeEntry", {
        status: "AUTHORIZED", mint: MINT, chainId: "solana", pool: POOL,
        quote: QUOTE, sampledAt: baseTime, authorizedAt: baseTime
      }),
      receipt("fixture:entry", "executeEntry", {
        status: "FILLED_PAPER", eventId: "fixture-entry", mint: MINT, allInCents: "8000"
      }),
      receipt("fixture:exit", "observeExitQuote", {
        status: "UNFILLED", reason: "later identity-bound executable exit quote is unavailable"
      }),
      receipt("fixture:finish", "finishRun", end)
    ];
    return checkpoint({results, positions: [position], cashCents: "92000", realizedNetCents: "0"});
  },
  clockFault: () => checkpoint({
    clockAdmissionBlocked: true,
    results: [receipt("fixture:clock", "riskSnapshot", {
      status: "REJECT", reason: "CLOCK_FAULT_LATCHED", entriesAllowed: false, reservedPositions: 1
    })]
  }),
  restartStop: () => checkpoint({
    clockAdmissionBlocked: true,
    results: [receipt("fixture:restart", "riskSnapshot", {
      status: "REJECT", reason: "CLOCK_RESTART_BLOCKED", entriesAllowed: false, reservedPositions: 0
    })]
  }),
  receipt,
  checkpoint
});
