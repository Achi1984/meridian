import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  ALLOWED_SOLANA_RPC_METHODS,
  assertAllowedSolanaRpcMethod,
  createReadOnlyAdapterInterface,
  parseDexScreenerPair,
  parseSolanaLargestAccounts
} from "../scripts/memecoin-paper/adapters.mjs";
import {
  PaperLedger,
  PAPER_LEDGER_POLICY
} from "../scripts/memecoin-paper/ledger.mjs";
import {runSyntheticReplay} from "../scripts/memecoin-paper/replay.mjs";
import {
  AuditLogger,
  analyzeCandidate,
  filterCandidate,
  scout
} from "../scripts/memecoin-paper/stages.mjs";
import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE,
  SYNTHETIC_SMART_WALLET_ALLOWLIST,
  SYNTHETIC_SOURCE,
  syntheticCandidate
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const ZERO_COSTS = {
  feeCents: 0,
  spreadCents: 0,
  slippageCents: 0,
  priceImpactCents: 0,
  networkCents: 0
};

function setEvidence(candidate, key, value, coverage = candidate.evidence[key]?.coverage) {
  candidate.evidence[key] = {...candidate.evidence[key], value, coverage};
  if (key === "marketCapUsd") candidate.marketCapUsd = value;
  if (key === "pairCreatedAt") candidate.pairCreatedAt = value;
  if (key === "tokenDecimals") candidate.decimals = value;
}

function validFilters(candidate, now, options = {}) {
  return filterCandidate(candidate, {now, holdUntil: now + EIGHT_HOURS, ...options});
}

function identityCandidate(mint, now) {
  const candidate = syntheticCandidate(now);
  candidate.mint = mint;
  for (const item of Object.values(candidate.evidence)) item.binding.mint = mint;
  for (const item of Object.values(candidate.analystEvidence)) item.binding.mint = mint;
  return candidate;
}

