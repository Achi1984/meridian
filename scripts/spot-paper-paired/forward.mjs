import { readFile } from "node:fs/promises";
import { createRunJournal } from "../spot-paper-pilot/journal.mjs";
import {
  advanceStrategy, applyPaperObservation, createLedger, createStrategyState,
  parseKrakenOhlc, parseKrakenTicker, sha256, SPOT_PAPER_PILOT_LIMITS,
  SPOT_PAPER_PILOT_VERSION
} from "../spot-paper-pilot/core.mjs";

const MAX_RESEARCH_SOURCE_BYTES = 1024 * 1024;
const PAIRED_TRANSPORT_FAILURE = Symbol("pairedTransportFailure");
const PAIRED_TRANSPORT_DIAGNOSTIC_SCHEMA =
  "SPOT_PAPER_PAIRED_TRANSPORT_DIAGNOSTIC_V1";
const SAFE_FAILURE_REASONS = new Set([
  "REQUEST_TIMEOUT", "REQUEST_ABORTED", "REQUEST_BUDGET_EXHAUSTED",
  "REQUEST_LIMIT", "DURATION_LIMIT", "RUN_BYTE_LIMIT", "RESPONSE_BYTE_LIMIT",
  "EMPTY_HTTP_BODY", "TRUNCATED_HTTP_BODY", "INVALID_CONTENT_TYPE",
  "INVALID_RESPONSE_HEADERS", "INVALID_RESPONSE_URL", "INVALID_JSON_RESPONSE",
  "HTTP_ERROR", "CLOCK_MOVED_BACKWARDS", "INVALID_CLOCK", "STALE_OHLC",
  "INVALID_OHLC", "INVALID_TICKER", "INVALID_ACQUISITION",
  "PROVIDER_COUNTER_MISMATCH", "OBSERVATION_OUT_OF_ORDER",
  "DECISION_PRECEDES_OBSERVATION", "TICKER_PREDATES_DECISION",
  "TICKER_NOT_CAUSAL", "NON_CAUSAL_FILL", "NON_CAUSAL_RISK_FILL",
  "CLOCK_ERROR"
]);

export const SPOT_PAPER_PAIRED = Object.freeze({
  pair: "BTC/EUR",
  baselineModel: SPOT_PAPER_PILOT_VERSION,
  challengerModel: "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
  controlModel: "CASH_CONTROL_V1",
  initialCashCents: 100_000,
  maxEntryCents: 10_000,
  maxDurationMs: 8 * 60 * 60 * 1000,
  maxCycles: 480,
  maxRequests: 960,
  maxBytes: SPOT_PAPER_PILOT_LIMITS.maxBytes,
  maxResponseBytes: SPOT_PAPER_PILOT_LIMITS.maxResponseBytes,
  requestTimeoutMs: SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs,
  maxQuoteAgeMs: SPOT_PAPER_PILOT_LIMITS.maxQuoteAgeMs,
  maxCandleAgeMs: SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs,
  pollIntervalMs: SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs,
  feeBpsPerSide: SPOT_PAPER_PILOT_LIMITS.feeBpsPerSide,
  slippageBpsPerSide: SPOT_PAPER_PILOT_LIMITS.slippageBpsPerSide,
  stopLossBps: SPOT_PAPER_PILOT_LIMITS.stopLossBps,
  maxSessionLossCents: SPOT_PAPER_PILOT_LIMITS.maxSessionLossCents
});

export const SPOT_PAPER_PAIRED_INTEGRATION =
  "BLOCKED_PENDING_MERIDIAN_1299_ACCEPTED_EXPORTS";
export const SPOT_PAPER_PAIRED_PINNED_INTEGRATION =
  "PINNED_RESEARCH_EXPORTS_HOST_NOT_ACCEPTED";
export const SPOT_PAPER_RESEARCH_COMPARISON_ID = "SPOT_PAPER_SMA_COMPARISON_V1";
export const SPOT_PAPER_PAIRED_SOURCE_ID = "KRAKEN_PUBLIC_SPOT_XBTEUR";
export const SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID = "SYNTHETIC_TEST_ONLY";
export const SPOT_PAPER_PAIRED_TREND_MODEL =
  "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1";
export const SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR =
  "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1";
export const SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256 =
  "4c60b1ccccbd495d93006a6838593423c27caac8104a0239fa23fd97a716f82d";
export const SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256 =
  "dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25";
export const SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT = Object.freeze({
  initialCashCents: SPOT_PAPER_PAIRED.initialCashCents,
  maxEntryCents: SPOT_PAPER_PAIRED.maxEntryCents,
  feeBpsPerSide: SPOT_PAPER_PAIRED.feeBpsPerSide,
  slippageBpsPerSide: SPOT_PAPER_PAIRED.slippageBpsPerSide,
  stopLossBps: SPOT_PAPER_PAIRED.stopLossBps,
  maxSessionLossCents: SPOT_PAPER_PAIRED.maxSessionLossCents
});

export const SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT = Object.freeze({
  contractId: "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2",
  version: 2,
  ...SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT,
  feeBpsPerSide: 20,
  feeBasis: "EEA_SPOT_ONLY_TAKER_ASSUMPTION",
  feeSource: "https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea",
  feeAsOf: "2026-11-09",
  accountTier: "UNKNOWN",
  accountingEngine: "PAIRED_FEE_SCENARIO_LEDGER_V1"
});
export const SPOT_PAPER_PAIRED_ACCOUNT_CONTRACTS = Object.freeze({
  BTC_EUR_PAIRED_PAPER_V1: SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT,
  [SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId]:
    SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT
});

export function resolveSpotPaperPairedAccountContract(contractId) {
  if (!Object.hasOwn(SPOT_PAPER_PAIRED_ACCOUNT_CONTRACTS, contractId)) {
    throw new Error("UNKNOWN_ACCOUNT_CONTRACT");
  }
  const contract = SPOT_PAPER_PAIRED_ACCOUNT_CONTRACTS[contractId];
  return contract;
}

function accountAssumptions(accountContract) {
  return {
    feeBpsPerSide: accountContract.feeBpsPerSide,
    slippageBpsPerSide: accountContract.slippageBpsPerSide,
    ratesVerified: false,
    ...(accountContract.version ? {
      accountContractId: accountContract.contractId,
      accountContractVersion: accountContract.version,
      feeBasis: accountContract.feeBasis,
      feeSource: accountContract.feeSource,
      feeAsOf: accountContract.feeAsOf,
      accountTier: accountContract.accountTier,
      accountingEngine: accountContract.accountingEngine
    } : {})
  };
}

export function pairedConfigDigest(config) {
  const accountContract = config.accountContract ?? SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT;
  const identity = {
    pair: SPOT_PAPER_PAIRED.pair,
    feedSourceId: config.provider.sourceId,
    researchSourceSha256: config.researchSourceSha256,
    arms: config.arms.map(({ role, modelId, accountId }) => ({
      role, modelId, accountId
    })),
    accountContract,
    comparisonEngineId: config.comparisonEngine.id,
    ...(config.modelPair ? {modelPairId: config.modelPair.id} : {}),
    limits: {
      maxCycles: config.maxCycles ?? SPOT_PAPER_PAIRED.maxCycles,
      maxRequests: config.maxRequests ?? SPOT_PAPER_PAIRED.maxRequests,
      maxBytes: config.maxBytes ?? SPOT_PAPER_PAIRED.maxBytes,
      maxResponseBytes: config.maxResponseBytes ?? SPOT_PAPER_PAIRED.maxResponseBytes,
      maxDurationMs: config.maxDurationMs ?? SPOT_PAPER_PAIRED.maxDurationMs,
      requestTimeoutMs: config.requestTimeoutMs ?? SPOT_PAPER_PAIRED.requestTimeoutMs,
      pollIntervalMs: config.pollIntervalMs ?? SPOT_PAPER_PAIRED.pollIntervalMs
    },
    assumptions: {
      feeBpsPerSide: accountContract.feeBpsPerSide,
      slippageBpsPerSide: accountContract.slippageBpsPerSide
    }
  };
  return sha256(Buffer.from(JSON.stringify(identity), "utf8"));
}

