import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireLaunchHistory,
  DEFAULT_LAUNCH_HISTORY_LIMITS,
  SOLANA_RPC_ORIGIN
} from "../scripts/memecoin-paper/launch-history-source.mjs";
import {
  CLASSIC_SPL_TOKEN_PROGRAM_ID,
  LAUNCH_HISTORY_RISK_PREDICATE_VERSION,
  classifyLaunchHistory
} from "../scripts/memecoin-paper/launch-history-classifier.mjs";
import {
  AUTHORITY,
  MINT,
  OTHER_MINT,
  PAGE_ONE,
  PAGE_TWO,
  RECIPIENT,
  TOKEN_ACCOUNT,
  TXIDS,
  initialMintTransaction,
  parsedInstruction,
  parsedTransaction
} from "./fixtures/memecoin-paper-launch-history/rpc-responses.mjs";

const SUBJECT = Object.freeze({
  address: MINT,
  source: "synthetic launch manifest",
  evidenceId: "fixture:mint-subject"
});
const INTERVAL = Object.freeze({startSlot: 95, endSlot: 120});
const BASE_LIMITS = Object.freeze({pageSize: 2});

function rpcResponse(request, {result, error} = {}) {
  const {id} = JSON.parse(request.body);
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    ...(error ? {error} : {result})
  }), {status: 200, headers: {"content-type": "application/json"}});
}

function successfulMintTo(slot, {mint = MINT, account = TOKEN_ACCOUNT, amount = "1"} = {}) {
  return parsedTransaction(slot, [
    parsedInstruction("mintTo", {mint, account, amount, authority: AUTHORITY})
  ]);
}

function defaultTransport({pages = [PAGE_ONE, PAGE_TWO], transaction = signature => {
  if (signature === TXIDS[0]) return initialMintTransaction(120);
  if (signature === TXIDS[1]) return successfulMintTo(110);
  if (signature === TXIDS[2]) return successfulMintTo(100);
  return null;
}} = {}) {
  const calls = [];
  const plannedPages = pages.map((item, index) => Array.isArray(item)
    ? {
      before: index === 0 ? null : pages[index - 1].at(-1)?.signature ?? null,
      result: item
    }
    : item);
  const transport = async request => {
    assert.equal(request.url, SOLANA_RPC_ORIGIN);
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
    assert.equal(request.headers.authorization, undefined);
    const body = JSON.parse(request.body);
    calls.push({method: body.method, params: body.params});
    if (body.method === "getSlot") return rpcResponse(request, {result: 125});
    if (body.method === "getSignaturesForAddress") {
      const before = body.params[1].before;
      const page = plannedPages.find(item => item.before === (before ?? null))?.result ??
        plannedPages.at(-1).result;
      return rpcResponse(request, {result: page});
    }
    if (body.method === "getTransaction") {
      const result = transaction(body.params[0]);
      if (result?.transaction && !Array.isArray(result.transaction.signatures)) {
        result.transaction.signatures = [body.params[0]];
      }
      return rpcResponse(request, {result});
    }
    throw new Error(`unexpected RPC method: ${body.method}`);
  };
  return {transport, calls};
}

function acquire(transport, options = {}) {
  return acquireLaunchHistory({
    subjects: [SUBJECT],
    ...INTERVAL,
    transport,
    clock: () => 1_000,
    limits: {...BASE_LIMITS, ...options.limits},
    ...options
  });
}

test("bounded pagination crosses the inclusive lower slot, retains page boundaries, and retrieves successes", async () => {
  const {transport, calls} = defaultTransport();
  const result = await acquire(transport);

  assert.deepEqual(calls.map(call => call.method), [
    "getSlot",
    "getSignaturesForAddress",
    "getSignaturesForAddress",
    "getTransaction",
    "getTransaction",
    "getTransaction"
  ]);
  assert.deepEqual(calls[1].params[1], {
    limit: 2,
    commitment: "finalized"
  });
  assert.equal(calls[2].params[1].before, TXIDS[1]);
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.coverage.finalizedAnchor, {status: "CAPTURED", slot: 125});
  assert.equal(result.coverage.sourceHistoryCompleteness,
    "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION");
  assert.equal(classifyLaunchHistory({history: result, mint: MINT}).priorRugFinding.status,
    "UNKNOWN");
  assert.equal(result.coverage.scope, "declared-subjects-and-inclusive-slot-interval-only");
  assert.equal(result.coverage.subjects[0].terminationReason, "LOWER_SLOT_BOUND_REACHED");
  assert.deepEqual(result.coverage.subjects[0].pageBoundaries.map(page => [
    page.firstSignature, page.lastSignature, page.signatureCount
  ]), [[TXIDS[0], TXIDS[1], 2], [TXIDS[2], TXIDS[3], 2]]);
  assert.deepEqual(result.transactions.map(item => item.signature), [
    TXIDS[2], TXIDS[1], TXIDS[0]
  ]);
  assert.ok(result.transactions.every(item => item.status === "SUCCESS"));
  assert.equal(result.counters.requests, 6);
  assert.ok(result.events.every(event => event.responseBytes > 0));
});

