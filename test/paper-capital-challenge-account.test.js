import test from "node:test";
import assert from "node:assert/strict";
import {
  appendUsdAccountEvent, createUsdAccountJournal, createUsdPersistencePayload, replayUsdAccount
} from "../scripts/paper-capital-challenge/account.mjs";
import { createUsdObservation } from "../scripts/paper-capital-challenge/valuation.mjs";
import {
  USD_MODELED_COSTS, validateUsdQuote
} from "../scripts/paper-capital-challenge/account-contract.mjs";
import {
  advanceChallengeState, createChallengeState, getExposureGate, replayChallengeState
} from "../scripts/paper-capital-challenge/guard.mjs";
import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from
  "../scripts/paper-capital-challenge/policy.mjs";

// All prices and times below are synthetic fixtures, not market acquisitions or fills.
const BASE = Date.UTC(2025, 0, 1);
const BINDING = {
  campaignId: POLICY.campaignId, currency: "USD",
  strategyVersion: "synthetic-account-test-v1", costVersion: USD_MODELED_COSTS.version
};
function quote(index, bid = "10000", ask = bid, overrides = {}) {
  return {
    schemaVersion: "NATIVE_BTC_USD_QUOTE_V1", id: `quote-${index}`,
    marketPair: "BTC/USD", baseCurrency: "BTC", quoteCurrency: "USD",
    sourceId: "synthetic-usd-book", nativeInstrument: "BTC/USD",
    evidenceKind: "SYNTHETIC_FIXTURE", bid, ask,
    quotedAtMs: BASE + index * 1000, receivedAtMs: BASE + index * 1000,
    maxAgeMs: 10_000, ...overrides
  };
}
function event(index, action = "HOLD", options = {}) {
  return {
    id: `event-${index}`, ...BINDING, observedAtMs: BASE + index * 1000,
    action, quote: quote(index), quantityBtc: ["BUY", "SELL"].includes(action) ? "0.009" : null,
    feeCents: 0, reason: null, ...options
  };
}
function journal(events = []) {
  return { ...createUsdAccountJournal(BINDING), events };
}
function replay(events) {
  return replayUsdAccount(journal(events));
}

test("synthetic buy/hold/sell books exact taker fees and counts exit/slippage once", () => {
  const inputs = [
    event(0, "BUY"),
    event(1, "HOLD"),
    event(2, "SELL")
  ];
  const before = structuredClone(inputs);
  const result = replay(inputs);
  assert.deepEqual(inputs, before);
  const buy = result.entries[0];
  assert.equal(buy.fill.notionalCents, 9009);
  assert.equal(buy.fill.feeCents, 19);
  assert.equal(buy.fill.priceNumerator, "10010000000000000");
  assert.equal(buy.fill.priceDenominator, "1000000000000");
  assert.equal(buy.observation.valuation.cashCents, 90972);
  assert.equal(buy.observation.valuation.inventoryAtAdverseBidCents, 8991);
  assert.equal(buy.observation.valuation.modeledExitCostsCents, 18);
  assert.equal(buy.observation.netEquityCents, 99945);
  assert.deepEqual(result.entries[1].observation.valuation, {
    ...buy.observation.valuation, asOfMs: BASE + 1000, bidQuoteAtMs: BASE + 1000
  });
  assert.equal(result.entries[2].fill.notionalCents, 8991);
  assert.equal(result.entries[2].fill.feeCents, 18);
  assert.deepEqual(result.account, {
    cashCents: 99945, inventorySatoshis: "0", unbookedAccruedFeesCents: 0
  });
  assert.equal(result.entries[2].observation.valuation.modeledExitCostsCents, 0);
  assert.equal(result.activity.modeledFeesCents, 37);
  assert.equal(result.activity.turnoverCents, 18000);
  assert.equal(result.activity.modeledSlippageCents, 18);
  assert.equal(result.activity.netPnlCents, -55);
  assert.equal(result.activity.completedRoundTrips, 1);
  assert.equal(result.activity.exposureDurationMs, 2000);
  assert.equal(result.activity.activityCriterionMet, true);
  assert.equal(result.activity.profitableCandidateEstablished, false);
  assert.equal(result.authorization.executionAuthorized, false);
  assert.equal(result.authorization.productionExposureGate.reason, "POLICY_DISABLED");
  assert.equal(Object.isFrozen(result.entries[0].fill), true);
  assert.equal(Object.isFrozen(inputs[0]), false);
});

