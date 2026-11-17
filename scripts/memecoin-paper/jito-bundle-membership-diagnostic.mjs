import {createHash} from "node:crypto";
import {
  isSolanaPublicKey,
  RAYDIUM_CPMM_LAYOUT
} from "./cpmm-swap-observations.mjs";
import {LAUNCH_HISTORY_SOURCE_VERSION} from "./launch-history-source.mjs";

export const JITO_BUNDLE_MEMBERSHIP_DIAGNOSTIC_VERSION =
  "jito-bundle-membership-diagnostic-v1";
export const JITO_BUNDLE_DIAGNOSTIC_LIMITS = Object.freeze({
  maxResponseBytes: 1_048_576,
  maxRequestBytes: 65_536,
  maxBundleIds: 5,
  maxTransactionReceipts: 2_000
});

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const BUNDLE_ID = /^[a-f\d]{64}$/i;
const SHA256 = /^[a-f\d]{64}$/i;
const AUTHORITY = Object.freeze({
  sourceAuthentication: "NOT_ESTABLISHED",
  sourceCoverage: "UNKNOWN",
  policyNumeratorEligible: false,
  executionAuthorized: false
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function signatureIsValid(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 88) return false;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_VALUES.get(character);
    if (digit === undefined) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let byteLength = 0;
  while (decoded > 0n) {
    byteLength += 1;
    decoded >>= 8n;
  }
  for (const character of value) {
    if (character !== "1") break;
    byteLength += 1;
  }
  return byteLength === 64;
}

function validSlot(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseResult(identity, responseSha256 = null, expectedSha256Matched = null,
  requestResponseBinding = {status: "UNAVAILABLE", reason: "REQUEST_BYTES_NOT_CAPTURED"}) {
  return {
    status: "DIAGNOSTIC_ONLY",
    diagnosticVersion: JITO_BUNDLE_MEMBERSHIP_DIAGNOSTIC_VERSION,
    identity: identity ?? null,
    responseSha256,
    expectedSha256Matched,
    requestResponseBinding,
    rows: [],
    ...AUTHORITY
  };
}

function unknownRows(result, requestedBundleIds, reason) {
  result.rows = requestedBundleIds.map(bundleId => ({
    bundleId,
    classification: "UNKNOWN",
    reason,
    rawStatus: null,
    rawStatusIndex: null,
    matchedTransactions: []
  }));
  return result;
}

function parseJsonBytes(value, maxBytes) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 ||
      value.byteLength > maxBytes) return null;
  const bytes = new Uint8Array(value);
  try {
    return {bytes, value: JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes))};
  } catch {
    return null;
  }
}

function validIdentity(identity) {
  return isRecord(identity) && identity.chainId === "solana" &&
    isSolanaPublicKey(identity.mint) && isSolanaPublicKey(identity.pool) &&
    isRecord(identity.launchWindow) &&
    validSlot(identity.launchWindow.startInclusive) &&
    validSlot(identity.launchWindow.endInclusive) &&
    identity.launchWindow.endInclusive >= identity.launchWindow.startInclusive;
}

function requestBinding(requestBytes, expectedBundleIds, responseId) {
  if (requestBytes === undefined) {
    return {status: "UNAVAILABLE", reason: "REQUEST_BYTES_NOT_CAPTURED"};
  }
  const parsed = parseJsonBytes(requestBytes, JITO_BUNDLE_DIAGNOSTIC_LIMITS.maxRequestBytes);
  if (!parsed || !isRecord(parsed.value) || parsed.value.jsonrpc !== "2.0" ||
      !["string", "number"].includes(typeof parsed.value.id) ||
      !Number.isSafeInteger(parsed.value.id) && typeof parsed.value.id === "number" ||
      parsed.value.method !== "getBundleStatuses" ||
      !Array.isArray(parsed.value.params) || parsed.value.params.length !== 1 ||
      !Array.isArray(parsed.value.params[0])) {
    return {status: "MISMATCH", reason: "UNSUPPORTED_CAPTURED_REQUEST"};
  }
  const capturedIds = parsed.value.params[0];
  if (parsed.value.id !== responseId) {
    return {status: "MISMATCH", reason: "JSON_RPC_ID_MISMATCH"};
  }
  if (capturedIds.length !== expectedBundleIds.length ||
      capturedIds.some((id, index) => id !== expectedBundleIds[index])) {
    return {status: "MISMATCH", reason: "REQUESTED_BUNDLE_IDS_MISMATCH"};
  }
  return {status: "MATCHED", reason: null};
}

