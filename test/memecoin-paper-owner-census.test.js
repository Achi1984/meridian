import assert from "node:assert/strict";
import test from "node:test";
import {acquireOwnerCensus} from "../scripts/memecoin-paper/owner-census.mjs";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE,
  syntheticCandidate
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";

const NOW = Date.parse("2026-11-02T15:00:00Z");
const LEGACY_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...ALPHABET].map((character, index) => [character, index]));
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: SYNTHETIC_MINT,
  pool: SYNTHETIC_POOL,
  quote: SYNTHETIC_QUOTE
});
const BOUNDS = Object.freeze({
  maxRequests: 1,
  maxResponseBytes: 8_388_608,
  maxAccounts: 20_000,
  maxDecodeWork: 4_000_000,
  maxElapsedMs: 30_000,
  maxSlotSkew: 10,
  maxTimeSkewMs: 30_000,
  maxEvidenceAgeMs: 60_000
});

function decodeBase58(value) {
  let decoded = 0n;
  for (const character of value) decoded = decoded * 58n + BigInt(BASE58_VALUES.get(character));
  const bytes = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  bytes.reverse();
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") zeroes += 1;
  const result = Buffer.alloc(zeroes + bytes.length);
  result.set(bytes, zeroes);
  return result;
}

function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

function key(seed) {
  return encodeBase58(Buffer.alloc(32, seed));
}

function mintEvidence({
  identity = IDENTITY,
  supplyAtoms = "100",
  slot = "100",
  observedAt = NOW,
  programId = LEGACY_TOKEN_PROGRAM,
  extensions = {state: "ABSENT"}
} = {}) {
  return {
    status: "DECODED_UNVERIFIED",
    sourceStatus: "CALLER_INJECTED_RPC_DATA_NOT_AUTHENTICATED",
    authorizationEligible: false,
    hardGateEligible: false,
    binding: {
      expectedMint: identity.mint,
      requestedMint: identity.mint,
      accountPubkey: identity.mint,
      ownerProgram: programId,
      slot,
      observedAt
    },
    mint: {supplyAtoms, initialized: true, decimals: 0},
    extensions
  };
}

function tokenAccount({mint = IDENTITY.mint, owner = key(8), amount = 0n,
  programId = LEGACY_TOKEN_PROGRAM, bytesLength = 165} = {}) {
  const bytes = Buffer.alloc(bytesLength);
  decodeBase58(mint).copy(bytes, 0, 0, 32);
  decodeBase58(owner).copy(bytes, 32, 0, 32);
  bytes.writeBigUInt64LE(BigInt(amount), 64);
  bytes[108] = 1;
  bytes.writeUInt32LE(0, 72);
  bytes.writeUInt32LE(0, 109);
  bytes.writeUInt32LE(0, 129);
  return {
    pubkey: key(30 + Number(amount % 100n)),
    account: {
      owner: programId,
      executable: false,
      data: [bytes.toString("base64"), "base64"]
    }
  };
}

function rpcPayload(accounts, {slot = 100, id = 1} = {}) {
  return {jsonrpc: "2.0", id, result: {context: {slot}, value: accounts}};
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json"}
  });
}

function acquire({
  accounts = [
    tokenAccount({owner: key(8), amount: 40n}),
    tokenAccount({owner: key(8), amount: 10n}),
    tokenAccount({owner: key(9), amount: 50n})
  ],
  supplyAtoms = "100",
  slot = 100,
  mintSlot = "100",
  mintObservedAt = NOW,
  observedAt = NOW,
  programId = LEGACY_TOKEN_PROGRAM,
  extensions = {state: "ABSENT"},
  bounds = BOUNDS,
  transport = async () => response(rpcPayload(accounts, {slot})),
  signal,
  identity = IDENTITY,
  poolExclusionEvidence
} = {}) {
  return acquireOwnerCensus({
    identity,
    manifest: {bounds},
    transport,
    clock: () => observedAt,
    signal,
    mintEvidence: mintEvidence({
      identity,
      supplyAtoms,
      slot: mintSlot,
      observedAt: mintObservedAt,
      programId,
      extensions
    }),
    poolExclusionEvidence
  });
}