test("ask-plus and bid-minus fills never use midpoint or pretend maker liquidity", () => {
  const result = replay([
    event(0, "BUY", { quote: quote(0, "9900", "10000") }),
    event(1, "SELL", { quote: quote(1, "9900", "10000") })
  ]);
  assert.equal(result.entries[0].fill.notionalCents, 9009);
  assert.equal(result.entries[1].fill.notionalCents, 8901);
  assert.equal(result.entries[1].fill.liquidity, "MODELED_TAKER");
  assert.equal(result.entries[1].fill.provenance, "ASSUMED_COUNTERFACTUAL");
});

test("fractional cents and sub-cent exits round conservatively with exact decimal input", () => {
  const result = replay([
    event(0, "BUY", { quantityBtc: "0.00000001", quote: quote(0, "10000.00000001") }),
    event(1, "SELL", { quantityBtc: "0.00000001", quote: quote(1, "10000.00000001") })
  ]);
  assert.equal(result.entries[0].fill.notionalCents, 1);
  assert.equal(result.entries[0].fill.feeCents, 1);
  assert.equal(result.entries[1].fill.notionalCents, 0);
  assert.equal(result.entries[1].fill.feeCents, 1);
  assert.equal(result.account.cashCents, 99997);
  assert.equal(result.entries[0].observation.netEquityCents, 99997);
});

test("additional accrued fees reduce equity once; settling them preserves equity", () => {
  const result = replay([
    event(0, "BUY"), event(1, "ACCRUE_FEE", { feeCents: 101 }),
    event(2, "SETTLE_FEES"), event(3, "SELL")
  ]);
  assert.equal(result.entries[1].observation.netEquityCents, 99844);
  assert.equal(result.entries[1].observation.valuation.unbookedAccruedFeesCents, 101);
  assert.equal(result.entries[2].observation.netEquityCents, 99844);
  assert.equal(result.entries[2].observation.valuation.unbookedAccruedFeesCents, 0);
  assert.equal(result.account.cashCents, 99844);
  assert.equal(result.activity.additionalAccruedFeesCents, 101);
  assert.equal(result.activity.modeledFeesCents, 37);
});

test("open inventory raises high-water then breaches USD100 with overshoot; pause survives replay", () => {
  const inputs = [
    event(0, "BUY"),
    event(1, "HOLD", { quote: quote(1, "20000") }),
    event(2, "HOLD", { quote: quote(2, "5000") }),
    event(3, "BUY", { quote: quote(3, "5000") }),
    event(4, "SELL", { quantityBtc: "0.004", quote: quote(4, "5000") }),
    event(5, "SELL", { quantityBtc: "0.005", quote: quote(5, "5000") }),
    event(6, "BUY", { quote: quote(6, "5000") })
  ];
  const open = replay(inputs.slice(0, 3));
  assert.equal(open.guardState.highWaterEquityCents, 108918);
  assert.equal(open.account.inventorySatoshis, "900000");
  assert.equal(open.activity.netEquityCents, 95458);
  assert.equal(open.activity.maxDrawdownCents, 13460);
  assert.equal(open.guardState.paused, true);
  assert.equal(open.guardState.pauseObservationId, "event-2");
  const restarted = replayUsdAccount(JSON.parse(JSON.stringify(journal(inputs))));
  assert.deepEqual(restarted, replay(inputs));
  assert.equal(restarted.guardState.paused, true);
  assert.equal(restarted.guardState.highWaterEquityCents, 108918);
  assert.equal(restarted.entries[3].fill, null);
  assert.equal(restarted.entries[3].skipReason, "DRAWDOWN_PAUSED");
  assert.equal(restarted.entries[4].fill.side, "SELL");
  assert.equal(restarted.entries[5].fill.side, "SELL");
  assert.equal(restarted.account.inventorySatoshis, "0");
  assert.equal(restarted.activity.completedRoundTrips, 1);
  assert.equal(restarted.activity.skippedEntryReasons.DRAWDOWN_PAUSED, 2);
  assert.equal(restarted.authorization.productionExposureGate.reason, "DRAWDOWN_PAUSED");
  assert.throws(() => replay([...inputs.slice(0, 3), event(3, "SELL", {
    quantityBtc: "0.01", quote: quote(3, "5000")
  })]), /EXIT_EXCEEDS_INVENTORY/);
  assert.throws(() => replay([...inputs.slice(0, 3), event(3, "SELL", {
    quote: quote(3, "5000", "5000", { quotedAtMs: BASE - 20000 })
  })]), /STALE_OR_FUTURE_QUOTE/);
});

