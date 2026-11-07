import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {
  ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS,
  diagnoseAlchemyHolderResponse
} from "../scripts/memecoin-paper/alchemy-holder-diagnostic.mjs";

const MINT = "So11111111111111111111111111111111111111112";
const OWNER_A = "11111111111111111111111111111111";
const OWNER_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const HOLDER_A = "SysvarRent111111111111111111111111111111111";
const HOLDER_B = "SysvarC1ock11111111111111111111111111111111";
const SOURCE_SHAPED_RESPONSE = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    mint: MINT,
    slot: "123",
    sortBy: "balance_desc",
    holders: [{
      holder: HOLDER_A,
      owner: OWNER_A,
      balanceRaw: "974620712305381",
      balanceUi: "974620712.305381"
    }]
  }
};

function row(holder = HOLDER_A, owner = OWNER_A, balanceRaw = "10", balanceUi = "10") {
  return {holder, owner, balanceRaw, balanceUi};
}

function envelope(holders = [row()]) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {mint: MINT, slot: "123", sortBy: "balance_desc", holders}
  };
}

function raw(payload = envelope()) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function diagnose(bytes, options = {}) {
  return diagnoseAlchemyHolderResponse({
    expectedMint: MINT,
    expectedSlot: "123",
    rawBytes: bytes,
    ...options
  });
}

function assertNoAuthority(result) {
  assert.equal(result.completeness, "UNKNOWN");
  assert.equal(result.trust, "UNKNOWN");
  assert.equal(result.censusEligible, false);
  assert.equal(result.executionAuthorized, false);
}

test("validates the documented Alchemy RPC response shape and computes its raw digest", () => {
  const bytes = raw(SOURCE_SHAPED_RESPONSE);
  const result = diagnose(bytes, {
    expectedSha256: createHash("sha256").update(bytes).digest("hex")
  });

  assert.equal(result.status, "DIAGNOSTIC_ONLY");
  assert.equal(result.reason, "CHECKS_MATCH_SOURCE_COMPLETENESS_UNKNOWN");
  assert.equal(result.actualSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.expectedSha256Matched, true);
  assert.equal(result.responseMint, MINT);
  assert.equal(result.responseSlot, "123");
  assert.equal(result.holderRowCount, 1);
  assert.equal(result.uniqueTokenAccountCount, 1);
  assert.equal(result.ownerCount, 1);
  assert.equal(result.observedBalanceRawTotal, "974620712305381");
  assertNoAuthority(result);
});

test("aggregates split token accounts per owner using raw integer balances", () => {
  const result = diagnose(raw(envelope([
    row(HOLDER_A, OWNER_A, "4", "999.5"),
    row(HOLDER_B, OWNER_A, "6", "0.0001"),
    row("Vote111111111111111111111111111111111111111", OWNER_B, "5", "5.000")
  ])));

  assert.equal(result.observedBalanceRawTotal, "15");
  assert.equal(result.ownerCount, 2);
  assert.deepEqual(result.owners, [
    {owner: OWNER_A, balanceRaw: "10"},
    {owner: OWNER_B, balanceRaw: "5"}
  ]);
  assertNoAuthority(result);
});

test("deduplicates identical token-account rows without double counting", () => {
  const result = diagnose(raw(envelope([row(), row()])));

  assert.equal(result.holderRowCount, 2);
  assert.equal(result.uniqueTokenAccountCount, 1);
  assert.equal(result.duplicateRowCount, 1);
  assert.equal(result.observedBalanceRawTotal, "10");
  assertNoAuthority(result);
});

test("rejects conflicting duplicate token-account rows", () => {
  const result = diagnose(raw(envelope([row(), row(HOLDER_A, OWNER_B, "10", "10")])));

  assert.equal(result.reason, "CONFLICTING_DUPLICATE");
  assert.equal(result.owners, null);
  assertNoAuthority(result);
});