export function pairedResearchSourceDigest({ comparisonBytes, entryConfirmationBytes }) {
  if (!Buffer.isBuffer(comparisonBytes) || !Buffer.isBuffer(entryConfirmationBytes)) {
    throw new Error("RESEARCH_SOURCE_BYTES_REQUIRED");
  }
  const contents = [
    ["scripts/spot-paper-research/comparison.mjs", comparisonBytes],
    ["scripts/spot-paper-research/entry-confirmation.mjs", entryConfirmationBytes]
  ].sort(([left], [right]) => left.localeCompare(right));
  const parts = [];
  for (const [path, bytes] of contents) {
    parts.push(Buffer.from(path, "utf8"), Buffer.from([0]), bytes, Buffer.from([0]));
  }
  return sha256(Buffer.concat(parts));
}

const isRecord = value => value !== null && typeof value === "object" &&
  !Array.isArray(value);
const fingerprint = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function validateJson(value, code) {
  try {
    const encoded = JSON.stringify(value);
    assert(encoded !== undefined, code);
    JSON.parse(encoded);
  } catch {
    throw new Error(code);
  }
}

function validateConfig(config) {
  assert(isRecord(config), "CONFIG_REQUIRED");
  config.accountContract = config.accountContract ??
    SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT;
  assert(Object.values(SPOT_PAPER_PAIRED_ACCOUNT_CONTRACTS).some(contract =>
    same(contract, config.accountContract)), "INVALID_ACCOUNT_CONTRACT");
  assert(typeof config.runId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(config.runId), "INVALID_RUN_ID");
  assert(typeof config.dataRoot === "string" && config.dataRoot.trim(), "DATA_ROOT_REQUIRED");
  assert(fingerprint(config.sourceSha256) && fingerprint(config.researchSourceSha256) &&
    fingerprint(config.configSha256),
    "FROZEN_IDENTITY_REQUIRED");
  for (const [field, fallback, maximum] of [
    ["maxCycles", SPOT_PAPER_PAIRED.maxCycles, SPOT_PAPER_PAIRED.maxCycles],
    ["maxRequests", SPOT_PAPER_PAIRED.maxRequests, SPOT_PAPER_PAIRED.maxRequests],
    ["maxBytes", SPOT_PAPER_PAIRED.maxBytes, SPOT_PAPER_PAIRED.maxBytes],
    ["maxResponseBytes", SPOT_PAPER_PAIRED.maxResponseBytes,
      SPOT_PAPER_PAIRED.maxResponseBytes],
    ["maxDurationMs", SPOT_PAPER_PAIRED.maxDurationMs, SPOT_PAPER_PAIRED.maxDurationMs],
    ["requestTimeoutMs", SPOT_PAPER_PAIRED.requestTimeoutMs,
      SPOT_PAPER_PAIRED.requestTimeoutMs],
    ["pollIntervalMs", SPOT_PAPER_PAIRED.pollIntervalMs, SPOT_PAPER_PAIRED.maxDurationMs]
  ]) {
    const value = config[field] ?? fallback;
    assert(Number.isSafeInteger(value) && value > 0 && value <= maximum,
      `INVALID_${field.toUpperCase()}`);
    config[field] = value;
  }
  assert(config.maxRequests >= 2 && config.pollIntervalMs >= SPOT_PAPER_PAIRED.pollIntervalMs,
    "INVALID_RUN_BOUNDS");
  return {
    ...config,
    now: config.now ?? Date.now,
    monotonicNow: config.monotonicNow ?? (() => performance.now()),
    sleep: config.sleep ?? ((ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("ABORTED"));
      let timer;
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("ABORTED"));
      };
      timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }))
  };
}

function validateBindings(config, testOnly) {
  const expectedSource = testOnly ? SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID :
    SPOT_PAPER_PAIRED_SOURCE_ID;
  assert(config.provider?.sourceId === expectedSource &&
    typeof config.provider.fetchOhlc === "function" &&
    typeof config.provider.fetchTicker === "function" &&
    typeof config.provider.counters === "function", "PROVIDER_REQUIRED");
  const providerCounters = config.provider.counters();
  assert(providerCounters?.requests === 0 && providerCounters?.bytes === 0,
    "PROVIDER_ALREADY_USED");
  assert(Array.isArray(config.arms) && config.arms.length === 3, "THREE_ARMS_REQUIRED");
  const nextRun = config.modelPair?.id === SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR;
  assert(!config.modelPair || nextRun, "UNKNOWN_MODEL_PAIR");
  if (nextRun) {
    assert(config.accountContract.contractId ===
      SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId &&
      config.accountContract.feeBpsPerSide === 20 &&
      config.accountContract.slippageBpsPerSide === 10,
    "NEXT_RUN_ACCOUNT_CONTRACT_REQUIRED");
  }
  const expected = nextRun ? [
    ["baseline", SPOT_PAPER_PAIRED.challengerModel],
    ["challenger", SPOT_PAPER_PAIRED_TREND_MODEL],
    ["cash", SPOT_PAPER_PAIRED.controlModel]
  ] : [
    ["baseline", SPOT_PAPER_PAIRED.baselineModel],
    ["challenger", SPOT_PAPER_PAIRED.challengerModel],
    ["cash", SPOT_PAPER_PAIRED.controlModel]
  ];
  if (nextRun) {
    assert(Array.isArray(config.modelPair.models) &&
      same(config.modelPair.models, expected.map(([role, modelId]) => ({
        role, modelId
      }))), "MODEL_PAIR_IDENTITY_MISMATCH");
  }
  const accounts = new Set();
  for (let index = 0; index < expected.length; index++) {
    const [role, model] = expected[index];
    const arm = config.arms[index];
    assert(arm?.role === role && arm.modelId === model &&
      typeof arm.accountId === "string" && arm.accountId.length > 0 &&
      typeof arm.initialize === "function" && typeof arm.decide === "function" &&
      typeof arm.apply === "function" && typeof arm.summarize === "function" &&
      (config.accountContract.version !== 2 || role === "cash" ||
        arm.feeApply === config.feeScenarioApply) &&
      (!nextRun || arm.strategyAdapter === config.strategyAdapters?.[role]) &&
      same(arm.accountContract, config.accountContract),
    `INVALID_${role.toUpperCase()}_BINDING`);
    assert(!accounts.has(arm.accountId), "CONFLICTING_ACCOUNTS");
    accounts.add(arm.accountId);
  }
  const comparisonBindingValid = config.accountContract.version === 2 ?
    config.comparisonEngine?.compare === config.feeScenarioCompare :
    config.comparisonEngine?.compare ===
      config.comparisonExports?.compareSpotPaperStrategies;
  assert(config.comparisonEngine?.id === SPOT_PAPER_RESEARCH_COMPARISON_ID &&
    typeof config.comparisonEngine.compare === "function" &&
    comparisonBindingValid,
  "RESEARCH_COMPARISON_ENGINE_REQUIRED");
  if (nextRun) {
    for (const role of ["baseline", "challenger"]) {
      const adapter = config.strategyAdapters?.[role];
      assert(adapter?.modelId === expected.find(item => item[0] === role)?.[1] &&
        typeof adapter.createState === "function" &&
        typeof adapter.advance === "function" &&
        typeof adapter.recordSell === "function" &&
        config.arms.find(arm => arm.role === role)?.researchExports === adapter.bridge,
      `${role.toUpperCase()}_STRATEGY_ADAPTER_REQUIRED`);
    }
    assert(config.arms[1].modelId === SPOT_PAPER_PAIRED_TREND_MODEL,
      "TREND_MODEL_ID_MISMATCH");
    assert(typeof config.trendActivityDiagnostic === "function",
      "TREND_ACTIVITY_DIAGNOSTIC_REQUIRED");
  } else {
    assert(config.challengerExports?.SPOT_PAPER_ENTRY_CONFIRMATION_ID ===
      SPOT_PAPER_PAIRED.challengerModel &&
      typeof config.challengerExports.createEntryConfirmationState === "function" &&
      typeof config.challengerExports.advanceEntryConfirmation === "function" &&
      typeof config.challengerExports.recordEntryConfirmationSell === "function",
    "RESEARCH_CHALLENGER_EXPORTS_REQUIRED");
    assert(config.arms[1].researchExports === config.challengerExports &&
      config.arms[1].modelId === config.challengerExports.SPOT_PAPER_ENTRY_CONFIRMATION_ID,
      "CHALLENGER_EXPORTS_NOT_BOUND");
  }
  assert(config.configSha256 === pairedConfigDigest(config), "CONFIG_IDENTITY_MISMATCH");
}

