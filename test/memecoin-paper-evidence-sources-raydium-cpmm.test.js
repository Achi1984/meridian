import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {
  collectRaydiumCpmmPoolEvidence,
  RAYDIUM_CPMM_LAYOUT
} from "../scripts/memecoin-paper/evidence-sources/raydium-cpmm.mjs";

const RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
const PROGRAM = RAYDIUM_CPMM_LAYOUT.programId;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const NOW = Date.parse("2026-11-02T18:00:00Z");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_VALUES = new Map([...ALPHABET].map((character, index) => [character, index]));
const P = (1n << 255n) - 19n;
const D = mod(-121665n * modPow(121666n, P - 2n, P), P);
const SQRT_MINUS_ONE = modPow(2n, (P - 1n) / 4n, P);
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: encodeBase58(Buffer.alloc(32, 2)),
  pool: encodeBase58(Buffer.alloc(32, 3)),
  quote: encodeBase58(Buffer.alloc(32, 4))
});

function mod(value, modulus) {
  const result = value % modulus;
  return result < 0n ? result + modulus : result;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = mod(base, modulus);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = result * factor % modulus;
    factor = factor * factor % modulus;
    power >>= 1n;
  }
  return result;
}

function decodeBase58(value) {
  let decoded = 0n;
  for (const character of value) decoded = decoded * 58n + BigInt(ALPHABET_VALUES.get(character));
  const bytes = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  bytes.reverse();
  let zeroes = 0;
  while (value[zeroes] === "1") zeroes += 1;
  const significant = zeroes + bytes.length;
  assert.ok(significant <= 32);
  const result = Buffer.alloc(32);
  result.set(bytes, 32 - bytes.length);
  if (zeroes > 0) result.fill(0, 0, zeroes);
  return result;
}

function encodeBase58(bytes) {
  let decoded = 0n;
  for (const byte of bytes) decoded = decoded * 256n + BigInt(byte);
  let result = "";
  while (decoded > 0n) {
    result = ALPHABET[Number(decoded % 58n)] + result;
    decoded /= 58n;
  }
  let zeroes = 0;
  while (bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + result;
}

function leInt(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = value * 256n + BigInt(bytes[index]);
  }
  return value;
}

function isCurvePoint(bytes) {
  const value = Buffer.from(bytes);
  const sign = value[31] >>> 7;
  value[31] &= 0x7f;
  const y = leInt(value);
  if (y >= P) return false;
  const y2 = y * y % P;
  const u = mod(y2 - 1n, P);
  const v = mod(D * y2 + 1n, P);
  if (v === 0n) return false;
  const x2 = u * modPow(v, P - 2n, P) % P;
  let x = modPow(x2, (P + 3n) / 8n, P);
  if (x * x % P !== x2) x = x * SQRT_MINUS_ONE % P;
  return x * x % P === x2 && (x !== 0n || sign === 0);
}

function derivePda(seeds) {
  const program = decodeBase58(PROGRAM);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const bytes = createHash("sha256")
      .update(Buffer.concat([...seeds, Buffer.from([bump]), program,
        Buffer.from("ProgramDerivedAddress")]))
      .digest();
    if (!isCurvePoint(bytes)) return {address: encodeBase58(bytes), bump};
  }
  throw new Error("no PDA fixture");
}

function putKey(bytes, offset, address) {
  decodeBase58(address).copy(bytes, offset);
}

function putOptionKey(bytes, offset, address) {
  bytes.writeUInt32LE(address ? 1 : 0, offset);
  if (address) putKey(bytes, offset + 4, address);
}

