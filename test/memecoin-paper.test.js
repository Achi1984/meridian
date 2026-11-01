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
  processCandidate,
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

function authorize(ledger, candidate, now, {
  authorizationId = `auth-${candidate.mint}`,
  tickId = "tick-1",
  marks = []
} = {}) {
  const {filters, analysis} = paperInputs(candidate, now);
  return ledger.authorizeEntry({
    authorizationId,
    candidate,
    filterResult: filters,
    scoreResult: analysis,
    tickId,
    now: now + 1000,
    marks
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
    assert.equal(check.source, SYNTHETIC_SOURCE);
    assert.equal(check.observedAt, now);
    assert.ok(check.coverage);
    assert.ok(check.reason);
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

  assert.equal(filterCandidate(syntheticCandidate(now), {now: "not-a-time"}).status, "UNKNOWN");

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

test("prior-rug rejection requires attributable evidence and survives the audit trail", () => {
  const now = Date.now();
  const unsupported = syntheticCandidate(now);
  setEvidence(unsupported, "crediblePriorRug", {
    found: true, reviewed: true, historyCoverage: "complete"
  });
  assert.equal(validFilters(unsupported, now).checks.priorRug.status, "UNKNOWN");

  const attributed = syntheticCandidate(now);
  setEvidence(attributed, "crediblePriorRug", {
    found: true,
    reviewed: true,
    historyCoverage: "complete",
    attribution: "Public transaction evidence reviewed",
    evidenceIds: ["tx-signature-reference-1"]
  });
  const {filters, logger} = processCandidate(attributed, {
    now,
    holdUntil: now + EIGHT_HOURS,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  assert.equal(filters.checks.priorRug.status, "REJECT");
  assert.equal(logger.report().filter(event => event.stage === "Filter").length, Object.keys(filters.checks).length);
  assert.deepEqual(filters.checks.priorRug.evidenceRefs, ["tx-signature-reference-1"]);
  const row = logger.report().find(event => event.gate === "priorRug");
  assert.equal(row.status, "REJECT");
  assert.deepEqual(row.evidenceRefs, ["tx-signature-reference-1"]);
  assert.equal(row.source, SYNTHETIC_SOURCE);
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

test("synthetic evidence and smart-wallet fixture allowlists cannot mix with real-source candidates", () => {
  const now = Date.now();
  const claimedReal = syntheticCandidate(now, {source: "DexScreener public API"});
  const filterResult = validFilters(claimedReal, now);
  assert.equal(filterResult.status, "UNKNOWN");
  assert.equal(filterResult.checks.mintAuthority.status, "UNKNOWN");
  const score = analyzeCandidate(claimedReal, {
    now,
    filterResult: validFilters(syntheticCandidate(now), now),
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  assert.equal(score.status, "BLOCKED");
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

test("malformed adapter identities return UNKNOWN instead of trusting hostile fields", () => {
  const parsed = parseDexScreenerPair({
    chainId: "solana",
    pairAddress: "https://attacker.example/pool",
    baseToken: {address: SYNTHETIC_MINT},
    quoteToken: {address: SYNTHETIC_QUOTE},
    liquidity: {usd: 50_000},
    volume: {h1: 50_000},
    txns: {h1: {buys: 1, sells: 1}}
  }, {sampledAt: Date.now()});
  assert.equal(parsed.status, "UNKNOWN");
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
  assert.equal(ledger.executeEntry(auth, {...quote, eventId: "entry\nhttps://evil"}, {now: now + 2000}).status, "REJECT");
});

test("entry requires literal executable true", () => {
  const now = Date.now();
  for (const [index, executable] of ["false", 1, {}, []].entries()) {
    const candidate = syntheticCandidate(now);
    const ledger = new PaperLedger({now});
    const auth = authorize(ledger, candidate, now);
    const result = ledger.executeEntry(auth, fillQuote(candidate, now, {
      eventId: `invalid-executable-${index}`,
      executable
    }), {now: now + 2000});
    assert.equal(result.status, "UNFILLED");
    assert.equal(ledger.summary().cashCents, "100000");
    assert.equal(ledger.summary().openPositions.length, 0);
  }
});

test("entry event identity binds actual quote identity and exact replay charges once", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  const quote = fillQuote(candidate, now, {
    eventId: "entry-quote-identity",
    costs: {...ZERO_COSTS, feeCents: 10}
  });
  const fill = ledger.executeEntry(auth, quote, {now: now + 2000});
  assert.equal(fill.status, "FILLED_PAPER");
  assert.deepEqual(ledger.executeEntry(auth, quote, {now: now + 2000}), fill);
  assert.equal(ledger.summary().cashCents, "92000");
  assert.equal(ledger.summary().costs.entry.feeCents, "10");
  assert.equal(ledger.summary().eventCount, 3);

  const afterFill = ledger.summary();
  const changedIdentities = [
    {mint: "11111111111111111111111111111112"},
    {chainId: "other-chain"},
    {pool: "11111111111111111111111111111113"},
    {quote: "11111111111111111111111111111114"}
  ];
  for (const identity of changedIdentities) {
    const result = ledger.executeEntry(auth, {...quote, ...identity}, {now: now + 2000});
    assert.equal(result.status, "REJECT");
    assert.deepEqual(ledger.summary(), afterFill);
  }
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
  const mismatchedDecision = ledger.authorizeEntry({
    authorizationId: "auth-mismatched",
    candidate: candidates[3],
    filterResult: validFilters(candidates[0], now),
    scoreResult: analyzeCandidate(candidates[0], {
      now, filterResult: validFilters(candidates[0], now),
      smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
    }),
    tickId: "tick-mismatched",
    now: now + 1000
  });
  assert.equal(mismatchedDecision.status, "REJECT");
  assert.match(mismatchedDecision.reason, /not bound/);
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

test("pending reservations reject a second authorization for the same mint before either fills", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const first = authorize(ledger, candidate, now, {authorizationId: "same-mint-first", tickId: "tick-a"});
  const second = authorize(ledger, candidate, now, {authorizationId: "same-mint-second", tickId: "tick-b"});
  assert.equal(first.status, "AUTHORIZED");
  assert.equal(second.status, "REJECT");

  const firstFill = ledger.executeEntry(first, fillQuote(candidate, now, {
    eventId: "same-mint-entry-a"
  }), {now: now + 2000});
  assert.equal(firstFill.status, "FILLED_PAPER");
  const cashAfterFirstFill = ledger.summary().cashCents;
  const secondFill = ledger.executeEntry(second, fillQuote(candidate, now, {
    eventId: "same-mint-entry-b"
  }), {now: now + 2000});
  assert.equal(secondFill.status, "REJECT");
  assert.equal(ledger.summary().cashCents, cashAfterFirstFill);
  assert.equal(ledger.summary().openPositions.length, 1);
  assert.equal(ledger.summary().openPositions[0].tokenAtoms, firstFill.tokenAtoms);
});

test("analyst score must be a finite integer within the supported range", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  const filters = validFilters(candidate, now);
  const validScore = analyzeCandidate(candidate, {
    now, filterResult: filters,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  });
  for (const invalid of [NaN, Infinity, -1, 101, undefined, 69.5]) {
    const ledger = new PaperLedger({now});
    const result = ledger.authorizeEntry({
      authorizationId: `invalid-score-${String(invalid)}`,
      candidate,
      filterResult: filters,
      scoreResult: {...validScore, score: invalid},
      tickId: "invalid-score-tick",
      now: now + 1000
    });
    assert.equal(result.status, "REJECT", `score ${String(invalid)} must be rejected`);
  }
});

test("same-sample, stale, and identity-mismatched fills stay unfilled", () => {
  const now = Date.parse("2026-01-01T10:00:00Z");
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  assert.equal(ledger.executeEntry(auth, fillQuote(candidate, now, {observedAt: now + 1000}), {now: now + 1000}).status, "UNFILLED");
  assert.equal(ledger.reservations.get(auth.authorizationId), auth);

  const staleLedger = new PaperLedger({now});
  const staleAuth = authorize(staleLedger, candidate, now, {authorizationId: "auth-stale", tickId: "tick-stale"});
  const staleNow = Date.parse(staleAuth.authorizedAt) + 300_001;
  assert.equal(staleLedger.executeEntry(staleAuth, fillQuote(candidate, now, {
    eventId: "expired-execution",
    observedAt: staleNow
  }), {now: staleNow}).status, "REJECT");
  assert.equal(staleLedger.authorizationResults.get(staleAuth.authorizationId).status, "EXPIRED");

  const identityLedger = new PaperLedger({now});
  const wrongAuth = authorize(identityLedger, candidate, now, {authorizationId: "auth-wrong", tickId: "tick-wrong"});
  assert.equal(identityLedger.executeEntry(wrongAuth, fillQuote(candidate, now, {
    pool: "11111111111111111111111111111112"
  }), {now: now + 2000}).status, "UNFILLED");
});

test("entry revalidates fresh marks and retains retryable reservations on unknown marks", () => {
  const now = Date.now();
  const firstCandidate = syntheticCandidate(now);
  const secondCandidate = identityCandidate("11111111111111111111111111111112", now + 2500);
  const ledger = new PaperLedger({now});
  const firstAuth = authorize(ledger, firstCandidate, now);
  assert.equal(ledger.executeEntry(firstAuth, fillQuote(firstCandidate, now), {now: now + 2000}).status, "FILLED_PAPER");

  const currentMark = exitQuote(firstCandidate, now + 3000, 10_000);
  const secondAuth = authorize(ledger, secondCandidate, now + 3000, {
    authorizationId: "unknown-mark-auth",
    tickId: "unknown-mark-tick",
    marks: [currentMark]
  });
  const cashBefore = ledger.summary().cashCents;
  const unknown = ledger.executeEntry(secondAuth, fillQuote(secondCandidate, now + 3000, {
    eventId: "unknown-mark-entry"
  }), {now: now + 5000});
  assert.equal(unknown.status, "UNFILLED");
  assert.match(unknown.reason, /fresh complete marks/);
  assert.equal(ledger.summary().cashCents, cashBefore);
  assert.equal(ledger.summary().openPositions.length, 1);
  assert.equal(ledger.reservations.get(secondAuth.authorizationId), secondAuth);

  const staleMark = exitQuote(firstCandidate, now + 3000 - 300_001, 10_000);
  const stale = ledger.executeEntry(secondAuth, fillQuote(secondCandidate, now + 3000, {
    eventId: "stale-mark-entry"
  }), {now: now + 5000, marks: [staleMark]});
  assert.equal(stale.status, "UNFILLED");
  assert.match(stale.reason, /fresh complete marks/);
  assert.equal(ledger.summary().cashCents, cashBefore);
});

test("a daily loss trip revokes earlier reservations before they can fill", () => {
  const now = Date.now();
  const firstCandidate = syntheticCandidate(now);
  const secondCandidate = identityCandidate("11111111111111111111111111111112", now + 2500);
  const ledger = new PaperLedger({now});
  const firstAuth = authorize(ledger, firstCandidate, now);
  ledger.executeEntry(firstAuth, fillQuote(firstCandidate, now), {now: now + 2000});
  const mark = exitQuote(firstCandidate, now + 3000, 10_000);
  const secondAuth = authorize(ledger, secondCandidate, now + 3000, {
    authorizationId: "pre-loss-reservation",
    tickId: "pre-loss-tick",
    marks: [mark]
  });
  assert.equal(secondAuth.status, "AUTHORIZED");

  const lossMark = exitQuote(firstCandidate, now + 4000, 6000);
  const gate = ledger.riskSnapshot({now: now + 4000, marks: [lossMark]});
  assert.equal(gate.status, "DAILY_LOSS_LIMIT");
  assert.equal(ledger.reservations.has(secondAuth.authorizationId), false);
  assert.equal(ledger.authorizationResults.get(secondAuth.authorizationId).status, "REVOKED");
  const cashAfterGate = ledger.summary().cashCents;
  const attempt = ledger.executeEntry(secondAuth, fillQuote(secondCandidate, now + 3000, {
    eventId: "pre-loss-entry"
  }), {now: now + 5000, marks: []});
  assert.equal(attempt.status, "REJECT");
  assert.equal(ledger.summary().cashCents, cashAfterGate);
  assert.equal(ledger.summary().openPositions.length, 0);
});

test("execution resizes to current equity's 8% cap after an authorized mark decline", () => {
  const now = Date.now();
  const firstCandidate = syntheticCandidate(now);
  const secondCandidate = identityCandidate("11111111111111111111111111111112", now + 2500);
  const ledger = new PaperLedger({now});
  const firstAuth = authorize(ledger, firstCandidate, now);
  ledger.executeEntry(firstAuth, fillQuote(firstCandidate, now), {now: now + 2000});
  const entryMark = exitQuote(firstCandidate, now + 3000, 10_000);
  const secondAuth = authorize(ledger, secondCandidate, now + 3000, {
    authorizationId: "equity-revalidation-auth",
    tickId: "equity-revalidation-tick",
    marks: [entryMark]
  });
  assert.equal(secondAuth.maxSpendCents, 8000n);
  const declinedMark = exitQuote(firstCandidate, now + 4000, 7500);
  const fill = ledger.executeEntry(secondAuth, fillQuote(secondCandidate, now + 4000, {
    eventId: "equity-revalidated-entry",
    observedAt: now + 5000
  }), {now: now + 5000, marks: [declinedMark]});
  assert.equal(fill.status, "FILLED_PAPER");
  assert.ok(BigInt(fill.allInCents) <= 7840n);
  assert.equal(ledger.summary().openPositions.length, 2);
});

test("authorization expires after five minutes and cannot cross Vienna midnight", () => {
  const now = Date.parse("2026-01-01T10:00:00Z");
  const candidate = syntheticCandidate(now);
  const ledger = new PaperLedger({now});
  const boundaryAuth = authorize(ledger, candidate, now, {
    authorizationId: "auth-age-boundary",
    tickId: "tick-age-boundary"
  });
  const boundaryNow = Date.parse(boundaryAuth.authorizedAt) + 5 * 60 * 1000;
  const boundaryQuote = fillQuote(candidate, now, {
    eventId: "auth-age-boundary-entry",
    observedAt: boundaryNow,
    priceMicros: 10_000
  });
  assert.equal(ledger.executeEntry(boundaryAuth, boundaryQuote, {now: boundaryNow}).status, "FILLED_PAPER");

  const nextCandidate = identityCandidate("11111111111111111111111111111112", boundaryNow + 1000);
  const expiredAuth = authorize(ledger, nextCandidate, boundaryNow + 1000, {
    authorizationId: "auth-expired",
    tickId: "tick-expired",
    marks: [exitQuote(candidate, boundaryNow + 1000, 10_000)]
  });
  const expiredNow = Date.parse(expiredAuth.authorizedAt) + 5 * 60 * 1000 + 1;
  const expired = ledger.executeEntry(expiredAuth, fillQuote(nextCandidate, expiredNow - 1000, {
    eventId: "auth-expired-entry",
    observedAt: expiredNow
  }), {now: expiredNow, marks: [exitQuote(candidate, expiredNow, 10_000)]});
  assert.equal(expired.status, "REJECT");
  assert.equal(ledger.authorizationResults.get(expiredAuth.authorizationId).status, "EXPIRED");

  const midnightBase = Date.parse("2026-01-01T22:58:00Z");
  const midnightCandidate = syntheticCandidate(midnightBase);
  const midnightLedger = new PaperLedger({now: midnightBase});
  const midnightAuth = authorize(midnightLedger, midnightCandidate, midnightBase, {
    authorizationId: "auth-midnight",
    tickId: "tick-midnight"
  });
  const afterMidnight = Date.parse("2026-01-01T23:01:00Z");
  const crossed = midnightLedger.executeEntry(midnightAuth, fillQuote(midnightCandidate, midnightBase, {
    eventId: "auth-midnight-entry",
    observedAt: afterMidnight
  }), {now: afterMidnight});
  assert.equal(crossed.status, "REJECT");
  assert.equal(midnightLedger.authorizationResults.get(midnightAuth.authorizationId).status, "REVOKED");
  assert.equal(midnightLedger.summary().cashCents, "100000");
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

test("entry debit rounds nonintegral cents upward at the affordable base-unit boundary", () => {
  const now = Date.now();
  const candidate = syntheticCandidate(now);
  candidate.decimals = 0;
  candidate.evidence.tokenDecimals.value = 0;
  const ledger = new PaperLedger({now});
  const auth = authorize(ledger, candidate, now);
  const fill = ledger.executeEntry(auth, fillQuote(candidate, now, {
    eventId: "ceil-entry-debit",
    priceMicros: 30_001,
    decimals: 0
  }), {now: now + 2000});
  assert.equal(fill.status, "FILLED_PAPER");
  assert.equal(fill.tokenAtoms, "2666");
  assert.equal(fill.notionalCents, "7999");
  assert.equal(fill.allInCents, "7999");
  assert.ok(BigInt(fill.allInCents) <= auth.maxSpendCents);
  assert.equal(ledger.summary().cashCents, "92001");

  const mark = exitQuote(candidate, now + 3000, 30_001);
  const equity = ledger.riskSnapshot({now: now + 3000, marks: [mark]});
  assert.equal(equity.status, "PASS");
  assert.equal(equity.grossOpenValueCents, 7998n);
  assert.equal(equity.netUnrealizedPnlCents, -1n);
  assert.equal(equity.equityCents, 99999n);
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

  const mark = exitQuote(candidate, now + 3000, 10_000, {
    costs: {feeCents: 100, spreadCents: 50, slippageCents: 25, priceImpactCents: 25, networkCents: 10}
  });
  const equity = ledger.riskSnapshot({now: now + 3000, marks: [mark]});
  assert.equal(equity.status, "PASS");
  assert.equal(equity.equityCents, equity.cashAtMarkCents + equity.grossOpenValueCents - equity.estimatedExitCostsCents);
  assert.equal(equity.grossUnrealizedPnlCents, 0n);
  assert.equal(equity.netUnrealizedPnlCents, -420n);
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
  const lastQuote = exitQuote(candidate, now + 5000, 10_000);
  const exit = ledger.observeExitQuote(lastQuote);
  assert.equal(exit.status, "CLOSED_PAPER");
  assert.equal(exit.fillPriceMicros, "10000");
  assert.equal(exit.gapThroughStop, true);
  assert.equal(exit.realizedNetPnlCents, "0");
  assert.equal(ledger.summary().openPositions.length, 0);
  assert.deepEqual(ledger.observeExitQuote(lastQuote), exit);
  assert.equal(ledger.observeExitQuote({...lastQuote, costs: {...ZERO_COSTS, feeCents: 1}}).status, "REJECT");
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

test("daily loss gate uses fixed USD 30 against each Vienna day's opening equity", () => {
  const dayStart = Date.parse("2026-01-01T22:59:00Z");
  const nextViennaDay = Date.parse("2026-01-01T23:00:00Z");
  const dailyLedger = new PaperLedger({now: dayStart});
  const rollover = dailyLedger.riskSnapshot({now: nextViennaDay, marks: []});
  assert.equal(rollover.status, "PASS");
  assert.equal(dailyLedger.day, "2026-01-02");
  assert.equal(rollover.dailyOpeningEquityCents, 100000n);

  const now = Date.parse("2026-01-01T10:00:00Z");
  const ledger = new PaperLedger({now});
  const winner = syntheticCandidate(now);
  const winnerAuth = authorize(ledger, winner, now);
  ledger.executeEntry(winnerAuth, fillQuote(winner, now), {now: now + 2000});
  ledger.observeExitQuote(exitQuote(winner, now + 3000, 20_000));
  const winnerExit = exitQuote(winner, now + 4000, 18_799);
  assert.equal(ledger.observeExitQuote(winnerExit).status, "CLOSED_PAPER");
  assert.equal(ledger.summary().cashCents, "107039");

  const candidate = syntheticCandidate(now + 5000, {
    mint: "11111111111111111111111111111112"
  });
  for (const item of [...Object.values(candidate.evidence), ...Object.values(candidate.analystEvidence)]) {
    item.binding.mint = candidate.mint;
  }
  const auth = authorize(ledger, candidate, now + 5000);
  ledger.executeEntry(auth, fillQuote(candidate, now + 5000), {now: now + 7000});

  const openingMark = exitQuote(candidate, nextViennaDay, 10_000);
  const opened = ledger.riskSnapshot({now: nextViennaDay, marks: [openingMark]});
  assert.equal(opened.status, "PASS");
  assert.equal(opened.dailyOpeningEquityCents, 107039n);
  assert.equal(opened.limitCents, 3000n);

  const unknown = ledger.riskSnapshot({now: nextViennaDay + 1000, marks: []});
  assert.equal(unknown.status, "EQUITY_UNKNOWN");
  assert.equal(unknown.entriesAllowed, false);

  const allowedLoss = ledger.riskSnapshot({
    now: nextViennaDay + 2000,
    marks: [exitQuote(candidate, nextViennaDay + 2000, 6252)]
  });
  assert.equal(allowedLoss.status, "PASS");
  assert.equal(allowedLoss.lossCents, 2999n);
  assert.equal(allowedLoss.limitCents, 3000n);
  assert.equal(allowedLoss.entriesAllowed, true);

  const loss = ledger.riskSnapshot({
    now: nextViennaDay + 3000,
    marks: [exitQuote(candidate, nextViennaDay + 3000, 6251)]
  });
  assert.equal(loss.status, "DAILY_LOSS_LIMIT");
  assert.equal(loss.lossCents, 3000n);
  assert.equal(loss.limitCents, 3000n);
  assert.equal(loss.entriesAllowed, false);
  assert.equal(loss.exitRequests[0].status, "CLOSED_PAPER");
  assert.equal(loss.exitRequests[0].reason, "DAILY_LOSS_LIMIT");
  assert.equal(loss.openPositions, 0);
  assert.equal(loss.equityCents, loss.cashCents);

  const sameDay = ledger.riskSnapshot({now: nextViennaDay + 4000, marks: []});
  assert.equal(sameDay.status, "DAILY_LOSS_LIMIT");
  assert.equal(sameDay.entriesAllowed, false);
  assert.equal(sameDay.dailyOpeningEquityCents, 107039n);

  const followingViennaDay = Date.parse("2026-01-02T23:00:00Z");
  const newDay = ledger.riskSnapshot({now: followingViennaDay, marks: []});
  assert.equal(newDay.status, "PASS");
  assert.equal(newDay.entriesAllowed, true);
  assert.equal(newDay.dailyOpeningEquityCents, 104039n);
  assert.equal(PAPER_LEDGER_POLICY.dailyLossLimitCents, "3000");
  assert.equal(PaperLedger.restartDisposition().status, "UNRECOVERABLE_FAIL_CLOSED");
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
  assert.equal(logger.truncated, true);
  assert.equal(logger.report().length, 1);
  assert.doesNotMatch(logger.report()[0].reason, /https?:\/\//);
  assert.doesNotMatch(logger.report()[0].reason, /\u0000/);
});

test("synthetic replay is integrated, bounded, and visibly non-operational", () => {
  const report = runSyntheticReplay({now: Date.now()});
  assert.equal(report.reportType, "SYNTHETIC_FIXTURE_REPLAY_ONLY");
  assert.equal(report.networkAccessed, false);
  assert.equal(report.liveCandidateEvidence, false);
  assert.equal(report.realDataPreparation.status, "BLOCKED");
  assert.equal(report.realDataPreparation.executableAdapterAvailable, false);
  assert.ok(report.realDataPreparation.missingEvidence.length >= 5);
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


test("clock rollback cannot reset a tripped daily loss gate or mutate direct-ledger state", () => {
  const start = Date.parse("2026-01-02T10:00:00Z");
  const ledger = new PaperLedger({now: start});
  const candidate = syntheticCandidate(start);
  const auth = authorize(ledger, candidate, start);
  const quote = fillQuote(candidate, start);
  const fill = ledger.executeEntry(auth, quote, {now: start + 2000});
  const loss = ledger.riskSnapshot({now: start + 3000,
    marks: [exitQuote(candidate, start + 3000, 6250)]});
  assert.equal(loss.status, "DAILY_LOSS_LIMIT");
  const before = {summary: ledger.summary(), audit: ledger.auditEvents(),
    day: ledger.day, opening: ledger.dailyOpeningEquityCents};
  for (const now of [start - 86400000, start + 2999]) {
    const rejected = ledger.riskSnapshot({now, marks: []});
    assert.equal(rejected.reason, "NON_MONOTONIC_TIME");
    assert.equal(rejected.entriesAllowed, false);
    assert.equal(ledger.finishRun({startedAt: start - 86400000, now}).reason, "NON_MONOTONIC_TIME");
    assert.deepEqual({summary: ledger.summary(), audit: ledger.auditEvents(),
      day: ledger.day, opening: ledger.dailyOpeningEquityCents}, before);
    assert.equal(ledger.dailyLossTripped, true);
  }
  // Old exact event lookup is not a new command and does not move the clock.
  assert.deepEqual(ledger.executeEntry(auth, quote, {now: start + 2000}), fill);
  assert.equal(ledger.riskSnapshot({now: start + 3000, marks: []}).status, "DAILY_LOSS_LIMIT");
  const tomorrow = ledger.riskSnapshot({now: start + 86400000, marks: []});
  assert.equal(tomorrow.status, "PASS");
  assert.equal(ledger.day, "2026-01-03");
});

test("all direct-ledger mutation paths reject older command times before side effects", () => {
  const start = Date.parse("2026-01-02T10:00:00Z");
  const ledger = new PaperLedger({now: start});
  const candidate = syntheticCandidate(start);
  const auth = authorize(ledger, candidate, start);
  ledger.riskSnapshot({now: start + 3000, marks: []});
  const before = {summary: ledger.summary(), audit: ledger.auditEvents(), reservations: [...ledger.reservations]};
  assert.equal(ledger.executeEntry(auth, fillQuote(candidate, start), {now: start + 2000}).reason,
    "NON_MONOTONIC_TIME");
  assert.equal(ledger.observeExitQuote(exitQuote(candidate, start + 2000, 9000)).reason,
    "NON_MONOTONIC_TIME");
  assert.equal(authorize(ledger, candidate, start, {authorizationId: "new-old", tickId: "new-old"}).reason,
    "NON_MONOTONIC_TIME");
  assert.deepEqual({summary: ledger.summary(), audit: ledger.auditEvents(), reservations: [...ledger.reservations]}, before);
  assert.equal(ledger.executeEntry(auth, fillQuote(candidate, start, {observedAt: start + 3000}),
    {now: start + 3000}).status, "FILLED_PAPER");
});

test("forward UTC time across Vienna DST fallback is admitted without day regression", () => {
  const start = Date.parse("2026-10-25T00:59:59Z");
  const ledger = new PaperLedger({now: start});
  assert.equal(ledger.riskSnapshot({now: Date.parse("2026-10-25T01:00:00Z"), marks: []}).status, "PASS");
  assert.equal(ledger.day, "2026-10-25");
  assert.equal(ledger.riskSnapshot({now: Date.parse("2026-10-25T23:00:00Z"), marks: []}).status, "PASS");
  assert.equal(ledger.day, "2026-10-26");
});