function summarizeLedger(state, valuationAvailable, terminalAt) {
  const ledger = state.ledger;
  const open = ledger.position;
  const markAgeMs = ledger.lastMark ? terminalAt - ledger.lastMark.receivedAt : null;
  const marked = !open || Boolean(ledger.lastMark && valuationAvailable &&
    markAgeMs >= 0 && markAgeMs <= SPOT_PAPER_PAIRED.maxQuoteAgeMs);
  return {
    feesCents: ledger.feesCents,
    startingCapitalCents: ledger.initialCashCents,
    netEquityCents: marked ? ledger.cashCents + (open ? ledger.lastMark.netExitCents : 0) : null,
    markedEquityCents: marked ? ledger.cashCents + (open ? ledger.lastMark.netExitCents : 0) : null,
    sampledDrawdownCents: state.sampledDrawdownCents ?? 0,
    exposureCents: open ? open.entryGrossCents : 0,
    turnoverCents: ledger.fills.reduce((sum, fill) => sum + fill.grossCents, 0),
    openPositions: open ? [{ quantitySat: open.quantitySat,
      entrySignalId: open.entrySignalId }] : [],
    unresolvedObservations: marked ? 0 : (open ? 1 : 0),
    markAgeMs: marked && open ? markAgeMs : null
  };
}

function markLedgerWithoutTrading(
  ledger, quote, at, feeBpsPerSide, feeApply = applyPaperObservation
) {
  if (!ledger.position) return clone(ledger);
  const valuationInput = clone(ledger);
  valuationInput.position.stopPriceNano = "0";
  const result = feeApply(valuationInput, {
    quote, nowMs: at, stopped: true, feeBpsPerSide
  });
  assert(result.fills.length === 0 && result.ledger.position?.quantitySat ===
    ledger.position.quantitySat &&
    result.ledger.position.entrySignalId === ledger.position.entrySignalId,
  "MARK_ONLY_CHANGED_ACCOUNT");
  return result.ledger;
}

export function createBaselineArm(
  accountId = "baseline",
  accountContract = SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT,
  feeApply = applyPaperObservation
) {
  return {
    role: "baseline",
    modelId: SPOT_PAPER_PAIRED.baselineModel,
    accountId,
    accountContract,
    feeApply,
    initialize: () => ({ strategy: createStrategyState(), ledger: createLedger(),
      valuationLedger: createLedger(), stopped: false }),
    decide({ state, candles, at }) {
      const advanced = advanceStrategy(state.strategy, candles);
      return {
        state: { ...state, strategy: advanced.state },
        decision: advanced.signals.at(-1) ?? null,
        decidedAt: at,
        metadata: { newCandleCount: advanced.newCandleCount,
          missedDecisionWindow: Boolean(advanced.missedDecisionWindow) }
      };
    },
    apply({ state, decision, quote, at, stopped }) {
      if (stopped || state.stopped) {
        return {
          state: clone(state), fills: [], stopReason: state.stopReason ?? null,
          stoppedAt: state.stoppedAt ?? null,
          riskState: { stopped: true, reason: state.stopReason ?? null,
            stoppedAt: state.stoppedAt ?? null }
        };
      }
      const result = feeApply(state.ledger, {
        signal: decision, quote, nowMs: at, stopped: stopped || state.stopped,
        feeBpsPerSide: accountContract.feeBpsPerSide
      });
      return {
        state: { ...state, ledger: result.ledger,
          stopped: state.stopped || Boolean(result.stopReason) },
        fills: result.fills,
        stopReason: result.stopReason,
        stoppedAt: result.stopReason ? at : null,
        riskState: { lossLimitReached: result.lossLimitReached }
      };
    },
    summarize({ state, valuationAvailable, terminalAt }) {
      return summarizeLedger(state, valuationAvailable, terminalAt);
    }
  };
}

export function createChallengerArm(
  researchExports, accountId = "challenger",
  accountContract = SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT,
  feeApply = applyPaperObservation,
  { role = "challenger", modelId = researchExports?.SPOT_PAPER_ENTRY_CONFIRMATION_ID } = {}
) {
  if (researchExports?.SPOT_PAPER_ENTRY_CONFIRMATION_ID !==
      SPOT_PAPER_PAIRED.challengerModel ||
      typeof researchExports.createEntryConfirmationState !== "function" ||
      typeof researchExports.advanceEntryConfirmation !== "function" ||
      typeof researchExports.recordEntryConfirmationSell !== "function") {
    throw new Error("RESEARCH_CHALLENGER_EXPORTS_REQUIRED");
  }
  assert((role === "challenger" &&
      modelId === researchExports.SPOT_PAPER_ENTRY_CONFIRMATION_ID) ||
    (role === "baseline" &&
      modelId === SPOT_PAPER_PAIRED.challengerModel) ||
    (role === "challenger" && modelId === SPOT_PAPER_PAIRED_TREND_MODEL),
  "INVALID_STRATEGY_ARM_IDENTITY");
  return {
    role,
    modelId,
    accountId,
    accountContract,
    feeApply,
    researchExports,
    initialize: () => ({ strategy: researchExports.createEntryConfirmationState(),
      ledger: createLedger(), valuationLedger: createLedger(), stopped: false }),
    decide({ state, candles, at }) {
      const advanced = researchExports.advanceEntryConfirmation(state.strategy, candles, {
        decisionAt: at, held: Boolean(state.ledger.position)
      });
      return {
        state: { ...state, strategy: advanced.state },
        decision: advanced.signals.at(-1) ?? null,
        decidedAt: at,
        metadata: { newCandleCount: advanced.newCandleCount,
          missedDecisionWindow: Boolean(advanced.missedDecisionWindow),
          discarded: advanced.discarded ?? null,
          ...(advanced.blockedEntryReason ?
            {blockedEntryReason: advanced.blockedEntryReason} : {}),
          ...(advanced.trendFilter ? {trendFilter: advanced.trendFilter} : {}) }
      };
    },
    apply({ state, decision, quote, at, stopped }) {
      if (stopped || state.stopped) {
        return {
          state: clone(state), fills: [], stopReason: state.stopReason ?? null,
          stoppedAt: state.stoppedAt ?? null,
          riskState: { stopped: true, reason: state.stopReason ?? null,
            stoppedAt: state.stoppedAt ?? null }
        };
      }
      const result = feeApply(state.ledger, {
        signal: decision, quote, nowMs: at, stopped: stopped || state.stopped,
        feeBpsPerSide: accountContract.feeBpsPerSide
      });
      const candidateFills = result.fills.map(fill => {
        const strategyReason = fill.side === "BUY" ? decision?.strategyReason :
          fill.reason === "SAMPLED_2PCT_BID_STOP" ?
            "BASELINE_SAMPLED_2PCT_BID_STOP" : decision?.strategyReason;
        return { ...fill, ledgerReason: fill.reason,
          strategyId: modelId,
          ...(strategyReason ? { reason: strategyReason, strategyReason } : {}) };
      });
      if (candidateFills.length) {
        result.ledger.fills.splice(result.ledger.fills.length - candidateFills.length,
          candidateFills.length, ...candidateFills);
      }
      let strategy = state.strategy;
      if (candidateFills.some(fill => fill.side === "SELL")) {
        strategy = researchExports.recordEntryConfirmationSell(strategy, at);
      }
      return {
        state: { ...state, strategy, ledger: result.ledger,
          stopped: state.stopped || Boolean(result.stopReason) },
        fills: candidateFills,
        stopReason: result.stopReason,
        stoppedAt: result.stopReason ? at : null,
        riskState: { lossLimitReached: result.lossLimitReached }
      };
    },
    summarize({ state, valuationAvailable, terminalAt }) {
      return summarizeLedger(state, valuationAvailable, terminalAt);
    }
  };
}

export function createCashControlArm(
  accountId = "cash-control",
  accountContract = SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT
) {
  return {
    role: "cash",
    modelId: SPOT_PAPER_PAIRED.controlModel,
    accountId,
    accountContract,
    initialize: () => ({ cashCents: SPOT_PAPER_PAIRED.initialCashCents, fills: [] }),
    decide({ at }) {
      return { state: null, decision: null, decidedAt: at, metadata: { control: "NO_TRADE" } };
    },
    apply({ state }) {
      return { state, fills: [], stopReason: null, riskState: { noTrade: true } };
    },
    summarize({ state }) {
      return {
        startingCapitalCents: SPOT_PAPER_PAIRED.initialCashCents,
        feesCents: 0, netEquityCents: state.cashCents, markedEquityCents: state.cashCents,
        sampledDrawdownCents: 0, exposureCents: 0, turnoverCents: 0,
        openPositions: [], unresolvedObservations: 0, markAgeMs: null
      };
    }
  };
}