function validSwapReceipt(receipt) {
  return isRecord(receipt) && receipt.status === "DECODED" &&
    receipt.kind === "RAYDIUM_CPMM_SWAP" &&
    receipt.programId === RAYDIUM_CPMM_LAYOUT.programId &&
    isSolanaPublicKey(receipt.mint) && isSolanaPublicKey(receipt.pool) &&
    signatureIsValid(receipt.signature) && validSlot(receipt.slot);
}

function launchHistoryProblem(history, identity) {
  const interval = history?.slotInterval;
  const subject = row => isRecord(row) && row.address === identity.pool &&
    typeof row.source === "string" && row.source.trim().length > 0 &&
    typeof row.evidenceId === "string" && row.evidenceId.trim().length > 0;
  if (!isRecord(history) ||
      history.sourceVersion !== LAUNCH_HISTORY_SOURCE_VERSION ||
      history.commitment !== "finalized" ||
      !Array.isArray(history.transactions) ||
      history.transactions.length > JITO_BUNDLE_DIAGNOSTIC_LIMITS.maxTransactionReceipts ||
      !isRecord(history.coverage) ||
      !validSlot(interval?.startInclusive) || !validSlot(interval?.endInclusive) ||
      interval.endInclusive < interval.startInclusive) {
    return "CANONICAL_SWAP_OR_HISTORY_RECEIPT_INVALID";
  }
  if (interval.startInclusive !== identity.launchWindow.startInclusive ||
      interval.endInclusive !== identity.launchWindow.endInclusive) {
    return "HISTORY_INTERVAL_NOT_PINNED_TO_LAUNCH_WINDOW";
  }
  const declared = Array.isArray(history.declaredSubjects)
    ? history.declaredSubjects.filter(subject) : [];
  const covered = Array.isArray(history.coverage.subjects)
    ? history.coverage.subjects.filter(subject) : [];
  if (declared.length !== 1 || covered.length !== 1) {
    return "POOL_SUBJECT_NOT_UNAMBIGUOUSLY_DECLARED";
  }
  if (declared[0].source !== covered[0].source ||
      declared[0].evidenceId !== covered[0].evidenceId) {
    return "POOL_SUBJECT_COVERAGE_BINDING_MISMATCH";
  }
  return null;
}

function memberTransactions(status) {
  if (!Array.isArray(status.transactions) || status.transactions.length < 1 ||
      status.transactions.length > 5) return null;
  const signatures = status.transactions;
  if (!signatures.every(signatureIsValid) || new Set(signatures).size !== signatures.length) {
    return null;
  }
  return signatures;
}

function successfulStatus(status) {
  return status.confirmation_status === "finalized" &&
    isRecord(status.err) &&
    Object.keys(status.err).length === 1 &&
    Object.hasOwn(status.err, "Ok") && status.err.Ok === null;
}

function rowResult(bundleId, status, statusIndex, reason, matchedTransactions = []) {
  return {
    bundleId,
    classification: reason === null ? "POSITIVE_MATCH" : "UNKNOWN",
    reason,
    processedSlot: validSlot(status?.slot) ? status.slot : null,
    matchedTransactions,
    rawStatus: status,
    rawStatusIndex: statusIndex
  };
}

