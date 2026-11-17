import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  JITO_BUNDLE_MEMBERSHIP_DIAGNOSTIC_VERSION,
  diagnoseJitoBundleMembership
} from "../scripts/memecoin-paper/jito-bundle-membership-diagnostic.mjs";

const MINT = "So11111111111111111111111111111111111111112";
const POOL = "SysvarRent111111111111111111111111111111111";
const BUNDLE_ID = "a".repeat(64);
const OTHER_BUNDLE_ID = "b".repeat(64);
const SIGNATURE = "1".repeat(64);
const OTHER_SIGNATURE = "2".repeat(64);
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: MINT,
  pool: POOL,
  launchWindow: Object.freeze({startInclusive: 100, endInclusive: 132})
});

function status(overrides = {}) {
  return {
    bundle_id: BUNDLE_ID,
    transactions: [SIGNATURE],
    slot: 120,
    confirmation_status: "finalized",
    err: {Ok: null},
    ...overrides
  };
}

function response(value = [status()], {id = 1, contextSlot = 130} = {}) {
  return Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    result: {context: {slot: contextSlot}, value},
    id
  }));
}

function request(bundleIds = [BUNDLE_ID], id = 1) {
  return Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "getBundleStatuses",
    params: [bundleIds]
  }));
}

function receipt(overrides = {}) {
  return {
    status: "DECODED",
    kind: "RAYDIUM_CPMM_SWAP",
    commitment: "finalized",
    chainId: "solana",
    mint: MINT,
    pool: POOL,
    signature: SIGNATURE,
    slot: 120,
    ...overrides
  };
}

function diagnose(bytes = response(), options = {}) {
  return diagnoseJitoBundleMembership({
    rawResponseBytes: bytes,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    requestBytes: request(),
    requestedBundleIds: [BUNDLE_ID],
    identity: IDENTITY,
    transactionReceipts: [receipt()],
    ...options
  });
}

test("reports a finalized exact-signature pool-swap match with raw provenance only", () => {
  const bytes = response();
  const result = diagnose(bytes);

  assert.equal(result.status, "DIAGNOSTIC_ONLY");
  assert.equal(result.diagnosticVersion, JITO_BUNDLE_MEMBERSHIP_DIAGNOSTIC_VERSION);
  assert.equal(result.requestResponseBinding.status, "MATCHED");
  assert.equal(result.rows[0].classification, "POSITIVE_MATCH");
  assert.equal(result.rows[0].reason, null);
  assert.equal(result.rows[0].rawStatus.bundle_id, BUNDLE_ID);
  assert.equal(result.rows[0].rawStatusIndex, 0);
  assert.deepEqual(result.rows[0].matchedTransactions, [
    {signature: SIGNATURE, slot: 120, receiptIndex: 0}
  ]);
  assert.equal(result.sourceAuthentication, "NOT_ESTABLISHED");
  assert.equal(result.sourceCoverage, "UNKNOWN");
  assert.equal(result.policyNumeratorEligible, false);
  assert.equal(result.executionAuthorized, false);
});

test("a missing pool-specific receipt and mismatched request binding remain unknown", () => {
  const unmatched = diagnose(response(), {transactionReceipts: [receipt({signature: OTHER_SIGNATURE})]});
  assert.equal(unmatched.rows[0].classification, "UNKNOWN");
  assert.equal(unmatched.rows[0].reason, "NO_POOL_SPECIFIC_TRANSACTION_RECEIPT");

  const mismatchedRequest = diagnose(response(), {requestBytes: request([OTHER_BUNDLE_ID])});
  assert.equal(mismatchedRequest.requestResponseBinding.status, "MISMATCH");
  assert.equal(mismatchedRequest.rows[0].reason, "REQUEST_RESPONSE_BINDING_MISMATCH");

  const mismatchedRpcId = diagnose(response(), {requestBytes: request([BUNDLE_ID], 2)});
  assert.equal(mismatchedRpcId.requestResponseBinding.reason, "JSON_RPC_ID_MISMATCH");
  assert.equal(mismatchedRpcId.rows[0].reason, "REQUEST_RESPONSE_BINDING_MISMATCH");
});