function acquisition(response, counters, config, bytesAlreadyCounted = false) {
  if (!response || typeof response.raw !== "string" ||
      !Number.isSafeInteger(response.bytes) || response.bytes < 0 ||
      Buffer.byteLength(response.raw, "utf8") !== response.bytes ||
      !fingerprint(response.sha256) ||
      sha256(Buffer.from(response.raw, "utf8")) !== response.sha256 ||
      !Number.isSafeInteger(response.requestStartedAt) ||
      !Number.isSafeInteger(response.receivedAt) ||
      response.receivedAt < response.requestStartedAt) throw new Error("INVALID_ACQUISITION");
  if (!bytesAlreadyCounted) counters.bytes += response.bytes;
  if (response.bytes > config.maxResponseBytes) throw new Error("RESPONSE_BYTE_LIMIT");
  if (counters.bytes > config.maxBytes) throw new Error("RUN_BYTE_LIMIT");
  return response;
}

function boundedCall(operation, context, {
  requestKind, cycle, monotonicStart, counters, provider
}) {
  const transportState = { phase: "HEADERS", requestBytes: 0 };
  const diagnostic = termination => {
    syncProviderCounters(provider, counters);
    const elapsed = context.monotonicNow() - monotonicStart;
    return {
      schemaVersion: PAIRED_TRANSPORT_DIAGNOSTIC_SCHEMA,
      requestKind, phase: transportState.phase, termination,
      attemptedCycle: cycle, requestCount: counters.requests,
      byteCount: counters.bytes, requestBytes: transportState.requestBytes,
      elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed)) : 0
    };
  };
  const rejectWithDiagnostic = (error, termination) => {
    if (!(error instanceof Error)) error = new Error("TRANSPORT_ERROR");
    try {
      Object.defineProperty(error, PAIRED_TRANSPORT_FAILURE, {
        value: diagnostic(termination)
      });
    } catch {
      error = new Error("TRANSPORT_ERROR");
      Object.defineProperty(error, PAIRED_TRANSPORT_FAILURE, {
        value: diagnostic(termination)
      });
    }
    return error;
  };
  if (context.signal?.aborted) {
    return Promise.reject(rejectWithDiagnostic(
      context.signal.reason ?? new Error("REQUEST_ABORTED"), "CANCELLATION"));
  }
  const remaining = context.deadlineAt - context.monotonicNow();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return Promise.reject(rejectWithDiagnostic(
      new Error("DURATION_LIMIT"), "OUTER_TIMEOUT"));
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(context.signal.reason ?? new Error("RUN_ABORTED"));
  context.signal?.addEventListener("abort", onAbort, { once: true });
  const callDeadline = Math.min(context.deadlineAt,
    context.monotonicNow() + context.requestTimeoutMs);
  const timeoutCode = callDeadline >= context.deadlineAt ? "DURATION_LIMIT" : "REQUEST_TIMEOUT";
  let timer;
  let abortListener;
  const task = Promise.resolve().then(() => operation({
    deadlineAt: callDeadline, monotonicNow: context.monotonicNow,
    requestTimeoutMs: context.requestTimeoutMs, signal: controller.signal,
    onTransportState: (phase, requestBytes) => {
      if (["HEADERS", "BODY", "RESPONSE"].includes(phase)) {
        transportState.phase = phase;
      }
      if (Number.isSafeInteger(requestBytes) && requestBytes >= 0 &&
          requestBytes <= SPOT_PAPER_PAIRED.maxResponseBytes) {
        transportState.requestBytes = requestBytes;
      }
    }
  }));
  task.catch(() => {});
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
      if (abortListener && context.signal) {
        context.signal.removeEventListener("abort", abortListener);
      }
      if (!controller.signal.aborted) controller.abort(new Error("REQUEST_FINISHED"));
    };
    timer = setTimeout(() => {
      controller.abort(new Error(timeoutCode));
      cleanup();
      reject(rejectWithDiagnostic(new Error(timeoutCode), "OUTER_TIMEOUT"));
    }, Math.min(remaining, context.requestTimeoutMs));
    abortListener = () => {
      cleanup();
      reject(rejectWithDiagnostic(
        context.signal.reason ?? new Error("REQUEST_ABORTED"), "CANCELLATION"));
    };
    context.signal?.addEventListener("abort", abortListener, { once: true });
    task.then(value => {
      cleanup();
      if (context.monotonicNow() >= callDeadline) {
        reject(rejectWithDiagnostic(new Error(timeoutCode), "OUTER_TIMEOUT"));
      }
      else resolve(value);
    }, error => {
      cleanup();
      const termination = context.signal?.aborted ? "CANCELLATION" :
        error?.message === "REQUEST_TIMEOUT" ? "REQUEST_TIMEOUT" :
          error?.message === "DURATION_LIMIT" ? "OUTER_TIMEOUT" :
            "TRANSPORT_ERROR";
      reject(rejectWithDiagnostic(error, termination));
    });
  });
}

function safeFailureReason(error) {
  const reason = error instanceof Error ? error.message : "";
  if (SAFE_FAILURE_REASONS.has(reason) || /^HTTP_[1-5][0-9]{2}$/.test(reason)) {
    return reason;
  }
  return "UNKNOWN_FAILURE";
}

async function boundedSleep(config, durationMs, deadlineAt) {
  const remaining = deadlineAt - config.monotonicNow();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("DURATION_LIMIT");
  const controller = new AbortController();
  const onAbort = () => controller.abort(config.signal.reason ?? new Error("RUN_ABORTED"));
  if (config.signal?.aborted) onAbort();
  else config.signal?.addEventListener("abort", onAbort, { once: true });
  let timer;
  let abortListener;
  const sleep = Promise.resolve().then(() =>
    config.sleep(Math.min(durationMs, Math.ceil(remaining)), controller.signal));
  sleep.catch(() => {});
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort(new Error("DURATION_LIMIT"));
      resolve("DURATION_LIMIT");
    }, remaining);
  });
  const aborted = config.signal ? new Promise((_, reject) => {
    abortListener = () => reject(config.signal.reason ?? new Error("RUN_ABORTED"));
    config.signal.addEventListener("abort", abortListener, { once: true });
  }) : new Promise(() => {});
  try {
    const result = await Promise.race([sleep, deadline, aborted]);
    if (result === "DURATION_LIMIT" || config.monotonicNow() >= deadlineAt) {
      throw new Error("DURATION_LIMIT");
    }
  } finally {
    clearTimeout(timer);
    config.signal?.removeEventListener("abort", onAbort);
    if (abortListener) config.signal.removeEventListener("abort", abortListener);
    if (!controller.signal.aborted) controller.abort(new Error("SLEEP_FINISHED"));
  }
}

function updateDrawdown(summary, highWater) {
  if (!Number.isSafeInteger(summary.netEquityCents)) {
    return { highWater, drawdown: null };
  }
  const nextHigh = Math.max(highWater, summary.netEquityCents);
  return { highWater: nextHigh, drawdown: nextHigh - summary.netEquityCents };
}

function slippageForFillCents(fill, quote) {
  assert(Number.isSafeInteger(fill.quantitySat) && fill.quantitySat > 0 &&
    typeof fill.priceNano === "string" && /^\d+$/.test(fill.priceNano),
  "INVALID_FILL");
  const reference = BigInt(fill.side === "BUY" ? quote.askNano : quote.bidNano);
  const execution = BigInt(fill.priceNano);
  const adverse = fill.side === "BUY" ? execution - reference : reference - execution;
  assert((fill.side === "BUY" || fill.side === "SELL") && adverse >= 0n,
    "INVALID_FILL_SLIPPAGE");
  const product = BigInt(fill.quantitySat) * adverse;
  const cents = (product * 2n + 100_000_000_000_000n) /
    (2n * 100_000_000_000_000n);
  assert(cents <= BigInt(Number.MAX_SAFE_INTEGER), "SLIPPAGE_OVERFLOW");
  return Number(cents);
}

function syncProviderCounters(provider, counters) {
  const reported = typeof provider.counters === "function" ? provider.counters() : null;
  if (Number.isSafeInteger(reported?.requests)) {
    counters.requests = Math.max(counters.requests, reported.requests);
  }
  if (Number.isSafeInteger(reported?.bytes)) {
    counters.bytes = Math.max(counters.bytes, reported.bytes);
  }
}

