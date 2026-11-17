import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  JITO_BUNDLE_MEMBERSHIP_DIAGNOSTIC_VERSION,
  diagnoseJitoBundleMembership
} from "../scripts/memecoin-paper/jito-bundle-membership-diagnostic.mjs";
import {
  acquireLaunchHistory,
  LAUNCH_HISTORY_SOURCE_VERSION,
  SOLANA_RPC_ORIGIN
} from "../scripts/memecoin-paper/launch-history-source.mjs";
import {
  decodeCpmmSuccessfulSwap,
  RAYDIUM_CPMM_LAYOUT
} from "../scripts/memecoin-paper/cpmm-swap-observations.mjs";
import {makeFixture} from "./fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs";

const MINT = "So11111111111111111111111111111111111111112";
const POOL = "SysvarRent111111111111111111111111111111111";
const OTHER_POOL = "SysvarC1ock11111111111111111111111111111111";
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

function swapReceipt(overrides = {}) {
  return {
    status: "DECODED",
    kind: "RAYDIUM_CPMM_SWAP",
    programId: RAYDIUM_CPMM_LAYOUT.programId,
    mint: MINT,
    pool: POOL,
    signature: SIGNATURE,
    slot: 120,
    ...overrides
  };
}

function historyTransaction(overrides = {}) {
  return {
    signature: SIGNATURE,
    slot: 120,
    status: "SUCCESS",
    subjectAddresses: [POOL],
    transaction: {signatures: [SIGNATURE]},
    meta: {err: null},
    ...overrides
  };
}

function launchHistory(transactions = [historyTransaction()]) {
  return {
    sourceVersion: LAUNCH_HISTORY_SOURCE_VERSION,
    source: "Solana JSON-RPC",
    commitment: "finalized",
    declaredSubjects: [{
      address: POOL,
      source: "synthetic fixture",
      evidenceId: "fixture:pool"
    }],
    slotInterval: {startInclusive: 100, endInclusive: 132},
    coverage: {
      complete: false,
      subjects: [{
        address: POOL,
        source: "synthetic fixture",
        evidenceId: "fixture:pool"
      }]
    },
    signatures: [...new Map(transactions.map(transaction => [transaction.signature, {
      signature: transaction.signature,
      slot: transaction.slot,
      err: null,
      errorStatus: null,
      subjectAddresses: transaction.subjectAddresses
    }])).values()],
    transactions
  };
}

function diagnose(bytes = response(), options = {}) {
  return diagnoseJitoBundleMembership({
    rawResponseBytes: bytes,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    requestBytes: request(),
    requestedBundleIds: [BUNDLE_ID],
    identity: IDENTITY,
    launchHistory: launchHistory(),
    swapReceipts: [swapReceipt()],
    ...options
  });
}

