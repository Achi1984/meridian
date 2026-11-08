import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceChallengeState, createChallengeState, getExposureGate, replayChallengeState
} from "../scripts/paper-capital-challenge/guard.mjs";
import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from
  "../scripts/paper-capital-challenge/policy.mjs";

const BASE = Date.UTC(2025, 0, 1);
const IDENTITY = { campaignId: POLICY.campaignId, currency: POLICY.currency };

function observation(id, netEquityCents, observedAtMs, overrides = {}) {
  const {
    currency = "USD",
    monetaryUnit = POLICY.monetaryUnit,
    marketPair = POLICY.marketPair,
    strategyVersion = "strategy-v1",
    status = "FRESH",
    asOfMs = observedAtMs,
    bidQuoteAtMs = asOfMs,
    maxAgeMs = 1_000,
    quoteSourceId = "usd-book-1",
    cashCents = netEquityCents,
    inventoryAtAdverseBidCents = 0,
    unbookedAccruedFeesCents = 0,
    modeledExitCostsCents = 0,
    valuationCurrency = currency,
    method = "CASH_PLUS_EXECUTABLE_ADVERSE_BID",
    campaignId = POLICY.campaignId
  } = overrides;
  return {
    id, campaignId, currency, strategyVersion, observedAtMs, netEquityCents,
    valuation: {
      status, currency: valuationCurrency, monetaryUnit, marketPair, method,
      asOfMs, bidQuoteAtMs, maxAgeMs,
      quoteSourceId, cashCents, inventoryAtAdverseBidCents,
      unbookedAccruedFeesCents, modeledExitCostsCents
    }
  };
}

function advance(state, id, equity, offset, overrides) {
  return advanceChallengeState(state, observation(id, equity, BASE + offset, overrides));
}

test("policy is an isolated, immutable, disabled USD paper campaign", () => {
  assert.equal(POLICY.currency, "USD");
  assert.equal(POLICY.monetaryUnit, "USD_CENTS");
  assert.equal(POLICY.marketPair, "BTC/USD");
  assert.equal(POLICY.initialCapitalCents, 100_000);
  assert.equal(POLICY.maxDrawdownCents, 10_000);
  assert.equal(POLICY.enabled, false);
  assert.equal(POLICY.executionMode, "PAPER_ONLY");
  assert.equal(POLICY.leverageAllowed, false);
  assert.equal(POLICY.borrowingAllowed, false);
  assert.equal(POLICY.topUpsAllowed, false);
  assert.equal(POLICY.resetsAllowed, false);
  assert.equal(POLICY.executionEnabled, false);
  assert.ok(Object.isFrozen(POLICY));
  assert.throws(() => createChallengeState({ campaignId: "BTC_EUR_PILOT", currency: "USD" }),
    /CAMPAIGN_ID_MISMATCH/);
  assert.throws(() => createChallengeState({ ...IDENTITY, currency: "EUR" }),
    /CURRENCY_MISMATCH/);
});

test("1000 to 900 cents-in-dollars latches the absolute drawdown pause", () => {
  let state = createChallengeState(IDENTITY);
  state = advance(state, "initial", 100_000, 1_000);
  state = advance(state, "threshold", 90_000, 2_000);
  assert.equal(state.highWaterEquityCents, 100_000);
  assert.equal(state.paused, true);
  assert.equal(state.pauseObservationId, "threshold");
  assert.deepEqual(getExposureGate(state, BASE + 2_000), {
    allowed: false, reason: "DRAWDOWN_PAUSED"
  });
});

test("drawdown is measured from the all-time peak, not initial capital", () => {
  let state = createChallengeState(IDENTITY);
  state = advance(state, "initial", 100_000, 1_000);
  state = advance(state, "new-peak", 110_000, 2_000);
  state = advance(state, "peak-drawdown", 100_000, 3_000);
  assert.equal(state.highWaterEquityCents, 110_000);
  assert.equal(state.paused, true);
});

test("1099.99 to 1000 remains just short of the absolute threshold", () => {
  let state = createChallengeState(IDENTITY);
  state = advance(state, "peak", 109_999, 1_000);
  state = advance(state, "near-threshold", 100_000, 2_000);
  assert.equal(state.paused, false);
  assert.equal(state.highWaterEquityCents, 109_999);
});

test("adverse open-inventory loss and unbooked fees trigger the guard", () => {
  let inventoryState = createChallengeState(IDENTITY);
  inventoryState = advance(inventoryState, "inventory-initial", 100_000, 1_000);
  inventoryState = advance(inventoryState, "inventory-loss", 90_000, 2_000, {
    cashCents: 85_000, inventoryAtAdverseBidCents: 5_000
  });
  assert.equal(inventoryState.observations.at(-1).netEquityCents, 90_000);
  assert.equal(inventoryState.paused, true);
  assert.equal(inventoryState.observations.at(-1).valuation.inventoryAtAdverseBidCents, 5_000);

  let feeState = createChallengeState(IDENTITY);
  feeState = advance(feeState, "fee-initial", 100_000, 1_000);
  feeState = advance(feeState, "fee-loss", 90_000, 2_000, {
    cashCents: 100_000, unbookedAccruedFeesCents: 10_000
  });
  assert.equal(feeState.observations.at(-1).netEquityCents, 90_000);
  assert.equal(feeState.paused, true);
});