test("fixed mint-filtered request reconciles supply and aggregates by actual token-account owner", async () => {
  const requests = [];
  const result = await acquire({
    transport: async (request, options) => {
      requests.push({request, options});
      return response(rpcPayload([
        tokenAccount({owner: key(8), amount: 40n}),
        tokenAccount({owner: key(8), amount: 10n}),
        tokenAccount({owner: key(9), amount: 50n})
      ]));
    }
  });

  assert.equal(requests.length, 1);
  const {request, options} = requests[0];
  assert.equal(request.url, "https://api.mainnet-beta.solana.com");
  assert.equal(request.method, "POST");
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "error");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  const body = JSON.parse(request.body);
  assert.equal(body.method, "getProgramAccounts");
  assert.deepEqual(body.params, [LEGACY_TOKEN_PROGRAM, {
    commitment: "finalized",
    encoding: "base64",
    filters: [{memcmp: {offset: 0, bytes: IDENTITY.mint}}],
    withContext: true
  }]);

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.accountCoverage, "RECONCILED_RPC_RESPONSE_ONLY");
  assert.equal(result.rawCensus.accountCount, 3);
  assert.equal(result.rawCensus.ownerCount, 2);
  assert.equal(result.rawCensus.observedAmountAtoms, "100");
  assert.equal(result.rawCensus.owners.find(item => item.owner === key(8)).amountAtoms, "50");
  assert.equal(result.rawCensus.owners.find(item => item.owner === key(9)).amountAtoms, "50");
  assert.equal(result.coverage.supplyReconciled, true);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.cryptographicCompleteness, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.filterEvidence.verified, false);
});

test("caller PASS, verified flags, and address lists cannot create pool exclusions or reduce owners", async () => {
  const poolOwner = IDENTITY.pool;
  const evidence = {
    status: "PASS",
    verified: true,
    addresses: [poolOwner, key(8)],
    exclusions: ["selected_pool", "burned_supply"],
    pool: poolOwner
  };
  const result = await acquire({
    accounts: [
      tokenAccount({owner: poolOwner, amount: 75n}),
      tokenAccount({owner: key(9), amount: 25n})
    ],
    supplyAtoms: "100",
    poolExclusionEvidence: evidence
  });

  assert.equal(result.exclusionAssessment.status, "UNKNOWN");
  assert.equal(result.exclusionAssessment.suppliedEvidenceIgnored, true);
  assert.deepEqual(result.coverage.exclusions, []);
  assert.equal(result.rawCensus.owners.find(item => item.owner === poolOwner).amountAtoms, "75");
  assert.equal(result.filterEvidence.value, null);
});

test("the existing filter receives only nonverified census evidence and cannot report owner PASS", async () => {
  const result = await acquire();
  const candidate = syntheticCandidate(NOW);
  candidate.source = result.source;
  candidate.evidence.top10OwnerPct = result.filterEvidence;
  const filtered = filterCandidate(candidate, {now: NOW});

  assert.equal(filtered.checks.top10Owners.status, "UNKNOWN");
  assert.equal(filtered.accepted, false);
});

test("unsupported token programs and Token-2022 extensions remain UNKNOWN without dispatch", async () => {
  let calls = 0;
  const unsupported = await acquire({
    programId: key(20),
    transport: async () => { calls += 1; return response(rpcPayload([])); }
  });
  assert.equal(unsupported.reason, "UNSUPPORTED_TOKEN_PROGRAM");
  assert.equal(calls, 0);

  const mintExtension = await acquire({
    programId: TOKEN_2022_PROGRAM,
    extensions: {state: "PRESENT", types: ["TransferFeeConfig"]},
    transport: async () => { calls += 1; return response(rpcPayload([])); }
  });
  assert.equal(mintExtension.reason, "UNSUPPORTED_MINT_EXTENSION");
  assert.equal(calls, 0);
});

test("Token-2022 base accounts are accepted only without unsupported account extensions", async () => {
  const extended = await acquire({
    programId: TOKEN_2022_PROGRAM,
    accounts: [tokenAccount({
      owner: key(8),
      amount: 100n,
      programId: TOKEN_2022_PROGRAM,
      bytesLength: 166
    })]
  });
  assert.equal(extended.status, "UNKNOWN");
  assert.equal(extended.reason, "UNSUPPORTED_ACCOUNT_LAYOUT");

  const plain = await acquire({
    programId: TOKEN_2022_PROGRAM,
    accounts: [tokenAccount({
      owner: key(8),
      amount: 100n,
      programId: TOKEN_2022_PROGRAM
    })]
  });
  assert.equal(plain.accountCoverage, "RECONCILED_RPC_RESPONSE_ONLY");
  assert.equal(plain.rawCensus.owners[0].owner, key(8));
});

