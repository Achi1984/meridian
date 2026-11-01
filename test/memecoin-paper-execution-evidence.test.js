import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExactCosts,
  normalizeHypotheticalQuote
} from "../scripts/memecoin-paper-execution-evidence/normalize.mjs";
import {
  syntheticProviderQuote
} from "../scripts/memecoin-paper-execution-evidence/synthetic-fixtures.mjs";
import {PaperLedger} from "../scripts/memecoin-paper/ledger.mjs";
import {
  analyzeCandidate,
  filterCandidate
} from "../scripts/memecoin-paper/stages.mjs";
import {
  SYNTHETIC_SMART_WALLET_ALLOWLIST,
  syntheticCandidate
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";

const BASE_TIME = Date.parse("2026-10-30T12:00:00Z");
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "So11111111111111111111111111111111111111112",
  pool: "11111111111111111111111111111111",
  quote: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6
});
const SAMPLE_AT = BASE_TIME;
const AUTHORIZED_AT = BASE_TIME + 1_000;
const QUOTE_AT = BASE_TIME + 2_000;
const NOW = BASE_TIME + 3_000;

function normalizedQuote(quote = syntheticProviderQuote(QUOTE_AT), options = {}) {
  return normalizeHypotheticalQuote(quote, {
    identity: IDENTITY,
    candidateSampledAt: SAMPLE_AT,
    authorizedAt: AUTHORIZED_AT,
    now: NOW,
    ...options
  });
}

