import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptMarketEvidence,
  ANALYST_WINDOW_METRICS,
  buildAnalystWindowEvidence,
  PROPOSED_ANALYST_WINDOW_POLICY
} from "../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {
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
});

test("actual decoded source fixture adapts through hard filters and Analyst without authorization", async () => {
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
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.receipts.history), true);

  const adapted = adaptMarketEvidence(fixture.candidate, evidence);
  const filters = filterCandidate(adapted, {now: fixture.candidateT});
  assert.equal(filters.status, "PASS");
  const analysis = analyzeCandidate(adapted, {
    now: fixture.candidateT,
    filterResult: filters,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
  assert.equal(analysis.status, "PASS");
  assert.ok(Number.isInteger(analysis.score));
  assert.equal(adapted.executionAuthorized, false);
  assert.equal(evidence.executionAuthorized, false);
  assert.equal(evidence.authorizationEligible, false);
});

test("each missing Analyst component yields SCORE_UNAVAILABLE with no weight redistribution", async () => {
  const fixture = makeFixture();
  const evidence = await packet(fixture);
  const adapted = adaptMarketEvidence(fixture.candidate, evidence);
  const filters = filterCandidate(adapted, {now: fixture.candidateT});
  assert.equal(filters.status, "PASS");
  for (const key of ANALYST_WINDOW_METRICS) {
    const incomplete = {...adapted, analystEvidence: {...adapted.analystEvidence}};
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
  missingTransaction.transactions.push({
    ...missingTransaction.transactions[0], transaction: null, meta: null
  });
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
  const adapted = adaptMarketEvidence(fixture.candidate, forgedPacket);
  assert.deepEqual(adapted.analystEvidence, {});
  assert.equal(adapted.analystWindowPacket, null);
  assert.equal(adapted.executionAuthorized, false);
});

test("proposed timing remains explicit and cannot silently turn absent trust policy into price evidence", async () => {
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
});
