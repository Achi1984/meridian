import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createPaperExecutionStep} from "../scripts/memecoin-paper/execution-step.mjs";
import {CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {normalizeExactCosts} from "../scripts/memecoin-paper-execution-evidence/normalize.mjs";
import {
  createMarketQuoteAdapter, reviewScenarioConfigSha256
} from "../scripts/memecoin-paper/market-quote-adapter.mjs";
import {
  SYNTHETIC_MINT, SYNTHETIC_POOL, SYNTHETIC_QUOTE, SYNTHETIC_SOURCE
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {END, RUN, START, authorization} from "./fixtures/memecoin-paper-execution-step/scenario.mjs";
import {syntheticOrderResponse} from "./fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs";

const NOW = Date.parse("2026-11-01T18:00:00Z");
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: SYNTHETIC_MINT,
  pool: SYNTHETIC_POOL,
  quote: SYNTHETIC_QUOTE,
  decimals: 6
});

function request(overrides = {}) {
  return {
    identity: IDENTITY,
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: NOW - 2_000,
    authorizedAt: NOW - 1_000,
    slippageBps: 50,
    ...overrides
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json", ...headers}
  });
}

function entryResponse(overrides = {}) {
  return syntheticOrderResponse({
    inputMint: SYNTHETIC_QUOTE,
    outputMint: SYNTHETIC_MINT,
    ...overrides
  });
}

function adapterFor(body, options = {}) {
  const calls = [];
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => NOW,
    transport: async (url, init) => {
      calls.push({url, init});
      return typeof body === "function" ? body(url, init) : response(body);
    },
    ...options
  });
  return {adapter, calls};
}

function settleWithin(promise, timeoutMs = 500) {
  let timeoutHandle;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("quote did not settle within the test bound")), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeoutHandle));
}

function reviewScenario(caseName = "BASELINE", overrides = {}) {
  const assumptions = caseName === "STRESS"
    ? {scenarioId: "MEMECOIN_PAPER_QUOTE_ADVERSE_V1_STRESS",
      adverseAdjustmentBps: 300, networkReserveCents: "50"}
    : {scenarioId: "MEMECOIN_PAPER_QUOTE_ADVERSE_V1_BASELINE",
      adverseAdjustmentBps: 100, networkReserveCents: "10"};
  const config = {
    optIn: true,
    scenarioId: assumptions.scenarioId,
    scenarioVersion: "1",
    scenario: caseName,
    identity: {...IDENTITY},
    usdcMint: SYNTHETIC_QUOTE,
    usdcDecimals: 6,
    usdcUsdMicrosPerToken: "1000000",
    quoteBasis: "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS",
    adverseAdjustmentBps: assumptions.adverseAdjustmentBps,
    networkReserveCents: assumptions.networkReserveCents,
    feeCents: "0",
    spreadCents: "0",
    priceImpactCents: "0",
    zeroChargeDisposition: "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS",
    ...overrides
  };
  config.reviewEvidence ??= {
    evidenceId: "method-review-1",
    evidenceSha256: "a".repeat(64),
    scenarioConfigSha256: reviewScenarioConfigSha256(config),
    identity: {...config.identity},
    reviewerRef: "independent-methodology-review",
    purpose: "OFFLINE_SCENARIO_REVIEW_ONLY",
    decision: "APPROVE_SCENARIO_REVIEW_ONLY",
    recordedAt: NOW - 2_500
  };
  return config;
}

test("disabled adapter is inert and exposes no executable quote", async () => {
  const result = await createMarketQuoteAdapter().getPaperQuote();
  assert.equal(result.status, "DISABLED");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.quoteCandidate, null);
  assert.equal(result.costEvidence.status, "UNKNOWN");
});

test("read-only entry quote is identity-bound and uses exact units with a post-response receipt clock", async () => {
  const fixture = entryResponse();
  let clockCalls = 0;
  const {adapter, calls} = adapterFor(fixture.body, {
    clock: () => NOW + clockCalls++ * 75
  });
  const result = await adapter.getPaperQuote(request());

  assert.equal(fixture.fixtureLabel, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(call.url);
  assert.equal(url.origin, "https://api.jup.ag");
  assert.equal(url.pathname, "/swap/v2/order");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    inputMint: SYNTHETIC_QUOTE,
    outputMint: SYNTHETIC_MINT,
    amount: "100000000",
    swapMode: "ExactIn",
    slippageBps: "50"
  });
  assert.equal(url.searchParams.has("taker"), false);
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.redirect, "error");
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.referrerPolicy, "no-referrer");
  assert.deepEqual({...call.init.headers}, {accept: "application/json"});
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.sourceProvenance, "INJECTED_TRANSPORT_NOT_AUTHENTICATED");
  assert.equal(result.request.side, "ENTRY");
  assert.equal(result.request.amountAtoms, "100000000");
  assert.deepEqual(result.quoteCandidate.identity, IDENTITY);
  assert.equal(result.quoteCandidate.side, "ENTRY");
  assert.equal(result.quoteCandidate.amount.mint, SYNTHETIC_QUOTE);
  assert.equal(result.quoteCandidate.amount.decimals, 6);
  assert.deepEqual(result.quoteCandidate.priceQuotePerBase, {
    numerator: "5000000",
    denominator: "852873",
    unit: "quote-token per base-token",
    source: "exact raw inAmount/outAmount and caller-supplied decimals; not a USD price"
  });
  assert.equal(result.quoteCandidate.priceMicros, null);
  assert.equal(result.quoteCandidate.executable, false);
  assert.equal(result.quoteCandidate.sourceTime.status, "NOT_PROVIDED_BY_DOCUMENTED_RESPONSE");
  assert.equal(result.quoteCandidate.receiptTime.observedAt, NOW + 75);
  assert.equal(result.quoteCandidate.causalTime.observedAt, NOW - 1_000);
  assert.equal(result.quoteCandidate.route.binding.status, "SINGLE_POOL_MATCH");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.costEvidence.status, "UNKNOWN");
  for (const component of Object.values(result.costEvidence.components)) {
    assert.equal(component.status, "UNKNOWN");
    assert.equal(component.amount, null);
  }
  assert.deepEqual(result.costEvidence.reported.platformFee, {
    amount: "100", feeBps: 2, feeMint: SYNTHETIC_MINT
  });
});