test("exact USD100 high-water breach with open BTC is not rounded away", () => {
  const result = replay([
    event(0, "BUY"),
    event(1, "HOLD", { quote: quote(1, "20000") }),
    event(2, "HOLD"),
    event(3, "ACCRUE_FEE", { feeCents: 1026 }),
    event(4, "ACCRUE_FEE", { feeCents: 1 })
  ]);
  assert.equal(result.entries[3].observation.netEquityCents, 98919);
  assert.equal(replay(result.entries.slice(0, 4).map(entry => entry.event)).guardState.paused, false);
  assert.equal(result.entries[4].observation.netEquityCents, 98918);
  assert.equal(result.guardState.highWaterEquityCents, 108918);
  assert.equal(result.activity.maxDrawdownCents, 10000);
  assert.equal(result.guardState.pauseObservationId, "event-4");
  assert.equal(result.account.inventorySatoshis, "900000");
});

test("account bridge observations replay through the real existing guard unchanged", () => {
  const input = journal([event(0, "BUY"), event(1, "HOLD"), event(2, "SELL")]);
  const payload = createUsdPersistencePayload(input);
  const history = replayChallengeState({
    campaignId: BINDING.campaignId, currency: "USD", observations: payload.guardObservations
  });
  assert.deepEqual(history, payload.guardState);
  let advanced = createChallengeState({ campaignId: BINDING.campaignId, currency: "USD" });
  for (const observation of payload.guardObservations) {
    advanced = advanceChallengeState(advanced, observation);
  }
  assert.deepEqual(advanced, history);
  assert.equal(getExposureGate(history, BASE + 2000).allowed, false);
  assert.equal(payload.accountTransactionDurability, "NOT_IMPLEMENTED");
  assert.deepEqual(payload.transactions[0].event, input.events[0]);
  assert.equal(payload.transactions[0].fill.costVersion, payload.costs.version);
});

test("cash-only is not an active candidate; skips, provisional sizing and cash reserve are reported", () => {
  assert.equal(replay([]).activity.activityCriterionMet, false);
  const cashOnly = replay([
    event(0, "SKIP_ENTRY", { reason: "STRATEGY_NO_SIGNAL" }),
    event(1, "BUY", { quantityBtc: "0.01" }),
    event(2, "HOLD")
  ]);
  assert.equal(cashOnly.activity.completedRoundTrips, 0);
  assert.equal(cashOnly.activity.exposureDurationMs, 0);
  assert.equal(cashOnly.activity.activityCriterionMet, false);
  assert.equal(cashOnly.activity.skippedEntryReasons.STRATEGY_NO_SIGNAL, 1);
  assert.equal(cashOnly.activity.skippedEntryReasons.MAX_ENTRY_EXCEEDED, 1);
  const maximum = replay([event(0, "BUY", { quantityBtc: "0.00999" })]);
  assert.equal(maximum.entries[0].fill.notionalCents, 10000);
  assert.equal(maximum.entries[0].fill.feeCents, 20);
  assert.equal(maximum.account.cashCents, 89980);
  const held = replay([event(0, "BUY"), event(1, "BUY")]);
  assert.equal(held.activity.skippedEntryReasons.OPEN_INVENTORY, 1);
  assert.equal(held.activity.activityCriterionMet, false);
  const encumbered = replay([
    event(0, "ACCRUE_FEE", { feeCents: 95000 }), event(1, "BUY")
  ]);
  assert.equal(encumbered.entries[1].skipReason, "DRAWDOWN_PAUSED");
  assert.throws(() => replay([
    event(0, "ACCRUE_FEE", { feeCents: 100001 }), event(1, "SETTLE_FEES")
  ]), /INSUFFICIENT_CASH_TO_SETTLE_FEES/);
  assert.equal(replay([event(0, "ACCRUE_FEE", { feeCents: 100001 })])
    .activity.netEquityCents, -1);
});