test("response byte limit aborts the stream before the complete payload is buffered", async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode(JSON.stringify(rpcPayload([
    tokenAccount({owner: key(8), amount: 100n})
  ])));
  const chunks = [bytes.subarray(0, 100), bytes.subarray(100)];
  const streamedResponse = new Response(new ReadableStream({
    pull(controller) {
      if (chunks.length > 0) controller.enqueue(chunks.shift());
      else return new Promise(() => {});
    },
    cancel() { cancelled = true; }
  }));
  const result = await acquire({
    bounds: {...BOUNDS, maxResponseBytes: 128},
    transport: async () => streamedResponse
  });

  assert.equal(result.reason, "RESPONSE_BYTE_LIMIT");
  assert.equal(result.status, "UNKNOWN");
  assert.equal(cancelled, true);
  assert.ok(result.provenance.responseBytes > 128);
});

test("duplicate token accounts and mismatched mint supply invalidate the whole response", async () => {
  const item = tokenAccount({owner: key(8), amount: 100n});
  const duplicate = await acquire({accounts: [item, item]});
  assert.equal(duplicate.reason, "DUPLICATE_TOKEN_ACCOUNT");
  assert.equal(duplicate.rawCensus, null);

  const mismatch = await acquire({
    accounts: [tokenAccount({owner: key(8), amount: 99n})],
    supplyAtoms: "100"
  });
  assert.equal(mismatch.reason, "SUPPLY_MISMATCH");
  assert.equal(mismatch.rawCensus, null);
});

test("mixed slots and stale mint evidence stay UNKNOWN", async () => {
  const mixed = await acquire({slot: 120, mintSlot: "100"});
  assert.equal(mixed.reason, "SLOT_SKEW");
  assert.equal(mixed.rawCensus, null);

  const stale = await acquire({
    mintObservedAt: NOW - 120_000,
    observedAt: NOW,
    bounds: {...BOUNDS, maxTimeSkewMs: 30_000}
  });
  assert.equal(stale.reason, "TIME_SKEW");
  assert.equal(stale.rawCensus, null);
});

test("cancellation prevents dispatch and replayed identity data is rejected", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const cancelled = await acquire({
    signal: controller.signal,
    transport: async () => { calls += 1; return response(rpcPayload([])); }
  });
  assert.equal(cancelled.reason, "CANCELLED");
  assert.equal(cancelled.provenance.requestCount, 0);
  assert.equal(calls, 0);

  const alternate = {
    ...IDENTITY,
    mint: key(21)
  };
  const replay = await acquire({
    identity: alternate,
    supplyAtoms: "100",
    transport: async () => response(rpcPayload([
      tokenAccount({mint: IDENTITY.mint, owner: key(8), amount: 100n})
    ]))
  });
  assert.equal(replay.reason, "ACCOUNT_MINT_MISMATCH");
  assert.equal(replay.rawCensus, null);
  assert.equal(replay.boundIdentity.mint, alternate.mint);
});

test("active cancellation and elapsed-time timeout stop the single request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = acquire({
    signal: controller.signal,
    transport: async () => {
      calls += 1;
      return new Promise(() => {});
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.reason, "CANCELLED");
  assert.equal(cancelled.provenance.requestCount, 1);
  assert.equal(calls, 1);

  const timeout = await acquire({
    bounds: {...BOUNDS, maxElapsedMs: 10},
    transport: async () => new Promise(() => {})
  });
  assert.equal(timeout.reason, "TIMEOUT");
  assert.equal(timeout.provenance.requestCount, 1);
});

test("malformed program ownership and non-success responses do not retry", async () => {
  let calls = 0;
  const malformed = await acquire({
    accounts: [tokenAccount({owner: key(8), amount: 100n, programId: key(22)})]
  });
  assert.equal(malformed.reason, "MALFORMED_PROGRAM_ACCOUNT");

  const limited = await acquire({
    transport: async () => { calls += 1; return response({}, 429); }
  });
  assert.equal(limited.reason, "RATE_LIMITED");
  assert.equal(calls, 1);
  assert.equal(limited.provenance.requestCount, 1);
});