function paperInputs(candidate, now) {
  const filters = validFilters(candidate, now);
  const analysis = analyzeCandidate(candidate, {
    now,
    filterResult: filters,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  assert.equal(filters.status, "PASS");
  assert.equal(analysis.status, "PASS");
  return {filters, analysis};
}

function authorize(ledger, candidate, now, {authorizationId = `auth-${candidate.mint}`, tickId = "tick-1"} = {}) {
  const {filters, analysis} = paperInputs(candidate, now);
  return ledger.authorizeEntry({
    authorizationId,
    candidate,
    filterResult: filters,
    scoreResult: analysis,
    tickId,
    now: now + 1000
  });
}

function fillQuote(candidate, now, overrides = {}) {
  return {
    eventId: `entry-${candidate.mint}`,
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: SYNTHETIC_SOURCE,
    observedAt: now + 2000,
    priceMicros: 10_000,
    decimals: candidate.decimals,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: ZERO_COSTS,
    ...overrides
  };
}

function exitQuote(candidate, now, priceMicros, overrides = {}) {
  return {
    eventId: `exit-${candidate.mint}-${now}`,
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: SYNTHETIC_SOURCE,
    observedAt: now,
    priceMicros,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: ZERO_COSTS,
    ...overrides
  };
}

test("strict filter accepts inclusive baseline evidence and carries provenance", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const result = validFilters(candidate, now);
  assert.equal(result.status, "PASS");
  assert.equal(result.accepted, true);
  for (const check of Object.values(result.checks)) {
    assert.equal(check.status, "PASS");
    if (check.source) assert.equal(check.source, SYNTHETIC_SOURCE);
  }
});

test("pair-age inclusive bounds reject just-outside values", () => {
  const now = Date.now();
  for (const age of [30 * 60 * 1000, 72 * 60 * 60 * 1000]) {
    const candidate = syntheticCandidate(now);
    setEvidence(candidate, "pairCreatedAt", now - age);
    assert.equal(validFilters(candidate, now).checks.pairAge.status, "PASS");
  }
  for (const age of [30 * 60 * 1000 - 1, 72 * 60 * 60 * 1000 + 1]) {
    const candidate = syntheticCandidate(now);
    setEvidence(candidate, "pairCreatedAt", now - age);
    assert.equal(validFilters(candidate, now).checks.pairAge.status, "REJECT");
  }
});

test("market cap uses only actual marketCap and has inclusive bounds", () => {
  const now = Date.now();
  for (const cap of [300_000, 20_000_000]) {
    const candidate = syntheticCandidate(now);
    setEvidence(candidate, "marketCapUsd", cap);
    assert.equal(validFilters(candidate, now).checks.marketCap.status, "PASS");
  }
  for (const cap of [299_999, 20_000_001]) {
    const candidate = syntheticCandidate(now);
    setEvidence(candidate, "marketCapUsd", cap);
    assert.equal(validFilters(candidate, now).checks.marketCap.status, "REJECT");
  }
  const missing = syntheticCandidate(now);
  missing.marketCapUsd = null;
  missing.fdv = 2_000_000;
  delete missing.evidence.marketCapUsd;
  assert.equal(validFilters(missing, now).checks.marketCap.status, "UNKNOWN");
});

test("liquidity, volume, concentration, dev holdings, bundled supply and run-up boundaries", () => {
  const now = Date.now();
  const cases = [
    ["liquidityUsd", "liquidity", 40_000, 39_999],
    ["volume1hUsd", "volume1h", 50_000, 49_999],
    ["top10OwnerPct", "top10Owners", 25, 25.01],
    ["devAssociatedPct", "devHoldings", 3, 3.01],
    ["bundledLaunchPct", "bundledLaunch", 10, 10.01],
    ["priceChange1hPct", "priceRunup", 79.99, 80]
  ];
  for (const [field, check, accepted, rejected] of cases) {
    const pass = syntheticCandidate(now);
    setEvidence(pass, field, accepted);
    assert.equal(validFilters(pass, now).checks[check].status, "PASS", `${field} at boundary`);
    const fail = syntheticCandidate(now);
    setEvidence(fail, field, rejected);
    assert.equal(validFilters(fail, now).checks[check].status, "REJECT", `${field} past boundary`);
  }
});

test("unknown, stale, unbound, incomplete and unsafe evidence fail closed distinctly", () => {
  const now = Date.now();
  const missing = syntheticCandidate(now);
  delete missing.evidence.mintAuthorityRevoked;
  assert.equal(validFilters(missing, now).checks.mintAuthority.status, "UNKNOWN");

  const stale = syntheticCandidate(now);
  stale.evidence.volume1hUsd.observedAt = now - 5 * 60 * 1000 - 1;
  assert.equal(validFilters(stale, now).checks.volume1h.status, "UNKNOWN");

  const mixedPool = syntheticCandidate(now);
  mixedPool.evidence.liquidityUsd.binding.pool = "11111111111111111111111111111112";
  assert.equal(validFilters(mixedPool, now).checks.liquidity.status, "UNKNOWN");

  const incompleteOwners = syntheticCandidate(now);
  setEvidence(incompleteOwners, "top10OwnerPct", 10, {complete: false});
  assert.equal(validFilters(incompleteOwners, now).checks.top10Owners.status, "UNKNOWN");

  const unrevoked = syntheticCandidate(now);
  setEvidence(unrevoked, "freezeAuthorityRevoked", false);
  assert.equal(validFilters(unrevoked, now).checks.freezeAuthority.status, "REJECT");

  const extension = syntheticCandidate(now);
  setEvidence(extension, "tokenExtensions", {
    transferFee: false, transferHook: true, defaultFrozen: false, permanentDelegate: false
  });
  assert.equal(validFilters(extension, now).checks.tokenExtensions.status, "REJECT");
});

test("pool lock evidence must match selected pool and cover the proposed hold", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  setEvidence(candidate, "lpProtection", {
    verified: true, model: "lock", pool: candidate.pool,
    lockedUntil: now + EIGHT_HOURS - 1
  });
  assert.equal(validFilters(candidate, now).checks.lpProtection.status, "REJECT");
  candidate.evidence.lpProtection.value.lockedUntil = now + EIGHT_HOURS;
  assert.equal(validFilters(candidate, now).checks.lpProtection.status, "PASS");
  candidate.evidence.lpProtection.value.pool = "11111111111111111111111111111112";
  assert.equal(validFilters(candidate, now).checks.lpProtection.status, "UNKNOWN");
});