test("exit quote binds the position-open time, direction, and raw base amount", async () => {
  const fixture = syntheticOrderResponse({
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    inAmount: "1000000",
    outAmount: "5842157",
    otherAmountThreshold: "5812946"
  });
  let clockCalls = 0;
  const {adapter, calls} = adapterFor(fixture.body, {
    clock: () => NOW + clockCalls++ * 50
  });
  const exitRequest = request({
    side: "EXIT",
    amountAtoms: "1000000",
    positionOpenedAt: NOW - 1_000
  });
  delete exitRequest.authorizedAt;
  const result = await adapter.getPaperQuote(exitRequest);
  const url = new URL(calls[0].url);

  assert.equal(url.searchParams.get("inputMint"), SYNTHETIC_MINT);
  assert.equal(url.searchParams.get("outputMint"), SYNTHETIC_QUOTE);
  assert.equal(url.searchParams.get("amount"), "1000000");
  assert.equal(result.quoteCandidate.side, "EXIT");
  assert.equal(result.quoteCandidate.amount.mint, SYNTHETIC_MINT);
  assert.equal(result.quoteCandidate.causalTime.observedAt, NOW - 1_000);
  assert.equal(result.quoteCandidate.receiptTime.observedAt, NOW + 50);
  assert.equal(result.quoteCandidate.route.binding.status, "SINGLE_POOL_MATCH");
  assert.equal(result.authorizationEligible, false);
});

test("identity mismatch and multi-pool routes remain unavailable", async () => {
  const mismatch = syntheticOrderResponse({
    inputMint: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"
  });
  const mismatchResult = await adapterFor(mismatch.body).adapter.getPaperQuote(request());
  assert.ok(mismatchResult.reasons.includes("RESPONSE_MINT_MISMATCH"));
  assert.equal(mismatchResult.quoteCandidate, null);

  const multiLeg = entryResponse({
    routePlan: [
      ...entryResponse().body.routePlan,
      {
        ...entryResponse().body.routePlan[0],
        swapInfo: {
          ...entryResponse().body.routePlan[0].swapInfo,
          ammKey: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
        }
      }
    ]
  });
  const multiResult = await adapterFor(multiLeg.body).adapter.getPaperQuote(request());
  assert.equal(multiResult.quoteCandidate.route.binding.status, "MULTI_LEG_UNBOUND");
  assert.ok(multiResult.reasons.includes("SELECTED_POOL_ROUTE_NOT_IDENTITY_BOUND"));
  assert.equal(multiResult.authorizationEligible, false);
});

test("future chronology, malformed decimals, and caller authentication claims are rejected before transport", async () => {
  let calls = 0;
  const {adapter} = adapterFor(syntheticOrderResponse().body, {
    transport: async () => {
      calls += 1;
      return response(syntheticOrderResponse().body);
    }
  });
  const future = await adapter.getPaperQuote(request({candidateSampledAt: NOW + 1}));
  const decimals = await adapter.getPaperQuote(request({quoteDecimals: 19}));
  const authClaim = await adapter.getPaperQuote(request({sourceAuthenticated: true}));
  assert.equal(future.status, "UNAVAILABLE");
  assert.equal(decimals.status, "UNAVAILABLE");
  assert.equal(authClaim.status, "UNAVAILABLE");
  assert.equal(calls, 0);
});

test("stale authorization or candidate chronology is disclosed and remains ineligible", async () => {
  const fixture = entryResponse();
  const result = await adapterFor(fixture.body, {
    clock: () => NOW + 100
  }).adapter.getPaperQuote(request({
    candidateSampledAt: NOW - 6 * 60 * 1000,
    authorizedAt: NOW - 5 * 60 * 1000 - 1
  }));
  assert.ok(result.reasons.includes("CAUSAL_REFERENCE_STALE"));
  assert.equal(result.quoteCandidate.executable, false);
  assert.equal(result.authorizationEligible, false);
});

