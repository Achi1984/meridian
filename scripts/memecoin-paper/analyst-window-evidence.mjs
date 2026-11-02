import {
  decodeCpmmSuccessfulSwap,
  estimateCpmmDecodeWork,
  isSolanaPublicKey
} from "./cpmm-swap-observations.mjs";
import {FILTER_POLICY, SCORE_SPEC, analyzeCandidate, filterCandidate} from "./stages.mjs";

export const ANALYST_WINDOW_METRICS = Object.freeze([
  "momentum15m",
  "uniqueBuyers1h",
  "buySellUsdRatio1h",
  "holderGrowthPct1h",
  "liquidityMarketCapPct",
  "qualifiedSmartWallets"
]);

export const PROPOSED_ANALYST_WINDOW_POLICY = Object.freeze({
  version: "analyst-window-proposal-v1",
  scoreVersion: SCORE_SPEC.version,
  boundary: "(startExclusive,endInclusive]",
  windowsMs: Object.freeze({swaps1h: 3_600_000, momentum15m: 900_000, holders1h: 3_600_000}),
  momentumDenomination: "USD",
  historicalPriceTrust: null,
  censusPolicy: null,
  walletQualification: null
});

const PACKET_BRAND = Symbol("source-built Analyst window packet");
const MAX_HISTORY_ROWS = 5_000;
const MAX_CENSUS_ROWS = 25_000;
const MAX_ALLOWLIST_ROWS = 10_000;
const MAX_TOTAL_CENSUS_ROWS = 50_000;
const MAX_PRICE_LOOKUPS = 2_048;
const MAX_DECODE_WORK = 25_000_000;
const MAX_SOURCE_READ_MS = 15_000;
const NULL_SLOT_PROVENANCE = new Set([
  "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT",
  "DERIVED_ONCHAIN_WINDOW_NO_SINGLE_SLOT",
  "DERIVED_ONCHAIN_WINDOW_WITH_EXACT_HISTORICAL_USD_PRICES_NO_SINGLE_SLOT",
  "CENSUS_ENDPOINTS_TYPED_PROVENANCE_NO_SINGLE_SLOT",
  "DERIVED_ONCHAIN_WINDOW_WITH_EXTERNALLY_REVIEWED_ALLOWLIST_NO_SINGLE_SLOT"
]);
const HASH = /^[a-f0-9]{64}$/i;
const DECIMAL_INTEGER = /^(0|[1-9]\d{0,39})$/;
const UNCERTAIN_SWAP_REASONS = new Set([
  "CPMM_INSTRUCTION_UNDECODABLE",
  "ROUTED_INSTRUCTION_AMBIGUOUS",
  "MULTIPLE_CPMM_SWAPS_AMBIGUOUS",
  "CPMM_ACCOUNT_LAYOUT_MISMATCH",
  "SWAP_POOL_OR_USER_ACCOUNT_MISMATCH",
  "SWAP_MINT_OR_VAULT_MISMATCH",
  "SWAP_EVENT_LOG_INVALID",
  "SWAP_EVENT_MISSING_OR_AMBIGUOUS",
  "SWAP_EVENT_IDENTITY_MISMATCH",
  "SWAP_EVENT_INSTRUCTION_MISMATCH",
  "SWAP_INSTRUCTION_ARGUMENTS_INVALID",
  "SWAP_EVENT_AMOUNT_MISMATCH",
  "TOKEN_BALANCE_LAYOUT_INCOMPLETE",
  "USER_OR_VAULT_BALANCE_DELTA_MISMATCH",
  "USER_TOKEN_DECIMALS_MISMATCH",
  "LP_SWAP_TRANSACTION_AMBIGUOUS",
  "TRANSACTION_RECEIPT_INVALID",
  "TRANSACTION_SIGNATURE_MISMATCH",
  "TRANSACTION_UNAVAILABLE",
  "TRANSACTION_LAYOUT_UNAVAILABLE",
  "POOL_PROOF_UNBOUND_OR_INCOMPLETE"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function timestampValue(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return validTime(parsed) ? parsed : null;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sourceLabel(...sources) {
  const label = [...new Set(sources.filter(value =>
    typeof value === "string" && value.trim()).map(value => value.trim()))].join(" + ");
  return label.slice(0, 256);
}

function tokenUnits(rawAmount, decimals) {
  if (typeof rawAmount !== "string" || !DECIMAL_INTEGER.test(rawAmount) ||
      !Number.isInteger(decimals) ||
      decimals < 0 || decimals > 18) return null;
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(rawAmount);
  const whole = amount / scale;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const units = Number(whole) + Number(amount % scale) / Number(scale);
  return Number.isFinite(units) ? units : null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sameIdentity(left, right) {
  return isRecord(left) && left.chainId === right.chainId &&
    left.mint === right.mint && left.pool === right.pool && left.quote === right.quote;
}

function candidateIdentity(candidate) {
  return {
    chainId: candidate?.chainId ?? null,
    mint: candidate?.mint ?? null,
    pool: candidate?.pool ?? null,
    quote: candidate?.quote ?? null
  };
}

function validReceipt(source, receipt, assembledAt) {
  return typeof source === "string" && source.trim().length > 0 && source.length <= 256 &&
    isRecord(receipt) && receipt.status === "SOURCE_BOUND" &&
    typeof receipt.id === "string" && receipt.id.trim().length > 0 &&
    receipt.id.length <= 256 && receipt.source === source &&
    HASH.test(receipt.payloadSha256 ?? "") && validTime(receipt.receivedAt) &&
    receipt.receivedAt <= assembledAt;
}

function validPolicy(policy) {
  return isRecord(policy) && policy.scoreVersion === SCORE_SPEC.version &&
    typeof policy.version === "string" &&
    policy.version.trim().length > 0 &&
    policy.boundary === "(startExclusive,endInclusive]" &&
    isRecord(policy.windowsMs) &&
    policy.windowsMs.swaps1h === 3_600_000 &&
    policy.windowsMs.momentum15m === 900_000 &&
    policy.windowsMs.holders1h === 3_600_000;
}

function bindingOf(candidate) {
  return {
    chainId: candidate.chainId,
    mint: candidate.mint,
    pool: candidate.pool,
    quote: candidate.quote
  };
}

function metricEvidence({
  candidate,
  value,
  source,
  observedAt,
  coverage,
  slot = null
}) {
  return {
    value,
    source,
    observedAt,
    slot,
    verified: true,
    coverage: {complete: true, ...coverage},
    binding: bindingOf(candidate)
  };
}

function noMetric(reason) {
  return {status: "UNAVAILABLE", reason};
}

export function adaptAcceptedOwnerCensusResult(result, {identity} = {}) {
  const boundIdentity = result?.boundIdentity;
  const rows = result?.rawCensus?.owners;
  const boundedRows = Array.isArray(rows) && rows.length <= MAX_CENSUS_ROWS
    ? rows.map(entry => isRecord(entry) && isSolanaPublicKey(entry.owner) &&
      typeof entry.amountAtoms === "string" && DECIMAL_INTEGER.test(entry.amountAtoms)
      ? {owner: entry.owner, amountAtoms: entry.amountAtoms} : null)
    : null;
  return deepFreeze({
    schema: "MERGED_OWNER_CENSUS_SOURCE_RESULT_V1",
    status: "UNKNOWN",
    reason: result?.reason ?? "SOURCE_COMPLETENESS_UNAUTHENTICATED",
    source: typeof result?.source === "string" ? result.source : null,
    identity: isRecord(identity) && sameIdentity(boundIdentity, identity) ? boundIdentity : null,
    observedAt: timestampValue(result?.observedAt),
    slot: Number.isSafeInteger(result?.slot) && result.slot >= 0 ? result.slot : null,
    slotProvenance: Number.isSafeInteger(result?.slot) && result.slot >= 0
      ? "ONCHAIN_SLOT" : null,
    accountCoverage: result?.accountCoverage ?? "UNKNOWN",
    rawCensus: {
      accountCount: Number.isSafeInteger(result?.rawCensus?.accountCount)
        ? result.rawCensus.accountCount : null,
      ownerCount: Number.isSafeInteger(result?.rawCensus?.ownerCount)
        ? result.rawCensus.ownerCount : null,
      owners: boundedRows
    },
    coverage: {
      complete: false,
      sourceCompletenessAuthenticated: result?.coverage?.sourceCompletenessAuthenticated === true,
      supplyReconciled: result?.coverage?.supplyReconciled === true
    },
    receipt: null
  });
}

function exactSourceObservation(value, source, requestedAt, assembledAt, trust) {
  const receipt = value?.receipt;
  return isRecord(value) && value.status === "SOURCE_BOUND" &&
    value.mint === requestedAt.mint && value.denomination === "USD" &&
    value.source === trust.source && value.methodologyVersion === trust.version &&
    value.sourceAtMs === requestedAt.atMs && validTime(value.receivedAt) &&
    value.sourceAtMs <= value.receivedAt &&
    value.receivedAt <= assembledAt && finitePositive(value.valueUsd) &&
    validReceipt(source, receipt, assembledAt) &&
    value.receipt.receivedAt === value.receivedAt;
}

function sourceTrustReady(trust) {
  return isRecord(trust) && trust.status === "REVIEWED" &&
    trust.denomination === "USD" &&
    trust.mode === "EXACT_HISTORICAL_OBSERVATION" &&
    typeof trust.source === "string" && trust.source.trim().length > 0 &&
    typeof trust.version === "string" && trust.version.trim().length > 0 &&
    typeof trust.reviewReceiptId === "string" && trust.reviewReceiptId.trim().length > 0;
}

function sourceRowMaybeSwap(row, identity, poolProof) {
  return decodeCpmmSuccessfulSwap(row, {identity, poolProof});
}

function identityBoundPoolProof(poolProof, identity, candidateT, assembledAt) {
  return isRecord(poolProof) && poolProof.status === "SOURCE_BOUND" &&
    poolProof.verified === true && sameIdentity({
      chainId: poolProof.chainId,
      mint: poolProof.baseMint,
      pool: poolProof.pool,
      quote: poolProof.quoteMint
    }, identity) && validTime(poolProof.observedAt) &&
    poolProof.observedAt <= candidateT &&
    poolProof.observedAt <= poolProof.receipt?.receivedAt &&
    Number.isSafeInteger(poolProof.slot) && poolProof.slot >= 0 &&
    validReceipt(poolProof.source, poolProof.receipt, assembledAt);
}

function historyWindowReady(result, identity, startExclusive, endInclusive, assembledAt) {
  return isRecord(result) && result.status === "COMPLETE" &&
    result.coverage?.complete === true && result.coverage?.truncated === false &&
    result.coverage?.cursorExhausted === true && Array.isArray(result.transactions) &&
    result.transactions.length <= MAX_HISTORY_ROWS &&
    result.requested?.startExclusiveMs === startExclusive &&
    result.requested?.endInclusiveMs === endInclusive &&
    sameIdentity(result.identity, identity) &&
    result.receipt?.receivedAt >= endInclusive &&
    validReceipt(result.source, result.receipt, assembledAt);
}

function equalStringArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function censusPolicyReady(policy) {
  return isRecord(policy) && policy.status === "REVIEWED" &&
    typeof policy.version === "string" && policy.version.trim().length > 0 &&
    policy.aggregation === "DISTINCT_POSITIVE_BALANCE_OWNER" &&
    typeof policy.denominatorPolicy === "string" && policy.denominatorPolicy.trim().length > 0 &&
    Array.isArray(policy.exclusions) && policy.exclusions.length > 0 &&
    policy.exclusions.every(value => typeof value === "string" && value.length > 0) &&
    typeof policy.reviewReceiptId === "string" && policy.reviewReceiptId.trim().length > 0;
}

function ownerCount(snapshot, policy, endpoint, assembledAt, identity, chargeWork) {
  if (!isRecord(snapshot) || snapshot.status !== "COMPLETE" ||
      !sameIdentity(snapshot.identity, identity) ||
      snapshot.observedAt !== endpoint || snapshot.coverage?.complete !== true ||
      snapshot.coverage?.truncated !== false ||
      snapshot.censusPolicyVersion !== policy.version ||
      snapshot.aggregation !== policy.aggregation ||
      snapshot.denominatorPolicy !== policy.denominatorPolicy ||
      !equalStringArray(snapshot.exclusions, policy.exclusions) ||
      typeof snapshot.denominatorAtoms !== "string" ||
      !DECIMAL_INTEGER.test(snapshot.denominatorAtoms ?? "") ||
      BigInt(snapshot.denominatorAtoms) <= 0n ||
      !Array.isArray(snapshot.owners) || snapshot.owners.length > MAX_CENSUS_ROWS ||
      !validTime(snapshot.receivedAt) || snapshot.receivedAt < snapshot.observedAt ||
      snapshot.receivedAt > assembledAt ||
      snapshot.receivedAt !== snapshot.receipt?.receivedAt ||
      !validReceipt(snapshot.source, snapshot.receipt, assembledAt) ||
      (snapshot.slot === null
        ? snapshot.provenanceType !== "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT"
        : !Number.isSafeInteger(snapshot.slot) || snapshot.slot < 0 ||
          snapshot.provenanceType !== "ONCHAIN_SLOT")) return null;
  const owners = new Set();
  for (const entry of snapshot.owners) {
    if (!chargeWork(1)) return null;
    if (!isRecord(entry) || !isSolanaPublicKey(entry.owner) ||
        typeof entry.balanceAtoms !== "string" ||
        !DECIMAL_INTEGER.test(entry.balanceAtoms ?? "")) return null;
    if (BigInt(entry.balanceAtoms) > 0n) owners.add(entry.owner);
  }
  return owners.size;
}

function validPair(pair, identity, candidateT, assembledAt) {
  return isRecord(pair) && pair.status === "SOURCE_BOUND" &&
    sameIdentity(pair.identity, identity) &&
    finitePositive(pair.marketCapUsd) && finitePositive(pair.liquidityUsd) &&
    validTime(pair.observedAt) &&
    pair.observedAt <= candidateT && pair.observedAt <= assembledAt &&
    pair.receipt?.receivedAt >= pair.observedAt &&
    validReceipt(pair.source, pair.receipt, assembledAt);
}

function candidatePairMatches(candidate, pair, identity) {
  const marketCap = candidate?.evidence?.marketCapUsd;
  const liquidity = candidate?.evidence?.liquidityUsd;
  const matchingEvidence = (item, value) => isRecord(item) &&
    item.verified === true && item.coverage?.complete === true &&
    item.value === value && item.source === pair.source &&
    sameIdentity(item.binding, identity) &&
    timestampValue(item.observedAt) === pair.observedAt;
  return candidate?.marketCapUsd === pair.marketCapUsd &&
    matchingEvidence(marketCap, pair.marketCapUsd) &&
    matchingEvidence(liquidity, pair.liquidityUsd);
}

function walletAllowlistReady(allowlist, policy, candidateT, assembledAt, syntheticFixtureOnly) {
  return isRecord(allowlist) && allowlist.status === "VERIFIED" &&
    typeof allowlist.source === "string" && allowlist.source.trim().length > 0 &&
    typeof allowlist.version === "string" && allowlist.version.trim().length > 0 &&
    allowlist.qualificationPolicyVersion === policy.version &&
    (syntheticFixtureOnly
      ? policy.membershipTiming === "SYNTHETIC_FIXTURE_ONLY"
      : policy.membershipTimingApproval?.status === "OWNER_APPROVED" &&
        policy.membershipTimingApproval.mode === "AS_OF_CANDIDATE_CUTOFF" &&
        typeof policy.membershipTimingApproval.decisionId === "string" &&
        policy.membershipTimingApproval.decisionId.trim().length > 0) &&
    typeof allowlist.provenance === "string" && allowlist.provenance.trim().length > 0 &&
    validTime(allowlist.effectiveFromMs) && validTime(allowlist.effectiveUntilMs) &&
    allowlist.effectiveFromMs <= candidateT && candidateT <= allowlist.effectiveUntilMs &&
    allowlist.review?.status === "EXTERNALLY_REVIEWED" &&
    validTime(allowlist.review.reviewedAt) && allowlist.review.reviewedAt <= candidateT &&
    allowlist.receipt?.receivedAt >= allowlist.review.reviewedAt &&
    typeof allowlist.review.receiptId === "string" &&
    allowlist.review.receiptId.trim().length > 0 &&
    Array.isArray(allowlist.entries) && allowlist.entries.length <= MAX_ALLOWLIST_ROWS &&
    validReceipt(allowlist.source, allowlist.receipt, assembledAt);
}

function qualifiedWallets(allowlist, policy, candidateT, assembledAt, syntheticFixtureOnly, chargeWork) {
  if (!walletAllowlistReady(allowlist, policy, candidateT, assembledAt, syntheticFixtureOnly)) return null;
  const result = new Set();
  for (const entry of allowlist.entries) {
    if (!chargeWork(1)) return null;
    if (!isRecord(entry) || !isSolanaPublicKey(entry.address) ||
        entry.qualified !== true || entry.reviewed !== true ||
        entry.candidateMintExcluded !== true ||
        entry.qualificationPolicyVersion !== policy.version ||
        typeof entry.qualificationReceiptId !== "string" ||
        !entry.qualificationReceiptId.trim()) return null;
    result.add(entry.address);
  }
  return result;
}

function serializeDecoded(row) {
  return row.status === "DECODED"
    ? JSON.stringify([
      row.signature, row.slot, row.instructionIndex, row.observedAt, row.pool, row.mint,
      row.quote, row.direction, row.trader, row.inputAmountRaw, row.outputAmountRaw
    ])
    : JSON.stringify([row.status, row.reason]);
}

function possibleUnobservedSwap(decoded) {
  return decoded.status === "EXCLUDED" && UNCERTAIN_SWAP_REASONS.has(decoded.reason);
}

function createSourceBudget(maxReadMs = MAX_SOURCE_READ_MS) {
  const startedAt = performance.now();
  let decodeWork = 0;
  let censusRows = 0;
  let priceLookups = 0;
  const withinTime = () => performance.now() - startedAt < maxReadMs;
  return {
    withinTime,
    chargeDecode(units) {
      if (!Number.isSafeInteger(units) || units < 0 ||
          decodeWork + units > MAX_DECODE_WORK) return false;
      decodeWork += units;
      return true;
    },
    chargeCensus(units) {
      if (!Number.isSafeInteger(units) || units < 0 ||
          !withinTime() || censusRows + units > MAX_TOTAL_CENSUS_ROWS) return false;
      censusRows += units;
      return true;
    },
    canLookupPrice() {
      return withinTime() && priceLookups < MAX_PRICE_LOOKUPS;
    },
    chargePrice() {
      if (!this.canLookupPrice()) return false;
      priceLookups += 1;
      return true;
    },
    async read(operation, args) {
      if (typeof operation !== "function" || !withinTime()) return null;
      const controller = new AbortController();
      const remaining = Math.max(1, maxReadMs - (performance.now() - startedAt));
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("SOURCE_READ_DEADLINE_EXCEEDED"));
        }, remaining);
      });
      try {
        const pending = Promise.resolve().then(() =>
          operation({...args, signal: controller.signal}));
        return await Promise.race([pending, timeout]);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    totals() {
      return {decodeWork, censusRows, priceLookups, elapsedMs: Math.floor(performance.now() - startedAt)};
    }
  };
}

export async function buildAnalystWindowEvidence({
  candidate,
  candidateT,
  assembledAt,
  decisionAt = assembledAt,
  policy,
  poolProof,
  historySource,
  censusSource,
  priceSource,
  marketPairEvidence,
  smartWalletAllowlist,
  maxSourceReadMs = MAX_SOURCE_READ_MS
} = {}) {
  const identity = candidateIdentity(candidate);
  const metrics = {};
  const unavailableMetrics = Object.fromEntries(ANALYST_WINDOW_METRICS.map(key =>
    [key, noMetric("REQUIRED_SOURCE_OR_REVIEWED_POLICY_UNAVAILABLE")]));
  const receipts = {pool: null, history: null, census: [], prices: [], marketPair: null, allowlist: null};
  const windows = {};
  const sourceBudgetValid = Number.isSafeInteger(maxSourceReadMs) &&
    maxSourceReadMs > 0 && maxSourceReadMs <= MAX_SOURCE_READ_MS;
  const budget = createSourceBudget(sourceBudgetValid ? maxSourceReadMs : MAX_SOURCE_READ_MS);
  const policyValid = validPolicy(policy);
  const timeValid = validTime(candidateT) && validTime(assembledAt) &&
    sourceBudgetValid && validTime(decisionAt) && candidateT <= assembledAt && assembledAt <= decisionAt &&
    decisionAt - candidateT <= FILTER_POLICY.maxEvidenceAgeMs &&
    timestampValue(candidate?.sampledAt) === candidateT &&
    policyValid && policy.windowsMs.swaps1h <= candidateT &&
    policy.windowsMs.momentum15m <= candidateT &&
    policy.windowsMs.holders1h <= candidateT;
  const identityValid = identity.chainId === "solana" &&
    isSolanaPublicKey(identity.mint) && isSolanaPublicKey(identity.pool) &&
    isSolanaPublicKey(identity.quote) && identity.mint !== identity.quote &&
    typeof candidate?.source === "string" && candidate.source.trim().length > 0;
  if (!policyValid || !timeValid || !identityValid) {
    const packet = {
      schema: "MEMECOIN_ANALYST_WINDOW_EVIDENCE_V1",
      status: "INCOMPLETE",
      binding: identity,
      candidateT: validTime(candidateT) ? candidateT : null,
      assembledAt: validTime(assembledAt) ? assembledAt : null,
      decisionAt: validTime(decisionAt) ? decisionAt : null,
      policy: policyValid ? policy : null,
      windows,
      metrics,
      unavailableMetrics: Object.fromEntries(ANALYST_WINDOW_METRICS.map(key => [
        key, noMetric(!identityValid ? "CANDIDATE_IDENTITY_INVALID"
          : !policyValid ? "WINDOW_POLICY_INVALID" : "CANDIDATE_TIME_INVALID")
      ])),
      receipts,
      executionAuthorized: false,
      authorizationEligible: false
    };
    Object.defineProperty(packet, PACKET_BRAND, {value: true});
    return deepFreeze(packet);
  }

  const start1h = candidateT - policy.windowsMs.swaps1h;
  const start15m = candidateT - policy.windowsMs.momentum15m;
  const startHolders = candidateT - policy.windowsMs.holders1h;
  windows.swaps1h = {startExclusive: start1h, endInclusive: candidateT};
  windows.momentum15m = {startInclusive: start15m, endInclusive: candidateT};
  windows.holders1h = {startInclusive: startHolders, endInclusive: candidateT};
  const poolReady = identityBoundPoolProof(poolProof, identity, candidateT, assembledAt);
  if (poolReady) receipts.pool = {
    source: poolProof.source,
    id: poolProof.receipt.id,
    payloadSha256: poolProof.receipt.payloadSha256,
    receivedAt: poolProof.receipt.receivedAt,
    observedAt: poolProof.observedAt,
    slot: poolProof.slot
  };
  else unavailableMetrics.uniqueBuyers1h = noMetric("POOL_PROOF_STALE_OR_UNBOUND");

  const historyResult = poolReady && typeof historySource?.readWindow === "function"
    ? await budget.read(historySource.readWindow.bind(historySource), {
      identity, poolProof,
      startExclusiveMs: start1h, endInclusiveMs: candidateT
    })
    : null;
  const historyReady = poolReady && historyWindowReady(
    historyResult, identity, start1h, candidateT, assembledAt
  );
  const decodedSwaps = [];
  let decodeComplete = historyReady;
  if (historyReady) {
    receipts.history = {
      source: historyResult.source,
      id: historyResult.receipt.id,
      payloadSha256: historyResult.receipt.payloadSha256,
      receivedAt: historyResult.receipt.receivedAt,
      coverage: {
        complete: historyResult.coverage.complete,
        truncated: historyResult.coverage.truncated,
        cursorExhausted: historyResult.coverage.cursorExhausted
      }
    };
    const seen = new Map();
    for (const row of historyResult.transactions) {
      if (!budget.withinTime()) {
        decodeComplete = false;
        break;
      }
      const workUnits = estimateCpmmDecodeWork(row);
      if (workUnits === null || !budget.chargeDecode(workUnits)) {
        decodeComplete = false;
        break;
      }
      const decoded = sourceRowMaybeSwap(row, identity, poolProof);
      if (possibleUnobservedSwap(decoded)) decodeComplete = false;
      if (row?.signature && seen.has(row.signature)) {
        if (seen.get(row.signature) !== serializeDecoded(decoded)) decodeComplete = false;
        continue;
      }
      if (row?.signature) seen.set(row.signature, serializeDecoded(decoded));
      if (decoded.status === "DECODED" &&
          decoded.observedAt > start1h && decoded.observedAt <= candidateT) {
        decodedSwaps.push(decoded);
      }
    }
    if (decodeComplete) {
      const buyers = new Set(decodedSwaps.filter(row => row.direction === "BUY").map(row => row.buyer));
      metrics.uniqueBuyers1h = metricEvidence({
        candidate, value: buyers.size, source: historyResult.source,
        observedAt: candidateT, slot: null,
        coverage: {
          window: windows.swaps1h,
          historyReceiptId: historyResult.receipt.id,
          poolReceiptId: poolProof.receipt.id,
          successfulDecodedSwaps: decodedSwaps.length,
          distinctBuyerAddresses: buyers.size,
          provenanceType: "DERIVED_ONCHAIN_WINDOW_NO_SINGLE_SLOT"
        }
      });
      delete unavailableMetrics.uniqueBuyers1h;
      windows.swaps1h.decodedUniqueTransactions = decodedSwaps.length;
      windows.swaps1h.excludedDuplicateSignatures = historyResult.transactions.length -
        [...seen.keys()].length;
      windows.swaps1h.observations = decodedSwaps.map(swap => ({
        signature: swap.signature,
        slot: swap.slot,
        instructionIndex: swap.instructionIndex,
        observedAt: swap.observedAt,
        direction: swap.direction,
        trader: swap.trader,
        buyer: swap.buyer,
        inputMint: swap.inputMint,
        outputMint: swap.outputMint,
        inputAmountRaw: swap.inputAmountRaw,
        outputAmountRaw: swap.outputAmountRaw
      }));
    } else {
      unavailableMetrics.uniqueBuyers1h = noMetric("SWAP_HISTORY_OR_DECODING_COVERAGE_INCOMPLETE");
    }
  } else {
    unavailableMetrics.uniqueBuyers1h = noMetric("SWAP_HISTORY_SOURCE_INCOMPLETE");
  }

  const priceCache = new Map();
  async function getTrustedPrice(mint, atMs, purpose) {
    const trust = policy.historicalPriceTrust;
    if (!sourceTrustReady(trust) || typeof priceSource?.readObservation !== "function") return null;
    const key = `${mint}:${atMs}`;
    if (!priceCache.has(key)) {
      if (priceCache.size >= MAX_PRICE_LOOKUPS || !budget.chargePrice()) return null;
      priceCache.set(key, await budget.read(priceSource.readObservation.bind(priceSource), {
        mint, atMs, denomination: policy.momentumDenomination, purpose
      }));
    }
    const response = priceCache.get(key);
    if (!exactSourceObservation(response, response?.source, {mint, atMs}, assembledAt, trust) ||
        response.source !== trust.source || response.denomination !== policy.momentumDenomination) {
      return null;
    }
    receipts.prices.push({
      source: response.source,
      id: response.receipt.id,
      payloadSha256: response.receipt.payloadSha256,
      receivedAt: response.receivedAt,
      sourceAtMs: response.sourceAtMs,
      mint,
      purpose
    });
    return response;
  }

  const momentumTrustReady = sourceTrustReady(policy.historicalPriceTrust) &&
    policy.momentumDenomination === "USD";
  if (momentumTrustReady) {
    const [from, to] = await Promise.all([
      getTrustedPrice(identity.mint, start15m, "MOMENTUM_START"),
      getTrustedPrice(identity.mint, candidateT, "MOMENTUM_END")
    ]);
    if (from && to && from.source === to.source &&
        from.methodologyVersion === to.methodologyVersion) {
      const value = (to.valueUsd / from.valueUsd - 1) * 100;
      if (Number.isFinite(value)) {
        metrics.momentum15m = metricEvidence({
          candidate, value, source: from.source, observedAt: candidateT,
          coverage: {
            window: windows.momentum15m,
            denomination: "USD",
            source: from.source,
            methodologyVersion: from.methodologyVersion,
            startReceiptId: from.receipt.id,
            endReceiptId: to.receipt.id,
            exactEndpoints: true,
            provenanceType: "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT"
          }
        });
        delete unavailableMetrics.momentum15m;
      }
    }
  }
  if (!metrics.momentum15m) unavailableMetrics.momentum15m = noMetric(
    "TRUSTED_EXACT_USD_MOMENTUM_ENDPOINTS_UNAVAILABLE"
  );

  let buyVolumeUsd = 0;
  let sellVolumeUsd = 0;
  let allFlowsPriced = historyReady && decodeComplete;
  if (allFlowsPriced) {
    for (const swap of decodedSwaps) {
      const quoteAmountRaw = swap.direction === "BUY"
        ? swap.inputAmountRaw
        : swap.outputAmountRaw;
      const quoteUnits = tokenUnits(quoteAmountRaw, poolProof.quoteDecimals);
      const quotePrice = await getTrustedPrice(identity.quote, swap.observedAt, "SWAP_QUOTE_USD");
      if (!Number.isFinite(quoteUnits) || quoteUnits <= 0 || !quotePrice) {
        allFlowsPriced = false;
        break;
      }
      const flowUsd = quoteUnits * quotePrice.valueUsd;
      if (!Number.isFinite(flowUsd) || flowUsd <= 0) {
        allFlowsPriced = false;
        break;
      }
      if (swap.direction === "BUY") buyVolumeUsd += flowUsd;
      else sellVolumeUsd += flowUsd;
    }
  }
  if (allFlowsPriced && buyVolumeUsd > 0 && sellVolumeUsd > 0 &&
      Number.isFinite(buyVolumeUsd) && Number.isFinite(sellVolumeUsd)) {
    metrics.buySellUsdRatio1h = metricEvidence({
      candidate, value: null,
      source: sourceLabel(historyResult.source, policy.historicalPriceTrust.source),
      observedAt: candidateT,
      coverage: {
        window: windows.swaps1h,
        denomination: "USD",
        buyVolumeUsd,
        sellVolumeUsd,
        historyReceiptId: historyResult.receipt.id,
        priceTrustVersion: policy.historicalPriceTrust.version,
        provenanceType: "DERIVED_ONCHAIN_WINDOW_WITH_EXACT_HISTORICAL_USD_PRICES_NO_SINGLE_SLOT"
      }
    });
    delete unavailableMetrics.buySellUsdRatio1h;
  } else {
    unavailableMetrics.buySellUsdRatio1h = noMetric(
      !allFlowsPriced ? "SWAP_FLOW_PRICING_OR_COVERAGE_INCOMPLETE"
        : "POSITIVE_BUY_AND_SELL_USD_DENOMINATORS_REQUIRED"
    );
  }

  const censusPolicy = policy.censusPolicy;
  if (censusPolicyReady(censusPolicy) && typeof censusSource?.readSnapshots === "function") {
    const census = await budget.read(censusSource.readSnapshots.bind(censusSource), {
      identity, startAtMs: startHolders, endAtMs: candidateT, policy: censusPolicy
    });
    const pair = census?.snapshots;
    if (census?.status === "COMPLETE" && census?.coverage?.complete === true &&
        census?.coverage?.truncated === false && Array.isArray(pair) && pair.length === 2 &&
        sameIdentity(census.identity, identity) &&
        Array.isArray(pair[0]?.owners) && Array.isArray(pair[1]?.owners) &&
        pair[0].owners.length + pair[1].owners.length <= MAX_TOTAL_CENSUS_ROWS) {
      const chargeCensus = units => budget.chargeCensus(units);
      const startCount = ownerCount(pair[0], censusPolicy, startHolders, assembledAt, identity, chargeCensus);
      const endCount = ownerCount(pair[1], censusPolicy, candidateT, assembledAt, identity, chargeCensus);
      if (pair[0]?.source !== pair[1]?.source) {
        unavailableMetrics.holderGrowthPct1h = noMetric("CENSUS_SOURCE_CHANGED_BETWEEN_ENDPOINTS");
      }
      receipts.census = pair.filter(snapshot => isRecord(snapshot) &&
        validReceipt(snapshot.source, snapshot.receipt, assembledAt)).map(snapshot => ({
        source: snapshot.source,
        id: snapshot.receipt.id,
        payloadSha256: snapshot.receipt.payloadSha256,
        receivedAt: snapshot.receivedAt,
        observedAt: snapshot.observedAt,
        slot: snapshot.slot,
        provenanceType: snapshot.provenanceType
      }));
      if (pair[0]?.source === pair[1]?.source &&
          startCount !== null && endCount !== null && startCount > 0) {
        const value = ((endCount - startCount) / startCount) * 100;
        if (Number.isFinite(value)) {
          metrics.holderGrowthPct1h = metricEvidence({
            candidate, value, source: pair[0].source, observedAt: candidateT,
            coverage: {
              window: windows.holders1h,
              aggregation: censusPolicy.aggregation,
              censusPolicyVersion: censusPolicy.version,
              exclusions: [...censusPolicy.exclusions],
              startOwnerCount: startCount,
              endOwnerCount: endCount,
              exactEndpoints: true,
              startReceiptId: pair[0].receipt.id,
              endReceiptId: pair[1].receipt.id,
              endpointProvenance: pair.map(snapshot => ({
                slot: snapshot.slot,
                type: snapshot.provenanceType
              })),
              provenanceType: "CENSUS_ENDPOINTS_TYPED_PROVENANCE_NO_SINGLE_SLOT"
            }
          });
          delete unavailableMetrics.holderGrowthPct1h;
        }
      }
    }
  }
  if (!metrics.holderGrowthPct1h) unavailableMetrics.holderGrowthPct1h = noMetric(
    "MATCHED_COMPLETE_CENSUS_ENDPOINTS_UNAVAILABLE"
  );

  if (validPair(marketPairEvidence, identity, candidateT, assembledAt) &&
      candidatePairMatches(candidate, marketPairEvidence, identity)) {
    receipts.marketPair = {
      source: marketPairEvidence.source,
      id: marketPairEvidence.receipt.id,
      payloadSha256: marketPairEvidence.receipt.payloadSha256,
      receivedAt: marketPairEvidence.receipt.receivedAt,
      observedAt: marketPairEvidence.observedAt
    };
    const value = marketPairEvidence.liquidityUsd / marketPairEvidence.marketCapUsd * 100;
    if (Number.isFinite(value) && value > 0) {
      metrics.liquidityMarketCapPct = metricEvidence({
        candidate, value, source: marketPairEvidence.source, observedAt: marketPairEvidence.observedAt,
        coverage: {
          pairReceiptId: marketPairEvidence.receipt.id,
          liquidityUsd: marketPairEvidence.liquidityUsd,
          actualMarketCapUsd: marketPairEvidence.marketCapUsd,
          sameAcceptedPair: true,
          provenanceType: "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT"
        }
      });
      delete unavailableMetrics.liquidityMarketCapPct;
    }
  }
  if (!metrics.liquidityMarketCapPct) unavailableMetrics.liquidityMarketCapPct = noMetric(
    "SAME_ACCEPTED_PAIR_LIQUIDITY_OR_ACTUAL_MARKET_CAP_UNAVAILABLE"
  );

  const qualificationPolicy = policy.walletQualification;
  const syntheticFixtureOnly = candidate?.source === "SYNTHETIC_FIXTURE_ONLY";
  if (isRecord(qualificationPolicy) && qualificationPolicy.status === "REVIEWED" &&
      typeof qualificationPolicy.version === "string" &&
      typeof qualificationPolicy.reviewReceiptId === "string" &&
      qualificationPolicy.reviewReceiptId.trim() &&
      historyReady && decodeComplete) {
    const eligible = qualifiedWallets(
      smartWalletAllowlist, qualificationPolicy, candidateT, assembledAt,
      syntheticFixtureOnly, units => budget.chargeCensus(units)
    );
    if (eligible) {
      const buyers = new Set(decodedSwaps.filter(row => row.direction === "BUY").map(row => row.buyer));
      const count = [...buyers].filter(address => eligible.has(address)).length;
      receipts.allowlist = {
        source: smartWalletAllowlist.source,
        id: smartWalletAllowlist.receipt.id,
        payloadSha256: smartWalletAllowlist.receipt.payloadSha256,
        receivedAt: smartWalletAllowlist.receipt.receivedAt,
        version: smartWalletAllowlist.version,
        qualificationPolicyVersion: qualificationPolicy.version,
        reviewReceiptId: smartWalletAllowlist.review.receiptId
      };
      metrics.qualifiedSmartWallets = metricEvidence({
        candidate, value: count,
        source: sourceLabel(historyResult.source, smartWalletAllowlist.source),
        observedAt: candidateT,
        coverage: {
          window: windows.swaps1h,
          distinctBuyers: buyers.size,
          allowlistVersion: smartWalletAllowlist.version,
          qualificationPolicyVersion: qualificationPolicy.version,
          allowlistReviewReceiptId: smartWalletAllowlist.review.receiptId,
          historyReceiptId: historyResult.receipt.id,
          provenanceType: "DERIVED_ONCHAIN_WINDOW_WITH_EXTERNALLY_REVIEWED_ALLOWLIST_NO_SINGLE_SLOT"
        }
      });
      delete unavailableMetrics.qualifiedSmartWallets;
    }
  }
  if (!metrics.qualifiedSmartWallets) unavailableMetrics.qualifiedSmartWallets = noMetric(
    "EXTERNALLY_REVIEWED_EFFECTIVE_ALLOWLIST_OR_BUYER_PROVENANCE_UNAVAILABLE"
  );

  const status = ANALYST_WINDOW_METRICS.every(key => metrics[key])
    ? "COMPLETE" : "INCOMPLETE";
  const packet = {
    schema: "MEMECOIN_ANALYST_WINDOW_EVIDENCE_V1",
    status,
    binding: identity,
    candidateT,
    assembledAt,
    decisionAt,
    policy: {
      version: policy.version,
      boundary: policy.boundary,
      windowsMs: {...policy.windowsMs},
      momentumDenomination: policy.momentumDenomination,
      historicalPriceTrustVersion: policy.historicalPriceTrust?.version ?? null,
      historicalPriceTrustReviewReceiptId: policy.historicalPriceTrust?.reviewReceiptId ?? null,
      censusPolicyVersion: policy.censusPolicy?.version ?? null,
      censusPolicyReviewReceiptId: policy.censusPolicy?.reviewReceiptId ?? null,
      censusAggregation: policy.censusPolicy?.aggregation ?? null,
      censusExclusions: policy.censusPolicy?.exclusions
        ? [...policy.censusPolicy.exclusions] : null,
      censusDenominatorPolicy: policy.censusPolicy?.denominatorPolicy ?? null,
      walletQualificationVersion: policy.walletQualification?.version ?? null,
      walletQualificationReviewReceiptId: policy.walletQualification?.reviewReceiptId ?? null,
      membershipTiming: policy.walletQualification?.membershipTiming ?? null,
      membershipTimingApproval: policy.walletQualification?.membershipTimingApproval ?? null
    },
    limits: {
      maxSourceReadMs,
      maxHistoryRows: MAX_HISTORY_ROWS,
      maxDecodeWork: MAX_DECODE_WORK,
      maxPriceLookups: MAX_PRICE_LOOKUPS,
      maxCensusOwners: MAX_TOTAL_CENSUS_ROWS,
      maxAllowlistRows: MAX_ALLOWLIST_ROWS,
      ...budget.totals()
    },
    windows,
    metrics,
    unavailableMetrics,
    receipts,
    executionAuthorized: false,
    authorizationEligible: false
  };
  Object.defineProperty(packet, PACKET_BRAND, {value: true});
  return deepFreeze(packet);
}

function canonicalAnalystValue(key, evidence, packet) {
  switch (key) {
    case "momentum15m":
      return {percent: evidence.value};
    case "uniqueBuyers1h":
      return {count: evidence.value};
    case "buySellUsdRatio1h":
      return {
        buyVolumeUsd: evidence.coverage.buyVolumeUsd,
        sellVolumeUsd: evidence.coverage.sellVolumeUsd
      };
    case "holderGrowthPct1h":
      return {
        startHolders: evidence.coverage.startOwnerCount,
        endHolders: evidence.coverage.endOwnerCount
      };
    case "liquidityMarketCapPct":
      return {
        liquidityUsd: evidence.coverage.liquidityUsd,
        marketCapUsd: evidence.coverage.actualMarketCapUsd
      };
    case "qualifiedSmartWallets":
      return {
        count: evidence.value,
        allowlistId: packet.receipts.allowlist?.id,
        evidenceIds: [packet.receipts.history?.id, packet.receipts.allowlist?.id]
      };
    default:
      return null;
  }
}

export function bridgeAnalystWindowPacket(packet, {identity, reviewEvidence = {}} = {}) {
  if (packet?.[PACKET_BRAND] !== true || !sameIdentity(packet.binding, identity) ||
      packet.executionAuthorized !== false || packet.authorizationEligible !== false) {
    return Object.freeze({status: "UNAVAILABLE", analystEvidence: Object.freeze({})});
  }
  const analystEvidence = {};
  for (const key of ANALYST_WINDOW_METRICS) {
    const evidence = packet.metrics[key];
    const review = reviewEvidence[key];
    if (!isRecord(evidence) || !isRecord(review) || review.status !== "REVIEWED" ||
        typeof review.reviewerId !== "string" || !review.reviewerId.trim() ||
        typeof review.reviewId !== "string" || !review.reviewId.trim() ||
        !validTime(review.reviewedAt) || review.reviewedAt > packet.decisionAt) continue;
    const sourceVersion = evidence.coverage.methodologyVersion ??
      packet.policy.version;
    const value = canonicalAnalystValue(key, evidence, packet);
    if (!isRecord(value) || !Number.isSafeInteger(packet.windows[key === "momentum15m"
      ? "momentum15m" : key === "holderGrowthPct1h" ? "holders1h" : "swaps1h"]?.endInclusive)) {
      continue;
    }
    const windowMs = key === "momentum15m" ? 900_000
      : key === "liquidityMarketCapPct" ? undefined : 3_600_000;
    const slotProvenance = evidence.coverage.provenanceType;
    if (!NULL_SLOT_PROVENANCE.has(slotProvenance)) continue;
    analystEvidence[key] = {
      source: evidence.source,
      sourceVersion,
      identity: packet.binding,
      observedAt: evidence.observedAt,
      slot: evidence.slot,
      value,
      review,
      coverage: {
        ...evidence.coverage,
        complete: true,
        ...(windowMs ? {windowMs} : {}),
        ...(key === "uniqueBuyers1h" ? {uniqueAddressesDeduplicated: true} : {}),
        slotProvenance
      },
      review
    };
  }
  return deepFreeze({status: "BRIDGED", analystEvidence});
}

export async function evaluateWithCanonicalMarketAdapter({
  canonicalAdapter,
  providerCandidate,
  evidence,
  packet,
  reviewEvidence,
  now,
  holdUntil = null
} = {}) {
  const bridge = bridgeAnalystWindowPacket(packet, {
    identity: candidateIdentity(providerCandidate),
    reviewEvidence
  });
  if (bridge.status !== "BRIDGED" || typeof canonicalAdapter !== "function" ||
      !validTime(now)) {
    return {
      status: "CANONICAL_ADAPTER_OR_PACKET_UNAVAILABLE",
      bridge,
      adapted: null,
      filters: null,
      analysis: {status: "SCORE_UNAVAILABLE", score: null},
      executionAuthorized: false
    };
  }
  const adapted = await canonicalAdapter({
    providerCandidate,
    evidence,
    analystEvidence: bridge.analystEvidence,
    now,
    holdUntil
  });
  const candidate = adapted?.candidate;
  const filters = candidate ? filterCandidate(candidate, {now, holdUntil})
    : {status: "SCORE_UNAVAILABLE", results: []};
  const analysis = candidate ? analyzeCandidate(candidate, {
    now,
    filterResult: filters,
    smartWalletAllowlist: adapted?.smartWalletAllowlist
  }) : {status: "SCORE_UNAVAILABLE", score: null};
  return {
    status: adapted?.status ?? "ADAPTER_RESULT_UNAVAILABLE",
    bridge,
    adapted,
    filters,
    analysis,
    executionAuthorized: false
  };
}