async function actualCanonicalInputs() {
  const fixture = makeFixture({buyCount: 1, sellCount: 0, includeBoundaryRows: false});
  const transactionRow = fixture.transactions[0];
  const identity = {
    ...fixture.identity,
    launchWindow: {
      startInclusive: transactionRow.slot,
      endInclusive: transactionRow.slot
    }
  };
  const decodedSwap = decodeCpmmSuccessfulSwap(transactionRow, {
    identity: fixture.identity,
    poolProof: fixture.poolProof
  });
  let observedAt = 1_000;
  const history = await acquireLaunchHistory({
    subjects: [{
      address: fixture.identity.pool,
      source: "synthetic fixture pool",
      evidenceId: "fixture:pool-history"
    }],
    startSlot: transactionRow.slot,
    endSlot: transactionRow.slot,
    transport: async requestValue => {
      assert.equal(requestValue.url, SOLANA_RPC_ORIGIN);
      const requestBody = JSON.parse(requestValue.body);
      let result;
      if (requestBody.method === "getSlot") {
        result = transactionRow.slot + 1;
      } else if (requestBody.method === "getSignaturesForAddress") {
        assert.equal(requestBody.params[0], fixture.identity.pool);
        result = [{
          signature: transactionRow.signature,
          slot: transactionRow.slot,
          blockTime: transactionRow.blockTime,
          err: null
        }];
      } else if (requestBody.method === "getTransaction") {
        assert.equal(requestBody.params[0], transactionRow.signature);
        result = {
          slot: transactionRow.slot,
          blockTime: transactionRow.blockTime,
          version: "legacy",
          transaction: transactionRow.transaction,
          meta: transactionRow.meta
        };
      } else {
        throw new Error(`unexpected RPC method: ${requestBody.method}`);
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: requestBody.id,
        result
      }), {status: 200});
    },
    clock: () => observedAt++
  });
  assert.equal(history.coverage.subjects[0].address, fixture.identity.pool);
  assert.equal(history.transactions[0].status, "SUCCESS");
  assert.equal(decodedSwap.status, "DECODED");
  return {identity, history, decodedSwap, signature: transactionRow.signature};
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
    {
      signature: SIGNATURE,
      slot: 120,
      swapReceiptIndex: 0,
      historyTransactionIndex: 0
    }
  ]);
  assert.equal(result.sourceAuthentication, "NOT_ESTABLISHED");
  assert.equal(result.sourceCoverage, "UNKNOWN");
  assert.equal(result.policyNumeratorEligible, false);
  assert.equal(result.executionAuthorized, false);
});

test("joins actual canonical CPMM decoder output to an acquired finalized launch-history receipt", async () => {
  const {identity, history, decodedSwap, signature} = await actualCanonicalInputs();
  const capturedResponse = response([
    status({transactions: [signature], slot: identity.launchWindow.startInclusive})
  ], {contextSlot: identity.launchWindow.endInclusive + 1});
  const result = diagnoseJitoBundleMembership({
    rawResponseBytes: capturedResponse,
    expectedSha256: createHash("sha256").update(capturedResponse).digest("hex"),
    requestBytes: request(),
    requestedBundleIds: [BUNDLE_ID],
    identity,
    launchHistory: history,
    swapReceipts: [decodedSwap]
  });

  assert.equal(result.rows[0].classification, "POSITIVE_MATCH");
  assert.equal(result.rows[0].matchedTransactions[0].signature, signature);
  assert.deepEqual(history.declaredSubjects.map(subject => subject.address), [identity.pool]);
});

test("a missing pool-specific receipt and mismatched request binding remain unknown", () => {
  const unmatched = diagnose(response(), {
    swapReceipts: [swapReceipt({signature: OTHER_SIGNATURE})]
  });
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
    launchHistory: launchHistory(),
    swapReceipts: [swapReceipt()]
  });
  assert.ok(duplicateRows.rows.every(row =>
    row.reason === "DUPLICATE_BUNDLE_STATUS" && row.classification === "UNKNOWN"));

  const duplicateSignature = diagnose(response([
    status({transactions: [SIGNATURE, SIGNATURE]})
  ]));
  assert.equal(duplicateSignature.rows[0].reason, "MALFORMED_STATUS_MEMBERSHIP");

  const repeatedOversizedList = diagnose(response([
    status({transactions: Array.from({length: 1_000}, () => SIGNATURE)})
  ]));
  assert.ok(repeatedOversizedList.rows.every(row =>
    row.reason === "MALFORMED_STATUS_MEMBERSHIP" && row.classification === "UNKNOWN"));

  const conflictingMembership = diagnose(response([
    status(),
    status({bundle_id: OTHER_BUNDLE_ID})
  ]), {
    requestedBundleIds: [BUNDLE_ID, OTHER_BUNDLE_ID],
    requestBytes: request([BUNDLE_ID, OTHER_BUNDLE_ID]),
    launchHistory: launchHistory(),
    swapReceipts: [swapReceipt()]
  });
  assert.ok(conflictingMembership.rows.every(row =>
    row.reason === "CONFLICTING_BUNDLE_MEMBERSHIP"));

  const duplicateReceipt = diagnose(response(), {
    swapReceipts: [swapReceipt(), swapReceipt()]
  });
  assert.equal(duplicateReceipt.rows[0].reason, "AMBIGUOUS_SWAP_RECEIPT");
});