function poolFields(identity = IDENTITY) {
  const [token0Mint, token1Mint] = [identity.mint, identity.quote]
    .sort((left, right) => Buffer.compare(decodeBase58(left), decodeBase58(right)));
  const authority = derivePda([Buffer.from("vault_and_lp_mint_auth_seed")]);
  const token0Vault = derivePda([
    Buffer.from("pool_vault"), decodeBase58(identity.pool), decodeBase58(token0Mint)
  ]);
  const token1Vault = derivePda([
    Buffer.from("pool_vault"), decodeBase58(identity.pool), decodeBase58(token1Mint)
  ]);
  const lpMint = derivePda([Buffer.from("pool_lp_mint"), decodeBase58(identity.pool)]);
  return {
    authority,
    token0Mint,
    token1Mint,
    token0Vault: token0Vault.address,
    token1Vault: token1Vault.address,
    token0Program: TOKEN,
    token1Program: TOKEN_2022,
    lpMint: lpMint.address
  };
}

function poolBytes(identity = IDENTITY, overrides = {}) {
  const fields = {...poolFields(identity), ...overrides};
  const bytes = Buffer.alloc(637);
  createHash("sha256").update("account:PoolState").digest().copy(bytes, 0, 0, 8);
  for (const [offset, address] of [
    [8, encodeBase58(Buffer.alloc(32, 5))],
    [40, encodeBase58(Buffer.alloc(32, 6))],
    [72, fields.token0Vault],
    [104, fields.token1Vault],
    [136, fields.lpMint],
    [168, fields.token0Mint],
    [200, fields.token1Mint],
    [232, fields.token0Program],
    [264, fields.token1Program],
    [296, encodeBase58(Buffer.alloc(32, 7))]
  ]) putKey(bytes, offset, address);
  bytes[328] = fields.authority.bump;
  bytes[329] = 0;
  bytes[330] = 9;
  bytes[331] = 6;
  bytes[332] = 9;
  bytes.writeBigUInt64LE(1234n, 333);
  return bytes;
}

function vaultBytes(mint, authority, amount = 100_000n) {
  const bytes = Buffer.alloc(165);
  putKey(bytes, 0, mint);
  putKey(bytes, 32, authority.address);
  bytes.writeBigUInt64LE(amount, 64);
  bytes[108] = 1;
  return bytes;
}

function lpMintBytes(authority) {
  const bytes = Buffer.alloc(82);
  putOptionKey(bytes, 0, authority.address);
  bytes.writeBigUInt64LE(998n, 36);
  bytes[44] = 9;
  bytes[45] = 1;
  return bytes;
}

function account(owner, bytes, overrides = {}) {
  return {
    owner,
    executable: false,
    lamports: 1_000_000,
    data: [bytes.toString("base64"), "base64"],
    ...overrides
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json"}
  });
}

function buildTransport({
  identity = IDENTITY,
  firstPool = poolBytes(identity),
  secondPool = firstPool,
  slot1 = 1_000,
  slot2 = 1_001,
  poolOwner = PROGRAM,
  vault0 = null,
  vault1 = null,
  lpMint = null,
  lpOwner = TOKEN,
  nullAccount = null
} = {}) {
  const fields = poolFields(identity);
  const requests = [];
  const accounts = [
    account(fields.token0Program, vault0 ?? vaultBytes(fields.token0Mint, fields.authority)),
    account(fields.token1Program, vault1 ?? vaultBytes(fields.token1Mint, fields.authority)),
    account(lpOwner, lpMint ?? lpMintBytes(fields.authority))
  ];
  if (Number.isInteger(nullAccount)) accounts[nullAccount] = null;
  const transport = async (request, options) => {
    requests.push({request, options});
    const rpc = JSON.parse(request.body);
    if (request.url !== RPC_ORIGIN || request.credentials !== "omit" ||
        request.redirect !== "error" || options.credentials !== "omit" ||
        options.redirect !== "error") throw new Error("unexpected request policy");
    if (rpc.method === "getAccountInfo") {
      return response({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          context: {slot: slot1},
          value: account(poolOwner, firstPool)
        }
      });
    }
    if (rpc.method === "getMultipleAccounts") {
      assert.deepEqual(rpc.params[0], [
        identity.pool, fields.token0Vault, fields.token1Vault, fields.lpMint
      ]);
      assert.equal(rpc.params[1].commitment, "finalized");
      assert.equal(rpc.params[1].encoding, "base64");
      assert.equal(rpc.params[1].minContextSlot, slot1);
      return response({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          context: {slot: slot2},
          value: [account(poolOwner, secondPool), ...accounts]
        }
      });
    }
    throw new Error("unexpected RPC method");
  };
  return {transport, requests, fields, accounts};
}