test("fixture successfully normalizes the exact quote/base ratio but cannot normalize USD costs", async () => {
  const amount = "123456789012345678901";
  const output = "9876543210987654321";
  const fixture = entryResponse({
    inAmount: amount,
    outAmount: output,
    otherAmountThreshold: "1"
  });
  const {adapter} = adapterFor(fixture.body, {clock: () => NOW});
  const result = await adapter.getPaperQuote(request({
    amountAtoms: amount,
    quoteDecimals: 18,
    identity: {...IDENTITY, decimals: 18}
  }));
  const ratio = result.quoteCandidate.priceQuotePerBase;
  const numerator = BigInt(ratio.numerator);
  const denominator = BigInt(ratio.denominator);
  assert.equal(numerator * BigInt(output), denominator * BigInt(amount));
  assert.equal(ratio.unit, "quote-token per base-token");
  assert.equal(result.quoteCandidate.routeAmounts.inputAtoms, amount);
  assert.equal(result.quoteCandidate.routeAmounts.outputAtoms, output);
  assert.equal(result.quoteCandidate.priceMicros, null);
  assert.equal(result.costEvidence.status, "UNKNOWN");
  assert.deepEqual(Object.keys(result.costEvidence.components).sort(),
    ["fee", "network", "priceImpact", "slippage", "spread"]);
  assert.ok(Object.values(result.costEvidence.components)
    .every(component => component.status === "UNKNOWN" && component.amount === null));
  assert.equal(result.authorizationEligible, false);
});

test("the existing cost normalizer maps a complete explicit synthetic scenario without granting authority", () => {
  const fixture = {
    label: "SYNTHETIC_DECLARED_COST_SCENARIO_ONLY",
    evidence: {
      source: SYNTHETIC_SOURCE,
      binding: IDENTITY,
      observedAt: NOW,
      microUsd: {
        fee: "12345",
        spread: "1",
        slippage: "10000",
        priceImpact: "10001",
        network: "9999"
      }
    }
  };
  const normalized = normalizeExactCosts(fixture.evidence, {
    identity: IDENTITY,
    quoteSource: SYNTHETIC_SOURCE,
    quoteObservedAt: NOW,
    now: NOW
  });

  assert.equal(fixture.label, "SYNTHETIC_DECLARED_COST_SCENARIO_ONLY");
  assert.equal(normalized.status, "NORMALIZED_UNVERIFIED");
  assert.deepEqual(normalized.costsCents, {
    feeCents: "2",
    spreadCents: "1",
    slippageCents: "1",
    priceImpactCents: "2",
    networkCents: "1"
  });
  assert.equal(normalized.totalCents, "7");
  assert.equal(normalized.provenance, "CALLER_ASSERTED_NOT_SOURCE_VERIFIED");
  assert.equal(normalized.authorizationEligible, false);
});

test("explicit baseline scenario projects net-basis costs without changing actual quote eligibility", async () => {
  const result = await adapterFor(entryResponse().body).adapter.getPaperQuote(request(), {
    reviewScenario: reviewScenario()
  });
  const projection = result.scenarioProjection;

  assert.equal(projection.status, "REVIEW_PROJECTION_ONLY");
  assert.equal(projection.scenarioCostCoverage, "COMPLETE");
  assert.equal(projection.actualCostCoverage, "UNKNOWN");
  assert.equal(projection.scenario.case, "BASELINE");
  assert.equal(projection.scenario.quoteUsdAssumption.assumption,
    "USDC_EQUALS_USD1_EXPERIMENTAL_NOT_MEASURED");
  assert.equal(projection.scenario.approvalEvidenceProvenance,
    "CALLER_ASSERTED_NOT_AUTHENTICATED");
  assert.equal(projection.scenario.approvalEvidence.status, "ASSERTED_UNVERIFIED");
  assert.equal(projection.costBasis, "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS");
  assert.deepEqual(projection.costsCents, {
    feeCents: "0",
    spreadCents: "0",
    slippageCents: "80",
    priceImpactCents: "0",
    networkCents: "10"
  });
  assert.equal(projection.costDisposition.feeCents,
    "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS");
  assert.equal(projection.costDisposition.spreadCents,
    "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS");
  assert.equal(projection.costDisposition.priceImpactCents,
    "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS");
  assert.equal(projection.amountProjection.maximumModeledInputAtoms, "79099990");
  assert.equal(projection.amountProjection.modeledAllInCents, "8000");
  assert.equal(projection.quoteValue.grossBeforeExtraScenarioCostsCents, "7910");
  assert.equal(projection.quoteValue.afterExtraScenarioCostsCents, "8000");
  const ledgerGross = (BigInt(projection.amountProjection.maximumModeledBaseAtoms) *
    BigInt(projection.priceMicros) +
    10n ** BigInt(IDENTITY.decimals) * 10_000n - 1n) /
    (10n ** BigInt(IDENTITY.decimals) * 10_000n);
  const scenarioCosts = BigInt(projection.costsCents.slippageCents) +
    BigInt(projection.costsCents.networkCents);
  assert.equal(projection.quoteValue.grossBeforeExtraScenarioCostsCents, ledgerGross.toString());
  assert.equal(projection.quoteValue.totalExtraScenarioCostsCents, scenarioCosts.toString());
  assert.equal(projection.amountProjection.modeledAllInCents,
    (ledgerGross + scenarioCosts).toString());
  assert.equal(projection.quoteValue.label, "MODELED_SINGLE_SIDE_QUOTE_VALUE_NOT_PNL");
  assert.equal(projection.pnl.status, "NOT_COMPUTED_SINGLE_SIDE_PROJECTION");
  assert.equal(projection.executionRealistic, false);
  assert.equal(projection.integrationEligible, false);
  assert.equal(projection.authorizationEligible, false);
  assert.equal(result.quoteCandidate.priceMicros, null);
  assert.equal(result.costEvidence.status, "UNKNOWN");
  assert.equal(result.authorizationEligible, false);
  assert.deepEqual(projection.providerFieldsRetainedSeparately, {
    feeBps: 2,
    feeMint: SYNTHETIC_MINT,
    platformFee: {amount: "100", feeBps: 2, feeMint: SYNTHETIC_MINT},
    networkFeesLamports: {signature: 5000, prioritization: 2500, rent: 0},
    priceImpact: {field: "priceImpact", value: 0.02, unit: "percentage_points"},
    slippageToleranceBps: 50
  });
});