test("drawdown overshoot is retained as observed and does not flatten positions", () => {
  let state = createChallengeState(IDENTITY);
  state = advance(state, "initial", 100_000, 1_000);
  state = advance(state, "gap-overshoot", 87_500, 2_000);
  assert.equal(state.observations.at(-1).netEquityCents, 87_500);
  assert.equal(state.highWaterEquityCents, 100_000);
  assert.equal(state.pauseObservationId, "gap-overshoot");
  assert.equal(state.position, undefined);
});

test("missing and stale valuations fail closed and cannot advance the high-water mark", () => {
  const state = createChallengeState(IDENTITY);
  assert.equal(getExposureGate(state, BASE + 1_000).reason, "NO_FRESH_VALUATION");
  assert.throws(() => advanceChallengeState(state, observation("missing", 110_000, BASE + 1_000, {
    status: "MISSING"
  })), /MISSING_OR_UNSUPPORTED_VALUATION/);
  assert.throws(() => advanceChallengeState(state, observation("stale", 110_000, BASE + 20_000, {
    asOfMs: BASE, bidQuoteAtMs: BASE
  })), /STALE_OR_MISSING_VALUATION/);
  assert.equal(state.highWaterEquityCents, 100_000);
  assert.equal(getExposureGate(state, BASE + 1_000).allowed, false);
  const fresh = advance(state, "fresh", 100_000, 1_000);
  assert.equal(getExposureGate(fresh, BASE + 2_001).reason,
    "STALE_OR_MISSING_VALUATION");
});

test("restart replay preserves the peak and pause across strategy versions", () => {
  let state = createChallengeState(IDENTITY);
  state = advance(state, "initial", 100_000, 1_000);
  state = advance(state, "new-peak", 110_000, 2_000);
  state = advance(state, "loss", 100_000, 3_000, { strategyVersion: "strategy-v2" });
  const resumed = replayChallengeState({
    ...IDENTITY, policyVersion: POLICY.version,
    observations: JSON.parse(JSON.stringify(state.observations))
  });
  assert.equal(resumed.highWaterEquityCents, 110_000);
  assert.equal(resumed.paused, true);
  assert.equal(resumed.pauseObservationId, "loss");
  assert.equal(resumed.observations.at(-1).strategyVersion, "strategy-v2");
  const nextVersion = advance(resumed, "later", 110_000, 4_000, {
    strategyVersion: "strategy-v3"
  });
  assert.equal(nextVersion.paused, true);
  assert.equal(nextVersion.pauseObservationId, "loss");
  assert.equal(getExposureGate(nextVersion, BASE + 4_000).reason, "DRAWDOWN_PAUSED");
});

test("exact duplicate delivery is idempotent and contradictory or unordered events fail", () => {
  let state = createChallengeState(IDENTITY);
  const first = observation("first", 100_000, BASE + 1_000);
  state = advanceChallengeState(state, first);
  state = advance(state, "second", 101_000, 2_000);
  assert.deepEqual(advanceChallengeState(state, first), state);
  assert.throws(() => advanceChallengeState(state, {
    ...first, netEquityCents: 99_000,
    valuation: { ...first.valuation, cashCents: 99_000 }
  }), /CONTRADICTORY_DUPLICATE_OBSERVATION/);
  assert.throws(() => advance(state, "out-of-order", 100_000, 1_500),
    /OBSERVATION_OUT_OF_ORDER/);
});

test("EUR, unsafe numbers, inconsistent equity, and forged resume snapshots are rejected", () => {
  const state = createChallengeState(IDENTITY);
  assert.throws(() => advanceChallengeState(state,
    observation("eur", 100_000, BASE + 1_000, { currency: "EUR" })),
  /CURRENCY_MISMATCH/);
  assert.throws(() => advanceChallengeState(state,
    observation("valuation-eur", 100_000, BASE + 1_000, { valuationCurrency: "EUR" })),
  /CURRENCY_MISMATCH/);
  for (const marketPair of ["BTC/EUR", "BTC/USDT", "BTC/USDC"]) {
    assert.throws(() => advanceChallengeState(state,
      observation(`pair-${marketPair.replace("/", "-")}`, 100_000, BASE + 1_000, { marketPair })),
    /MARKET_PAIR_MISMATCH/);
  }
  assert.throws(() => advanceChallengeState(state,
    observation("non-usd-cents", 100_000, BASE + 1_000, { monetaryUnit: "USDT_CENTS" })),
  /MISSING_OR_UNSUPPORTED_VALUATION/);
  assert.throws(() => advanceChallengeState(state,
    observation("unsafe", Number.MAX_SAFE_INTEGER + 1, BASE + 1_000)),
  /INVALID_/);
  assert.throws(() => advanceChallengeState(state,
    observation("mismatch", 99_999, BASE + 1_000, { cashCents: 100_000 })),
  /NET_EQUITY_MISMATCH/);
  const changedSnapshot = { ...state, highWaterEquityCents: 90_000 };
  assert.equal(getExposureGate(changedSnapshot, BASE + 1_000).reason, "INVALID_STATE");
  assert.throws(() => advanceChallengeState(changedSnapshot,
    observation("resume", 100_000, BASE + 1_000)), /STATE_REPLAY_MISMATCH/);
});