function comparisonHasStaleOpenMark(comparison, lastQuote) {
  if (comparison?.status !== "COMPARISON_AVAILABLE" || !isRecord(comparison.arms)) {
    return false;
  }
  return Object.values(comparison.arms).some(arm => {
    const inventory = arm?.unresolvedTerminalInventory;
    if (!inventory) return false;
    return !lastQuote || inventory.lastMark?.receivedAt !== lastQuote.receivedAt;
  });
}

function comparisonMatchesForward(comparison, arms, states, fills, summaries, terminalAt) {
  if (comparison?.status !== "COMPARISON_AVAILABLE" || !isRecord(comparison.arms)) {
    return false;
  }
  const fillIdentity = fill => ({
    id: fill.id, side: fill.side, quantitySat: fill.quantitySat,
    priceNano: fill.priceNano, grossCents: fill.grossCents,
    feeCents: fill.feeCents, ledgerReason: fill.ledgerReason ?? fill.reason,
    signalAt: fill.signalAt, quoteReceivedAt: fill.quoteReceivedAt,
    executionAt: fill.executionAt
  });
  return arms.every((arm, index) => {
    const replay = comparison.arms[arm.role];
    const state = states[index];
    const ledger = state.valuationLedger ?? state.ledger ??
      { cashCents: state.cashCents, feesCents: 0 };
    const summary = summaries[index];
    const replayFills = replay?.fills;
    const position = ledger.position ?? null;
    const replayInventory = replay?.unresolvedTerminalInventory ?? null;
    const stopTimeMatches = (replay?.tradingStoppedAt ?? null) ===
      (state.stoppedAt ?? null);
    return isRecord(replay) && Array.isArray(replayFills) &&
      replay.initialCashCents === SPOT_PAPER_PAIRED.initialCashCents &&
      replay.finalCashCents === ledger.cashCents &&
      replay.finalNetEquityCents === summary.netEquityCents &&
      replay.feesCents === summary.feesCents &&
      replay.grossTurnoverCents === summary.turnoverCents &&
      replay.stopped === Boolean(state.stopped) &&
      (replay.stopReason ?? null) === (state.stopReason ?? null) &&
      stopTimeMatches && replay.valuationAt === terminalAt &&
      replayFills.length === fills[index].length &&
      replayFills.every((fill, fillIndex) =>
        same(fillIdentity(fill), fillIdentity(fills[index][fillIndex]))) &&
      Boolean(replayInventory) === Boolean(position) &&
      (!position || (replayInventory.quantitySat === position.quantitySat &&
        replayInventory.entrySignalId === position.entrySignalId));
  });
}