test("native currency/source/instrument, timestamps and quote values fail closed", () => {
  for (const currency of ["EUR", "USDT", "USDC"]) {
    assert.throws(() => replay([event(0, "BUY", {
      quote: quote(0, "10000", "10000", { quoteCurrency: currency, marketPair: `BTC/${currency}` })
    })]), /NATIVE_USD_INSTRUMENT_REQUIRED/);
  }
  for (const overrides of [
    { nativeInstrument: "BTC/EUR" }, { baseCurrency: "ETH" }, { sourceId: "" },
    { quotedAtMs: BASE + 1 }, { receivedAtMs: BASE + 1 },
    { quotedAtMs: BASE - 10001 }, { maxAgeMs: 10001 }, { maxAgeMs: 0 },
    { quotedAtMs: NaN }, { receivedAtMs: Number.MAX_SAFE_INTEGER + 1 },
    { bid: "10001", ask: "10000" }, { bid: "0" }, { ask: "-1" },
    { bid: 10000 }, { bid: "1e4" }, { ask: "Infinity" }, { bid: "NaN" },
    { bid: "10000.000000001" }, { bid: "9999999999999999" },
    { evidenceKind: "AUTHENTICATED_LIVE" }, { schemaVersion: "other" }
  ]) assert.throws(() => replay([event(0, "BUY", { quote: quote(0, "10000", "10000", overrides) })]));
  assert.throws(() => replay([event(0, "SELL")]), /EXIT_EXCEEDS_INVENTORY/);
  assert.throws(() => replay([event(0, "TOP_UP")]), /INVALID_ACTION/);
  assert.throws(() => replay([event(0, "RESET")]), /INVALID_ACTION/);
  assert.throws(() => replay([event(0, "BUY", { quantityBtc: "-1" })]), /INVALID_QUANTITY/);
});

test("ordered events, contradictory duplicate IDs, immutable bindings and unsafe numbers are rejected", () => {
  const first = event(0, "BUY");
  assert.deepEqual(replay([first, first, event(1, "SELL")]), replay([first, event(1, "SELL")]));
  const original = journal([first]);
  const saved = structuredClone(original);
  assert.deepEqual(appendUsdAccountEvent(original, first), original);
  assert.deepEqual(original, saved);
  assert.equal(Object.isFrozen(original.events[0]), false);
  assert.throws(() => replay([first, { ...first, quantityBtc: "0.008" }]), /CONTRADICTORY_DUPLICATE_EVENT/);
  assert.throws(() => appendUsdAccountEvent(original, { ...first, quantityBtc: "0.008" }),
    /CONTRADICTORY_DUPLICATE_EVENT/);
  assert.throws(() => replay([first, event(1, "HOLD", { observedAtMs: BASE })]),
    /STALE_OR_FUTURE_QUOTE|ACCOUNT_EVENT_OUT_OF_ORDER/);
  assert.throws(() => replay([event(1), event(0)]), /ACCOUNT_EVENT_OUT_OF_ORDER/);
  assert.throws(() => replay([first, event(1, "HOLD", {
    observedAtMs: BASE, quote: quote(0)
  })]), /ACCOUNT_EVENT_OUT_OF_ORDER/);
  assert.throws(() => replay([event(0), event(1, "HOLD", {
    quote: quote(1, "10000", "10000", { quotedAtMs: BASE - 1 })
  })]), /QUOTE_OUT_OF_ORDER/);
  assert.throws(() => replay([event(0), event(1, "HOLD", {
    quote: quote(0, "10001", "10001")
  })]), /CONTRADICTORY_DUPLICATE_QUOTE/);
  for (const overrides of [
    { currency: "EUR" }, { campaignId: "other" }, { strategyVersion: "other" },
    { costVersion: "other" }, { observedAtMs: 1.5 }, { observedAtMs: Infinity },
    { feeCents: Number.MAX_SAFE_INTEGER + 1 }, { feeCents: "10" }, { feeCents: -1 },
    { quantityBtc: 0.009 }, { quantityBtc: "0" }, { quantityBtc: "1e-8" },
    { quantityBtc: "9999999999999999" }, { feeCents: 1 }, { extra: "unbound" }
  ]) assert.throws(() => replay([event(0, "BUY", overrides)]));
  assert.throws(() => replayUsdAccount({ ...original, account: { cashCents: 100000 } }), /INVALID_ACCOUNT_JOURNAL/);
  const accessor = quote(0);
  Object.defineProperty(accessor, "bid", { enumerable: true, get() { throw new Error("getter ran"); } });
  assert.throws(() => validateUsdQuote(accessor, BASE), /INVALID_QUOTE/);
});