test("baseline and stress exit projections use conservative rational rounding and remain identity-bound", async () => {
  const exitBody = syntheticOrderResponse({
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    inAmount: "3000000",
    outAmount: "3703702",
    otherAmountThreshold: "3685184"
  }).body;
  const exitRequest = request({
    side: "EXIT",
    amountAtoms: "3000000",
    positionOpenedAt: NOW - 1_000
  });
  delete exitRequest.authorizedAt;
  const baseline = await adapterFor(exitBody).adapter.getPaperQuote(exitRequest, {
    reviewScenario: reviewScenario()
  });
  const stress = await adapterFor(exitBody).adapter.getPaperQuote(exitRequest, {
    reviewScenario: reviewScenario("STRESS")
  });
  const base = baseline.scenarioProjection;
  const stressed = stress.scenarioProjection;
  const entry = await adapterFor(entryResponse().body).adapter.getPaperQuote(request(), {
    reviewScenario: reviewScenario()
  });
  const stressEntry = await adapterFor(entryResponse().body).adapter.getPaperQuote(request(), {
    reviewScenario: reviewScenario("STRESS")
  });
  const mark = await adapterFor(exitBody).adapter.getPaperQuote(exitRequest, {
    reviewScenario: reviewScenario()
  });

  assert.equal(base.status, "REVIEW_PROJECTION_ONLY");
  assert.equal(base.side, "EXIT");
  assert.equal(base.priceMicros, 1_234_567);
  assert.equal(base.priceRounding, "floor_exact_USD_per_token_microUSD");
  assert.deepEqual(base.costsCents, {
    feeCents: "0", spreadCents: "0", slippageCents: "4",
    priceImpactCents: "0", networkCents: "10"
  });
  const exitLedgerGross = BigInt(base.amountProjection.maximumModeledBaseAtoms) *
    BigInt(base.priceMicros) /
    (10n ** BigInt(IDENTITY.decimals) * 10_000n);
  const exitScenarioCosts = BigInt(base.costsCents.slippageCents) +
    BigInt(base.costsCents.networkCents);
  assert.equal(base.quoteValue.grossBeforeExtraScenarioCostsCents, exitLedgerGross.toString());
  assert.equal(base.quoteValue.totalExtraScenarioCostsCents, exitScenarioCosts.toString());
  assert.equal(base.quoteValue.afterExtraScenarioCostsCents,
    (exitLedgerGross - exitScenarioCosts).toString());
  assert.equal(base.amountProjection.maximumModeledBaseAtoms, "3000000");
  assert.equal(base.quoteValue.grossBeforeExtraScenarioCostsCents, "370");
  assert.equal(base.quoteValue.totalExtraScenarioCostsCents, "14");
  assert.equal(base.quoteValue.afterExtraScenarioCostsCents, "356");
  assert.equal(base.rawExactQuotePerBase.numerator, "1851851");
  assert.equal(base.rawExactQuotePerBase.denominator, "1500000");
  assert.equal(stressed.scenarioCostCoverage, "COMPLETE");
  assert.equal(stressed.side, "EXIT");
  assert.ok(BigInt(stressed.quoteValue.afterExtraScenarioCostsCents) <=
    BigInt(base.quoteValue.afterExtraScenarioCostsCents));
  assert.ok(BigInt(stressed.quoteValue.totalExtraScenarioCostsCents) >
    BigInt(base.quoteValue.totalExtraScenarioCostsCents));
  assert.equal(base.identity.mint, IDENTITY.mint);
  assert.equal(entry.scenarioProjection.scenario.configurationSha256,
    base.scenario.configurationSha256);
  assert.equal(stressEntry.scenarioProjection.amountProjection.modeledAllInCents, "8000");
  assert.ok(BigInt(stressEntry.scenarioProjection.costsCents.slippageCents) >
    BigInt(entry.scenarioProjection.costsCents.slippageCents));
  assert.ok(BigInt(stressEntry.scenarioProjection.amountProjection.maximumModeledInputAtoms) <
    BigInt(entry.scenarioProjection.amountProjection.maximumModeledInputAtoms));
  assert.notEqual(base.scenario.configurationSha256, stressed.scenario.configurationSha256);
  assert.equal(mark.scenarioProjection.side, "EXIT");
  assert.equal(mark.scenarioProjection.scenario.configurationSha256,
    base.scenario.configurationSha256);

  const restarted = await adapterFor(exitBody).adapter.getPaperQuote(exitRequest, {
    reviewScenario: reviewScenario()
  });
  assert.equal(restarted.scenarioProjection.scenario.configurationSha256,
    base.scenario.configurationSha256);
  assert.equal(restarted.scenarioProjection.identity.pool, base.identity.pool);
});

