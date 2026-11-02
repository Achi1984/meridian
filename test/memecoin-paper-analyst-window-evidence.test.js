import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYST_WINDOW_METRICS,
  adaptAcceptedOwnerCensusResult,
  bridgeAnalystWindowPacket,
  buildAnalystWindowEvidence,
  evaluateWithCanonicalMarketAdapter,
  PROPOSED_ANALYST_WINDOW_POLICY
} from "../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {
  estimateCpmmDecodeWork,
  decodeCpmmSuccessfulSwap,
  RAYDIUM_CPMM_LAYOUT
} from "../scripts/memecoin-paper/cpmm-swap-observations.mjs";
import {
  analyzeCandidate,
  filterCandidate,
  SCORE_SPEC
} from "../scripts/memecoin-paper/stages.mjs";
import {makeFixture, makeSwap} from "./fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs";

function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let output = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    output = alphabet[remainder] + output;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + output;
}

function packet(fixture) {
  return buildAnalystWindowEvidence({
    candidate: fixture.candidate,
    candidateT: fixture.candidateT,
    assembledAt: fixture.assembledAt,
    decisionAt: fixture.decisionAt,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    historySource: fixture.historySource,
    censusSource: fixture.censusSource,
    priceSource: fixture.priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
}

test("Raydium CPMM decoder uses the pinned official program and v0.2.0 swap layout", () => {
  assert.equal(RAYDIUM_CPMM_LAYOUT.programId, "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
  assert.equal(RAYDIUM_CPMM_LAYOUT.sourceCommit, "ec3b20ddf74d4f3c69f6ac475fde85755a57b0e6");
  assert.equal(RAYDIUM_CPMM_LAYOUT.idlCommit, "e7e0c96fe77bcf6a020b84a44c47a722aac8e359");
  assert.deepEqual(RAYDIUM_CPMM_LAYOUT.instructions.swapBaseInput,
    [143, 190, 90, 218, 196, 30, 51, 222]);
  assert.deepEqual(RAYDIUM_CPMM_LAYOUT.events.swap,
    [64, 198, 205, 232, 38, 8, 113, 226]);
});

test("successful raw CPMM instruction binds event, vault deltas, transaction and token-account owner", () => {
  const fixture = makeFixture();
  const row = fixture.transactions[0];
  const decoded = decodeCpmmSuccessfulSwap(row, {
    identity: fixture.identity,
    poolProof: fixture.poolProof
  });
  assert.equal(decoded.status, "DECODED");
  assert.equal(decoded.kind, "RAYDIUM_CPMM_SWAP");
  assert.equal(decoded.direction, "BUY");
  assert.equal(decoded.buyer, row.meta.preTokenBalances[0].owner);
  assert.notEqual(decoded.buyer, row.transaction.message.accountKeys[0]);
  assert.equal(decoded.inputAmountRaw, "1000000");
  assert.equal(decoded.outputAmountRaw, "2000000");
  assert.equal(decoded.signature, row.signature);
  assert.equal(decoded.slot, row.slot);
  assert.equal(decoded.instructionIndex, 0);

  const mismatchedSignature = makeSwap(998, fixture.candidateT - 10_000).signature;
  const mismatchedTransaction = {
    ...row,
    transaction: {...row.transaction, signatures: [mismatchedSignature]}
  };
  assert.equal(decodeCpmmSuccessfulSwap(mismatchedTransaction, fixture).reason,
    "TRANSACTION_SIGNATURE_MISMATCH");
});

test("failed swaps, transfers, LP changes, routed calls and stale pool identity are excluded", () => {
  const fixture = makeFixture();
  const failed = makeSwap(777, fixture.candidateT - 10_000, {failed: true});
  assert.equal(decodeCpmmSuccessfulSwap(failed, fixture).reason, "TRANSACTION_FAILED");

  const transfer = makeSwap(778, fixture.candidateT - 10_000);
  transfer.transaction.message.instructions[0].programIdIndex = 8;
  assert.equal(decodeCpmmSuccessfulSwap(transfer, fixture).reason, "TRANSFER_OR_NON_SWAP");

  const lp = makeSwap(779, fixture.candidateT - 10_000);
  const lpBytes = Buffer.concat([
    Buffer.from(RAYDIUM_CPMM_LAYOUT.instructions.deposit), Buffer.alloc(16)
  ]);
  lp.transaction.message.instructions[0].data = base58(lpBytes);
  assert.equal(decodeCpmmSuccessfulSwap(lp, fixture).reason, "LP_OPERATION");

  const mixedLpAndSwap = makeSwap(781, fixture.candidateT - 10_000);
  mixedLpAndSwap.transaction.message.instructions.push({
    programIdIndex: 13,
    accounts: Array.from({length: 13}, (_, index) => index),
    data: base58(Buffer.concat([
      Buffer.from(RAYDIUM_CPMM_LAYOUT.instructions.deposit), Buffer.alloc(16)
    ]))
  });
  assert.equal(decodeCpmmSuccessfulSwap(mixedLpAndSwap, fixture).reason,
    "LP_SWAP_TRANSACTION_AMBIGUOUS");

  const routed = makeSwap(780, fixture.candidateT - 10_000);
  const swap = routed.transaction.message.instructions[0];
  routed.transaction.message.instructions = [{
    programId: "11111111111111111111111111111111", accounts: [], data: "1"
  }];
  routed.meta.innerInstructions = [{index: 0, instructions: [swap]}];
  routed.transaction.meta = routed.meta;
  assert.equal(decodeCpmmSuccessfulSwap(routed, fixture).reason,
    "ROUTED_INSTRUCTION_AMBIGUOUS");

  assert.equal(decodeCpmmSuccessfulSwap(fixture.transactions[0], {
    identity: fixture.identity,
    poolProof: {...fixture.poolProof, pool: "11111111111111111111111111111112"}
  }).reason, "POOL_PROOF_UNBOUND_OR_INCOMPLETE");

  const oversized = makeSwap(782, fixture.candidateT - 10_000);
  oversized.transaction.message.instructions = Array.from({length: 129},
    () => oversized.transaction.message.instructions[0]);
  assert.equal(estimateCpmmDecodeWork(oversized), null);
  assert.equal(decodeCpmmSuccessfulSwap(oversized, fixture).reason,
    "TRANSACTION_LAYOUT_UNAVAILABLE");
});

test("actual decoded fixture produces a typed canonical-adapter bridge without inventing slots", async () => {
  const fixture = makeFixture({duplicateFirstRow: true});
  const evidence = await packet(fixture);
  assert.equal(evidence.status, "COMPLETE");
  assert.equal(evidence.metrics.uniqueBuyers1h.value, 101);
  assert.ok(Math.abs(evidence.metrics.momentum15m.value - 20) < 1e-10);
  assert.equal(evidence.metrics.holderGrowthPct1h.value, 15);
  assert.equal(evidence.metrics.liquidityMarketCapPct.value, 5);
  assert.equal(evidence.metrics.qualifiedSmartWallets.value, 5);
  assert.ok(evidence.metrics.buySellUsdRatio1h.coverage.buyVolumeUsd > 0);
  assert.ok(evidence.metrics.buySellUsdRatio1h.coverage.sellVolumeUsd > 0);
  assert.equal(evidence.windows.swaps1h.startExclusive, fixture.candidateT - 3_600_000);
  assert.equal(evidence.windows.swaps1h.endInclusive, fixture.candidateT);
  assert.equal(evidence.windows.swaps1h.excludedDuplicateSignatures, 1);
  assert.equal(evidence.metrics.uniqueBuyers1h.slot, null);
  assert.equal(evidence.metrics.momentum15m.slot, null);
  assert.equal(evidence.metrics.momentum15m.coverage.provenanceType,
    "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT");
  assert.equal(evidence.candidateT, fixture.candidateT);
  assert.equal(evidence.assembledAt, fixture.candidateT + 1);
  assert.equal(evidence.decisionAt, fixture.candidateT + 2);
  assert.equal(evidence.metrics.uniqueBuyers1h.observedAt, fixture.candidateT);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.receipts.history), true);

  const reviewEvidence = Object.fromEntries(ANALYST_WINDOW_METRICS.map(key => [key, {
    status: "REVIEWED",
    reviewerId: `fixture-reviewer-${key}`,
    reviewId: `fixture-review-${key}`,
    reviewedAt: fixture.candidateT - 1
  }]));
  const bridge = bridgeAnalystWindowPacket(evidence, {
    identity: fixture.identity,
    reviewEvidence
  });
  assert.equal(bridge.status, "BRIDGED");
  assert.deepEqual(Object.keys(bridge.analystEvidence).sort(), [...ANALYST_WINDOW_METRICS].sort());
  for (const [key, item] of Object.entries(bridge.analystEvidence)) {
    assert.equal(item.slot, null, key);
    assert.equal(item.coverage.slotProvenance, evidence.metrics[key].coverage.provenanceType, key);
  }
  const unavailable = await evaluateWithCanonicalMarketAdapter({
    providerCandidate: fixture.candidate,
    evidence: {},
    packet: evidence,
    reviewEvidence,
    now: fixture.decisionAt
  });
  assert.equal(unavailable.analysis.status, "SCORE_UNAVAILABLE");
  assert.equal(unavailable.executionAuthorized, false);
  assert.equal(evidence.executionAuthorized, false);
  assert.equal(evidence.authorizationEligible, false);
});

test("each missing Analyst component yields SCORE_UNAVAILABLE with no weight redistribution", async () => {
  const fixture = makeFixture();
  const filters = filterCandidate(fixture.candidate, {now: fixture.candidateT});
  assert.equal(filters.status, "PASS");
  for (const key of ANALYST_WINDOW_METRICS) {
    const incomplete = {...fixture.candidate, analystEvidence: {...fixture.candidate.analystEvidence}};
    delete incomplete.analystEvidence[key];
    const result = analyzeCandidate(incomplete, {
      now: fixture.candidateT,
      filterResult: filters,
      smartWalletAllowlist: fixture.smartWalletAllowlist
    });
    assert.equal(result.status, "SCORE_UNAVAILABLE", key);
    assert.equal(result.score, null, key);
  }
  assert.equal(SCORE_SPEC.threshold, 70);
  assert.deepEqual(SCORE_SPEC.weights, {
    momentum15m: 25,
    uniqueBuyers1h: 20,
    buySellUsdRatio1h: 15,
    holderGrowthPct1h: 15,
    liquidityMarketCapPct: 15,
    qualifiedSmartWallets: 10
  });
});

test("lower swap boundary is exclusive, candidate-time boundary inclusive, and buyers are distinct", async () => {
  const fixture = makeFixture({
    buyCount: 2,
    sellCount: 0,
    includeBoundaryRows: true,
    duplicateFirstRow: true
  });
  const evidence = await packet(fixture);
  assert.equal(evidence.metrics.uniqueBuyers1h.value, 3);
  assert.equal(evidence.windows.swaps1h.decodedUniqueTransactions, 3);
});

test("truncated history, ambiguous routes, unpriced flow and a zero sell side do not create ratios or wallet metrics", async () => {
  const truncated = makeFixture();
  const completeRead = truncated.historySource.readWindow.bind(truncated.historySource);
  truncated.historySource.readWindow = async request => {
    const result = await completeRead(request);
    return {...result, coverage: {complete: true, truncated: true, cursorExhausted: false}};
  };
  const truncatedPacket = await packet(truncated);
  assert.equal(truncatedPacket.metrics.uniqueBuyers1h, undefined);
  assert.equal(truncatedPacket.metrics.qualifiedSmartWallets, undefined);

  const missingTransaction = makeFixture();
  const unavailableRow = {
    ...makeSwap(990_000, missingTransaction.candidateT - 10_000),
    transaction: null,
    meta: null
  };
  assert.equal(decodeCpmmSuccessfulSwap(unavailableRow, missingTransaction).reason,
    "TRANSACTION_UNAVAILABLE");
  missingTransaction.transactions.push(unavailableRow);
  assert.equal((await packet(missingTransaction)).metrics.uniqueBuyers1h, undefined);

  const ambiguous = makeFixture();
  const routedRow = ambiguous.transactions[0];
  const cpmmInstruction = routedRow.transaction.message.instructions[0];
  routedRow.transaction.message.instructions = [{
    programId: "11111111111111111111111111111111", accounts: [], data: "1"
  }];
  routedRow.meta.innerInstructions = [{index: 0, instructions: [cpmmInstruction]}];
  assert.equal((await packet(ambiguous)).metrics.uniqueBuyers1h, undefined);

  const conflictingDuplicate = makeFixture({duplicateFirstRow: true});
  const duplicate = conflictingDuplicate.transactions.at(-1);
  duplicate.slot += 1;
  assert.equal((await packet(conflictingDuplicate)).metrics.uniqueBuyers1h, undefined);

  const missingFx = makeFixture({
    priceOverride: ({mint, atMs}) => mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      ? null
      : {
        status: "SOURCE_BOUND", source: "SYNTHETIC_FIXTURE_ONLY", mint,
        denomination: "USD", methodologyVersion: "fixture-exact-usd-v1",
        sourceAtMs: atMs,
        receivedAt: Date.parse("2026-10-30T12:00:00Z"), valueUsd: 1,
        receipt: {
          status: "SOURCE_BOUND", id: `price-${mint}`, source: "SYNTHETIC_FIXTURE_ONLY",
          payloadSha256: "f".repeat(64), receivedAt: Date.parse("2026-10-30T12:00:00Z")
        }
      }
  });
  const missingFxPacket = await packet(missingFx);
  assert.equal(missingFxPacket.metrics.buySellUsdRatio1h, undefined);
  assert.ok(missingFxPacket.metrics.momentum15m);

  const noSells = makeFixture({sellCount: 0});
  const noSellsPacket = await packet(noSells);
  assert.equal(noSellsPacket.metrics.buySellUsdRatio1h, undefined);
  assert.match(noSellsPacket.unavailableMetrics.buySellUsdRatio1h.reason, /POSITIVE/);
});

test("missing momentum endpoints, census mismatch, missing pair and unreviewed allowlist stay unavailable", async () => {
  const missingEndpoint = makeFixture({
    priceOverride: ({mint, atMs}) => {
      if (mint === "So11111111111111111111111111111111111111112" &&
          atMs === Date.parse("2026-10-30T12:00:00Z")) return null;
      return {
        status: "SOURCE_BOUND", source: "SYNTHETIC_FIXTURE_ONLY", mint,
        denomination: "USD", methodologyVersion: "fixture-exact-usd-v1",
        sourceAtMs: atMs, receivedAt: Date.parse("2026-10-30T12:00:00Z"), valueUsd: 1,
        receipt: {
          status: "SOURCE_BOUND", id: `price-${mint}-${atMs}`,
          source: "SYNTHETIC_FIXTURE_ONLY", payloadSha256: "f".repeat(64),
          receivedAt: Date.parse("2026-10-30T12:00:00Z")
        }
      };
    }
  });
  assert.equal((await packet(missingEndpoint)).metrics.momentum15m, undefined);

  const censusMismatch = makeFixture({
    censusOverride: null
  });
  const census = await censusMismatch.censusSource.readSnapshots({
    identity: censusMismatch.identity,
    startAtMs: censusMismatch.candidateT - 3_600_000,
    endAtMs: censusMismatch.candidateT,
    policy: censusMismatch.policy.censusPolicy
  });
  census.snapshots[1].exclusions = ["selected_pool"];
  censusMismatch.censusSource.readSnapshots = async () => census;
  assert.equal((await packet(censusMismatch)).metrics.holderGrowthPct1h, undefined);

  const noPair = makeFixture({marketPairOverride: null});
  noPair.marketPairEvidence = null;
  assert.equal((await packet(noPair)).metrics.liquidityMarketCapPct, undefined);

  const mismatchedPair = makeFixture();
  mismatchedPair.marketPairEvidence = {
    ...mismatchedPair.marketPairEvidence,
    marketCapUsd: mismatchedPair.marketPairEvidence.marketCapUsd + 1
  };
  assert.equal((await packet(mismatchedPair)).metrics.liquidityMarketCapPct, undefined);

  const unreviewed = makeFixture({allowlistOverride: {
    status: "UNSET",
    entries: []
  }});
  assert.equal((await packet(unreviewed)).metrics.qualifiedSmartWallets, undefined);
});

test("incomplete or stale source identity cannot be upgraded by the adapter", async () => {
  const fixture = makeFixture({
    poolProofOverride: null
  });
  const staleProof = {...fixture.poolProof, observedAt: fixture.candidateT + 1};
  const evidence = await buildAnalystWindowEvidence({
    candidate: fixture.candidate,
    candidateT: fixture.candidateT,
    assembledAt: fixture.assembledAt,
    decisionAt: fixture.decisionAt,
    policy: fixture.policy,
    poolProof: staleProof,
    historySource: fixture.historySource,
    censusSource: fixture.censusSource,
    priceSource: fixture.priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
  assert.equal(evidence.metrics.uniqueBuyers1h, undefined);
  const forgedPacket = {...evidence, executionAuthorized: true};
  const bridge = bridgeAnalystWindowPacket(forgedPacket, {
    identity: fixture.identity,
    reviewEvidence: {}
  });
  assert.equal(bridge.status, "UNAVAILABLE");
  assert.deepEqual(bridge.analystEvidence, {});
});

test("owner census adapter preserves merged 1152 uncertainty and never upgrades owner totals", () => {
  const fixture = makeFixture();
  const sourceResult = {
    status: "UNKNOWN",
    reason: "RPC_CENSUS_RECONCILED_BUT_SOURCE_COMPLETENESS_IS_UNAUTHENTICATED",
    source: "Solana JSON-RPC getProgramAccounts",
    boundIdentity: fixture.identity,
    slot: 900_001,
    observedAt: fixture.candidateT,
    accountCoverage: "RECONCILED_RPC_RESPONSE_ONLY",
    rawCensus: {
      accountCount: 1,
      ownerCount: 1,
      owners: [{owner: fixture.transactions[0].meta.preTokenBalances[0].owner, amountAtoms: "7"}]
    },
    coverage: {
      complete: false,
      supplyReconciled: true,
      sourceCompletenessAuthenticated: false
    }
  };
  const adapted = adaptAcceptedOwnerCensusResult(sourceResult, {identity: fixture.identity});
  assert.equal(adapted.status, "UNKNOWN");
  assert.equal(adapted.slot, sourceResult.slot);
  assert.equal(adapted.slotProvenance, "ONCHAIN_SLOT");
  assert.deepEqual(adapted.rawCensus.owners[0], sourceResult.rawCensus.owners[0]);
  assert.equal(adapted.coverage.complete, false);
  assert.equal(adapted.receipt, null);
});

test("window durations are pinned to this score version and timing approval is explicit", async () => {
  assert.deepEqual(PROPOSED_ANALYST_WINDOW_POLICY.windowsMs, {
    swaps1h: 3_600_000,
    momentum15m: 900_000,
    holders1h: 3_600_000
  });
  assert.equal(PROPOSED_ANALYST_WINDOW_POLICY.historicalPriceTrust, null);
  const fixture = makeFixture({policyOverride: {historicalPriceTrust: null}});
  const evidence = await packet(fixture);
  assert.equal(evidence.metrics.momentum15m, undefined);
  assert.equal(evidence.metrics.buySellUsdRatio1h, undefined);

  const shortWindow = makeFixture({policyOverride: {
    windowsMs: {swaps1h: 3_600_000, momentum15m: 1, holders1h: 3_600_000}
  }});
  const invalidWindowPacket = await packet(shortWindow);
  assert.equal(invalidWindowPacket.status, "INCOMPLETE");
  assert.equal(invalidWindowPacket.unavailableMetrics.momentum15m.reason, "WINDOW_POLICY_INVALID");

  const noMembershipDecision = makeFixture({policyOverride: {
    walletQualification: {
      status: "REVIEWED",
      version: "fixture-wallet-policy-v1",
      reviewReceiptId: "reviewed-is-not-owner-approved"
    }
  }});
  assert.equal((await packet(noMembershipDecision)).metrics.qualifiedSmartWallets, undefined);
});

test("source callbacks are deadline-bounded and oversized history is rejected", async () => {
  const hanging = makeFixture();
  let aborted = false;
  hanging.historySource.readWindow = ({signal}) => {
    signal.addEventListener("abort", () => { aborted = true; }, {once: true});
    return new Promise(() => {});
  };
  const timedOut = await buildAnalystWindowEvidence({
    candidate: hanging.candidate,
    candidateT: hanging.candidateT,
    assembledAt: hanging.assembledAt,
    decisionAt: hanging.decisionAt,
    policy: hanging.policy,
    poolProof: hanging.poolProof,
    historySource: hanging.historySource,
    censusSource: hanging.censusSource,
    priceSource: hanging.priceSource,
    marketPairEvidence: hanging.marketPairEvidence,
    smartWalletAllowlist: hanging.smartWalletAllowlist,
    maxSourceReadMs: 5
  });
  assert.equal(timedOut.metrics.uniqueBuyers1h, undefined);
  assert.equal(aborted, true);

  const oversized = makeFixture();
  const history = await oversized.historySource.readWindow({
    identity: oversized.identity,
    startExclusiveMs: oversized.candidateT - 3_600_000,
    endInclusiveMs: oversized.candidateT
  });
  oversized.historySource.readWindow = async () => ({
    ...history,
    transactions: Array.from({length: 5_001}, () => history.transactions[0])
  });
  assert.equal((await packet(oversized)).metrics.uniqueBuyers1h, undefined);

  const manyPrices = makeFixture({buyCount: 0, sellCount: 0, includeBoundaryRows: false});
  manyPrices.transactions.push(...Array.from({length: 2_050}, (_, index) =>
    makeSwap(30_000 + index, manyPrices.candidateT - 3_590_000 + index * 1_000)));
  const limitedPrices = await packet(manyPrices);
  assert.ok(limitedPrices.limits.priceLookups <= 2_048);
  assert.equal(limitedPrices.metrics.buySellUsdRatio1h, undefined);
});