async function collect(options = {}) {
  const built = buildTransport(options);
  const result = await collectRaydiumCpmmPoolEvidence({
    identity: options.identity ?? IDENTITY,
    enabled: true,
    transport: built.transport,
    clock: () => NOW,
    ...options.collectOptions
  });
  return {...built, result};
}

test("disabled Raydium decoder performs no request and cannot authorize evidence", async () => {
  let calls = 0;
  const result = await collectRaydiumCpmmPoolEvidence({
    identity: IDENTITY,
    transport: () => { calls += 1; },
    clock: () => { calls += 1; return NOW; }
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(result.networkAccessed, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(calls, 0);
});

test("pinned CPMM pool/vault/LP fields bind exact selected identity and census handoff", async () => {
  const {result, requests, fields} = await collect();
  assert.equal(result.status, "DECODED_UNVERIFIED", result.reasonCode);
  assert.equal(result.identity.mint, IDENTITY.mint);
  assert.equal(result.identity.pool, IDENTITY.pool);
  assert.equal(result.identity.quote, IDENTITY.quote);
  assert.equal(result.pool.programId, PROGRAM);
  assert.equal(result.pool.token0.mint, IDENTITY.mint);
  assert.equal(result.pool.token0.decimals, 6);
  assert.equal(result.pool.token0.programId, TOKEN);
  assert.equal(result.pool.token0.vault.address, fields.token0Vault);
  assert.equal(result.pool.token0.vault.amountAtoms, "100000");
  assert.equal(result.pool.token1.mint, IDENTITY.quote);
  assert.equal(result.pool.token1.decimals, 9);
  assert.equal(result.pool.token1.programId, TOKEN_2022);
  assert.equal(result.pool.lpMint.address, fields.lpMint);
  assert.equal(result.pool.lpMint.supplyAtoms, "998");
  assert.equal(result.pool.lpSupplyAtoms, "1234");
  assert.notEqual(result.pool.lpMint.supplyAtoms, result.pool.lpSupplyAtoms);
  assert.equal(result.pool.poolCreatorMeaning, "Raydium CPMM pool creator; not token developer attribution");
  assert.equal(result.poolExclusionEvidence.status, "DECODED_UNVERIFIED");
  assert.deepEqual(result.ownerCensusHandoff.selectedPoolTokenAccounts, [fields.token0Vault]);
  assert.deepEqual(result.ownerCensusHandoff.burnedTokenAccounts, []);
  assert.equal(result.ownerCensusHandoff.verified, false);
  assert.equal(result.ownerCensusHandoff.coverage.ownerCensusComplete, false);
  assert.equal(result.ownerCensusHandoff.coverage.burnedSupplyExcluded, false);
  assert.equal(result.lpProtection.status, "UNKNOWN");
  assert.equal(result.developerAttribution.status, "UNKNOWN");
  assert.equal(result.ownerConcentration.status, "UNKNOWN");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every(event => /^[a-f0-9]{64}$/.test(event.responseSha256)));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].request.method, "getAccountInfo");
  assert.equal(requests[1].request.method, "getMultipleAccounts");
  assert.ok(requests.every(({request}) => request.url === RPC_ORIGIN));
});

test("the selected token may be token_1 without mixing the quote vault", async () => {
  const reversedIdentity = {
    chainId: "solana",
    mint: IDENTITY.quote,
    pool: IDENTITY.pool,
    quote: IDENTITY.mint
  };
  const {result, fields} = await collect({identity: reversedIdentity});
  assert.equal(result.status, "DECODED_UNVERIFIED", result.reasonCode);
  assert.deepEqual(result.poolExclusionEvidence.value.selectedPoolTokenAccounts, [
    fields.token1Vault
  ]);
  assert.equal(result.poolExclusionEvidence.value.selectedMintVault.mint, reversedIdentity.mint);
  assert.equal(result.poolExclusionEvidence.value.quoteMintVault.mint, reversedIdentity.quote);
});