test("rejects wrong mint and slot bindings", () => {
  const sameSlotMintSupply = {mint: MINT, slot: "123", supplyRaw: "10"};
  const wrongMint = diagnose(raw({
    ...envelope(), result: {...envelope().result, mint: OWNER_A}
  }), {sameSlotMintSupply});
  const wrongSlot = diagnose(raw({
    ...envelope(), result: {...envelope().result, slot: "124"}
  }), {sameSlotMintSupply});

  assert.equal(wrongMint.reason, "MINT_MISMATCH");
  assert.equal(wrongSlot.reason, "SLOT_MISMATCH");
  assert.deepEqual(wrongMint.supplyComparison, {
    status: "NOT_CHECKED", reason: "RESPONSE_IDENTITY_MISMATCH"
  });
  assert.deepEqual(wrongSlot.supplyComparison, {
    status: "NOT_CHECKED", reason: "RESPONSE_IDENTITY_MISMATCH"
  });
  assertNoAuthority(wrongMint);
  assertNoAuthority(wrongSlot);
});

test("rejects malformed RPC envelopes and provider errors without exposing raw errors", () => {
  const cases = [
    [{jsonrpc: "1.0", id: 1, result: envelope().result}, "INVALID_RPC_ENVELOPE"],
    [{jsonrpc: "2.0", result: envelope().result}, "INVALID_RPC_ENVELOPE"],
    [{jsonrpc: "2.0", id: 1, error: {message: "private provider detail"}}, "RPC_ERROR"],
    [{jsonrpc: "2.0", id: 1, result: {...envelope().result, holders: {}}}, "INVALID_RESULT_SCHEMA"]
  ];

  for (const [payload, reason] of cases) {
    const result = diagnose(raw(payload));
    assert.equal(result.reason, reason);
    assert.equal(JSON.stringify(result).includes("private provider detail"), false);
    assertNoAuthority(result);
  }
});

test("rejects malformed holder schemas, public keys, and non-canonical amounts", () => {
  const cases = [
    [row(HOLDER_A, "not-a-public-key"), "INVALID_HOLDER_ROW"],
    [row(HOLDER_A, OWNER_A, "01"), "INVALID_BALANCE_RAW"],
    [row(HOLDER_A, OWNER_A, "1e2"), "INVALID_BALANCE_RAW"],
    [row(HOLDER_A, OWNER_A, "18446744073709551616"), "INVALID_BALANCE_RAW"],
    [{...row(), extra: "unexpected"}, "INVALID_HOLDER_ROW"],
    [row(HOLDER_A, OWNER_A, "1", 1), "INVALID_HOLDER_ROW"],
    [row(HOLDER_A, OWNER_A, "1", "1e2"), "INVALID_HOLDER_ROW"],
    [row(HOLDER_A, OWNER_A, "1", "-1"), "INVALID_HOLDER_ROW"],
    [row(HOLDER_A, OWNER_A, "1", "1".repeat(129)), "INVALID_HOLDER_ROW"]
  ];

  for (const [holder, reason] of cases) {
    const result = diagnose(raw(envelope([holder])));
    assert.equal(result.reason, reason);
    assertNoAuthority(result);
  }
});

test("accepts only documented holder sort options", () => {
  const descending = diagnose(raw(envelope([row()])));
  const ascending = diagnose(raw({
    ...envelope(), result: {...envelope().result, sortBy: "balance_asc"}
  }));
  const unsupported = diagnose(raw({
    ...envelope(), result: {...envelope().result, sortBy: "balance"}
  }));

  assert.equal(descending.reason, "CHECKS_MATCH_SOURCE_COMPLETENESS_UNKNOWN");
  assert.equal(ascending.reason, "CHECKS_MATCH_SOURCE_COMPLETENESS_UNKNOWN");
  assert.equal(unsupported.reason, "INVALID_RESULT_SCHEMA");
  for (const result of [descending, ascending, unsupported]) assertNoAuthority(result);
});

test("enforces the raw byte boundary before parsing", () => {
  const bytes = Buffer.alloc(ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS.maxResponseBytes + 1, 0x20);
  const result = diagnose(bytes);

  assert.equal(result.reason, "RESPONSE_BYTE_LIMIT");
  assert.equal(result.actualSha256, null);
  assertNoAuthority(result);
});

test("enforces the work boundary independently of the response byte cap", () => {
  const bytes = Buffer.from(`${" ".repeat(ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS.maxWorkUnits)}{}`, "utf8");
  const result = diagnose(bytes);

  assert.ok(bytes.byteLength < ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS.maxResponseBytes);
  assert.equal(result.reason, "WORK_LIMIT");
  assert.equal(result.workUnits, bytes.byteLength);
  assertNoAuthority(result);
});