test("page limits and null signature results preserve incomplete coverage, never a clean negative", async () => {
  const truncatedTransport = defaultTransport().transport;
  const truncated = await acquire(truncatedTransport, {
    limits: {pageSize: 2, maxPagesPerSubject: 1}
  });
  assert.equal(truncated.coverage.complete, false);
  assert.equal(truncated.coverage.subjects[0].terminationReason, "PAGE_LIMIT");
  const truncatedClassification = classifyLaunchHistory({history: truncated, mint: MINT});
  assert.equal(truncatedClassification.priorRugFinding.status, "UNKNOWN");
  assert.equal(truncatedClassification.completenessDecision,
    "INCOMPLETE_HISTORY_CANNOT_SUPPORT_A_CLEAN_NEGATIVE");
  assert.equal(truncatedClassification.creatorOfRecord.status, "OBSERVED");
  assert.equal(truncatedClassification.riskFindings.length, 1);
  assert.equal(truncatedClassification.priorRugFinding.status, "UNKNOWN");

  const nullResult = await acquire(async request => {
    const body = JSON.parse(request.body);
    return rpcResponse(request, {
      result: body.method === "getSlot" ? 125 : null
    });
  });
  assert.equal(nullResult.coverage.complete, false);
  assert.equal(nullResult.coverage.subjects[0].terminationReason, "NULL_RESULT");
  assert.equal(nullResult.coverage.subjects[0].pageBoundaries[0].status, "NULL_RESULT");
});

test("repeated cursors are retained as an incomplete page and never retried", async () => {
  let pageRequests = 0;
  const {transport: base} = defaultTransport();
  const transport = async request => {
    const body = JSON.parse(request.body);
    if (body.method === "getSignaturesForAddress") {
      pageRequests += 1;
      if (pageRequests === 2) {
        return rpcResponse(request, {result: [PAGE_ONE[1], PAGE_TWO[0]]});
      }
    }
    return base(request);
  };
  const result = await acquire(transport);
  assert.equal(pageRequests, 2);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.subjects[0].terminationReason, "REPEATED_CURSOR");
  assert.equal(result.coverage.subjects[0].pageBoundaries[1].status, "REPEATED_CURSOR");
});

test("future interval beyond finalized anchor is incomplete even when history is empty", async () => {
  const methods = [];
  const result = await acquireLaunchHistory({
    subjects: [SUBJECT],
    startSlot: 1_000_000_000,
    endSlot: 1_000_000_100,
    transport: async request => {
      const body = JSON.parse(request.body);
      methods.push(body.method);
      return rpcResponse(request, {result: body.method === "getSlot" ? 999_999_999 : []});
    },
    clock: () => 1_000
  });
  assert.deepEqual(methods, ["getSlot"]);
  assert.equal(result.coverage.finalizedAnchor.slot, 999_999_999);
  assert.equal(result.coverage.subjects[0].terminationReason,
    "END_SLOT_AFTER_FINALIZED_ANCHOR");
  assert.equal(result.coverage.complete, false);
});

test("signature deduplication retains all declared subjects and retrieves a shared transaction once", async () => {
  const shared = {signature: "shared-history-signature", slot: 120, err: null};
  const subjects = [SUBJECT, {
    address: RECIPIENT,
    source: "synthetic account map",
    evidenceId: "fixture:recipient-subject"
  }];
  const {calls, transport: base} = defaultTransport({
    pages: [
      {before: null, result: [shared]},
      {before: null, result: [shared]}
    ],
    transaction: () => initialMintTransaction(120)
  });
  const result = await acquireLaunchHistory({
    subjects,
    ...INTERVAL,
    transport: base,
    clock: () => 1_000,
    limits: {pageSize: 2}
  });
  assert.equal(result.signatures.length, 1);
  assert.deepEqual(result.signatures[0].subjectAddresses, [MINT, RECIPIENT]);
  assert.equal(calls.filter(call => call.method === "getTransaction").length, 1);
});