function authorizeSyntheticLedger(candidate, now, authorizationId) {
  const filters = filterCandidate(candidate, {now, holdUntil: now + 8 * 60 * 60 * 1000});
  const score = analyzeCandidate(candidate, {
    now,
    filterResult: filters,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  const ledger = new PaperLedger({now});
  const authorization = ledger.authorizeEntry({
    authorizationId,
    candidate,
    filterResult: filters,
    scoreResult: score,
    tickId: `tick-${authorizationId}`,
    now: now + 1_000
  });
  return {filters, score, ledger, authorization};
}

test("exact synthetic micro-USD cost components round upward using integer arithmetic", () => {
  const result = normalizeExactCosts({
    source: "SYNTHETIC_FIXTURE_ONLY",
    binding: IDENTITY,
    observedAt: QUOTE_AT,
    microUsd: {
      fee: "10001",
      spread: "10000",
      slippage: "1",
      priceImpact: "0",
      network: "9999"
    }
  }, {
    identity: IDENTITY,
    quoteSource: "SYNTHETIC_FIXTURE_ONLY",
    quoteObservedAt: QUOTE_AT,
    now: NOW
  });

  assert.equal(result.status, "NORMALIZED_UNVERIFIED");
  assert.deepEqual(result.costsCents, {
    feeCents: "2",
    spreadCents: "1",
    slippageCents: "1",
    priceImpactCents: "0",
    networkCents: "1"
  });
  assert.equal(result.totalCents, "5");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.provenance, "CALLER_ASSERTED_NOT_SOURCE_VERIFIED");
});

test("missing, fractional, negative, and conflicting cost evidence is unavailable", () => {
  assert.deepEqual(normalizeExactCosts(null).reasons, ["COST_EVIDENCE_MISSING"]);

  const complete = syntheticProviderQuote(QUOTE_AT).costs;
  const missing = {...complete, microUsd: {...complete.microUsd}};
  delete missing.microUsd.network;
  assert.ok(normalizeExactCosts(missing, {
    identity: IDENTITY,
    quoteSource: "SYNTHETIC_FIXTURE_ONLY",
    quoteObservedAt: QUOTE_AT,
    now: NOW
  }).reasons.includes("COST_COMPONENT_MISSING:network"));

  const stale = {...complete, observedAt: QUOTE_AT - 5 * 60 * 1000 - 1};
  assert.ok(normalizeExactCosts(stale, {
    identity: IDENTITY,
    quoteSource: "SYNTHETIC_FIXTURE_ONLY",
    quoteObservedAt: stale.observedAt,
    now: NOW
  }).reasons.includes("COST_STALE"));

  for (const invalid of [1.5, -1, "1.5"]) {
    const malformed = {...complete, microUsd: {...complete.microUsd, fee: invalid}};
    assert.ok(normalizeExactCosts(malformed, {
      identity: IDENTITY,
      quoteSource: "SYNTHETIC_FIXTURE_ONLY",
      quoteObservedAt: QUOTE_AT,
      now: NOW
    }).reasons.includes("COST_COMPONENT_NOT_NONNEGATIVE_INTEGER:fee"));
  }

  const conflicting = {
    ...complete,
    binding: {...complete.binding, pool: "11111111111111111111111111111112"}
  };
  assert.ok(normalizeExactCosts(conflicting, {
    identity: IDENTITY,
    quoteSource: "SYNTHETIC_FIXTURE_ONLY",
    quoteObservedAt: QUOTE_AT,
    now: NOW
  }).reasons.includes("COST_IDENTITY_MISMATCH:pool"));

  assert.ok(normalizeExactCosts({...complete, source: "conflicting-source"}, {
    identity: IDENTITY,
    quoteSource: "SYNTHETIC_FIXTURE_ONLY",
    quoteObservedAt: QUOTE_AT,
    now: NOW
  }).reasons.includes("COST_SOURCE_MISMATCH"));
});

test("well-formed provider-shaped synthetic quotes remain unavailable without verified semantics", () => {
  const result = normalizedQuote();
  assert.equal(result.status, "UNAVAILABLE");
  assert.deepEqual(result.reasons, ["QUOTE_SOURCE_UNAVAILABLE", "QUOTE_SEMANTICS_UNVERIFIED"]);
  assert.equal(result.quote, null);
  assert.equal(result.authorizationEligible, false);
  assert.ok(normalizeHypotheticalQuote(null).reasons.includes("QUOTE_RESPONSE_MISSING"));
});

test("quote validation binds mint, pool, quote mint, decimals, and chronology", () => {
  const conflicts = [
    ["mint", "11111111111111111111111111111112", "QUOTE_IDENTITY_MISMATCH:mint"],
    ["pool", "11111111111111111111111111111112", "QUOTE_IDENTITY_MISMATCH:pool"],
    ["quote", "11111111111111111111111111111112", "QUOTE_IDENTITY_MISMATCH:quote"],
    ["decimals", 9, "QUOTE_DECIMALS_MISMATCH"]
  ];
  for (const [key, value, reason] of conflicts) {
    assert.ok(normalizedQuote(syntheticProviderQuote(QUOTE_AT, {[key]: value})).reasons.includes(reason));
  }

  assert.ok(normalizedQuote(syntheticProviderQuote(SAMPLE_AT)).reasons
    .includes("QUOTE_NOT_LATER_THAN_CANDIDATE_SAMPLE"));
  assert.ok(normalizedQuote(syntheticProviderQuote(AUTHORIZED_AT)).reasons
    .includes("QUOTE_NOT_LATER_THAN_AUTHORIZATION"));
  assert.ok(normalizedQuote(syntheticProviderQuote(NOW + 1)).reasons
    .includes("QUOTE_FUTURE_DATED"));
  assert.ok(normalizeHypotheticalQuote(syntheticProviderQuote(QUOTE_AT), {
    identity: IDENTITY,
    candidateSampledAt: SAMPLE_AT,
    authorizedAt: AUTHORIZED_AT,
    now: QUOTE_AT + 5 * 60 * 1000 + 1
  }).reasons.includes("QUOTE_STALE"));
});

test("quote costs must be complete, fresh, and bound to the exact quote identity and time", () => {
  const quote = syntheticProviderQuote(QUOTE_AT);
  const partial = syntheticProviderQuote(QUOTE_AT, {
    costs: {...quote.costs, microUsd: {...quote.costs.microUsd, network: undefined}}
  });
  assert.ok(normalizedQuote(partial).reasons.includes("COST_COMPONENT_NOT_NONNEGATIVE_INTEGER:network"));

  const staleCosts = syntheticProviderQuote(QUOTE_AT, {
    costs: {...quote.costs, observedAt: QUOTE_AT - 1}
  });
  assert.ok(normalizedQuote(staleCosts).reasons.includes("COST_QUOTE_TIME_MISMATCH"));

  const conflictingCosts = syntheticProviderQuote(QUOTE_AT, {
    costs: {
      ...quote.costs,
      binding: {...quote.costs.binding, quote: "11111111111111111111111111111112"}
    }
  });
  assert.ok(normalizedQuote(conflictingCosts).reasons.includes("COST_IDENTITY_MISMATCH:quote"));
});

test("compatible ledger contract rejects partial, stale, and identity-conflicting quote evidence", () => {
  const candidate = syntheticCandidate(BASE_TIME);
  const {ledger, authorization} = authorizeSyntheticLedger(candidate, BASE_TIME, "evidence-ledger");
  assert.equal(authorization.status, "AUTHORIZED");
  const baseQuote = {
    eventId: "synthetic-ledger-quote",
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: "SYNTHETIC_FIXTURE_ONLY",
    observedAt: BASE_TIME + 2_000,
    priceMicros: 10_000,
    decimals: candidate.decimals,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: {
      feeCents: 0,
      spreadCents: 0,
      slippageCents: 0,
      priceImpactCents: 0,
      networkCents: 0
    }
  };
  const before = ledger.summary();

  const missing = ledger.executeEntry(authorization, {
    eventId: "synthetic-ledger-missing-quote"
  }, {now: BASE_TIME + 3_000});
  assert.equal(missing.status, "UNFILLED");
  assert.equal(ledger.summary().cashCents, before.cashCents);

  const missingCosts = ledger.executeEntry(authorization, {
    ...baseQuote,
    eventId: "synthetic-ledger-missing-costs",
    costs: undefined
  }, {now: BASE_TIME + 3_000});
  assert.equal(missingCosts.status, "UNFILLED");
  assert.match(missingCosts.reason, /cost breakdown is required/);

  const partial = ledger.executeEntry(authorization, {
    ...baseQuote,
    costs: {...baseQuote.costs, networkCents: undefined}
  }, {now: BASE_TIME + 3_000});
  assert.equal(partial.status, "UNFILLED");
  assert.match(partial.reason, /networkCents must be an integer/);
  assert.equal(ledger.summary().cashCents, before.cashCents);

  const conflict = ledger.executeEntry(authorization, {
    ...baseQuote,
    eventId: "synthetic-ledger-conflicting-pool",
    pool: "11111111111111111111111111111112"
  }, {now: BASE_TIME + 3_000});
  assert.equal(conflict.status, "UNFILLED");
  assert.match(conflict.reason, /identity-bound/);

  const expiredLedgerContext = {
    ...baseQuote,
    eventId: "synthetic-ledger-stale",
    observedAt: BASE_TIME + 2_000
  };
  const stale = ledger.executeEntry(authorization, expiredLedgerContext, {
    now: BASE_TIME + 5 * 60 * 1000 + 1_001
  });
  assert.equal(stale.status, "REJECT");
  assert.match(stale.reason, /risk authorization is expired/);
  assert.equal(ledger.summary().openPositions.length, 0);
});

test("observeExitQuote leaves missing, stale, conflicting, or partial-cost exits unresolved", () => {
  const makeOpenPosition = authorizationId => {
    const candidate = syntheticCandidate(BASE_TIME);
    const {ledger, authorization} = authorizeSyntheticLedger(candidate, BASE_TIME, authorizationId);
    const fill = ledger.executeEntry(authorization, {
      eventId: `entry-${authorizationId}`,
      mint: candidate.mint,
      chainId: candidate.chainId,
      pool: candidate.pool,
      quote: candidate.quote,
      source: "SYNTHETIC_FIXTURE_ONLY",
      observedAt: BASE_TIME + 2_000,
      priceMicros: 10_000,
      decimals: candidate.decimals,
      mode: "HYPOTHETICAL",
      executable: true,
      costs: {
        feeCents: 0,
        spreadCents: 0,
        slippageCents: 0,
        priceImpactCents: 0,
        networkCents: 0
      }
    }, {now: BASE_TIME + 2_000});
    assert.equal(fill.status, "FILLED_PAPER");
    return {candidate, ledger};
  };
  const exitQuote = (candidate, eventId, overrides = {}) => ({
    eventId,
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: "SYNTHETIC_FIXTURE_ONLY",
    observedAt: BASE_TIME + 3_000,
    priceMicros: 9_300,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: {
      feeCents: 0,
      spreadCents: 0,
      slippageCents: 0,
      priceImpactCents: 0,
      networkCents: 0
    },
    ...overrides
  });

  const missing = makeOpenPosition("missing-exit");
  assert.equal(missing.ledger.observeExitQuote(null, {
    now: BASE_TIME + 3_000,
    eventId: "missing-exit-quote"
  }).status, "UNKNOWN");
  assert.equal(missing.ledger.summary().openPositions.length, 1);

  const stale = makeOpenPosition("stale-exit");
  const staleResult = stale.ledger.observeExitQuote(
    exitQuote(stale.candidate, "stale-exit-quote"),
    {now: BASE_TIME + 3_000 + 5 * 60 * 1000 + 1}
  );
  assert.equal(staleResult.status, "VALUATION_UNAVAILABLE");
  assert.match(staleResult.reason, /stale/);
  assert.equal(stale.ledger.summary().openPositions.length, 1);

  const conflicting = makeOpenPosition("conflicting-exit");
  const conflictingResult = conflicting.ledger.observeExitQuote(exitQuote(
    conflicting.candidate,
    "conflicting-exit-quote",
    {pool: "11111111111111111111111111111112"}
  ));
  assert.equal(conflictingResult.status, "VALUATION_UNAVAILABLE");
  assert.match(conflictingResult.reason, /identity-mismatched/);

  const partialCosts = makeOpenPosition("partial-exit-costs");
  const partialResult = partialCosts.ledger.observeExitQuote(exitQuote(
    partialCosts.candidate,
    "partial-exit-cost-quote",
    {costs: {feeCents: 0}}
  ));
  assert.equal(partialResult.status, "UNFILLED");
  assert.match(partialResult.reason, /spreadCents must be an integer/);
  assert.equal(partialCosts.ledger.summary().openPositions.length, 1);
});

test("unavailable LP, owner, developer, bundle, and smart-wallet evidence cannot pass ledger gates", () => {
  const candidate = syntheticCandidate(BASE_TIME);
  for (const key of ["lpProtection", "top10OwnerPct", "devAssociatedPct", "bundledLaunchPct"]) {
    delete candidate.evidence[key];
  }
  const filters = filterCandidate(candidate, {
    now: BASE_TIME,
    holdUntil: BASE_TIME + 8 * 60 * 60 * 1000
  });
  assert.equal(filters.status, "UNKNOWN");
  assert.equal(filters.checks.tokenDecimals.status, "PASS");
  for (const gate of ["lpProtection", "top10Owners", "devHoldings", "bundledLaunch"]) {
    assert.equal(filters.checks[gate].status, "UNKNOWN");
  }

  const score = analyzeCandidate(candidate, {now: BASE_TIME, filterResult: filters});
  assert.equal(score.status, "BLOCKED");
  const ledger = new PaperLedger({now: BASE_TIME});
  const result = ledger.authorizeEntry({
    authorizationId: "unavailable-hard-gates",
    candidate,
    filterResult: filters,
    scoreResult: score,
    tickId: "unavailable-gates-tick",
    now: BASE_TIME + 1_000
  });
  assert.equal(result.status, "REJECT");
  assert.match(result.reason, /hard evidence gates must PASS/);

  const completeCandidate = syntheticCandidate(BASE_TIME);
  const completeFilters = filterCandidate(completeCandidate, {now: BASE_TIME});
  const unavailableWalletScore = analyzeCandidate(completeCandidate, {
    now: BASE_TIME,
    filterResult: completeFilters
  });
  assert.equal(unavailableWalletScore.status, "SCORE_UNAVAILABLE");
  assert.equal(unavailableWalletScore.components.qualifiedSmartWallets.status, "UNKNOWN");
});