test("Scout deterministically deduplicates mint without mixing pool-bound evidence", () => {
  const now = Date.now();
  const older = syntheticCandidate(now - 1000);
  const newer = syntheticCandidate(now, {pool: "11111111111111111111111111111112"});
  const result = scout([older, newer], {now, source: SYNTHETIC_SOURCE, maxCandidates: 2});
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].pool, newer.pool);
  assert.equal(result.audit.filter(event => event.status === "REJECT").length, 1);
  assert.equal(validFilters(result.selected[0], now).checks.liquidity.status, "UNKNOWN");
  assert.equal(result.discovery.exhaustive, false);
});

test("score is fully evidenced, fixed-weight, and exactly gates at 70", () => {
  const now = Date.now();
  for (const [momentum, expected] of [[9.8, 70], [9.5, 69]]) {
    const candidate = syntheticCandidate(now);
    candidate.analystEvidence.momentum15m.value = momentum;
    candidate.analystEvidence.uniqueBuyers1h.value = 70;
    candidate.analystEvidence.buySellUsdRatio1h.coverage.buyVolumeUsd = 190;
    candidate.analystEvidence.buySellUsdRatio1h.coverage.sellVolumeUsd = 100;
    candidate.analystEvidence.holderGrowthPct1h.value = 9;
    candidate.analystEvidence.liquidityMarketCapPct.value = 3.56;
    candidate.analystEvidence.qualifiedSmartWallets.value = 4;
    const result = analyzeCandidate(candidate, {
      now,
      filterResult: validFilters(candidate, now),
      smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
    });
    assert.equal(result.score, expected);
    assert.equal(result.status, expected === 70 ? "PASS" : "REJECT");
  }
});