test("missing and unsupported transaction versions remain explicit incomplete evidence", async () => {
  const missing = await acquire(defaultTransport({
    transaction: signature => signature === TXIDS[0] ? null
      : successfulMintTo(signature === TXIDS[1] ? 110 : 100)
  }).transport);
  assert.equal(missing.transactions.find(item => item.signature === TXIDS[0]).status,
    "MISSING_TRANSACTION");
  assert.equal(missing.coverage.successfulTransactionRetrievalComplete, false);

  const unsupported = await acquire(defaultTransport({
    transaction: signature => signature === TXIDS[0]
      ? parsedTransaction(120, [], {version: 1})
      : successfulMintTo(signature === TXIDS[1] ? 110 : 100)
  }).transport);
  const unsupportedTransaction = unsupported.transactions.find(item => item.signature === TXIDS[0]);
  assert.equal(unsupportedTransaction.status, "UNSUPPORTED_TRANSACTION_VERSION");
  assert.equal(unsupportedTransaction.version, 1);
  assert.equal(unsupported.coverage.complete, false);

  const mismatched = await acquire(defaultTransport({
    transaction: signature => {
      const slot = signature === TXIDS[0] ? 120 : signature === TXIDS[1] ? 110 : 100;
      const result = signature === TXIDS[0]
        ? initialMintTransaction(slot) : successfulMintTo(slot);
      result.transaction.signatures = ["different-transaction-signature"];
      return result;
    }
  }).transport);
  assert.equal(mismatched.transactions.find(item => item.signature === TXIDS[0]).status,
    "INVALID_TRANSACTION");
  assert.equal(mismatched.coverage.complete, false);

  const rpcVersionError = await acquire(async request => {
    const body = JSON.parse(request.body);
    if (body.method === "getSlot") return rpcResponse(request, {result: 125});
    if (body.method === "getSignaturesForAddress") {
      return rpcResponse(request, {result: [PAGE_ONE[0]]});
    }
    return rpcResponse(request, {
      error: {code: -32015, message: "Transaction version (1) is not supported"}
    });
  });
  assert.equal(rpcVersionError.transactions[0].status, "UNSUPPORTED_TRANSACTION_VERSION");
  assert.equal(rpcVersionError.transactions[0].error.code, -32015);
});

test("RPC errors, failed signatures, and absent error fields are not normalized into success", async () => {
  const rpcError = await acquire(async request => {
    const body = JSON.parse(request.body);
    return body.method === "getSlot"
      ? rpcResponse(request, {result: 125})
      : rpcResponse(request, {error: {code: -32000, message: "history unavailable"}});
  });
  assert.equal(rpcError.coverage.subjects[0].terminationReason, "RPC_ERROR");
  assert.equal(rpcError.coverage.subjects[0].pageBoundaries[0].error.message, "history unavailable");

  const failedSignature = {...PAGE_ONE[0], err: {InstructionError: [0, "Custom"]}};
  const failed = await acquire(async request => {
    const body = JSON.parse(request.body);
    if (body.method === "getSlot") return rpcResponse(request, {result: 125});
    return rpcResponse(request, {
      result: body.method === "getSignaturesForAddress" ? [failedSignature] : null
    });
  });
  assert.equal(failed.signatures[0].errorStatus, "FAILED_TRANSACTION");
  assert.equal(failed.transactions.length, 0);

  const missingErrField = {...PAGE_ONE[0]};
  delete missingErrField.err;
  const malformed = await acquire(async request => {
    const body = JSON.parse(request.body);
    return rpcResponse(request, {
      result: body.method === "getSlot" ? 125 : [missingErrField]
    });
  });
  assert.equal(malformed.coverage.subjects[0].terminationReason, "MALFORMED_PAGE");
  assert.equal(malformed.coverage.complete, false);
});