async function runPairedForward(input, testOnly) {
  const config = validateConfig({ ...input });
  assert(config.testOnly === testOnly, "RUN_MODE_MISMATCH");
  validateBindings(config, testOnly);
  const startedAt = config.now();
  assert(Number.isSafeInteger(startedAt) && startedAt >= 0, "INVALID_CLOCK");
  const monotonicStart = config.monotonicNow();
  assert(Number.isFinite(monotonicStart) && monotonicStart >= 0, "INVALID_MONOTONIC_CLOCK");
  const deadlineAt = monotonicStart + config.maxDurationMs;
  const runContext = { deadlineAt, monotonicNow: config.monotonicNow,
    signal: config.signal, requestTimeoutMs: config.requestTimeoutMs };
  const states = config.arms.map(arm => clone(arm.initialize({
    initialCashCents: SPOT_PAPER_PAIRED.initialCashCents,
    maxEntryCents: SPOT_PAPER_PAIRED.maxEntryCents,
    feeBpsPerSide: config.accountContract.feeBpsPerSide,
    slippageBpsPerSide: SPOT_PAPER_PAIRED.slippageBpsPerSide,
    stopLossBps: SPOT_PAPER_PAIRED.stopLossBps,
    maxSessionLossCents: SPOT_PAPER_PAIRED.maxSessionLossCents
  })));
  assert(new Set(states).size === 3, "CONFLICTING_ACCOUNT_STATE");
  const initialAccounts = config.arms.map((arm, index) =>
    arm.summarize({ state: states[index], valuationAvailable: false, terminalAt: startedAt }));
  assert(config.arms[0].role === "baseline" &&
    states[0].ledger?.initialCashCents === SPOT_PAPER_PAIRED.initialCashCents &&
    states[0].ledger?.cashCents === SPOT_PAPER_PAIRED.initialCashCents,
  "BASELINE_CAPITAL_MISMATCH");
  assert(initialAccounts.every(summary => isRecord(summary)) &&
    initialAccounts[2].netEquityCents === SPOT_PAPER_PAIRED.initialCashCents &&
    initialAccounts[2].feesCents === 0, "INITIAL_ACCOUNT_PARITY_REQUIRED");

  const manifest = {
    schemaVersion: "SPOT_PAPER_PAIRED_MANIFEST_V1",
    runId: config.runId, startedAt, mode: "paper", pair: SPOT_PAPER_PAIRED.pair,
    feedSourceId: config.provider.sourceId,
    sourceSha256: config.sourceSha256, configSha256: config.configSha256,
    researchSourceSha256: config.researchSourceSha256,
    integrationStatus: testOnly ? SPOT_PAPER_PAIRED_INTEGRATION :
      SPOT_PAPER_PAIRED_PINNED_INTEGRATION,
    ...(config.modelPair ? {modelPairId: config.modelPair.id} : {}),
    models: config.arms.map(({ role, modelId, accountId }) => ({ role, modelId, accountId })),
    comparisonEngineId: config.comparisonEngine.id,
    assumptions: accountAssumptions(config.accountContract),
    limits: {
      maxCycles: config.maxCycles, maxRequests: config.maxRequests,
      maxBytes: config.maxBytes, maxResponseBytes: config.maxResponseBytes,
      maxDurationMs: config.maxDurationMs, requestTimeoutMs: config.requestTimeoutMs,
      pollIntervalMs: config.pollIntervalMs
    }
  };
  const journal = await createRunJournal({
    ...config.journalOptions, dataRoot: config.dataRoot, runId: config.runId,
    manifest, ...runContext
  });
  const counters = { requests: 0, bytes: 0 };
  const observations = [];
  const replayObservations = [];
  const decisions = config.arms.map(() => []);
  const fills = config.arms.map(() => []);
  const riskStates = config.arms.map(() => []);
  const valuationStates = config.arms.map(() => []);
  const slippageTotals = config.arms.map(() => 0);
  assert(initialAccounts.every(summary =>
    summary.startingCapitalCents === SPOT_PAPER_PAIRED.initialCashCents),
  "INITIAL_CAPITAL_MISMATCH");
  const highWater = initialAccounts.map(() => SPOT_PAPER_PAIRED.initialCashCents);
  const maxDrawdown = config.arms.map(() => 0);
  let stopReason = null;
  let failureReason = null;
  let failureDiagnostic = null;
  let previousObservationAt = null;
  let previousCycleEnd = null;
  let cycle = 0;
  let lastQuote = null;
  let terminalOutcomeUnknown = false;
  try {
    await journal.append({ id: "paired-start", type: "start", at: startedAt },
      { states, counters, cycle }, runContext);
    while (cycle < config.maxCycles) {
      if (config.signal?.aborted) {
        stopReason = "OPERATOR_STOP";
        break;
      }
      const nowMono = config.monotonicNow();
      if (nowMono >= deadlineAt) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      if (previousCycleEnd !== null) {
        const remaining = config.pollIntervalMs - (nowMono - previousCycleEnd);
        if (remaining > 0) {
          try {
            await boundedSleep(config, Math.ceil(remaining), deadlineAt);
          } catch (error) {
            if (config.signal?.aborted) {
              stopReason = "OPERATOR_STOP";
              break;
            }
            if (error?.message === "DURATION_LIMIT") {
              stopReason = "DURATION_LIMIT";
              break;
            }
            throw error;
          }
          if (config.signal?.aborted) {
            stopReason = "OPERATOR_STOP";
            break;
          }
        }
      }
      const cycleStartedMono = config.monotonicNow();
      if (cycleStartedMono >= deadlineAt) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      const started = config.now();
      if (!Number.isSafeInteger(started) || started < startedAt ||
          (previousObservationAt !== null && started < previousObservationAt)) {
        throw new Error("CLOCK_ERROR");
      }
      cycle++;
      let ohlcResponse = null;
      let tickerResponse = null;
      let storedOhlc = null;
      let storedTicker = null;
      let cycleDecisions = [];
      try {
        if (counters.requests + 2 > config.maxRequests) throw new Error("REQUEST_LIMIT");
        counters.requests++;
        const ohlcBytesBefore = counters.bytes;
        ohlcResponse = await boundedCall(
          runtime => config.provider.fetchOhlc(runtime), runContext, {
            requestKind: "OHLC", cycle, monotonicStart, counters,
            provider: config.provider
          });
        syncProviderCounters(config.provider, counters);
        if (counters.requests !== cycle * 2 - 1 ||
            counters.bytes - ohlcBytesBefore !== ohlcResponse?.bytes) {
          throw new Error("PROVIDER_COUNTER_MISMATCH");
        }
        acquisition(ohlcResponse, counters, config, true);
        if (ohlcResponse.requestStartedAt < started ||
            (previousObservationAt !== null && ohlcResponse.requestStartedAt < previousObservationAt)) {
          throw new Error("OBSERVATION_OUT_OF_ORDER");
        }
        storedOhlc = await journal.persistResponse(ohlcResponse, runContext);
        const parsedOhlc = parseKrakenOhlc(ohlcResponse, config.now());
        const decisionAt = config.now();
        assert(Number.isSafeInteger(decisionAt) && decisionAt >= ohlcResponse.receivedAt,
          "DECISION_PRECEDES_OBSERVATION");
        cycleDecisions = config.arms.map((arm, index) => {
          const before = clone(states[index]);
          if (before.stopped) {
            return {
              state: before, decision: null, decidedAt: decisionAt,
              skippedReason: "ARM_STOPPED",
              metadata: { stoppedAt: before.stoppedAt ?? null,
                stopReason: before.stopReason ?? null }
            };
          }
          const result = arm.decide({
            state: clone(before), candles: clone(parsedOhlc.candles),
            observedAt: parsedOhlc.latestClosedAt, at: decisionAt, cycle
          });
          assert(isRecord(result) && Object.hasOwn(result, "decision") &&
            Number.isSafeInteger(result.decidedAt) && result.decidedAt >= ohlcResponse.receivedAt,
          "INVALID_ARM_DECISION");
          assert(same(before, states[index]), "ARM_DECISION_MUTATED_SHARED_STATE");
          validateJson(result, "INVALID_ARM_DECISION");
          return result;
        });
        assert(config.now() >= decisionAt, "CLOCK_ERROR");
        counters.requests++;
        const tickerBytesBefore = counters.bytes;
        tickerResponse = await boundedCall(
          runtime => config.provider.fetchTicker(runtime), runContext, {
            requestKind: "TICKER", cycle, monotonicStart, counters,
            provider: config.provider
          });
        syncProviderCounters(config.provider, counters);
        if (counters.requests !== cycle * 2 ||
            counters.bytes - tickerBytesBefore !== tickerResponse?.bytes) {
          throw new Error("PROVIDER_COUNTER_MISMATCH");
        }
        acquisition(tickerResponse, counters, config, true);
        storedTicker = await journal.persistResponse(tickerResponse, runContext);
        const latestDecisionAt = Math.max(...cycleDecisions.map(item => item.decidedAt));
        if (tickerResponse.requestStartedAt < latestDecisionAt) {
          throw new Error("TICKER_PREDATES_DECISION");
        }
        if (tickerResponse.requestStartedAt < ohlcResponse.receivedAt ||
            tickerResponse.receivedAt < latestDecisionAt) {
          throw new Error("TICKER_NOT_CAUSAL");
        }
        const quoteAt = config.now();
        const quote = parseKrakenTicker(tickerResponse, quoteAt);
        const candleAgeAtQuote = quoteAt - (parsedOhlc.latestClosedAt + 60_000);
        if (candleAgeAtQuote < 0 || candleAgeAtQuote > SPOT_PAPER_PAIRED.maxCandleAgeMs) {
          throw new Error("STALE_OHLC");
        }
        const effectAt = config.now();
        if (effectAt < quoteAt) throw new Error("CLOCK_MOVED_BACKWARDS");
        if (config.signal?.aborted || config.monotonicNow() >= deadlineAt) {
          stopReason = config.signal?.aborted ? "OPERATOR_STOP" : "DURATION_LIMIT";
          break;
        }
        const effectQuote = parseKrakenTicker(tickerResponse, effectAt);
        const candleAgeAtEffect = effectAt - (parsedOhlc.latestClosedAt + 60_000);
        if (candleAgeAtEffect < 0 || candleAgeAtEffect > SPOT_PAPER_PAIRED.maxCandleAgeMs) {
          throw new Error("STALE_OHLC");
        }
        const effects = config.arms.map((arm, index) => {
          const before = clone(states[index]);
          const decision = cycleDecisions[index];
          if (before.stopped) {
            return {
              state: before, fills: [], stopReason: before.stopReason ?? null,
              stoppedAt: before.stoppedAt ?? null, skipped: true,
              riskState: { stopped: true, reason: before.stopReason ?? null,
                stopReason: before.stopReason ?? null,
                stoppedAt: before.stoppedAt ?? null }
            };
          }
          const result = arm.apply({
            state: clone(decision.state ?? before), decision: clone(decision.decision),
            quote: clone(effectQuote), at: effectAt, stopped: Boolean(before.stopped), cycle
          });
          assert(isRecord(result) && Object.hasOwn(result, "state") &&
            Array.isArray(result.fills) && isRecord(result.riskState),
          "INVALID_ARM_EFFECT");
          assert(same(before, states[index]), "ARM_EFFECT_MUTATED_SHARED_STATE");
          validateJson(result, "INVALID_ARM_EFFECT");
          for (const fill of result.fills) {
            assert(fill.quoteReceivedAt === quote.receivedAt &&
              Number.isSafeInteger(fill.signalAt), "NON_CAUSAL_FILL");
            if (fill.reason === "SAMPLED_2PCT_BID_STOP" ||
                fill.ledgerReason === "SAMPLED_2PCT_BID_STOP") {
              assert(fill.signalAt >= quote.receivedAt && fill.signalAt <= effectAt,
                "NON_CAUSAL_RISK_FILL");
            } else {
              assert(fill.signalAt <= quote.requestStartedAt, "NON_CAUSAL_FILL");
            }
          }
          return result;
        });
        const nextStates = effects.map((effect, index) => {
          const state = clone(effect.state);
          state.valuationLedger = states[index].stopped ?
            markLedgerWithoutTrading(states[index].ledger, effectQuote, effectAt,
              config.accountContract.feeBpsPerSide,
              config.feeScenarioApply ?? applyPaperObservation) :
            clone(state.ledger ?? state.valuationLedger);
          if (states[index].stopped || effect.stopReason) {
            state.stopped = true;
            state.stopReason ??= states[index].stopReason ?? effect.stopReason;
            state.stoppedAt ??= states[index].stoppedAt ??
              effect.stoppedAt ?? effectAt;
          }
          return state;
        });
        const nextSummaries = config.arms.map((arm, index) => ({ ...arm.summarize({
          state: nextStates[index].valuationLedger ?
            { ...nextStates[index], ledger: nextStates[index].valuationLedger } :
            nextStates[index],
          quote, valuationAvailable: true, terminalAt: effectAt
        }) }));
        nextSummaries.forEach((summary, index) => {
          assert(isRecord(summary) && Number.isSafeInteger(summary.feesCents) &&
            summary.feesCents >= 0, "INVALID_ARM_SUMMARY");
          const drawdown = updateDrawdown(summary, highWater[index]);
          highWater[index] = drawdown.highWater;
          if (drawdown.drawdown !== null) {
            maxDrawdown[index] = Math.max(maxDrawdown[index], drawdown.drawdown);
          }
          summary.sampledDrawdownCents = maxDrawdown[index];
          const cycleSlippage = effects[index].fills.reduce((sum, fill) =>
            sum + slippageForFillCents(fill, effectQuote), 0);
          slippageTotals[index] += cycleSlippage;
          summary.slippageCents = slippageTotals[index];
          summary.modeledCostsCents = summary.feesCents + summary.slippageCents;
          assert(Number.isSafeInteger(summary.exposureCents) && summary.exposureCents >= 0 &&
            Number.isSafeInteger(summary.turnoverCents) && summary.turnoverCents >= 0 &&
            Array.isArray(summary.openPositions) &&
            Number.isSafeInteger(summary.unresolvedObservations) &&
            summary.unresolvedObservations >= 0, "INVALID_ARM_SUMMARY");
        });
        const observation = {
          id: `shared:${cycle}:${tickerResponse.sha256}`,
          type: "shared_observation", cycle,
          ohlc: { ...storedOhlc, latestClosedAt: parsedOhlc.latestClosedAt,
            ageMs: parsedOhlc.ageMs },
          ticker: null,
          decisions: cycleDecisions.map((decision, index) => ({
            role: config.arms[index].role, decidedAt: decision.decidedAt,
            decision: decision.decision, skippedReason: decision.skippedReason ?? null,
            metadata: decision.metadata ?? null
          })),
          fills: effects.map((effect, index) => ({
            role: config.arms[index].role, fills: effect.fills
          })),
          riskStates: effects.map((effect, index) => ({
            role: config.arms[index].role, state: effect.riskState,
            stopReason: nextStates[index].stopReason ?? effect.stopReason ?? null,
            stoppedAt: nextStates[index].stoppedAt ?? null,
            skipped: Boolean(effect.skipped)
          })),
          valuations: nextSummaries.map((summary, index) => ({
            role: config.arms[index].role, ...summary
          })),
          decisionAt: Math.max(...cycleDecisions.map(item => item.decidedAt)),
          effectAt,
          observedAt: effectAt
        };
        observation.ticker = { ...storedTicker, acquisitionAgeMs: quote.ageMs };
        await journal.append(observation, {
          states: nextStates, counters, cycle, lastObservationAt: effectAt
        }, runContext);
        states.splice(0, states.length, ...nextStates);
        cycleDecisions.forEach((decision, index) => decisions[index].push(decision));
        effects.forEach((effect, index) => {
          fills[index].push(...effect.fills.map(fill => ({ ...fill, executionAt: effectAt })));
          riskStates[index].push({
            ...effect.riskState,
            ...(nextStates[index].stopped ? {
              stopReason: nextStates[index].stopReason,
              stoppedAt: nextStates[index].stoppedAt
            } : {})
          });
          valuationStates[index].push(nextSummaries[index]);
        });
        observations.push(observation);
        replayObservations.push({
          at: effectAt, decisionAt: Math.max(...cycleDecisions.map(item => item.decidedAt)),
          effectAt, ohlc: ohlcResponse, ticker: tickerResponse
        });
        lastQuote = quote;
        previousObservationAt = tickerResponse.receivedAt;
        previousCycleEnd = config.monotonicNow();
      } catch (error) {
        syncProviderCounters(config.provider, counters);
        if (error?.code === "JOURNAL_UNKNOWN" || error?.message === "JOURNAL_UNKNOWN") {
          terminalOutcomeUnknown = true;
          throw error;
        }
        stopReason = config.signal?.aborted ? "OPERATOR_STOP" :
          error?.message === "REQUEST_LIMIT" ? "REQUEST_LIMIT" :
          error?.message === "DURATION_LIMIT" ? "DURATION_LIMIT" : "SHARED_FEED_FAILURE";
        failureReason = stopReason === "SHARED_FEED_FAILURE" ?
          safeFailureReason(error) : null;
        failureDiagnostic = error?.[PAIRED_TRANSPORT_FAILURE] ?? null;
        await journal.append({
          id: `shared-failure:${cycle}:${stopReason}`,
          type: "shared_feed_failure", cycle, at: config.now(),
          reason: safeFailureReason(error),
          ...(failureDiagnostic ? {transportDiagnostic: failureDiagnostic} : {}),
          responses: { ohlc: storedOhlc, ticker: storedTicker },
          decisions: cycleDecisions.map((decision, index) => ({
            role: config.arms[index].role, decidedAt: decision.decidedAt,
            decision: decision.decision, skippedReason: decision.skippedReason ?? null,
            metadata: decision.metadata ?? null
          }))
        }, { states, counters, cycle, stopReason }, {
          deadlineAt: config.monotonicNow() + 5_000,
          monotonicNow: config.monotonicNow, signal: null
        });
        break;
      }
    }
    if (!stopReason) stopReason = cycle >= config.maxCycles ? "CYCLE_LIMIT" : "DURATION_LIMIT";
    const endedAt = config.now();
    const monotonicEndedAt = config.monotonicNow();
    assert(Number.isSafeInteger(endedAt) && endedAt >= startedAt &&
      (previousObservationAt === null || endedAt >= previousObservationAt) &&
      Number.isFinite(monotonicEndedAt) && monotonicEndedAt >= monotonicStart,
    "CLOCK_ERROR");
    const elapsedMs = monotonicEndedAt - monotonicStart;
    const lastObservation = replayObservations.at(-1) ?? null;
    const sharedHorizonAt = lastObservation?.effectAt ?? null;
    const quoteAgeAtEffectMs = lastQuote && sharedHorizonAt !== null ?
      sharedHorizonAt - lastQuote.receivedAt : null;
    const terminalQuoteAgeMs = lastQuote ? endedAt - lastQuote.receivedAt : null;
    const commonHorizonAvailable = Boolean(lastQuote && lastObservation &&
      lastObservation.ticker.receivedAt === lastQuote.receivedAt &&
      quoteAgeAtEffectMs !== null && quoteAgeAtEffectMs >= 0 &&
      quoteAgeAtEffectMs <= SPOT_PAPER_PAIRED.maxQuoteAgeMs);
    const quoteFreshAtShutdown = terminalQuoteAgeMs !== null &&
      terminalQuoteAgeMs >= 0 &&
      terminalQuoteAgeMs <= SPOT_PAPER_PAIRED.maxQuoteAgeMs;
    const summaries = config.arms.map((arm, index) => ({ ...arm.summarize({
      state: states[index].valuationLedger ?
        { ...states[index], ledger: states[index].valuationLedger } : states[index],
      quote: lastQuote, valuationAvailable: commonHorizonAvailable,
      terminalAt: sharedHorizonAt ?? endedAt
    }), slippageCents: slippageTotals[index],
      sampledDrawdownCents: maxDrawdown[index] }));
    summaries.forEach(summary => {
      assert(Number.isSafeInteger(summary.feesCents) && summary.feesCents >= 0,
        "INVALID_ARM_SUMMARY");
      summary.modeledCostsCents = summary.feesCents + summary.slippageCents;
    });
    let comparison;
    try {
      comparison = !commonHorizonAvailable ? {
        schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
        status: "UNAVAILABLE", reason: "COMMON_HORIZON_UNAVAILABLE"
      } : replayObservations.length ?
        config.comparisonEngine.compare(clone(replayObservations)) : {
          schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
          status: "UNAVAILABLE", reason: "NO_SHARED_OBSERVATIONS"
        };
    } catch (error) {
      comparison = {
        schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
        status: "UNAVAILABLE", reason: "COMPARISON_ENGINE_FAILURE",
        detail: String(error?.message ?? error).slice(0, 120)
      };
    }
    if (comparisonHasStaleOpenMark(comparison, lastQuote)) {
      comparison = {
        schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
        status: "UNAVAILABLE", reason: "STOPPED_ARM_MARK_NOT_AT_SHARED_HORIZON"
      };
    }
    if (summaries.some((summary, index) => states[index].stopped &&
        summary.openPositions.length > 0 && summary.netEquityCents === null)) {
      comparison = {
        schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
        status: "UNAVAILABLE", reason: "STOPPED_ARM_MARK_NOT_AT_SHARED_HORIZON"
      };
    }
    if (comparison.status === "COMPARISON_AVAILABLE" &&
        !comparisonMatchesForward(comparison, config.arms, states, fills, summaries,
          replayObservations.at(-1)?.effectAt ?? null)) {
      comparison = {
        schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
        status: "UNAVAILABLE", reason: "REPLAY_FORWARD_ACCOUNT_MISMATCH"
      };
    }
    validateJson(comparison, "INVALID_COMPARISON_RESULT");
    const report = {
      schemaVersion: "SPOT_PAPER_PAIRED_REPORT_V1",
      runId: config.runId, pair: SPOT_PAPER_PAIRED.pair,
      ...(config.modelPair ? {modelPairId: config.modelPair.id} : {}),
      models: manifest.models, comparisonEngineId: config.comparisonEngine.id,
      feedSourceId: config.provider.sourceId,
      sourceSha256: config.sourceSha256, configSha256: config.configSha256,
      researchSourceSha256: config.researchSourceSha256,
      integrationStatus: manifest.integrationStatus,
      outcome: stopReason === "CYCLE_LIMIT" || stopReason === "DURATION_LIMIT" ?
        "COMPLETED_BOUNDED" : "INTERRUPTED_OR_STOPPED",
      stopReason, startedAt, endedAt, elapsedMs,
      wallClockElapsedMs: endedAt - startedAt,
      failureReason,
      ...(failureDiagnostic ? {transportDiagnostic: failureDiagnostic} : {}),
      fullEightHourCompletion: stopReason === "DURATION_LIMIT" &&
        elapsedMs >= SPOT_PAPER_PAIRED.maxDurationMs,
      coverage: elapsedMs >= config.maxDurationMs ?
        "CONFIGURED_DURATION_REACHED" : "PARTIAL",
      cycles: cycle, requests: counters.requests, deliveredBytes: counters.bytes,
      commonHorizon: { available: commonHorizonAvailable,
        reason: commonHorizonAvailable ? null : "NO_VALID_COMMON_OBSERVATION",
        quoteReceivedAt: lastQuote?.receivedAt ?? null, effectAt: sharedHorizonAt,
        quoteAgeAtEffectMs, terminalQuoteAgeMs, quoteFreshAtShutdown },
      assumptions: manifest.assumptions,
      ...(config.modelPair ? {
        trendActivityDiagnostic: config.trendActivityDiagnostic({
          completedRoundTripCount: fills[1].filter(fill => fill.side === "SELL").length,
          observedCoverageMs: Math.floor(elapsedMs)
        })
      } : {}),
      arms: config.arms.map((arm, index) => ({
        role: arm.role, modelId: arm.modelId, accountId: arm.accountId,
        tradingStatus: states[index].stopped ? "STOPPED" : "ACTIVE",
        stopReason: states[index].stopReason ?? null,
        stoppedAt: states[index].stoppedAt ?? null,
        decisions: decisions[index].map(decision => {
          const summary = { ...decision };
          delete summary.state;
          return summary;
        }),
        fills: fills[index],
        riskStates: riskStates[index], valuation: summaries[index]
      })),
      comparison,
      testOnly, liveTrading: false, executionImpact: false, autoPromotion: false
    };
    await journal.append({ id: "paired-terminal", type: "terminal", at: endedAt, report },
      { states, counters, cycle, stopReason }, {
        deadlineAt: config.monotonicNow() + 5_000,
        monotonicNow: config.monotonicNow, signal: null
      });
    await journal.close({
      deadlineAt: config.monotonicNow() + 5_000,
      monotonicNow: config.monotonicNow, signal: null
    });
    return report;
  } catch (error) {
    terminalOutcomeUnknown ||= error?.code === "JOURNAL_UNKNOWN" ||
      error?.message === "JOURNAL_UNKNOWN";
    throw error;
  } finally {
    if (!terminalOutcomeUnknown && !journal.poisoned &&
        journal.snapshot().events.at(-1)?.type !== "terminal") {
      await journal.close({
        deadlineAt: config.monotonicNow() + 5_000,
        monotonicNow: config.monotonicNow, signal: null
      });
    }
  }
}