test("missing smart-wallet provenance and incomplete analyst data never redistribute score", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const filterResult = validFilters(candidate, now);
  const unavailable = analyzeCandidate(candidate, {now, filterResult});
  assert.equal(unavailable.status, "SCORE_UNAVAILABLE");
  assert.equal(unavailable.score, null);
  assert.equal(unavailable.components.qualifiedSmartWallets.status, "UNKNOWN");
  const stale = syntheticCandidate(now);
  stale.analystEvidence.momentum15m.observedAt = now - 300_001;
  const staleResult = analyzeCandidate(stale, {
    now, filterResult: validFilters(stale, now),
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  assert.equal(staleResult.status, "SCORE_UNAVAILABLE");
  assert.equal(staleResult.components.momentum15m.status, "UNKNOWN");
});

test("DexScreener parser preserves missing market cap and never substitutes FDV", () => {
  const parsed = parseDexScreenerPair({
    chainId: "solana",
    pairAddress: SYNTHETIC_POOL,
    baseToken: {address: SYNTHETIC_MINT},
    quoteToken: {address: SYNTHETIC_QUOTE},
    pairCreatedAt: 1_700_000_000_000,
    fdv: 9_000_000,
    liquidity: {usd: 50_000},
    volume: {h1: 60_000},
    txns: {h1: {buys: 5, sells: 4}},
    priceChange: {h1: 10}
  }, {sampledAt: 1_700_000_001_000});
  assert.equal(parsed.status, "PARTIAL");
  assert.equal(parsed.marketCapUsd, null);
  assert.equal(parsed.evidence.fdvObservedButNotUsed, true);
  assert.ok(parsed.unsupportedRequiredEvidence.length > 0);
});

test("RPC adapter exposes only read methods and largest token accounts stay incomplete", async () => {
  assert.deepEqual(ALLOWED_SOLANA_RPC_METHODS, ["getAccountInfo", "getTokenLargestAccounts", "getTokenSupply"]);
  assert.equal(assertAllowedSolanaRpcMethod("getAccountInfo"), "getAccountInfo");
  assert.throws(() => assertAllowedSolanaRpcMethod("sendTransaction"), /read-only allowlist/);
  const largest = parseSolanaLargestAccounts({
    result: {context: {slot: 44}, value: [{address: "account", amount: "1"}]}
  }, {observedAt: Date.now()});
  assert.equal(largest.status, "UNKNOWN");
  assert.equal(largest.coverage.complete, false);
  assert.equal(largest.coverage.ownerAggregation, false);
  await assert.rejects(createReadOnlyAdapterInterface().request("getAccountInfo"), /disabled/);
});

test("fixed-point entry sizes to at most 8%, reserves atomically, and deduplicates event identity", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  assert.equal(auth.maxSpendCents, 8000n);
  assert.equal(auth.executionMode, "SIMULATED_ONLY");
  const quote = fillQuote(candidate, now);
  const fill = ledger.executeEntry(auth, quote, {now: now + 2000});
  assert.equal(fill.status, "FILLED_PAPER");
  assert.equal(fill.allInCents, "8000");
  assert.equal(fill.tokenAtoms, "8000000000");
  assert.equal(ledger.summary().cashCents, "92000");
  assert.deepEqual(ledger.executeEntry(auth, quote, {now: now + 2000}), fill);
  assert.equal(ledger.auditEvents()[0].type, "RISK_AUTHORIZED");
  assert.deepEqual(ledger.auditEvents().slice(1, 3).map(event => event.type), ["STOP_ARMED", "PAPER_FILL"]);
  assert.equal(ledger.executeEntry(auth, {...quote, priceMicros: 9999}, {now: now + 2000}).status, "REJECT");
});

test("risk reservations cap three distinct positions and prevent same-tick re-entry", () => {
  const now = Date.now();
  const ledger = new PaperLedger({now});
  const candidates = [
    identityCandidate("11111111111111111111111111111111", now),
    identityCandidate("11111111111111111111111111111112", now),
    identityCandidate("11111111111111111111111111111113", now),
    identityCandidate("11111111111111111111111111111114", now)
  ];
  const reservations = candidates.slice(0, 3).map((candidate, index) =>
    authorize(ledger, candidate, now, {authorizationId: `auth-${index}`, tickId: `tick-${index}`}));
  assert.ok(reservations.every(item => item.status === "AUTHORIZED"));
  const overflow = authorize(ledger, candidates[3], now, {authorizationId: "auth-overflow", tickId: "tick-4"});
  assert.equal(overflow.status, "REJECT");
  assert.match(overflow.reason, /three/);
  const duplicateMint = ledger.authorizeEntry({
    authorizationId: "auth-same-tick",
    candidate: candidates[0],
    filterResult: validFilters(candidates[0], now),
    scoreResult: analyzeCandidate(candidates[0], {
      now, filterResult: validFilters(candidates[0], now),
      smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
    }),
    tickId: "tick-0",
    now: now + 1000
  });
  assert.equal(duplicateMint.status, "REJECT");
});

test("same-sample, stale, and identity-mismatched fills stay unfilled", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  assert.equal(ledger.executeEntry(auth, fillQuote(candidate, now, {observedAt: now + 1000}), {now: now + 1000}).status, "UNFILLED");
  const staleAuth = authorize(ledger, candidate, now, {authorizationId: "auth-2", tickId: "tick-2"});
  assert.equal(ledger.executeEntry(staleAuth, fillQuote(candidate, now), {now: now + 600_000}).status, "UNFILLED");
  const wrongAuth = authorize(ledger, candidate, now, {authorizationId: "auth-3", tickId: "tick-3"});
  assert.equal(ledger.executeEntry(wrongAuth, fillQuote(candidate, now, {pool: "11111111111111111111111111111112"}), {now: now + 2000}).status, "UNFILLED");
});