test("review scenario configuration is snapshotted before the injected quote transport awaits", async () => {
  const fixture = entryResponse();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => NOW,
    transport: async () => {
      await waiting;
      return response(fixture.body);
    }
  });
  const config = reviewScenario();
  const pending = adapter.getPaperQuote(request(), {reviewScenario: config});
  await new Promise(resolve => setImmediate(resolve));
  config.reviewEvidence.decision = "NOT_APPROVED";
  config.identity.mint = SYNTHETIC_POOL;
  release();
  const result = await pending;

  assert.equal(result.scenarioProjection.status, "REVIEW_PROJECTION_ONLY");
  assert.equal(result.scenarioProjection.identity.mint, IDENTITY.mint);
  assert.equal(result.scenarioProjection.scenario.approvalEvidence.status,
    "ASSERTED_UNVERIFIED");
});

test("review scenario opt-in, evidence, identity, mint, and chronology fail closed", async () => {
  const body = entryResponse().body;
  const absent = await adapterFor(body).adapter.getPaperQuote(request());
  assert.equal(absent.scenarioProjection, null);

  const missingEvidence = reviewScenario();
  delete missingEvidence.reviewEvidence;
  const missing = await adapterFor(body).adapter.getPaperQuote(request(), {
    reviewScenario: missingEvidence
  });
  assert.equal(missing.scenarioProjection.status, "BLOCKED");

  const unapprovedConfig = reviewScenario();
  unapprovedConfig.reviewEvidence.decision = "NOT_APPROVED";
  const unapproved = await adapterFor(body).adapter.getPaperQuote(request(), {
    reviewScenario: unapprovedConfig
  });
  assert.equal(unapproved.scenarioProjection.status, "BLOCKED");
  assert.ok(unapproved.scenarioProjection.reasons.includes(
    "SCENARIO_REVIEW_EVIDENCE_MISSING_UNAPPROVED_OR_MISMATCHED"
  ));

  const mismatchedConfig = reviewScenario();
  mismatchedConfig.reviewEvidence.scenarioConfigSha256 = "b".repeat(64);
  const mismatched = await adapterFor(body).adapter.getPaperQuote(request(), {
    reviewScenario: mismatchedConfig
  });
  assert.equal(mismatched.scenarioProjection.status, "BLOCKED");

  const wrongQuoteMint = reviewScenario();
  wrongQuoteMint.usdcMint = SYNTHETIC_MINT;
  const wrongMint = await adapterFor(body).adapter.getPaperQuote(request(), {
    reviewScenario: wrongQuoteMint
  });
  assert.equal(wrongMint.scenarioProjection.status, "BLOCKED");
  assert.ok(wrongMint.scenarioProjection.reasons.includes("SCENARIO_CONFIGURATION_INVALID"));

  const wrongIdentity = reviewScenario("BASELINE", {
    identity: {...IDENTITY, mint: SYNTHETIC_POOL}
  });
  const identityMismatch = await adapterFor(body).adapter.getPaperQuote(request(), {
    reviewScenario: wrongIdentity
  });
  assert.equal(identityMismatch.scenarioProjection.status, "BLOCKED");
  assert.ok(identityMismatch.scenarioProjection.reasons.includes(
    "SCENARIO_IDENTITY_OR_DECIMALS_MISMATCH"
  ));

  const futureEvidence = reviewScenario();
  futureEvidence.reviewEvidence.recordedAt = NOW + 10_000;
  const future = await adapterFor(body).adapter.getPaperQuote(request(), {
    reviewScenario: futureEvidence
  });
  assert.equal(future.scenarioProjection.status, "BLOCKED");
});