test("quote identity preserves colon-containing source/ID tuples without aliases", () => {
  const firstQuote = quote(0, "10000", "10000", { sourceId: "a:b", id: "c" });
  const secondQuote = quote(1, "10001", "10001", { sourceId: "a", id: "b:c" });
  const events = [
    event(0, "HOLD", { quote: firstQuote }),
    event(1, "HOLD", { quote: secondQuote })
  ];
  const result = replay(events);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map(entry => [entry.event.quote.sourceId, entry.event.quote.id]),
    [["a:b", "c"], ["a", "b:c"]]);
  for (const existing of [firstQuote, secondQuote]) {
    assert.throws(() => replay([...events, event(2, "HOLD", {
      quote: { ...existing, bid: "9999" }
    })]), /CONTRADICTORY_DUPLICATE_QUOTE/);
  }
});

test("pure valuation validates account and leaves caller input unchanged", () => {
  const args = {
    binding: BINDING, account: { cashCents: 90972, inventorySatoshis: "900000",
      unbookedAccruedFeesCents: 100 },
    quote: quote(0), id: "standalone", observedAtMs: BASE
  };
  const before = structuredClone(args);
  assert.equal(createUsdObservation(args).netEquityCents, 99845);
  assert.deepEqual(args, before);
  assert.equal(Object.isFrozen(args.account), false);
  for (const account of [
    { ...args.account, cashCents: -1 }, { ...args.account, inventorySatoshis: "-1" },
    { ...args.account, inventorySatoshis: "1e8" },
    { ...args.account, inventorySatoshis: "9007199254740992" },
    { ...args.account, unbookedAccruedFeesCents: Infinity }
  ]) assert.throws(() => createUsdObservation({ ...args, account }));
  assert.throws(() => createUsdObservation({ ...args, id: "" }), /INVALID_OBSERVATION_ID/);
  assert.throws(() => createUsdObservation({
    ...args, account: { ...args.account, inventorySatoshis: "9007199254740991" },
    quote: quote(0, "90000000")
  }), /UNSAFE_NOTIONAL/);
});

test("journal never truncates the existing 256-observation restart bound", () => {
  const events = Array.from({ length: 256 }, (_, index) => event(index));
  const result = replay(events);
  assert.equal(result.guardState.observations.length, 256);
  assert.throws(() => replay([...events, event(256)]), /ACCOUNT_JOURNAL_LIMIT_REACHED/);
  assert.throws(() => appendUsdAccountEvent(journal(events), event(256)), /ACCOUNT_JOURNAL_LIMIT_REACHED/);
  assert.equal(appendUsdAccountEvent(journal(events), events[0]).events.length, 256);
});