test("decimal dust and invalid decimals fail closed without float ledger accounting", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  candidate.decimals = 0;
  candidate.evidence.tokenDecimals.value = 0;
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  const dust = ledger.executeEntry(auth, fillQuote(candidate, now, {priceMicros: 1_000_000_000}), {now: now + 2000});
  assert.equal(dust.status, "UNFILLED");
  assert.equal(ledger.summary().cashCents, "100000");
  assert.throws(() => new PaperLedger({initialCapitalCents: 100000.5, now}), /integer/);
  assert.equal(PAPER_LEDGER_POLICY.initialCapitalCents, "100000");
});

test("cost assumptions are explicit, integer cents, and charged once", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  const quote = fillQuote(candidate, now, {costs: {
    feeCents: 100, spreadCents: 50, slippageCents: 25, priceImpactCents: 25, networkCents: 10
  }});
  const result = ledger.executeEntry(auth, quote, {now: now + 2000});
  assert.equal(result.entryCostsCents, "210");
  assert.equal(result.allInCents, "8000");
  assert.equal(ledger.summary().cashCents, "92000");

  const ledger2 = new PaperLedger({now});
  const auth2 = authorize(ledger2, candidate, now);
  const missingCosts = ledger2.executeEntry(auth2, fillQuote(candidate, now, {
    costs: {...ZERO_COSTS, feeCents: undefined}
  }), {now: now + 2000});
  assert.equal(missingCosts.status, "UNFILLED");
  assert.equal(ledger2.summary().cashCents, "100000");
});

test("initial stop, trailing activation, high-water monotonicity, and gap-through fill", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  const fill = ledger.executeEntry(auth, fillQuote(candidate, now), {now: now + 2000});
  assert.equal(fill.initialStopPriceMicros, "9400");

  const first = ledger.observeExitQuote(exitQuote(candidate, now + 3000, 11_200));
  assert.equal(first.status, "MARKED");
  assert.equal(first.stopPriceMicros, "10528");
  const second = ledger.observeExitQuote(exitQuote(candidate, now + 4000, 10_600));
  assert.equal(second.status, "MARKED");
  assert.equal(second.stopPriceMicros, "10528");
  const exit = ledger.observeExitQuote(exitQuote(candidate, now + 5000, 10_000));
  assert.equal(exit.status, "CLOSED_PAPER");
  assert.equal(exit.fillPriceMicros, "10000");
  assert.equal(exit.gapThroughStop, true);
  assert.equal(exit.realizedNetPnlCents, "0");
  assert.equal(ledger.summary().openPositions.length, 0);
});

test("missing exit evidence is unresolved and never invents liquidation profit", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  ledger.executeEntry(auth, fillQuote(candidate, now), {now: now + 2000});
  const result = ledger.observeExitQuote(exitQuote(candidate, now + 3000, 9000, {
    executable: false, costs: undefined
  }));
  assert.equal(result.status, "UNFILLED");
  assert.equal(ledger.summary().openPositions.length, 1);
  assert.equal(ledger.summary().cashCents, "92000");
});

