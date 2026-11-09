import {sha256} from "../spot-paper-pilot/core.mjs";
import {
  createCashControlArm, createChallengerArm, pairedConfigDigest,
  SPOT_PAPER_PAIRED,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR, SPOT_PAPER_PAIRED_SOURCE_ID,
  SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
  SPOT_PAPER_PAIRED_TREND_MODEL, SPOT_PAPER_RESEARCH_COMPARISON_ID
} from "./forward.mjs";
import {
  compareSpotPaperFeeScenarioObservations,
  applySpotPaperPairedFeeObservation
} from "./fee-scenario.mjs";

const HASH = /^[a-f0-9]{64}$/;

export function nextRunResearchSourceDigest({
  comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes
} = {}) {
  if (![comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes]
    .every(Buffer.isBuffer)) throw new Error("NEXT_RUN_SOURCE_BYTES_REQUIRED");
  const contents = [
    ["scripts/spot-paper-research/comparison.mjs", comparisonBytes],
    ["scripts/spot-paper-research/entry-confirmation.mjs", entryConfirmationBytes],
    ["scripts/spot-paper-research/five-minute-trend.mjs", fiveMinuteTrendBytes]
  ].sort(([left], [right]) => left.localeCompare(right));
  const parts = [];
  for (const [path, bytes] of contents) {
    parts.push(Buffer.from(path, "utf8"), Buffer.from([0]), bytes, Buffer.from([0]));
  }
  return sha256(Buffer.concat(parts));
}

function adapterFor(role, exports) {
  const expectedId = role === "baseline" ?
    SPOT_PAPER_PAIRED.challengerModel : SPOT_PAPER_PAIRED_TREND_MODEL;
  const valid = role === "baseline" ?
    exports?.SPOT_PAPER_ENTRY_CONFIRMATION_ID === expectedId &&
      typeof exports.createEntryConfirmationState === "function" &&
      typeof exports.advanceEntryConfirmation === "function" &&
      typeof exports.recordEntryConfirmationSell === "function" :
    exports?.SPOT_PAPER_5M_TREND_FILTER_ID === expectedId &&
      typeof exports.createFiveMinuteTrendState === "function" &&
      typeof exports.advanceFiveMinuteTrendEntry === "function" &&
      typeof exports.recordFiveMinuteTrendSell === "function" &&
      typeof exports.diagnoseFiveMinuteTrendActivity === "function";
  if (!valid) throw new Error(`${role.toUpperCase()}_STRATEGY_EXPORTS_REQUIRED`);
  const adapter = role === "baseline" ? {
    modelId: expectedId,
    createState: exports.createEntryConfirmationState,
    advance: exports.advanceEntryConfirmation,
    recordSell: exports.recordEntryConfirmationSell
  } : {
    modelId: expectedId,
    createState: exports.createFiveMinuteTrendState,
    advance: exports.advanceFiveMinuteTrendEntry,
    recordSell: exports.recordFiveMinuteTrendSell,
    diagnoseActivity: exports.diagnoseFiveMinuteTrendActivity
  };
  adapter.bridge = {
    SPOT_PAPER_ENTRY_CONFIRMATION_ID: SPOT_PAPER_PAIRED.challengerModel,
    createEntryConfirmationState: adapter.createState,
    advanceEntryConfirmation: adapter.advance,
    recordEntryConfirmationSell: adapter.recordSell
  };
  return adapter;
}

export function createSpotPaperPairedNextRunConfig({
  runId, dataRoot, sourceSha256, researchSourceSha256, provider,
  confirmationExports, trendExports, accountIds, testOnly = true,
  now, monotonicNow, sleep, signal, maxCycles, maxRequests, maxBytes,
  maxResponseBytes, maxDurationMs, pollIntervalMs, journalOptions
} = {}) {
  if (!HASH.test(sourceSha256 ?? "") || !HASH.test(researchSourceSha256 ?? "")) {
    throw new Error("FROZEN_IDENTITY_REQUIRED");
  }
  if (typeof testOnly !== "boolean") throw new Error("RUN_MODE_REQUIRED");
  const expectedSourceId = testOnly ? SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID :
    SPOT_PAPER_PAIRED_SOURCE_ID;
  if (provider?.sourceId !== expectedSourceId) throw new Error("PROVIDER_REQUIRED");
  if (!accountIds || ["baseline", "challenger", "cash"].some(role =>
    typeof accountIds[role] !== "string" || accountIds[role].length === 0) ||
    new Set(Object.values(accountIds)).size !== 3) {
    throw new Error("THREE_DISTINCT_ACCOUNT_IDS_REQUIRED");
  }
  const baselineAdapter = adapterFor("baseline", confirmationExports);
  const challengerAdapter = adapterFor("challenger", trendExports);
  const strategyAdapters = {
    baseline: baselineAdapter,
    challenger: challengerAdapter
  };
  const accountContract = SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT;
  const feeScenarioApply = applySpotPaperPairedFeeObservation;
  const feeScenarioCompare = observations =>
    compareSpotPaperFeeScenarioObservations(observations, {
      feeBpsPerSide: accountContract.feeBpsPerSide,
      strategyAdapters,
      modelIds: {
        baseline: baselineAdapter.modelId,
        challenger: challengerAdapter.modelId,
        cash: SPOT_PAPER_PAIRED.controlModel
      }
    });
  const arms = [
    createChallengerArm(baselineAdapter.bridge, accountIds.baseline,
      accountContract, feeScenarioApply,
      {role: "baseline", modelId: baselineAdapter.modelId}),
    createChallengerArm(challengerAdapter.bridge, accountIds.challenger,
      accountContract, feeScenarioApply,
      {role: "challenger", modelId: challengerAdapter.modelId}),
    createCashControlArm(accountIds.cash, accountContract)
  ];
  arms[0].strategyAdapter = baselineAdapter;
  arms[1].strategyAdapter = challengerAdapter;
  const config = {
    runId, dataRoot, sourceSha256, researchSourceSha256,
    configSha256: "0".repeat(64), accountContract, provider, arms,
    strategyAdapters,
    trendActivityDiagnostic: challengerAdapter.diagnoseActivity,
    modelPair: {
      id: SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
      models: [
        {role: "baseline", modelId: baselineAdapter.modelId},
        {role: "challenger", modelId: challengerAdapter.modelId},
        {role: "cash", modelId: SPOT_PAPER_PAIRED.controlModel}
      ]
    },
    comparisonEngine: {
      id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
      compare: feeScenarioCompare
    },
    feeScenarioApply, feeScenarioCompare, testOnly,
    ...(now ? {now} : {}),
    ...(monotonicNow ? {monotonicNow} : {}),
    ...(sleep ? {sleep} : {}),
    ...(signal ? {signal} : {}),
    ...(maxCycles === undefined ? {} : {maxCycles}),
    ...(maxRequests === undefined ? {} : {maxRequests}),
    ...(maxBytes === undefined ? {} : {maxBytes}),
    ...(maxResponseBytes === undefined ? {} : {maxResponseBytes}),
    ...(maxDurationMs === undefined ? {} : {maxDurationMs}),
    ...(pollIntervalMs === undefined ? {} : {pollIntervalMs}),
    ...(journalOptions ? {journalOptions} : {})
  };
  config.configSha256 = pairedConfigDigest(config);
  return config;
}