test("initial authority and mint-to facts are attributed only to matching supported instructions", async () => {
  const {transport} = defaultTransport();
  const history = await acquire(transport);
  const result = classifyLaunchHistory({history, mint: MINT});

  assert.equal(result.classifierVersion, "solana-spl-token-attribution-v1");
  assert.equal(result.supportedProgram.programId, CLASSIC_SPL_TOKEN_PROGRAM_ID);
  assert.equal(result.creatorOfRecord.status, "OBSERVED");
  assert.equal(result.creatorOfRecord.authorityAtInitialization, AUTHORITY);
  assert.equal(result.initialMintToObservations.status, "OBSERVED_FACTS_NOT_COMPLETE_SET");
  assert.deepEqual(result.initialMintToObservations.recipients.find(item =>
    item.signature === TXIDS[0]), {
    mint: MINT,
    tokenAccount: TOKEN_ACCOUNT,
    tokenAccountOwner: RECIPIENT,
    amountAtoms: "2500000",
    mintAuthority: AUTHORITY,
    signature: TXIDS[0],
    slot: 120
  });
  assert.ok(result.verifiedRelations.some(relation =>
    relation.relation === "INITIAL_MINT_AUTHORITY" && relation.to === AUTHORITY));
  assert.equal(result.inferredCommonControl.status, "UNKNOWN");
  assert.deepEqual(result.inferredCommonControl.relations, []);
  assert.equal(result.riskFindings[0].predicateVersion, LAUNCH_HISTORY_RISK_PREDICATE_VERSION);
  assert.deepEqual(result.riskFindings[0].evidenceTxids, [TXIDS[0]]);
  assert.equal(result.priorRugFinding.status, "UNKNOWN");
  assert.equal(result.priceDropFinding.status, "NOT_EVALUATED");
});

test("wrong-mint and wrong-program instructions do not create attribution", async () => {
  const {transport} = defaultTransport({
    pages: [{before: null, result: [PAGE_ONE[0]]}],
    transaction: () => parsedTransaction(120, [
      parsedInstruction("initializeMint", {
        mint: OTHER_MINT,
        mintAuthority: AUTHORITY,
        decimals: 6,
        freezeAuthority: null
      }),
      parsedInstruction("initializeMint", {
        mint: MINT,
        mintAuthority: RECIPIENT,
        decimals: 6,
        freezeAuthority: null
      }, "11111111111111111111111111111111"),
      parsedInstruction("mintTo", {
        mint: OTHER_MINT,
        account: TOKEN_ACCOUNT,
        amount: "1",
        authority: AUTHORITY
      })
    ])
  });
  const history = await acquire(transport);
  const result = classifyLaunchHistory({history, mint: MINT});

  assert.equal(result.creatorOfRecord.status, "UNKNOWN");
  assert.deepEqual(result.verifiedRelations, []);
  assert.deepEqual(result.initialMintToObservations.recipients, []);
  assert.deepEqual(result.riskFindings, []);
});

test("same-slot observations remain UNKNOWN for bundles and never infer common control", async () => {
  const first = {signature: TXIDS[0], slot: 120, err: null};
  const second = {signature: TXIDS[1], slot: 120, err: null};
  const {transport} = defaultTransport({
    pages: [
      {before: null, result: [first, second]},
      {before: TXIDS[1], result: [{signature: "same-slot-tail", slot: 90, err: null}]}
    ],
    transaction: signature => signature === TXIDS[0]
      ? initialMintTransaction(120) : successfulMintTo(120, {account: RECIPIENT})
  });
  const history = await acquire(transport, {limits: {pageSize: 2}});
  const result = classifyLaunchHistory({history, mint: MINT});

  assert.equal(result.launchObservations.length, 1);
  assert.deepEqual(result.launchObservations[0].transactionIds, [TXIDS[1], TXIDS[0]]);
  assert.match(result.launchObservations[0].uncertainty, /does not establish one Jito bundle/);
  assert.equal(result.bundleMetric.status, "UNKNOWN");
  assert.equal(result.inferredCommonControl.status, "UNKNOWN");
});