test("duplicate status rows and duplicate member signatures are ambiguous", () => {
  const duplicateRows = diagnose(response([
    status(), status({transactions: [OTHER_SIGNATURE]})
  ]), {
    requestedBundleIds: [BUNDLE_ID, OTHER_BUNDLE_ID],
    requestBytes: request([BUNDLE_ID, OTHER_BUNDLE_ID]),
    transactionReceipts: [receipt()]
  });
  assert.equal(duplicateRows.rows[0].reason, "DUPLICATE_BUNDLE_STATUS");
  assert.equal(duplicateRows.rows[0].classification, "UNKNOWN");

  const duplicateSignature = diagnose(response([
    status({transactions: [SIGNATURE, SIGNATURE]})
  ]));
  assert.equal(duplicateSignature.rows[0].reason, "INVALID_OR_DUPLICATE_MEMBER_SIGNATURE");

  const conflictingMembership = diagnose(response([
    status(),
    status({bundle_id: OTHER_BUNDLE_ID})
  ]), {
    requestedBundleIds: [BUNDLE_ID, OTHER_BUNDLE_ID],
    requestBytes: request([BUNDLE_ID, OTHER_BUNDLE_ID]),
    transactionReceipts: [receipt()]
  });
  assert.ok(conflictingMembership.rows.every(row =>
    row.reason === "CONFLICTING_BUNDLE_MEMBERSHIP"));

  const duplicateReceipt = diagnose(response(), {
    transactionReceipts: [receipt(), receipt()]
  });
  assert.equal(duplicateReceipt.rows[0].reason, "AMBIGUOUS_TRANSACTION_RECEIPT");
});

test("future, out-of-window, nonfinalized, and failed statuses are not positive", () => {
  const future = diagnose(response([status({slot: 132})], {contextSlot: 131}));
  assert.equal(future.rows[0].reason, "FUTURE_OR_INVALID_BUNDLE_SLOT");

  const outsideWindow = diagnose(response([status({slot: 133})], {contextSlot: 140}));
  assert.equal(outsideWindow.rows[0].reason, "BUNDLE_SLOT_OUTSIDE_LAUNCH_WINDOW");

  const nonfinalized = diagnose(response([status({confirmation_status: "confirmed"})]));
  assert.equal(nonfinalized.rows[0].reason, "STATUS_NOT_FINALIZED_SUCCESS");

  const failed = diagnose(response([status({err: {Err: {InstructionError: [0, "Custom"]}}})]));
  assert.equal(failed.rows[0].reason, "STATUS_NOT_FINALIZED_SUCCESS");
});

test("digest mismatch, null or truncated absence, and unknown IDs stay unknown", () => {
  const bytes = response();
  const wrongDigest = diagnose(bytes, {expectedSha256: "0".repeat(64)});
  assert.equal(wrongDigest.expectedSha256Matched, false);
  assert.equal(wrongDigest.rows[0].reason, "RESPONSE_DIGEST_MISMATCH");

  const absent = diagnose(response([null]));
  assert.equal(absent.rows[0].reason, "MISSING_OR_NULL_STATUS");

  const truncated = diagnose(response([]));
  assert.equal(truncated.rows[0].reason, "STATUS_CARDINALITY_MISMATCH");

  const unknownId = diagnose(response([status({bundle_id: OTHER_BUNDLE_ID})]));
  assert.equal(unknownId.rows[0].reason, "UNKNOWN_BUNDLE_ID_IN_RESPONSE");
});

test("receipt identity and slot mismatches are unknown", () => {
  const wrongIdentity = diagnose(response(), {
    transactionReceipts: [receipt({pool: "Vote111111111111111111111111111111111111111"})]
  });
  assert.equal(wrongIdentity.rows[0].reason, "TRANSACTION_RECEIPT_IDENTITY_MISMATCH");

  const wrongSlot = diagnose(response(), {transactionReceipts: [receipt({slot: 121})]});
  assert.equal(wrongSlot.rows[0].reason, "TRANSACTION_RECEIPT_SLOT_MISMATCH");
});

test("uncaptured request binding remains unavailable and BAM Explorer gaps are documented", async () => {
  const uncaptured = diagnose(response(), {requestBytes: undefined});
  assert.equal(uncaptured.rows[0].classification, "POSITIVE_MATCH");
  assert.equal(uncaptured.requestResponseBinding.status, "UNAVAILABLE");

  const docs = await readFile(
    new URL("../docs/strategy-lab/memecoin-paper/LAUNCH_HISTORY_EVIDENCE.md", import.meta.url),
    "utf8"
  );
  assert.match(docs, /Direct BAM Ingest|DBI/);
  assert.match(docs, /Bundle Explorer/);
});