export async function runSpotPaperPaired(input) {
  assert(isRecord(input), "CONFIG_REQUIRED");
  if (input.modelPairId === SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR) {
    if (input.accountContract?.contractId !==
        SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId ||
        input.researchSourceSha256 !==
          SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256) {
      throw new Error("NEXT_RUN_IDENTITY_REQUIRED");
    }
    assert(!Object.hasOwn(input, "provider"), "PROVIDER_INJECTION_FORBIDDEN");
    const [comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes] =
      await Promise.all([
        readFile(new URL("../spot-paper-research/comparison.mjs", import.meta.url)),
        readFile(new URL("../spot-paper-research/entry-confirmation.mjs", import.meta.url)),
        readFile(new URL("../spot-paper-research/five-minute-trend.mjs", import.meta.url))
      ]);
    assert([comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes]
      .every(bytes => bytes.byteLength <= MAX_RESEARCH_SOURCE_BYTES),
    "RESEARCH_SOURCE_TOO_LARGE");
    const {nextRunResearchSourceDigest} =
      await import("./next-run-composition.mjs");
    const researchSourceSha256 = nextRunResearchSourceDigest({
      comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes
    });
    if (researchSourceSha256 !==
        SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256) {
      throw new Error("RESEARCH_SOURCE_IDENTITY_MISMATCH");
    }
    const [comparisonExports, confirmationExports, trendExports] = await Promise.all([
      import("../spot-paper-research/comparison.mjs"),
      import("../spot-paper-research/entry-confirmation.mjs"),
      import("../spot-paper-research/five-minute-trend.mjs")
    ]);
    const {createSpotPaperPairedKrakenProvider} = await import("./feed.mjs");
    const provider = createSpotPaperPairedKrakenProvider({signal: input.signal});
    const {createSpotPaperPairedNextRunConfig} =
      await import("./next-run-composition.mjs");
    const config = createSpotPaperPairedNextRunConfig({
      ...input, researchSourceSha256, provider, confirmationExports, trendExports,
      testOnly: false
    });
    return runPairedForward(config, false);
  }
  if (input.modelPairId !== undefined) throw new Error("UNKNOWN_MODEL_PAIR");
  const acceptedResearchSource = SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256;
  if (!fingerprint(acceptedResearchSource) ||
      input?.researchSourceSha256 !== acceptedResearchSource) {
    throw new Error("RESEARCH_INTEGRATION_NOT_ACCEPTED");
  }
  assert(!Object.hasOwn(input, "provider"), "PROVIDER_INJECTION_FORBIDDEN");
  const comparisonPath = new URL("../spot-paper-research/comparison.mjs", import.meta.url);
  const confirmationPath = new URL("../spot-paper-research/entry-confirmation.mjs", import.meta.url);
  const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
    readFile(comparisonPath), readFile(confirmationPath)
  ]);
  const researchSourceSha256 = pairedResearchSourceDigest({
    comparisonBytes, entryConfirmationBytes
  });
  if (researchSourceSha256 !== acceptedResearchSource) {
    throw new Error("RESEARCH_SOURCE_IDENTITY_MISMATCH");
  }
  const [comparisonExports, challengerExports] = await Promise.all([
    import("../spot-paper-research/comparison.mjs"),
    import("../spot-paper-research/entry-confirmation.mjs")
  ]);
  const accountContract = input.accountContract ??
    SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT;
  assert(Object.values(SPOT_PAPER_PAIRED_ACCOUNT_CONTRACTS).some(contract =>
    same(contract, accountContract)), "INVALID_ACCOUNT_CONTRACT");
  const accountIds = input.accountIds;
  assert(isRecord(accountIds), "ACCOUNT_IDS_REQUIRED");
  let compare = comparisonExports.compareSpotPaperStrategies;
  let feeScenarioApply;
  if (accountContract.contractId ===
      SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId) {
    const feeScenario = await import("./fee-scenario.mjs");
    feeScenarioApply = feeScenario.applySpotPaperPairedFeeObservation;
    compare = observations => feeScenario.compareSpotPaperFeeScenarioObservations(
      observations, {feeBpsPerSide: accountContract.feeBpsPerSide});
  }
  const comparisonEngine = {
    id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
    compare
  };
  const { createSpotPaperPairedKrakenProvider } = await import("./feed.mjs");
  const provider = createSpotPaperPairedKrakenProvider({ signal: input.signal });
  const arms = [
    createBaselineArm(accountIds.baseline, accountContract, feeScenarioApply),
    createChallengerArm(challengerExports, accountIds.challenger, accountContract,
      feeScenarioApply),
    createCashControlArm(accountIds.cash, accountContract)
  ];
  const config = {
    ...input, accountContract, provider, testOnly: false, researchSourceSha256,
    challengerExports, comparisonExports, comparisonEngine, arms,
    ...(accountContract.version === 2 ? {
      feeScenarioCompare: compare, feeScenarioApply
    } : {})
  };
  if (config.configSha256 !== pairedConfigDigest(config)) {
    throw new Error("CONFIG_IDENTITY_MISMATCH");
  }
  return runPairedForward(config, false);
}

export async function runSpotPaperPairedSynthetic(input) {
  if (input?.testOnly !== true ||
      input.provider?.sourceId !== SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID) {
    throw new Error("SYNTHETIC_TEST_ADAPTER_REQUIRED");
  }
  return runPairedForward(input, true);
}