test("pool account owner, discriminator, length, mint identity, and program are fail-closed", async t => {
  await t.test("wrong program owner", async () => {
    const {result} = await collect({poolOwner: TOKEN});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "POOL_PROGRAM_OWNER_MISMATCH");
  });
  await t.test("unsupported discriminator", async () => {
    const invalid = poolBytes();
    invalid[0] ^= 0xff;
    const {result} = await collect({firstPool: invalid});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "UNSUPPORTED_POOL_LAYOUT");
  });
  await t.test("unsupported layout length", async () => {
    const {result} = await collect({firstPool: Buffer.alloc(638)});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "INVALID_POOL_ACCOUNT");
  });
  await t.test("mint/quote mismatch", async () => {
    const alternate = {...IDENTITY, mint: encodeBase58(Buffer.alloc(32, 8))};
    const {result} = await collect({identity: alternate, firstPool: poolBytes()});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "POOL_TOKEN_IDENTITY_MISMATCH");
  });
  await t.test("unsupported token program", async () => {
    const {authority, ...fields} = poolFields();
    const invalid = poolBytes(IDENTITY, {...fields, token0Program: "11111111111111111111111111111111"});
    const {result} = await collect({firstPool: invalid});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "UNSUPPORTED_POOL_MODEL");
  });
});

test("pool state and returned vault/LP accounts must be bound to canonical PDAs", async t => {
  await t.test("state changes between account reads", async () => {
    const changed = poolBytes();
    changed[329] = 1;
    const {result} = await collect({secondPool: changed});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "POOL_STATE_CHANGED");
  });
  await t.test("wrong vault token-program owner", async () => {
    const {fields} = buildTransport();
    const built = buildTransport({vault0: vaultBytes(IDENTITY.mint, fields.authority)});
    built.transport = async (request, options) => {
      const rpc = JSON.parse(request.body);
      if (rpc.method === "getMultipleAccounts") {
        const valid = await buildTransport({vault0: vaultBytes(IDENTITY.mint, fields.authority)}).transport(request, options);
        const payload = await valid.json();
        payload.result.value[1].owner = TOKEN_2022;
        return response(payload);
      }
      return await buildTransport().transport(request, options);
    };
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY, enabled: true, transport: built.transport, clock: () => NOW
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "VAULT_IDENTITY_MISMATCH");
  });
  await t.test("vault authority mismatch", async () => {
    const {fields} = buildTransport();
    const invalid = vaultBytes(IDENTITY.mint, fields.authority);
    putKey(invalid, 32, encodeBase58(Buffer.alloc(32, 8)));
    const {result} = await collect({vault0: invalid});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "VAULT_AUTHORITY_OR_STATE_MISMATCH");
  });
  await t.test("LP mint authority mismatch", async () => {
    const {fields} = buildTransport();
    const invalid = lpMintBytes(fields.authority);
    putKey(invalid, 4, encodeBase58(Buffer.alloc(32, 8)));
    const {result} = await collect({lpMint: invalid});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "LP_MINT_AUTHORITY_MISMATCH");
  });
  await t.test("missing related account", async () => {
    const {result} = await collect({nullAccount: 1});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "INVALID_RPC_ENVELOPE");
  });
});

