import {SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA} from
  '../../scripts/spot-paper-paired-report/contract.mjs';

const LEGACY_MODELS = [
  {role: 'baseline', modelId: 'BTC_EUR_SMA5_SMA20_V1', accountId: 'base-account'},
  {role: 'challenger', modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1',
    accountId: 'challenger-account'},
  {role: 'cash', modelId: 'CASH_CONTROL_V1', accountId: 'cash-account'}
];
const NEXT_MODELS = [
  {role: 'baseline', modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1',
    accountId: 'base-account'},
  {role: 'challenger',
    modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1',
    accountId: 'challenger-account'},
  {role: 'cash', modelId: 'CASH_CONTROL_V1', accountId: 'cash-account'}
];
const NEXT_PAIR_ID = 'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1';
const NEXT_FEES = {
  feeBpsPerSide: 20,
  slippageBpsPerSide: 10,
  ratesVerified: false,
  accountContractId: 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2',
  accountContractVersion: 2,
  feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION',
  feeSource: 'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea',
  feeAsOf: '2026-11-09',
  accountTier: 'UNKNOWN',
  accountingEngine: 'PAIRED_FEE_SCENARIO_LEDGER_V1'
};

function arm(models, role, {fills = [], equity = 100_000, fees = 0, slippage = 0,
  turnover = 0, exposure = 0, drawdown = 0, stoppedAt = null,
  stopReason = null} = {}) {
  const model = models.find(item => item.role === role);
  return {
    role,
    modelId: model.modelId,
    accountId: model.accountId,
    tradingStatus: stoppedAt === null ? 'ACTIVE' : 'STOPPED',
    stoppedAt,
    stopReason,
    decisions: Array.from({length: 480}, (_, index) => ({
      decision: null, decidedAt: 1_000 + (index + 1) * 60_000 - 2
    })),
    riskStates: Array.from({length: 480}, (_, index) =>
      stoppedAt !== null && index === 479 ? {stopReason, stoppedAt} : {}),
    fills,
    valuation: {
      startingCapitalCents: 100_000,
      netEquityCents: equity,
      markedEquityCents: equity,
      feesCents: fees,
      slippageCents: slippage,
      modeledCostsCents: fees + slippage,
      turnoverCents: turnover,
      exposureCents: exposure,
      sampledDrawdownCents: drawdown,
      unresolvedObservations: 0,
      openPositions: [],
      markAgeMs: null
    }
  };
}

