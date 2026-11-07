import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptMarketEvidence,
  MAX_OWNER_ACCOUNTS,
  MARKET_EVIDENCE_ADAPTER_VERSION,
  SYNTHETIC_SOURCE
} from "../scripts/memecoin-paper/market-evidence-adapter.mjs";
import {analyzeCandidate, filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {address, DEFAULT_NOW as NOW, fixtureInput, IDENTITY, reviewed} from "./fixtures/memecoin-paper-analyst-window-evidence/canonical-input.mjs";

const HOLD_UNTIL = NOW + 8 * 60 * 60 * 1000;

function adapt(input = fixtureInput(), overrides = {}) {
  return adaptMarketEvidence({
    ...input,
    now: NOW,
    holdUntil: HOLD_UNTIL,
    ...overrides
  });
}

test("reviewed synthetic evidence maps through the existing filter and analyst without authority", () => {
  const result = adapt();
  assert.equal(result.status, "NORMALIZED",
    JSON.stringify({
      evidence: Object.entries(result.candidate.evidence)
        .filter(([, item]) => item.verified !== true).map(([key, item]) => [key, item.coverage.reason]),
      analyst: Object.entries(result.candidate.analystEvidence)
        .filter(([, item]) => item.verified !== true).map(([key, item]) => [key, item.coverage.reason]),
      wallets: result.smartWalletAllowlist
    }));
  assert.equal(result.version, MARKET_EVIDENCE_ADAPTER_VERSION);
  assert.equal(result.syntheticFixtureOnly, true);
  assert.equal(result.realDataEntryEligible, false);
  assert.equal(result.executionAuthorized, false);

  const filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(filters.status, "PASS",
    JSON.stringify(Object.fromEntries(Object.entries(filters.checks).map(([key, check]) =>
      [key, [check.status, check.reason]]))));
  assert.equal(filters.accepted, true);
  assert.equal(result.candidate.evidence.top10OwnerPct.value, 25);
  assert.equal(result.candidate.evidence.top10OwnerPct.coverage.aggregation, "owner");
  assert.equal(result.candidate.evidence.top10OwnerPct.coverage.denominatorAtoms, "800");
  assert.equal(result.candidate.evidence.devAssociatedPct.value, 2.5);
  assert.equal(result.candidate.evidence.bundledLaunchPct.value, 5);

  const analysis = analyzeCandidate(result.candidate, {
    now: NOW,
    filterResult: filters,
    smartWalletAllowlist: result.smartWalletAllowlist
  });
  assert.equal(analysis.status, "PASS");
  assert.equal(analysis.score, 100);
  assert.equal(analysis.components.buySellUsdRatio1h.coverage.buyVolumeUsd, 250);
  assert.equal(result.smartWalletAllowlist.provenance, SYNTHETIC_SOURCE);
});

test("every hard filter remains UNKNOWN when its required evidence is absent", () => {
  const cases = [
    ["pairCreatedAt", "pairAge", "provider"],
    ["marketCapUsd", "marketCap", "provider"],
    ["tokenDecimals", "tokenDecimals", "provider"],
    ["mintAuthorityRevoked", "mintAuthority", "provider"],
    ["freezeAuthorityRevoked", "freezeAuthority", "provider"],
    ["lpProtection", "lpProtection", "supplemental"],
    ["liquidityUsd", "liquidity", "provider"],
    ["volume1hUsd", "volume1h", "provider"],
    ["top10OwnerPct", "top10Owners", "supplemental"],
    ["devAssociatedPct", "devHoldings", "supplemental"],
    ["crediblePriorRug", "priorRug", "supplemental"],
    ["bundledLaunchPct", "bundledLaunch", "supplemental"],
    ["priceChange1hPct", "priceRunup", "provider"],
    ["tokenExtensions", "tokenExtensions", "provider"]
  ];
  for (const [evidenceKey, checkKey, group] of cases) {
    const input = fixtureInput();
    if (group === "provider") delete input.providerCandidate.evidence[evidenceKey];
    else if (evidenceKey === "top10OwnerPct") delete input.evidence.ownerCensus;
    else if (evidenceKey === "devAssociatedPct") delete input.evidence.developerAttribution;
    else if (evidenceKey === "crediblePriorRug") delete input.evidence.priorRug;
    else if (evidenceKey === "bundledLaunchPct") delete input.evidence.bundledLaunch;
    else delete input.evidence[evidenceKey];
    const result = adapt(input);
    const filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
    assert.equal(filters.checks[checkKey].status, "UNKNOWN", evidenceKey);
    assert.equal(filters.accepted, false, evidenceKey);
  }
});

test("each of the six analyst components is independently mandatory", () => {
  for (const key of [
    "momentum15m",
    "uniqueBuyers1h",
    "buySellUsdRatio1h",
    "holderGrowthPct1h",
    "liquidityMarketCapPct",
    "qualifiedSmartWallets"
  ]) {
    const input = fixtureInput();
    delete input.analystEvidence[key];
    const result = adapt(input);
    const filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
    assert.equal(filters.accepted, true, key);
    const analysis = analyzeCandidate(result.candidate, {
      now: NOW,
      filterResult: filters,
      smartWalletAllowlist: result.smartWalletAllowlist
    });
    assert.equal(analysis.status, "SCORE_UNAVAILABLE", key);
    assert.equal(analysis.score, null, key);
    assert.equal(analysis.components[key].status, "UNKNOWN", key);
  }
});

test("caller PASS/verified flags cannot replace review, identity, freshness, slot, or coverage", () => {
  const cases = [
    ["review", {review: null}],
    ["identity", {identity: {...IDENTITY, pool: address("Z", 1)}}],
    ["stale", {observedAt: NOW - 5 * 60 * 1000 - 1}],
    ["slot", {slot: -1}],
    ["coverage", {coverage: {complete: false}}]
  ];
  for (const [label, change] of cases) {
    const input = fixtureInput();
    const original = input.evidence.lpProtection;
    input.evidence.lpProtection = {
      ...original,
      ...change,
      status: "PASS",
      verified: true,
      value: original.value
    };
    const result = adapt(input);
    const filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
    assert.equal(filters.checks.lpProtection.status, "UNKNOWN", label);
  }
});

test("owner census aggregates by owner, excludes pool and burned balances, and is bounded", () => {
  const valid = adapt();
  assert.equal(valid.candidate.evidence.top10OwnerPct.value, 25);

  const duplicate = fixtureInput();
  duplicate.evidence.ownerCensus.value.accounts[1].account =
    duplicate.evidence.ownerCensus.value.accounts[0].account;
  assert.equal(adapt(duplicate).candidate.evidence.top10OwnerPct.verified, false);

  const unreconciled = fixtureInput();
  unreconciled.evidence.ownerCensus.value.supplyAtoms = "999";
  assert.equal(adapt(unreconciled).candidate.evidence.top10OwnerPct.verified, false);

  const wrongPool = fixtureInput();
  wrongPool.evidence.ownerCensus.value.pool = address("Z", 5);
  assert.equal(adapt(wrongPool).candidate.evidence.top10OwnerPct.verified, false);

  const oversized = fixtureInput();
  oversized.evidence.ownerCensus.value.accounts = Array(MAX_OWNER_ACCOUNTS + 1).fill(
    oversized.evidence.ownerCensus.value.accounts[0]);
  assert.equal(adapt(oversized).candidate.evidence.top10OwnerPct.verified, false);
});

test("owner census must reconcile source-bound supply, mint, and declared slot policy", () => {
  const mismatch = fixtureInput();
  mismatch.providerCandidate.tokenSupplyAtoms = "2000";
  mismatch.providerCandidate.evidence.tokenDecimals.coverage.amountAtoms = "2000";
  const mismatchResult = adapt(mismatch);
  const mismatchFilters = filterCandidate(mismatchResult.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(mismatchFilters.checks.top10Owners.status, "UNKNOWN");

  const missingSupply = fixtureInput();
  delete missingSupply.providerCandidate.tokenSupplyAtoms;
  delete missingSupply.providerCandidate.evidence.tokenDecimals.coverage.amountAtoms;
  const missingResult = adapt(missingSupply);
  const missingFilters = filterCandidate(missingResult.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(missingFilters.checks.tokenDecimals.status, "UNKNOWN");
  assert.equal(missingFilters.checks.top10Owners.status, "UNKNOWN");

  const wrongMint = fixtureInput();
  wrongMint.evidence.ownerCensus.value.context.mint = address("Z", 5);
  assert.equal(adapt(wrongMint).candidate.evidence.top10OwnerPct.verified, false);

  const contradictorySameSlot = fixtureInput();
  contradictorySameSlot.evidence.ownerCensus.value.context.slot = 2;
  contradictorySameSlot.evidence.ownerCensus.slot = 2;
  assert.equal(adapt(contradictorySameSlot).candidate.evidence.top10OwnerPct.verified, false);

  const supportedCrossSlot = fixtureInput();
  supportedCrossSlot.evidence.ownerCensus.value.context.slot = 2;
  supportedCrossSlot.evidence.ownerCensus.slot = 2;
  supportedCrossSlot.evidence.ownerCensus.coverage.supplyContextPolicy =
    "distinct-finalized-slots-equal-supply";
  const crossSlotResult = adapt(supportedCrossSlot);
  const crossSlotFilters = filterCandidate(crossSlotResult.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(crossSlotFilters.checks.top10Owners.status, "PASS");
});

test("hard-gate percentages round conservatively at sub-micropercentage boundaries", () => {
  const concentration = fixtureInput();
  const census = concentration.evidence.ownerCensus;
  census.value.supplyAtoms = "10000000000";
  census.coverage.burnedSupplyAtoms = "0";
  concentration.providerCandidate.tokenSupplyAtoms = "10000000000";
  concentration.providerCandidate.evidence.tokenDecimals.coverage.amountAtoms = "10000000000";
  for (const [index, account] of census.value.accounts.entries()) {
    account.amountAtoms = index < 10 ? "250000001"
      : index < 39 ? "250000000" : index === 39 ? "249999990" : "0";
  }
  let result = adapt(concentration);
  let filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(result.candidate.evidence.top10OwnerPct.value, 25.000001);
  assert.equal(filters.checks.top10Owners.status, "REJECT");

  const otherGates = fixtureInput();
  const otherCensus = otherGates.evidence.ownerCensus;
  otherCensus.value.supplyAtoms = "10000000000";
  otherCensus.coverage.burnedSupplyAtoms = "0";
  otherGates.providerCandidate.tokenSupplyAtoms = "10000000000";
  otherGates.providerCandidate.evidence.tokenDecimals.coverage.amountAtoms = "10000000000";
  otherCensus.value.accounts.splice(40, 0, ...Array.from({length: 10}, (_, index) => ({
    account: address("B", index + 40),
    owner: address("A", index + 40),
    amountAtoms: "0",
    classification: "holder"
  })));
  for (const [index, account] of otherCensus.value.accounts.entries()) {
    account.amountAtoms = index === 0 || index === 1 ? "150000005"
      : index < 49 ? "202083333" : index === 49 ? "202083339" : "0";
  }
  otherGates.evidence.developerAttribution.value.developerOwners = [
    address("A", 0), address("A", 1)
  ];
  otherGates.evidence.bundledLaunch.value.bundledSupplyAtoms = "1000000001";
  result = adapt(otherGates);
  filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(filters.checks.top10Owners.status, "PASS");
  assert.equal(result.candidate.evidence.devAssociatedPct.value, 3.000001);
  assert.equal(filters.checks.devHoldings.status, "REJECT");
  assert.equal(result.candidate.evidence.bundledLaunchPct.value, 10.000001);
  assert.equal(filters.checks.bundledLaunch.status, "REJECT");
});

test("developer identities require independent attribution and are never inferred from holders", () => {
  const input = fixtureInput();
  delete input.evidence.developerAttribution;
  const result = adapt(input);
  const filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(filters.checks.top10Owners.status, "PASS");
  assert.equal(filters.checks.devHoldings.status, "UNKNOWN");
});

test("LP lock evidence is selected-pool bound and must cover the proposed hold", () => {
  const input = fixtureInput();
  input.evidence.lpProtection = reviewed(SYNTHETIC_SOURCE, {
    model: "lock", pool: IDENTITY.pool, lockedUntil: HOLD_UNTIL
  });
  let result = adapt(input);
  assert.equal(filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL})
    .checks.lpProtection.status, "PASS");

  result = adapt(input, {holdUntil: NOW - 1});
  assert.equal(filterCandidate(result.candidate, {now: NOW, holdUntil: NOW - 1})
    .checks.lpProtection.status, "UNKNOWN");
  result = adapt(input, {holdUntil: NOW});
  assert.equal(filterCandidate(result.candidate, {now: NOW, holdUntil: NOW})
    .checks.lpProtection.status, "UNKNOWN");

  input.evidence.lpProtection.value.lockedUntil = HOLD_UNTIL - 1;
  result = adapt(input);
  assert.equal(filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL})
    .checks.lpProtection.status, "REJECT");

  input.evidence.lpProtection.value.pool = address("Z", 5);
  result = adapt(input);
  assert.equal(filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL})
    .checks.lpProtection.status, "UNKNOWN");
});

test("stale or cross-candidate analyst evidence stays UNKNOWN and synthetic never becomes real", () => {
  const input = fixtureInput();
  input.analystEvidence.momentum15m = {
    ...input.analystEvidence.momentum15m,
    identity: {...IDENTITY, quote: address("Z", 2)}
  };
  const result = adapt(input);
  const filters = filterCandidate(result.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  const analysis = analyzeCandidate(result.candidate, {
    now: NOW,
    filterResult: filters,
    smartWalletAllowlist: result.smartWalletAllowlist
  });
  assert.equal(analysis.status, "SCORE_UNAVAILABLE");
  assert.equal(analysis.components.momentum15m.status, "UNKNOWN");
  assert.equal(result.realDataEntryEligible, false);

  const mixed = fixtureInput();
  mixed.providerCandidate.source = "DexScreener public API";
  const mixedResult = adapt(mixed);
  const mixedFilters = filterCandidate(mixedResult.candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(mixedResult.syntheticFixtureOnly, false);
  assert.equal(mixedFilters.status, "UNKNOWN");
  assert.equal(mixedResult.realDataEntryEligible, false);
});