test("context slot consistency, response digest, and bounded cancellation are explicit", async t => {
  await t.test("slot skew", async () => {
    const {result} = await collect({slot1: 100, slot2: 20_000});
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "RPC_SLOT_INVALID");
  });
  await t.test("caller abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const built = buildTransport();
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      transport: built.transport,
      clock: () => NOW,
      signal: controller.signal
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "CANCELLED");
    assert.equal(built.requests.length, 0);
  });
  await t.test("abort before queued transport dispatch does not count or issue a request", async () => {
    const controller = new AbortController();
    const built = buildTransport();
    const pending = collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      transport: built.transport,
      clock: () => NOW,
      signal: controller.signal
    });
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "CANCELLED");
    assert.equal(result.counters.requests, 0);
    assert.equal(built.requests.length, 0);
  });
  await t.test("late response body is cancelled after timeout without retry", async () => {
    let resolveTransport;
    let calls = 0;
    let cancelled = false;
    const transportResponse = new Promise(resolve => { resolveTransport = resolve; });
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      clock: () => NOW,
      limits: {requestTimeoutMs: 5},
      transport: () => {
        calls += 1;
        return transportResponse;
      }
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "TIMEOUT");
    assert.equal(result.counters.requests, 1);
    assert.equal(calls, 1);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() { cancelled = true; }
    });
    resolveTransport(new Response(body, {
      headers: {"content-type": "application/json"}
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  });
  await t.test("late response body is cancelled after caller abort without retry", async () => {
    const controller = new AbortController();
    let resolveTransport;
    let calls = 0;
    let cancelled = false;
    const transportResponse = new Promise(resolve => { resolveTransport = resolve; });
    const pending = collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      clock: () => NOW,
      signal: controller.signal,
      transport: () => {
        calls += 1;
        return transportResponse;
      }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "CANCELLED");
    assert.equal(result.counters.requests, 1);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() { cancelled = true; }
    });
    resolveTransport(new Response(body, {
      headers: {"content-type": "application/json"}
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  });
  await t.test("response digest matches the captured byte body", async () => {
    const {result, requests} = await collect();
    const hash = createHash("sha256")
      .update(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: {
          context: {slot: 1001},
          value: [
            account(PROGRAM, poolBytes()),
            account(TOKEN, vaultBytes(IDENTITY.mint, poolFields().authority)),
            account(TOKEN_2022, vaultBytes(IDENTITY.quote, poolFields().authority)),
            account(TOKEN, lpMintBytes(poolFields().authority))
          ]
        }
      }))
      .digest("hex");
    assert.equal(result.poolExclusionEvidence.responseSha256, hash);
    assert.equal(requests.length, 2);
  });
});

test("the final decode boundary checks deadline and rejects backward source time", async t => {
  await t.test("expiry during output construction returns UNKNOWN", async () => {
    let clockReads = 0;
    const {transport} = buildTransport();
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      transport,
      clock: () => NOW + clockReads++ * 30,
      limits: {maxElapsedMs: 500}
    });
    assert.equal(clockReads, 18);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "TIMEOUT");
    assert.equal(result.executionAuthorized, false);
  });
  await t.test("response receipt time cannot precede request time", async () => {
    let clockReads = 0;
    const {transport} = buildTransport();
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      transport,
      clock: () => clockReads++ === 3 ? NOW - 1 : NOW
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "INVALID_CLOCK");
  });
});

test("invalid identity, transport policy, HTTP errors, and limits remain non-authorizing", async t => {
  await t.test("invalid identity", async () => {
    const built = buildTransport();
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: {...IDENTITY, pool: "https://other.example"},
      enabled: true,
      transport: built.transport,
      clock: () => NOW
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "INVALID_IDENTITY");
    assert.equal(built.requests.length, 0);
  });
  await t.test("429 no retry", async () => {
    let calls = 0;
    const result = await collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      clock: () => NOW,
      transport: () => { calls += 1; return response({}, 429); }
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "HTTP_429");
    assert.equal(calls, 1);
  });
  await t.test("oversized limit is refused before transport", async () => {
    let calls = 0;
    await assert.rejects(collectRaydiumCpmmPoolEvidence({
      identity: IDENTITY,
      enabled: true,
      clock: () => NOW,
      transport: () => { calls += 1; },
      limits: {maxResponseBytes: 2_000_000}
    }), /outside the bounded Raydium source limit/);
    assert.equal(calls, 0);
  });
});