test("response status rows are joined only by bundle ID, never by array position", () => {
  const partialReordered = diagnose(response([
    null,
    status()
  ]), {
    requestedBundleIds: [BUNDLE_ID, OTHER_BUNDLE_ID],
    requestBytes: request([BUNDLE_ID, OTHER_BUNDLE_ID])
  });
  assert.equal(partialReordered.rows[0].classification, "POSITIVE_MATCH");
  assert.equal(partialReordered.rows[1].reason, "MISSING_OR_NULL_STATUS");

  const extraPlaceholder = diagnose(response([null, status()]));
  assert.equal(extraPlaceholder.rows[0].classification, "UNKNOWN");
  assert.equal(extraPlaceholder.rows[0].reason, "STATUS_CARDINALITY_MISMATCH");
});

test("available history for non-swap bundle members cannot contradict a positive match", () => {
  const memberSignature = "1".repeat(63) + "2";
  const bytes = response([status({transactions: [SIGNATURE, memberSignature]})]);
  const other = historyTransaction({
    signature: memberSignature, transaction: {signatures: [memberSignature]},
    subjectAddresses: [OTHER_POOL]
  });
  assert.equal(diagnose(bytes).rows[0].classification, "POSITIVE_MATCH");
  assert.equal(diagnose(bytes, {
    launchHistory: launchHistory([historyTransaction(), other])
  }).rows[0].matchedTransactions.length, 1);

  for (const [rows, reason] of [
    [[{...other, slot: 121}], "TRANSACTION_RECEIPT_SLOT_MISMATCH"],
    [[{...other, status: "TRANSACTION_NOT_SUCCESSFUL"}], "HISTORY_TRANSACTION_NOT_SUCCESSFUL"],
    [[other, other], "AMBIGUOUS_HISTORY_TRANSACTION"]
  ]) {
    const result = diagnose(bytes, {
      launchHistory: launchHistory([historyTransaction(), ...rows])
    });
    assert.equal(result.rows[0].classification, "UNKNOWN");
    assert.equal(result.rows[0].reason, reason);
  }
});

test("available collector signature records reject failed, conflicting, duplicate, or wrong-slot members", async () => {
  const {identity, history, decodedSwap, signature} = await actualCanonicalInputs();
  const memberSignature = "1".repeat(63) + "2";
  const bytes = response([
    status({
      transactions: [signature, memberSignature],
      slot: identity.launchWindow.startInclusive
    })
  ], {contextSlot: identity.launchWindow.endInclusive + 1});
  const signatureRecord = overrides => ({
    signature: memberSignature,
    slot: identity.launchWindow.startInclusive,
    blockTime: null,
    err: null,
    subjectAddresses: [identity.pool],
    errorStatus: null,
    ...overrides
  });
  const diagnoseHistory = historyOverrides => diagnoseJitoBundleMembership({
    rawResponseBytes: bytes,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    requestBytes: request(),
    requestedBundleIds: [BUNDLE_ID],
    identity,
    launchHistory: {
      ...history,
      ...historyOverrides
    },
    swapReceipts: [decodedSwap]
  });
  const failedMember = diagnoseHistory({
    signatures: [...history.signatures, signatureRecord({
      err: {InstructionError: [0, "Custom"]},
      errorStatus: "FAILED_TRANSACTION"
    })]
  });
  assert.equal(failedMember.rows[0].classification, "UNKNOWN");
  assert.equal(failedMember.rows[0].reason, "HISTORY_SIGNATURE_NOT_SUCCESSFUL");
  assert.equal(failedMember.rows[0].matchedTransactions.length, 0);

  const conflictingMember = diagnoseHistory({
    signatures: [...history.signatures, signatureRecord({
      errorStatus: "CONFLICTING_SIGNATURE_RECORD"
    })]
  });
  assert.equal(conflictingMember.rows[0].reason, "CONFLICTING_HISTORY_SIGNATURE_RECORD");

  const wrongSlot = diagnoseHistory({
    signatures: [...history.signatures, signatureRecord({
      slot: identity.launchWindow.startInclusive + 1
    })]
  });
  assert.equal(wrongSlot.rows[0].reason, "HISTORY_SIGNATURE_SLOT_MISMATCH");

  const duplicateMember = diagnoseHistory({
    signatures: [
      ...history.signatures,
      signatureRecord(),
      signatureRecord({err: {InstructionError: [0, "Custom"]}})
    ]
  });
  assert.equal(duplicateMember.rows[0].reason, "AMBIGUOUS_HISTORY_SIGNATURE");
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
  assert.equal(truncated.rows[0].reason, "MISSING_OR_NULL_STATUS");

  const unknownId = diagnose(response([status({bundle_id: OTHER_BUNDLE_ID})]));
  assert.equal(unknownId.rows[0].reason, "UNKNOWN_BUNDLE_ID_IN_RESPONSE");
});