export function diagnoseJitoBundleMembership({
  rawResponseBytes,
  expectedSha256,
  requestBytes,
  requestedBundleIds,
  identity,
  launchHistory,
  swapReceipts
} = {}) {
  const result = baseResult(identity);
  if (!validIdentity(identity)) return {...result, reason: "INVALID_EXPECTED_IDENTITY"};
  result.identity = {
    chainId: identity.chainId,
    mint: identity.mint,
    pool: identity.pool,
    launchWindow: {
      startInclusive: identity.launchWindow.startInclusive,
      endInclusive: identity.launchWindow.endInclusive
    }
  };
  if (!Array.isArray(requestedBundleIds) ||
      requestedBundleIds.length < 1 ||
      requestedBundleIds.length > JITO_BUNDLE_DIAGNOSTIC_LIMITS.maxBundleIds ||
      !requestedBundleIds.every(id => typeof id === "string" && BUNDLE_ID.test(id)) ||
      new Set(requestedBundleIds).size !== requestedBundleIds.length) {
    return {...result, reason: "INVALID_REQUESTED_BUNDLE_IDS"};
  }
  const historyProblem = launchHistoryProblem(launchHistory, identity);
  if (historyProblem) return unknownRows(result, requestedBundleIds, historyProblem);
  if (!Array.isArray(swapReceipts) ||
      swapReceipts.length > JITO_BUNDLE_DIAGNOSTIC_LIMITS.maxTransactionReceipts) {
    return unknownRows(result, requestedBundleIds, "CANONICAL_SWAP_RECEIPTS_MISSING_OR_OVER_LIMIT");
  }
  if (!(rawResponseBytes instanceof Uint8Array) || rawResponseBytes.byteLength === 0 ||
      rawResponseBytes.byteLength > JITO_BUNDLE_DIAGNOSTIC_LIMITS.maxResponseBytes) {
    return unknownRows(result, requestedBundleIds, "INVALID_OR_BOUNDED_RESPONSE_BYTES");
  }
  if (typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)) {
    return unknownRows(result, requestedBundleIds, "INVALID_EXPECTED_DIGEST");
  }
  const responseBytes = new Uint8Array(rawResponseBytes);
  result.responseSha256 = digest(responseBytes);
  result.expectedSha256Matched = result.responseSha256 === expectedSha256.toLowerCase();
  if (!result.expectedSha256Matched) {
    return unknownRows(result, requestedBundleIds, "RESPONSE_DIGEST_MISMATCH");
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(responseBytes));
  } catch {
    return unknownRows(result, requestedBundleIds, "INVALID_RESPONSE_JSON");
  }
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" ||
      !["string", "number"].includes(typeof payload.id) ||
      typeof payload.id === "number" && !Number.isSafeInteger(payload.id)) {
    return unknownRows(result, requestedBundleIds, "INVALID_RPC_ENVELOPE");
  }
  result.requestResponseBinding = requestBinding(
    requestBytes, requestedBundleIds, payload.id
  );
  if (result.requestResponseBinding.status === "MISMATCH") {
    return unknownRows(result, requestedBundleIds, "REQUEST_RESPONSE_BINDING_MISMATCH");
  }
  if (Object.hasOwn(payload, "error")) {
    return unknownRows(result, requestedBundleIds, "RPC_ERROR");
  }
  const response = payload.result;
  if (!isRecord(response) || !isRecord(response.context) ||
      !validSlot(response.context.slot) || !Array.isArray(response.value)) {
    return unknownRows(result, requestedBundleIds, "UNSUPPORTED_STATUS_RESPONSE_SHAPE");
  }
  if (response.value.length > requestedBundleIds.length) {
    return unknownRows(result, requestedBundleIds, "STATUS_CARDINALITY_MISMATCH");
  }
  const rowsById = new Map();
  const signatureToBundleIds = new Map();
  for (let index = 0; index < response.value.length; index += 1) {
    const status = response.value[index];
    if (status === null) continue;
    if (!isRecord(status) || typeof status.bundle_id !== "string" ||
        !BUNDLE_ID.test(status.bundle_id)) {
      return unknownRows(result, requestedBundleIds, "MALFORMED_UNATTRIBUTED_STATUS");
    }
    if (!requestedBundleIds.includes(status.bundle_id)) {
      return unknownRows(result, requestedBundleIds, "UNKNOWN_BUNDLE_ID_IN_RESPONSE");
    }
    const existing = rowsById.get(status.bundle_id);
    if (existing) {
      return unknownRows(result, requestedBundleIds, "DUPLICATE_BUNDLE_STATUS");
    }
    const signatures = memberTransactions(status);
    if (!signatures) {
      return unknownRows(result, requestedBundleIds, "MALFORMED_STATUS_MEMBERSHIP");
    }
    const entry = {status, index, signatures};
    rowsById.set(status.bundle_id, entry);
    for (const signature of signatures) {
      const bundleIds = signatureToBundleIds.get(signature) ?? new Set();
      bundleIds.add(status.bundle_id);
      signatureToBundleIds.set(signature, bundleIds);
    }
  }
  const swapsBySignature = new Map();
  for (let index = 0; index < swapReceipts.length; index += 1) {
    const receipt = swapReceipts[index];
    if (!isRecord(receipt) || !signatureIsValid(receipt.signature)) continue;
    const entries = swapsBySignature.get(receipt.signature) ?? [];
    entries.push({receipt, index});
    swapsBySignature.set(receipt.signature, entries);
  }
  const historyBySignature = new Map();
  for (let index = 0; index < launchHistory.transactions.length; index += 1) {
    const transaction = launchHistory.transactions[index];
    if (!isRecord(transaction) || !signatureIsValid(transaction.signature)) continue;
    const entries = historyBySignature.get(transaction.signature) ?? [];
    entries.push({transaction, index});
    historyBySignature.set(transaction.signature, entries);
  }

  result.rows = requestedBundleIds.map(bundleId => {
    const entry = rowsById.get(bundleId);
    if (!entry) {
      return rowResult(bundleId, null, null, "MISSING_OR_NULL_STATUS");
    }
    const {status, index, signatures} = entry;
    if (!validSlot(status.slot) || status.slot > response.context.slot) {
      return rowResult(bundleId, status, index, "FUTURE_OR_INVALID_BUNDLE_SLOT");
    }
    if (status.slot < identity.launchWindow.startInclusive ||
        status.slot > identity.launchWindow.endInclusive) {
      return rowResult(bundleId, status, index, "BUNDLE_SLOT_OUTSIDE_LAUNCH_WINDOW");
    }
    if (!successfulStatus(status)) {
      return rowResult(bundleId, status, index, "STATUS_NOT_FINALIZED_SUCCESS");
    }

    const matchedTransactions = [];
    for (const signature of signatures) {
      if ((signatureToBundleIds.get(signature)?.size ?? 0) > 1) {
        return rowResult(bundleId, status, index, "CONFLICTING_BUNDLE_MEMBERSHIP");
      }
      const candidates = swapsBySignature.get(signature) ?? [];
      if (candidates.length > 1) {
        return rowResult(bundleId, status, index, "AMBIGUOUS_SWAP_RECEIPT");
      }
      const candidate = candidates[0];
      const swap = candidate?.receipt;
      if (candidate && (!validSwapReceipt(swap) || swap.mint !== identity.mint ||
          swap.pool !== identity.pool)) {
        return rowResult(bundleId, status, index, "SWAP_RECEIPT_IDENTITY_MISMATCH");
      }
      if (candidate && swap.slot !== status.slot) {
        return rowResult(bundleId, status, index, "SWAP_RECEIPT_SLOT_MISMATCH");
      }
      const historyEntries = historyBySignature.get(signature) ?? [];
      if (historyEntries.length > 1) {
        return rowResult(bundleId, status, index, "AMBIGUOUS_HISTORY_TRANSACTION");
      }
      if (historyEntries.length === 0) {
        if (!candidate) continue;
        return rowResult(bundleId, status, index, "FINALIZED_HISTORY_TRANSACTION_MISSING");
      }
      const {transaction, index: historyTransactionIndex} = historyEntries[0];
      const signatureList = transaction.transaction?.signatures;
      if (transaction.status !== "SUCCESS" || !isRecord(transaction.transaction) ||
          !Array.isArray(signatureList) || signatureList.length < 1 ||
          signatureList.length > 64 || signatureList[0] !== signature ||
          new Set(signatureList).size !== signatureList.length ||
          !signatureList.every(signatureIsValid) ||
          !isRecord(transaction.meta) || transaction.meta.err !== null ||
          (candidate && (!Array.isArray(transaction.subjectAddresses) ||
            !transaction.subjectAddresses.includes(identity.pool)))) {
        return rowResult(bundleId, status, index, "HISTORY_TRANSACTION_NOT_SUCCESSFUL");
      }
      if (!validSlot(transaction.slot) || transaction.slot !== status.slot ||
          transaction.slot < launchHistory.slotInterval.startInclusive ||
          transaction.slot > launchHistory.slotInterval.endInclusive) {
        return rowResult(bundleId, status, index, "TRANSACTION_RECEIPT_SLOT_MISMATCH");
      }
      if (!candidate) continue;
      matchedTransactions.push({
        signature,
        slot: transaction.slot,
        swapReceiptIndex: candidate.index,
        historyTransactionIndex
      });
    }
    if (matchedTransactions.length === 0) {
      return rowResult(bundleId, status, index, "NO_POOL_SPECIFIC_TRANSACTION_RECEIPT");
    }
    return rowResult(bundleId, status, index, null, matchedTransactions);
  });
  return result;
}