test("scenario conversion rejects zero/unsafe prices and refuses size extrapolation or over-cap entries", async () => {
  const subMicroRoute = entryResponse({
    inAmount: "100000000",
    outAmount: "1000000000000000",
    otherAmountThreshold: "1"
  });
  const subMicro = await adapterFor(subMicroRoute.body).adapter.getPaperQuote(request({
    amountAtoms: "100000000"
  }), {reviewScenario: reviewScenario()});
  const subMicroProjection = subMicro.scenarioProjection;
  assert.equal(subMicroProjection.status, "REVIEW_PROJECTION_ONLY");
  assert.equal(subMicroProjection.priceMicros, 1);
  assert.equal(subMicroProjection.amountProjection.maximumModeledBaseAtoms,
    "79100000000000");
  assert.equal(subMicroProjection.amountProjection.maximumModeledInputAtoms,
    "7910000");
  assert.equal(subMicroProjection.quoteValue.grossBeforeExtraScenarioCostsCents, "7910");
  assert.equal(subMicroProjection.costsCents.slippageCents, "80");
  assert.equal(subMicroProjection.costsCents.networkCents, "10");
  assert.equal(subMicroProjection.amountProjection.modeledAllInCents, "8000");
  assert.deepEqual(subMicroProjection.rawExactQuotePerBase, {
    numerator: "1",
    denominator: "10000000",
    unit: "quote-token per base-token",
    source: "exact raw inAmount/outAmount and caller-supplied decimals; not a USD price"
  });
  const subMicroQuantity = BigInt(subMicroProjection.amountProjection.maximumModeledBaseAtoms);
  const subMicroScale = 10n ** BigInt(IDENTITY.decimals);
  const subMicroLedgerGross = (subMicroQuantity * BigInt(subMicroProjection.priceMicros) +
    subMicroScale * 10_000n - 1n) / (subMicroScale * 10_000n);
  const subMicroCosts = BigInt(subMicroProjection.costsCents.slippageCents) +
    BigInt(subMicroProjection.costsCents.networkCents);
  assert.equal(subMicroProjection.quoteValue.grossBeforeExtraScenarioCostsCents,
    subMicroLedgerGross.toString());
  assert.equal(subMicroProjection.quoteValue.totalExtraScenarioCostsCents,
    subMicroCosts.toString());
  assert.equal(subMicroProjection.amountProjection.modeledAllInCents,
    (subMicroLedgerGross + subMicroCosts).toString());
  assert.ok(subMicroQuantity <= 1_000_000_000_000_000n);
  assert.ok(BigInt(subMicroProjection.amountProjection.maximumModeledInputAtoms) <=
    100_000_000n);

  const quoteDust = entryResponse({
    inAmount: "1", outAmount: "3", otherAmountThreshold: "1"
  });
  const subcent = await adapterFor(quoteDust.body).adapter.getPaperQuote(request({
    amountAtoms: "1"
  }), {reviewScenario: reviewScenario()});
  assert.equal(subcent.scenarioProjection.status, "REVIEW_PROJECTION_ONLY");
  assert.equal(subcent.scenarioProjection.priceMicros, 333334);
  assert.equal(subcent.scenarioProjection.priceRounding,
    "ceil_exact_USD_per_token_microUSD");
  assert.equal(subcent.scenarioProjection.amountProjection.maximumModeledInputAtoms, "1");
  assert.ok(BigInt(subcent.scenarioProjection.amountProjection.maximumModeledInputAtoms) <=
    BigInt(subcent.scenarioProjection.amountProjection.sourceQuotedInputAtoms));

  const nineDecimalIdentity = {...IDENTITY, decimals: 9};
  const nineDecimalQuote = entryResponse({
    inAmount: "100000000",
    outAmount: "17057460000",
    otherAmountThreshold: "1"
  });
  const nineDecimal = await adapterFor(nineDecimalQuote.body).adapter.getPaperQuote(request({
    identity: nineDecimalIdentity
  }), {reviewScenario: reviewScenario("BASELINE", {identity: nineDecimalIdentity})});
  assert.equal(nineDecimal.scenarioProjection.priceMicros,
    Number((100_000_000n * 1_000_000n + 17_057_460n - 1n) / 17_057_460n));

  const exitDust = syntheticOrderResponse({
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    inAmount: "1000000",
    outAmount: "5842157",
    otherAmountThreshold: "5812946"
  });
  const exitDustRequest = request({
    side: "EXIT", amountAtoms: "1000000", positionOpenedAt: NOW - 1_000
  });
  delete exitDustRequest.authorizedAt;
  const credit = await adapterFor(exitDust.body).adapter.getPaperQuote(exitDustRequest, {
    reviewScenario: reviewScenario()
  });
  assert.equal(credit.scenarioProjection.status, "REVIEW_PROJECTION_ONLY");
  assert.equal(credit.scenarioProjection.priceMicros, 5_842_157);
  assert.equal(credit.scenarioProjection.priceRounding,
    "floor_exact_USD_per_token_microUSD");
  assert.equal(credit.scenarioProjection.quoteValue.grossBeforeExtraScenarioCostsCents, "584");
  assert.equal(credit.scenarioProjection.quoteValue.direction, "CREDIT_ROUNDED_DOWN");

  const zeroPrice = syntheticOrderResponse({
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    inAmount: "9999999999999999999999999999999999999999",
    outAmount: "1",
    otherAmountThreshold: "1"
  });
  const zeroRequest = request({
    side: "EXIT",
    amountAtoms: "9999999999999999999999999999999999999999",
    positionOpenedAt: NOW - 1_000
  });
  delete zeroRequest.authorizedAt;
  const zero = await adapterFor(zeroPrice.body).adapter.getPaperQuote(zeroRequest, {
    reviewScenario: reviewScenario()
  });
  assert.equal(zero.scenarioProjection.status, "BLOCKED");
  assert.ok(zero.scenarioProjection.reasons.includes("SCENARIO_PRICE_MICROS_ZERO_OR_UNSAFE"));

  const unsafePrice = entryResponse({
    inAmount: "9999999999999999999999999999999999999999",
    outAmount: "1",
    otherAmountThreshold: "1"
  });
  const unsafe = await adapterFor(unsafePrice.body).adapter.getPaperQuote(request({
    amountAtoms: "9999999999999999999999999999999999999999"
  }), {reviewScenario: reviewScenario()});
  assert.equal(unsafe.scenarioProjection.status, "BLOCKED");
  assert.ok(unsafe.scenarioProjection.reasons.includes("SCENARIO_PRICE_MICROS_ZERO_OR_UNSAFE"));
});