test("receipt identity and slot mismatches are unknown", () => {
  const wrongIdentity = diagnose(response(), {
    swapReceipts: [swapReceipt({pool: "Vote111111111111111111111111111111111111111"})]
  });
  assert.equal(wrongIdentity.rows[0].reason, "SWAP_RECEIPT_IDENTITY_MISMATCH");

  const wrongSlot = diagnose(response(), {
    launchHistory: launchHistory([historyTransaction({slot: 121})])
  });
  assert.equal(wrongSlot.rows[0].reason, "TRANSACTION_RECEIPT_SLOT_MISMATCH");

  const failedHistoryTransaction = diagnose(response(), {
    launchHistory: launchHistory([
      historyTransaction({status: "TRANSACTION_NOT_SUCCESSFUL"})
    ])
  });
  assert.equal(failedHistoryTransaction.rows[0].reason,
    "HISTORY_TRANSACTION_NOT_SUCCESSFUL");
});

test("history window and declared pool subject must bind the candidate receipt", () => {
  const wrongWindow = diagnose(response(), {
    launchHistory: {
      ...launchHistory(),
      slotInterval: {startInclusive: 99, endInclusive: 132}
    }
  });
  assert.equal(wrongWindow.rows[0].reason, "HISTORY_INTERVAL_NOT_PINNED_TO_LAUNCH_WINDOW");

  const wrongPoolSubject = diagnose(response(), {
    launchHistory: {
      ...launchHistory(),
      declaredSubjects: [{
        address: OTHER_POOL,
        source: "synthetic fixture",
        evidenceId: "fixture:other"
      }],
      coverage: {
        complete: false,
        subjects: [{
          address: OTHER_POOL,
          source: "synthetic fixture",
          evidenceId: "fixture:other"
        }]
      }
    }
  });
  assert.equal(wrongPoolSubject.rows[0].reason, "POOL_SUBJECT_NOT_UNAMBIGUOUSLY_DECLARED");

  const mismatchedPoolEvidence = diagnose(response(), {
    launchHistory: {
      ...launchHistory(),
      coverage: {
        complete: false,
        subjects: [{
          address: POOL,
          source: "different synthetic source",
          evidenceId: "fixture:other-pool-evidence"
        }]
      }
    }
  });
  assert.equal(mismatchedPoolEvidence.rows[0].reason,
    "POOL_SUBJECT_COVERAGE_BINDING_MISMATCH");

  const wrongTransactionSubject = diagnose(response(), {
    launchHistory: launchHistory([historyTransaction({subjectAddresses: [OTHER_POOL]})])
  });
  assert.equal(wrongTransactionSubject.rows[0].reason, "HISTORY_TRANSACTION_NOT_SUCCESSFUL");
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