test("detects the provider row cap and never treats a short response as complete", () => {
  const capRows = Array.from({length: ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS.maxHolderRows}, () => row());
  const capped = diagnose(raw(envelope(capRows)));
  const short = diagnose(raw(envelope([row()])));

  assert.equal(capped.capSaturated, true);
  assert.equal(capped.holderRowCount, ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS.maxHolderRows);
  assert.equal(capped.duplicateRowCount, capped.holderRowCount - 1);
  assert.equal(capped.completeness, "UNKNOWN");
  assert.equal(short.capSaturated, false);
  assert.equal(short.completeness, "UNKNOWN");
  assertNoAuthority(capped);
  assertNoAuthority(short);
});

test("rejects responses with more rows than the fixed row cap", () => {
  const rows = Array.from({length: ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS.maxHolderRows + 1}, () => row());
  const result = diagnose(raw(envelope(rows)));

  assert.equal(result.reason, "ROW_LIMIT");
  assert.equal(result.capSaturated, true);
  assert.equal(result.owners, null);
  assertNoAuthority(result);
});

test("compares optional supply only when mint and slot both match", () => {
  const bytes = raw(envelope([row()]));
  const matching = diagnose(bytes, {
    sameSlotMintSupply: {mint: MINT, slot: 123, supplyRaw: "10"}
  });
  const mismatching = diagnose(bytes, {
    sameSlotMintSupply: {mint: MINT, slot: "123", supplyRaw: "11"}
  });
  const wrongIdentity = diagnose(bytes, {
    sameSlotMintSupply: {mint: OWNER_A, slot: "123", supplyRaw: "10"}
  });
  const missing = diagnose(bytes);

  assert.equal(matching.supplyComparison.status, "MATCH");
  assert.equal(mismatching.supplyComparison.status, "MISMATCH");
  assert.deepEqual(wrongIdentity.supplyComparison, {
    status: "NOT_CHECKED", reason: "SUPPLY_IDENTITY_MISMATCH"
  });
  assert.deepEqual(missing.supplyComparison, {status: "NOT_CHECKED", reason: "NOT_SUPPLIED"});
  for (const result of [matching, mismatching, wrongIdentity, missing]) assertNoAuthority(result);
});

test("detects mutated bytes and rejects a mismatched or malformed supplied digest", () => {
  const original = raw();
  const digest = createHash("sha256").update(original).digest("hex");
  const mutated = Buffer.from(original);
  mutated[mutated.length - 2] ^= 1;
  const result = diagnose(mutated, {expectedSha256: digest});
  const malformed = diagnose(original, {expectedSha256: "not-a-digest"});

  assert.notEqual(result.actualSha256, digest);
  assert.equal(result.expectedSha256Matched, false);
  assert.equal(result.reason, "DIGEST_MISMATCH");
  assert.equal(malformed.reason, "INVALID_EXPECTED_DIGEST");
  assertNoAuthority(result);
  assertNoAuthority(malformed);
});

test("caller-supplied completeness and trust claims never grant authority", () => {
  const result = diagnose(raw(), {
    complete: true,
    completeness: "COMPLETE",
    trust: "VERIFIED",
    censusEligible: true,
    executionAuthorized: true,
    reviewed: true
  });

  assertNoAuthority(result);
});

test("rejects malformed JSON and invalid expected identities without changing authority", () => {
  const malformedJson = diagnose(Buffer.from("{", "utf8"));
  const invalidMint = diagnoseAlchemyHolderResponse({
    expectedMint: "invalid", expectedSlot: "123", rawBytes: raw()
  });
  const invalidSlot = diagnoseAlchemyHolderResponse({
    expectedMint: MINT, expectedSlot: "01", rawBytes: raw()
  });

  assert.equal(malformedJson.reason, "INVALID_JSON");
  assert.equal(invalidMint.reason, "INVALID_EXPECTED_MINT");
  assert.equal(invalidSlot.reason, "INVALID_EXPECTED_SLOT");
  for (const result of [malformedJson, invalidMint, invalidSlot]) assertNoAuthority(result);
});