test("subject, source, slot interval, byte, work, and cancellation bounds fail closed", async () => {
  await assert.rejects(acquireLaunchHistory({
    subjects: [{address: MINT, source: "", evidenceId: "x"}],
    ...INTERVAL,
    transport: async () => { throw new Error("must not dispatch"); },
    clock: () => 1_000
  }), /source evidence reference/);
  await assert.rejects(acquireLaunchHistory({
    subjects: [SUBJECT],
    startSlot: 121,
    endSlot: 120,
    transport: async () => { throw new Error("must not dispatch"); },
    clock: () => 1_000
  }), /inclusive slot interval/);

  const oversized = await acquire(async request => new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(request.body).id,
      result: JSON.parse(request.body).method === "getSlot" ? 125 : PAGE_ONE
    }),
    {status: 200}
  ), {limits: {pageSize: 2, maxBytesPerResponse: 24}});
  assert.equal(oversized.coverage.complete, false);
  assert.equal(oversized.coverage.subjects[0].terminationReason, "RESPONSE_TOO_LARGE");

  const workLimited = await acquire(defaultTransport().transport, {
    limits: {pageSize: 2, maxWorkUnits: 1}
  });
  assert.equal(workLimited.coverage.complete, false);
  assert.equal(workLimited.coverage.subjects[0].terminationReason, "WORK_LIMIT");

  const timedOut = await acquire((_request, {signal}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response("{}")), 1_000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("transport aborted"));
    }, {once: true});
  }), {limits: {pageSize: 2, requestTimeoutMs: 10}});
  assert.equal(timedOut.coverage.complete, false);
  assert.equal(timedOut.coverage.subjects[0].terminationReason, "TIMEOUT");

  const elapsedLimited = await acquire(async request => {
    await new Promise(resolve => setTimeout(resolve, 70));
    return rpcResponse(request, {result: []});
  }, {limits: {pageSize: 2, maxDurationMs: 50}});
  assert.equal(elapsedLimited.coverage.complete, false);
  assert.equal(elapsedLimited.coverage.subjects[0].terminationReason, "TIME_LIMIT");

  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const cancelled = await acquire(async () => { calls += 1; }, {signal: controller.signal});
  assert.equal(calls, 0);
  assert.equal(cancelled.coverage.complete, false);
  assert.equal(cancelled.coverage.terminationReason, "CANCELLED");
  assert.equal(DEFAULT_LAUNCH_HISTORY_LIMITS.requestTimeoutMs, 5_000);
});

test("clock failures before request dispatch do not leave timeout rejections or listeners", async () => {
  for (const invalidClockValue of [NaN, () => { throw new Error("clock failed"); }]) {
    let clockCalls = 0;
    const unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    let calls = 0;
    const result = await acquireLaunchHistory({
      subjects: [SUBJECT],
      ...INTERVAL,
      transport: async request => {
        calls += 1;
        return rpcResponse(request, {result: 125});
      },
      clock: () => {
        clockCalls += 1;
        if (clockCalls === 3) {
          if (typeof invalidClockValue === "function") return invalidClockValue();
          return invalidClockValue;
        }
        return 1_000;
      },
      limits: {requestTimeoutMs: 5}
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    process.removeListener("unhandledRejection", onUnhandled);
    assert.equal(calls, 0);
    assert.equal(result.coverage.finalizedAnchor.status, "INVALID_CLOCK");
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(unhandled, []);
  }
});

test("request timeout cancels an active response reader without waiting or retrying", async () => {
  let pageRequests = 0;
  let cancellations = 0;
  const transport = async request => {
    const body = JSON.parse(request.body);
    if (body.method === "getSlot") return rpcResponse(request, {result: 125});
    pageRequests += 1;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `{"jsonrpc":"2.0","id":${body.id},"result":[`
        ));
      },
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancellations += 1;
        return new Promise(() => {});
      }
    });
    return new Response(stream, {status: 200});
  };
  const result = await acquire(transport, {
    limits: {pageSize: 2, requestTimeoutMs: 10}
  });
  assert.equal(pageRequests, 1);
  assert.equal(cancellations, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.subjects[0].terminationReason, "TIMEOUT");
});

test("late response after timeout is cancelled without issuing a retry", async () => {
  let transportCalls = 0;
  let lateBodyCancellations = 0;
  const result = await acquire(async request => {
    transportCalls += 1;
    if (JSON.parse(request.body).method === "getSlot") {
      return rpcResponse(request, {result: 125});
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    return {
      status: 200,
      redirected: false,
      url: SOLANA_RPC_ORIGIN,
      headers: new Headers(),
      body: {
        cancel() {
          lateBodyCancellations += 1;
          return new Promise(() => {});
        }
      }
    };
  }, {limits: {pageSize: 2, requestTimeoutMs: 5}});
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(transportCalls, 2);
  assert.equal(lateBodyCancellations, 1);
  assert.equal(result.coverage.subjects[0].terminationReason, "TIMEOUT");
});