test("provider expiry, malformed/truncated responses, and over-cap streams fail closed", async () => {
  const expired = entryResponse({
    router: "jupiterz",
    expireAt: String(Math.floor((NOW - 1_000) / 1_000))
  });
  assert.ok((await adapterFor(expired.body).adapter.getPaperQuote(request()))
    .reasons.includes("PROVIDER_QUOTE_EXPIRED"));

  const truncated = await adapterFor(() =>
    new Response('{"inputMint":', {headers: {"content-type": "application/json"}})
  ).adapter.getPaperQuote(request());
  assert.ok(truncated.reasons.includes("RESPONSE_JSON_INVALID"));

  const oversized = await adapterFor(() =>
    new Response(new Uint8Array(262_145), {headers: {"content-type": "application/json"}})
  ).adapter.getPaperQuote(request());
  assert.ok(oversized.reasons.includes("RESPONSE_TOO_LARGE"));
});

test("caller cancellation aborts the response stream without retry", async () => {
  const cancellation = new AbortController();
  let cancelled = false;
  let calls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    timeoutMs: 1_000,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return {
        status: 200,
        redirected: false,
        url: "",
        headers: new Headers({"content-type": "application/json"}),
        body: new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            cancelled = true;
          }
        })
      };
    }
  });
  const pending = adapter.getPaperQuote(request(), {signal: cancellation.signal});
  await new Promise(resolve => setImmediate(resolve));
  cancellation.abort();
  const result = await pending;

  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.reasons.includes("REQUEST_CANCELLED"));
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});

test("timeout cleanup does not wait for a reader whose cancellation never settles", async () => {
  let calls = 0;
  let cancelCalls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    timeoutMs: 40,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return {
        status: 200,
        redirected: false,
        url: "",
        headers: new Headers({"content-type": "application/json"}),
        body: {
          getReader() {
            return {
              read: () => new Promise(() => {}),
              cancel() {
                cancelCalls += 1;
                return new Promise(() => {});
              },
              releaseLock() {}
            };
          }
        }
      };
    }
  });

  const result = await settleWithin(adapter.getPaperQuote(request()));
  assert.ok(result.reasons.includes("REQUEST_TIMEOUT"));
  assert.ok(cancelCalls > 0);
  assert.equal(calls, 1);
});

test("endless immediate empty chunks are bounded and yield to the event loop", async () => {
  let calls = 0;
  let pulls = 0;
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 0);
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    timeoutMs: 1_000,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return {
        status: 200,
        redirected: false,
        url: "",
        headers: new Headers({"content-type": "application/json"}),
        body: new ReadableStream({
          pull(controller) {
            pulls += 1;
            controller.enqueue(new Uint8Array(0));
          }
        })
      };
    }
  });

  try {
    const result = await settleWithin(adapter.getPaperQuote(request()));
    assert.ok(result.reasons.includes("RESPONSE_EMPTY_READ_LIMIT"));
    assert.equal(timerRan, true);
    assert.ok(pulls <= 300);
    assert.equal(calls, 1);
  } finally {
    clearTimeout(timer);
  }
});

