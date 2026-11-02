import {SYNTHETIC_MINT, SYNTHETIC_POOL, SYNTHETIC_QUOTE, SYNTHETIC_SOURCE, syntheticCandidate} from "../../../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {RAYDIUM_CPMM_LAYOUT} from "../../../scripts/memecoin-paper/cpmm-swap-observations.mjs";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BASE_VAULT = key(80_001);
const QUOTE_VAULT = key(80_002);
const FEE_PAYER = key(80_003);
const AUTHORITY = key(80_004);
const AMM_CONFIG = key(80_005);
const OBSERVATION = key(80_006);
const CANDIDATE_T = Date.parse("2026-10-30T12:00:00.000Z");
const ASSEMBLED_AT = CANDIDATE_T + 1;
const DECISION_AT = CANDIDATE_T + 2;

function key(number) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(number, 28);
  return encodeBase58(bytes);
}

function signature(number) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(number, 60);
  return encodeBase58(bytes);
}

function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    encoded = alphabet[remainder] + encoded;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

function base58Bytes(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") zeroes += 1;
  return Buffer.concat([Buffer.alloc(zeroes), Buffer.from(bytes)]);
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function receipt(id, receivedAt = ASSEMBLED_AT, suffix = "a") {
  return {
    status: "SOURCE_BOUND",
    id,
    source: SYNTHETIC_SOURCE,
    payloadSha256: suffix.repeat(64).slice(0, 64),
    receivedAt
  };
}

function eventData({
  pool = SYNTHETIC_POOL,
  inputMint,
  outputMint,
  inputAmount,
  outputAmount,
  baseInput = true
}) {
  return Buffer.concat([
    Buffer.from(RAYDIUM_CPMM_LAYOUT.events.swap),
    base58Bytes(pool),
    u64(5_000_000_000),
    u64(9_000_000_000),
    u64(inputAmount),
    u64(outputAmount),
    u64(0),
    u64(0),
    Buffer.from([baseInput ? 1 : 0]),
    base58Bytes(inputMint),
    base58Bytes(outputMint),
    u64(0),
    u64(0),
    Buffer.from([0])
  ]).toString("base64");
}

function balance(accountIndex, mint, owner, amount) {
  return {
    accountIndex,
    mint,
    owner,
    uiTokenAmount: {amount: String(amount), decimals: 6}
  };
}

export function makeSwap(number, atMs, {direction = "BUY", failed = false} = {}) {
  const buyer = key(100_000 + number);
  const inputTokenAccount = key(200_000 + number * 2);
  const outputTokenAccount = key(200_001 + number * 2);
  const isBuy = direction === "BUY";
  const inputMint = isBuy ? SYNTHETIC_QUOTE : SYNTHETIC_MINT;
  const outputMint = isBuy ? SYNTHETIC_MINT : SYNTHETIC_QUOTE;
  const inputVault = isBuy ? QUOTE_VAULT : BASE_VAULT;
  const outputVault = isBuy ? BASE_VAULT : QUOTE_VAULT;
  const inputAmount = isBuy ? 1_000_000 : 2_000_000;
  const outputAmount = isBuy ? 2_000_000 : 1_000_000;
  const inputBefore = 10_000_000;
  const outputBefore = 0;
  const inputVaultBefore = 2_000_000_000;
  const outputVaultBefore = 9_000_000_000;
  const transactionSignature = signature(300_000 + number);
  const keys = [
    FEE_PAYER,
    AUTHORITY,
    AMM_CONFIG,
    SYNTHETIC_POOL,
    inputTokenAccount,
    outputTokenAccount,
    inputVault,
    outputVault,
    TOKEN_PROGRAM,
    TOKEN_PROGRAM,
    inputMint,
    outputMint,
    OBSERVATION,
    RAYDIUM_CPMM_LAYOUT.programId
  ];
  const logData = eventData({
    inputMint, outputMint, inputAmount, outputAmount
  });
  const transaction = {
    signatures: [transactionSignature],
    message: {
      accountKeys: keys,
      instructions: [{
        programIdIndex: 13,
        accounts: Array.from({length: 13}, (_, index) => index),
        data: encodeBase58(Buffer.concat([
          Buffer.from(RAYDIUM_CPMM_LAYOUT.instructions.swapBaseInput),
          u64(inputAmount),
          u64(outputAmount - 1)
        ]))
      }]
    },
    meta: {
      err: failed ? {InstructionError: [0, "Custom"]} : null,
      preTokenBalances: [
        balance(4, inputMint, buyer, inputBefore),
        balance(5, outputMint, buyer, outputBefore),
        balance(6, inputMint, AUTHORITY, inputVaultBefore),
        balance(7, outputMint, AUTHORITY, outputVaultBefore)
      ],
      postTokenBalances: [
        balance(4, inputMint, buyer, inputBefore - inputAmount),
        balance(5, outputMint, buyer, outputAmount),
        balance(6, inputMint, AUTHORITY, inputVaultBefore + inputAmount),
        balance(7, outputMint, AUTHORITY, outputVaultBefore - outputAmount)
      ],
      logMessages: [
        `Program ${RAYDIUM_CPMM_LAYOUT.programId} invoke [1]`,
        `Program data: ${logData}`,
        `Program ${RAYDIUM_CPMM_LAYOUT.programId} success`
      ]
    }
  };
  return {
    signature: transactionSignature,
    slot: 500_000 + number,
    blockTime: Math.floor(atMs / 1000),
    transaction,
    meta: transaction.meta
  };
}

export function makeFixture({
  buyCount = 100,
  sellCount = 5,
  includeBoundaryRows = true,
  duplicateFirstRow = false,
  historyOverride = null,
  poolProofOverride = null,
  censusOverride = null,
  priceOverride = null,
  marketPairOverride = null,
  allowlistOverride = null,
  policyOverride = {}
} = {}) {
  const candidateT = CANDIDATE_T;
  const assembledAt = ASSEMBLED_AT;
  const decisionAt = DECISION_AT;
  const start = candidateT - 3_600_000;
  const candidate = syntheticCandidate(candidateT);
  const identity = {
    chainId: candidate.chainId,
    mint: candidate.mint,
    pool: candidate.pool,
    quote: candidate.quote
  };
  const poolProof = {
    status: "SOURCE_BOUND",
    verified: true,
    chainId: "solana",
    pool: SYNTHETIC_POOL,
    baseMint: SYNTHETIC_MINT,
    quoteMint: SYNTHETIC_QUOTE,
    baseVault: BASE_VAULT,
    quoteVault: QUOTE_VAULT,
    baseDecimals: 6,
    quoteDecimals: 6,
    source: SYNTHETIC_SOURCE,
    observedAt: candidateT - 10_000,
    slot: 490_000,
    receipt: receipt("pool-proof", assembledAt, "b")
  };
  const transactions = [];
  for (let index = 0; index < buyCount; index += 1) {
    const at = start + 1_000 + index * 30_000;
    transactions.push(makeSwap(index, at));
  }
  for (let index = 0; index < sellCount; index += 1) {
    const at = start + 1_500 + (buyCount + index) * 30_000;
    transactions.push(makeSwap(10_000 + index, at, {direction: "SELL"}));
  }
  if (includeBoundaryRows) {
    transactions.push(makeSwap(20_000, start, {direction: "BUY"}));
    transactions.push(makeSwap(20_001, candidateT, {direction: "BUY"}));
  }
  if (duplicateFirstRow && transactions.length) {
    transactions.push(structuredClone(transactions[0]));
  }
  const historySource = {
    async readWindow({identity: requestIdentity, startExclusiveMs, endInclusiveMs}) {
      if (historyOverride) return historyOverride;
      return {
        status: "COMPLETE",
        source: SYNTHETIC_SOURCE,
        identity: requestIdentity,
        requested: {startExclusiveMs, endInclusiveMs},
        coverage: {complete: true, truncated: false, cursorExhausted: true},
        receipt: receipt("history-window", assembledAt, "c"),
        transactions
      };
    }
  };
  const censusPolicy = {
    status: "REVIEWED",
    version: "fixture-census-v1",
    aggregation: "DISTINCT_POSITIVE_BALANCE_OWNER",
    exclusions: ["selected_pool", "burned_supply"],
    denominatorPolicy: "TOTAL_SUPPLY_EXCLUDING_CENSUS_EXCLUSIONS",
    reviewReceiptId: "synthetic-fixture-census-policy"
  };
  const makeSnapshot = (identity, observedAt, count, id, suffix) => ({
    status: "COMPLETE",
    source: SYNTHETIC_SOURCE,
    identity,
    observedAt,
    receivedAt: assembledAt,
    slot: null,
    provenanceType: "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT",
    censusPolicyVersion: censusPolicy.version,
    aggregation: censusPolicy.aggregation,
    exclusions: [...censusPolicy.exclusions],
    denominatorPolicy: censusPolicy.denominatorPolicy,
    denominatorAtoms: "1000000000",
    coverage: {complete: true, truncated: false},
    owners: Array.from({length: count}, (_, index) => ({
      owner: key(400_000 + index),
      balanceAtoms: "1"
    })),
    receipt: receipt(id, assembledAt, suffix)
  });
  const censusSource = {
    async readSnapshots({identity: requestIdentity, startAtMs, endAtMs}) {
      if (censusOverride) return censusOverride;
      return {
        status: "COMPLETE",
        source: SYNTHETIC_SOURCE,
        identity: requestIdentity,
        coverage: {complete: true, truncated: false},
        snapshots: [
          makeSnapshot(requestIdentity, startAtMs, 20, "census-start", "d"),
          makeSnapshot(requestIdentity, endAtMs, 23, "census-end", "e")
        ]
      };
    }
  };
  const historicalPriceTrust = {
    status: "REVIEWED",
    source: SYNTHETIC_SOURCE,
    version: "fixture-exact-usd-v1",
    denomination: "USD",
    mode: "EXACT_HISTORICAL_OBSERVATION",
    reviewReceiptId: "synthetic-fixture-price-review"
  };
  const priceSource = {
    async readObservation({mint, atMs}) {
      if (priceOverride) return priceOverride({mint, atMs});
      return {
        status: "SOURCE_BOUND",
        source: SYNTHETIC_SOURCE,
        mint,
        denomination: "USD",
        methodologyVersion: historicalPriceTrust.version,
        sourceAtMs: atMs,
        receivedAt: assembledAt,
        valueUsd: mint === SYNTHETIC_MINT && atMs === candidateT ? 1.2 : 1,
        receipt: receipt(`price-${mint}-${atMs}`, assembledAt, "f")
      };
    }
  };
  const marketPairEvidence = marketPairOverride ?? {
    status: "SOURCE_BOUND",
    source: SYNTHETIC_SOURCE,
    identity,
    observedAt: candidateT,
    marketCapUsd: 1_000_000,
    liquidityUsd: 50_000,
    receipt: receipt("market-pair", assembledAt, "1")
  };
  const walletQualification = {
    status: "REVIEWED",
    version: "fixture-wallet-policy-v1",
    reviewReceiptId: "synthetic-fixture-wallet-policy",
    membershipTiming: "SYNTHETIC_FIXTURE_ONLY"
  };
  const smartWalletAllowlist = allowlistOverride ?? {
    status: "VERIFIED",
    source: SYNTHETIC_SOURCE,
    provenance: SYNTHETIC_SOURCE,
    version: "fixture-allowlist-v1",
    qualificationPolicyVersion: walletQualification.version,
    effectiveFromMs: candidateT - 90 * 24 * 60 * 60 * 1000,
    effectiveUntilMs: candidateT + 1_000,
    review: {
      status: "EXTERNALLY_REVIEWED",
      reviewedAt: candidateT - 24 * 60 * 60 * 1000,
      receiptId: "synthetic-fixture-allowlist-review"
    },
    entries: Array.from({length: 5}, (_, index) => ({
      address: key(100_000 + index),
      qualified: true,
      reviewed: true,
      candidateMintExcluded: true,
      qualificationPolicyVersion: walletQualification.version,
      qualificationReceiptId: `synthetic-qualification-${index}`
    })),
    receipt: receipt("fixture-allowlist", assembledAt, "2")
  };
  const policy = {
    version: "fixture-analyst-policy-v1",
    scoreVersion: "memecoin-candidate-score-v1",
    boundary: "(startExclusive,endInclusive]",
    windowsMs: {swaps1h: 3_600_000, momentum15m: 900_000, holders1h: 3_600_000},
    momentumDenomination: "USD",
    historicalPriceTrust,
    censusPolicy,
    walletQualification,
    ...policyOverride
  };
  return {
    candidate, identity, candidateT, assembledAt, decisionAt, policy, poolProof: poolProofOverride ?? poolProof,
    historySource, censusSource, priceSource, marketPairEvidence, smartWalletAllowlist,
    transactions, receipt
  };
}