export function syntheticPairedEvaluatorFixture({modelPair = false} = {}) {
  const models = structuredClone(modelPair ? NEXT_MODELS : LEGACY_MODELS);
  const expectedIdentity = {
    schemaVersion: SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA,
    runId: modelPair ? 'paired-trend-synthetic-001' : 'paired-synthetic-001',
    pair: 'BTC/EUR',
    sourceSha256: '1'.repeat(64),
    configSha256: '2'.repeat(64),
    researchSourceSha256: '3'.repeat(64),
    feedSourceId: 'SYNTHETIC_TEST_ONLY',
    comparisonEngineId: 'SPOT_PAPER_SMA_COMPARISON_V1',
    ...(modelPair ? {modelPairId: NEXT_PAIR_ID} : {}),
    models
  };
  const baselineFee = modelPair ? 20 : 50;
  const baselineFees = baselineFee * 2;
  const baselineEquity = 100_000 - baselineFees;
  const arms = [
    arm(models, 'baseline', {
      fills: [
        {side: 'BUY', grossCents: 10_000, feeCents: baselineFee, executionAt: 61_000},
        {side: 'SELL', grossCents: 10_000, feeCents: baselineFee, executionAt: 61_000}
      ],
      equity: baselineEquity,
      fees: baselineFees,
      slippage: 20,
      turnover: 20_000,
      drawdown: 200,
      stoppedAt: 28_750_000,
      stopReason: 'SESSION_LOSS_LIMIT'
    }),
    arm(models, 'challenger', {equity: 99_500, drawdown: 500}),
    arm(models, 'cash', {})
  ];
  const assumptions = modelPair ? structuredClone(NEXT_FEES) : {
    feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false
  };
  const report = {
    schemaVersion: 'SPOT_PAPER_PAIRED_REPORT_V1',
    runId: expectedIdentity.runId,
    pair: expectedIdentity.pair,
    models: structuredClone(models),
    comparisonEngineId: expectedIdentity.comparisonEngineId,
    feedSourceId: expectedIdentity.feedSourceId,
    sourceSha256: expectedIdentity.sourceSha256,
    configSha256: expectedIdentity.configSha256,
    researchSourceSha256: expectedIdentity.researchSourceSha256,
    ...(modelPair ? {
      modelPairId: NEXT_PAIR_ID,
      trendActivityDiagnostic: {
        schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
        status: 'PARTIAL_COVERAGE',
        completedRoundTripCount: 0,
        requiredCompletedRoundTrips: 5,
        observedCoverageMs: 28_800_000,
        requiredCoverageMs: 86_400_000,
        completeWindow: false,
        forcedTrades: false,
        deadlineExtensionAllowed: false,
        profitability: 'NOT_ASSESSED'
      }
    } : {}),
    integrationStatus: 'SYNTHETIC_ONLY',
    outcome: 'COMPLETED_BOUNDED',
    stopReason: 'CYCLE_LIMIT',
    startedAt: 1_000,
    endedAt: 28_801_000,
    elapsedMs: 28_800_000,
    wallClockElapsedMs: 28_800_000,
    failureReason: null,
    fullEightHourCompletion: false,
    coverage: 'CONFIGURED_DURATION_REACHED',
    cycles: 480,
    requests: 960,
    deliveredBytes: 1_000,
    commonHorizon: {
      available: true, quoteReceivedAt: 28_801_000, effectAt: 28_801_000
    },
    assumptions,
    arms,
    comparison: {
      schemaVersion: 'SPOT_PAPER_SMA_COMPARISON_V1',
      status: 'COMPARISON_AVAILABLE',
      commonHorizonAt: 28_801_000,
      arms: {
        baseline: {
          strategyId: models[0].modelId, valuationAt: 28_801_000,
          finalNetEquityCents: baselineEquity, fillCount: 2,
          feesCents: baselineFees, grossTurnoverCents: 20_000
        },
        challenger: {
          strategyId: models[1].modelId, valuationAt: 28_801_000,
          finalNetEquityCents: 99_500, fillCount: 0, feesCents: 0,
          grossTurnoverCents: 0
        },
        cash: {
          strategyId: 'CASH_NO_TRADE', valuationAt: 28_801_000,
          finalNetEquityCents: 100_000, fillCount: 0, feesCents: 0,
          grossTurnoverCents: 0
        }
      }
    },
    testOnly: true,
    liveTrading: false,
    executionImpact: false,
    autoPromotion: false
  };
  const manifest = {
    schemaVersion: 'SPOT_PAPER_PAIRED_MANIFEST_V1',
    runId: expectedIdentity.runId,
    startedAt: report.startedAt,
    mode: 'paper',
    pair: expectedIdentity.pair,
    feedSourceId: expectedIdentity.feedSourceId,
    sourceSha256: expectedIdentity.sourceSha256,
    configSha256: expectedIdentity.configSha256,
    researchSourceSha256: expectedIdentity.researchSourceSha256,
    models: structuredClone(models),
    comparisonEngineId: expectedIdentity.comparisonEngineId,
    ...(modelPair ? {modelPairId: NEXT_PAIR_ID} : {}),
    assumptions: structuredClone(assumptions),
    limits: {
      maxCycles: 480, maxRequests: 960,
      maxBytes: 64 * 1024 * 1024, maxResponseBytes: 256 * 1024,
      maxDurationMs: 28_800_000, requestTimeoutMs: 5_000,
      pollIntervalMs: 60_000
    }
  };
  const events = [
    {id: 'paired-start', type: 'start', at: report.startedAt},
    ...Array.from({length: report.cycles}, (_, index) => {
      const observedAt = report.startedAt + (index + 1) * 60_000;
      return {
        id: `shared:${index + 1}:${'b'.repeat(64)}`,
        type: 'shared_observation',
        cycle: index + 1,
        decisionAt: observedAt - 2,
        effectAt: observedAt,
        observedAt,
        ohlc: {
          path: `responses/${'a'.repeat(64)}.json`,
          sha256: 'a'.repeat(64), bytes: 100,
          requestStartedAt: observedAt - 10_000,
          receivedAt: observedAt - 100
        },
        ticker: {
          path: `responses/${'b'.repeat(64)}.json`,
          sha256: 'b'.repeat(64), bytes: 100,
          requestStartedAt: observedAt - 1,
          receivedAt: observedAt
        },
        decisions: models.map(model => ({
          role: model.role, decidedAt: observedAt - 2,
          decision: null, skippedReason: null, metadata: null
        })),
        fills: models.map((model, roleIndex) => ({
          role: model.role,
          fills: index === 0 ? structuredClone(arms[roleIndex].fills) : []
        })),
        riskStates: models.map((model, roleIndex) => ({
          role: model.role,
          state: {},
          stopReason: arms[roleIndex].riskStates[index].stopReason ?? null,
          stoppedAt: arms[roleIndex].riskStates[index].stoppedAt ?? null,
          skipped: false
        })),
        valuations: models.map(model => ({role: model.role}))
      };
    }),
    {id: 'paired-terminal', type: 'terminal', at: report.endedAt,
      report: structuredClone(report)}
  ];
  const journal = {
    schemaVersion: 'SPOT_PAPER_PILOT_JOURNAL_V1',
    runId: expectedIdentity.runId,
    manifest,
    createdAt: report.startedAt,
    sequence: events.length,
    checkpoint: {
      cycle: report.cycles,
      stopReason: report.stopReason,
      counters: {requests: report.requests, bytes: report.deliveredBytes}
    },
    events,
    reconciliationStatus: 'READ_ONLY_VERIFIED'
  };
  return {expectedIdentity, report, journal};
}