test("late response cancellation rejection is observed after timeout without retry", async () => {
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  let calls = 0;
  let cancelCalls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    timeoutMs: 40,
    clock: () => NOW,
    transport: async (_url, {signal}) => {
      calls += 1;
      return new Promise(resolve => {
        const lateResponse = () => resolve({
          status: 200,
          redirected: false,
          url: "",
          headers: new Headers({"content-type": "application/json"}),
          body: {
            getReader() {
              return {
                read: () => new Promise(() => {}),
                cancel() {
                  cancelCalls += 1;
                  return Promise.reject(new Error("late body cancellation rejected"));
                },
                releaseLock() {}
              };
            }
          }
        });
        if (signal.aborted) lateResponse();
        else signal.addEventListener("abort", lateResponse, {once: true});
      });
    }
  });

  try {
    const result = await settleWithin(adapter.getPaperQuote(request()));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(result.reasons.includes("REQUEST_TIMEOUT"));
    assert.ok(cancelCalls > 0);
    assert.deepEqual(unhandled, []);
    assert.equal(calls, 1);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("caller abort race settles despite a never-settling cancellation and never retries", async () => {
  const cancellation = new AbortController();
  let calls = 0;
  let cancelCalls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    timeoutMs: 80,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return {
        status: 200,
        redirected: false,
        url: "",
        headers: new Headers({"content-type": "application/json"}),
        body: {
          getReader() {
            return {
              read: () => new Promise(() => {}),
              cancel() {
                cancelCalls += 1;
                return new Promise(() => {});
              },
              releaseLock() {}
            };
          }
        }
      };
    }
  });

  const pending = adapter.getPaperQuote(request(), {signal: cancellation.signal});
  await new Promise(resolve => setImmediate(resolve));
  cancellation.abort();
  const result = await settleWithin(pending);
  assert.ok(result.reasons.includes("REQUEST_CANCELLED"));
  assert.ok(cancelCalls > 0);
  assert.equal(calls, 1);
});

test("caller abort and timeout contain synchronous source cancellation throws", async () => {
  const uncaught = [];
  const unhandled = [];
  const onUncaught = error => uncaught.push(error);
  const onUnhandled = error => unhandled.push(error);
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);

  try {
    for (const mode of ["CALLER_ABORT", "INTERNAL_TIMEOUT"]) {
      const cancellation = new AbortController();
      let calls = 0;
      let cancelCalls = 0;
      const adapter = createMarketQuoteAdapter({
        enabled: true,
        timeoutMs: mode === "INTERNAL_TIMEOUT" ? 30 : 80,
        clock: () => NOW,
        transport: async () => {
          calls += 1;
          return {
            status: 200,
            redirected: false,
            url: "",
            headers: new Headers({"content-type": "application/json"}),
            body: {
              getReader() {
                return {
                  read: () => new Promise(() => {}),
                  cancel() {
                    cancelCalls += 1;
                    throw new Error("synchronous source cancellation failure");
                  },
                  releaseLock() {}
                };
              }
            }
          };
        }
      });

      const pending = adapter.getPaperQuote(request(), {
        signal: mode === "CALLER_ABORT" ? cancellation.signal : undefined
      });
      if (mode === "CALLER_ABORT") {
        await new Promise(resolve => setImmediate(resolve));
        cancellation.abort();
      }
      const result = await settleWithin(pending);
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(result.status, "UNAVAILABLE");
      assert.ok(result.reasons.includes(
        mode === "CALLER_ABORT" ? "REQUEST_CANCELLED" : "REQUEST_TIMEOUT"
      ));
      assert.ok(cancelCalls > 0);
      assert.equal(calls, 1);
    }

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(uncaught, []);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
  }
});

test("the configured request budget caps transport attempts", async () => {
  let calls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    maxRequests: 1,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return response(entryResponse().body);
    }
  });
  const first = await adapter.getPaperQuote(request());
  const second = await adapter.getPaperQuote(request());
  assert.equal(first.status, "UNAVAILABLE");
  assert.ok(second.reasons.includes("REQUEST_BUDGET_EXHAUSTED"));
  assert.equal(calls, 1);
});

test("the existing Paper consumer cannot fill from an incomplete market quote candidate", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-market-quote-"));
  const store = await CheckpointStore.open(directory);
  const session = await PaperCheckpointSession.open({store, runId: RUN, startedAt: START});
  t.after(async () => {
    await session.close();
    await rm(directory, {recursive: true, force: true});
  });
  const step = createPaperExecutionStep({
    session, store, runId: RUN, startedAt: START, endAt: END
  });
  const authorizationInput = authorization("market-quote-consumer");
  const authorized = await step.authorizeEntry(authorizationInput);
  assert.equal(authorized.status, "AUTHORIZED");

  let clockCalls = 0;
  const fixture = entryResponse().body;
  const market = await adapterFor(fixture, {
    clock: () => START + 2_000 + clockCalls++ * 100
  }).adapter.getPaperQuote({
    identity: {
      chainId: "solana",
      mint: authorizationInput.candidate.mint,
      pool: authorizationInput.candidate.pool,
      quote: authorizationInput.candidate.quote,
      decimals: authorizationInput.candidate.decimals
    },
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: START,
    authorizedAt: authorizationInput.now,
    slippageBps: 50
  });
  const rejected = await step.executeEntry({
    eventId: "market-quote-unavailable",
    authorizationId: authorized.authorizationId,
    quote: market.quoteCandidate,
    now: START + 3_000,
    marks: []
  });
  assert.equal(market.authorizationEligible, false);
  assert.equal(rejected.status, "REJECT");
  assert.equal(session.metadata.sequence, 1);
  assert.equal(session.snapshot().summary.openPositions.length, 0);
});