test("daily loss gate uses Europe/Vienna opening equity and unknown marks block entries", () => {
  const dayStart = Date.parse("2026-01-01T22:59:00Z");
  const nextViennaDay = Date.parse("2026-01-01T23:00:00Z");
  const dailyLedger = new PaperLedger({now: dayStart});
  const rollover = dailyLedger.riskSnapshot({now: nextViennaDay, marks: []});
  assert.equal(rollover.status, "PASS");
  assert.equal(dailyLedger.day, "2026-01-02");
  assert.equal(rollover.dailyOpeningEquityCents, 100000n);

  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  ledger.executeEntry(auth, fillQuote(candidate, now), {now: now + 2000});
  const unknown = ledger.riskSnapshot({now: now + 3000, marks: []});
  assert.equal(unknown.status, "EQUITY_UNKNOWN");
  assert.equal(unknown.entriesAllowed, false);
  const lossMark = {
    ...exitQuote(candidate, now + 3000, 6000),
    costs: ZERO_COSTS
  };
  const loss = ledger.riskSnapshot({now: now + 3000, marks: [lossMark]});
  assert.equal(loss.status, "DAILY_LOSS_LIMIT");
  assert.equal(loss.lossCents, 3200n);
  assert.equal(loss.limitCents, 3000n);
  assert.equal(loss.entriesAllowed, false);
});

test("eight-hour report stops new work and leaves open positions explicitly unresolved", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  ledger.executeEntry(auth, fillQuote(candidate, now), {now: now + 2000});
  const report = ledger.finishRun({startedAt: now, now: now + EIGHT_HOURS, marks: []});
  assert.equal(report.status, "FINISHED");
  assert.equal(report.entriesAllowed, false);
  assert.equal(report.openPositions[0].markStatus, "VALUATION_UNAVAILABLE");
  assert.match(report.note, /not liquidated/);
  assert.equal(ledger.summary().openPositions.length, 1);
  assert.equal(PaperLedger.restartDisposition().status, "UNRECOVERABLE_FAIL_CLOSED");
  assert.equal(PaperLedger.restartDisposition().entriesAllowed, false);
});

test("audit output is bounded and removes URLs/control characters from hostile fields", () => {
  const logger = new AuditLogger({maxEvents: 1, maxTextLength: 40});
  assert.equal(logger.record({reason: "hostile\u0000 https://token.example/path?secret=x"}), true);
  assert.equal(logger.record({reason: "overflow"}), false);
  assert.equal(logger.report().length, 1);
  assert.doesNotMatch(logger.report()[0].reason, /https?:\/\//);
  assert.doesNotMatch(logger.report()[0].reason, /\u0000/);
});

test("synthetic replay is integrated, bounded, and visibly non-operational", () => {
  const report = runSyntheticReplay({now: Date.now()});
  assert.equal(report.reportType, "SYNTHETIC_FIXTURE_REPLAY_ONLY");
  assert.equal(report.networkAccessed, false);
  assert.equal(report.liveCandidateEvidence, false);
  assert.deepEqual(report.pipeline.map(stage => stage.stage), [
    "Scout", "Filter", "Analyst", "Risk authorization", "Executor (simulated only)", "Logger"
  ]);
  assert.equal(report.filters.status, "PASS");
  assert.equal(report.analysis.status, "PASS");
  assert.equal(report.simulatedFill.executionRealistic, false);
  assert.equal(report.runEnd.openPositions[0].markStatus, "VALUATION_UNAVAILABLE");
  assert.match(report.caveat, /not market observations/);
});

test("one-shot manifest remains disabled, unset, bounded, and allowlists no user URLs", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "scripts/memecoin-paper/run-manifest.json"), "utf8"));
  assert.equal(manifest.enabled, false);
  assert.equal(manifest.stopSwitch.engaged, true);
  assert.equal(manifest.startAt, null);
  assert.equal(manifest.endAt, null);
  assert.equal(manifest.durationMs, EIGHT_HOURS);
  assert.deepEqual(manifest.allowedMints, []);
  assert.deepEqual(manifest.allowedPools, []);
  assert.equal(manifest.http.arbitraryUrls, false);
  assert.equal(manifest.http.tokenProvidedUrls, false);
  assert.equal(manifest.http.redirects, "error");
  assert.ok(manifest.pollBudget.maxBytesPerResponse > 0);
  assert.ok(manifest.pollBudget.maxBytesPerRun > manifest.pollBudget.maxBytesPerResponse);
});
