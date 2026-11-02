import {createHash} from "node:crypto";

export const LP_PROTECTION_SOURCE_VERSION =
  "raydium-cpmm-lp-protection@3d69122790e97cd6aff24e8ba95940793773f58c";
export const LP_PROTECTION_DECODER_VERSION = "raydium-cpmm-lp-census-v1";
export const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DECIMAL_INTEGER = /^(?:0|[1-9]\d{0,19})$/;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_RUN_BYTES = 2_097_152;
const MAX_ACCOUNTS = 10_000;
const MAX_CLAIMS = 10_000;
const MAX_DURATION_MS = 15_000;
const MAX_REQUEST_MS = 5_000;
const MAX_EVIDENCE_AGE_MS = 5 * 60 * 1000;
const U64_MAX = (1n << 64n) - 1n;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = mod(-121665n * modPow(121666n, ED25519_P - 2n, ED25519_P), ED25519_P);
const ED25519_SQRT_MINUS_ONE = modPow(2n, (ED25519_P - 1n) / 4n, ED25519_P);
const PDA_MARKER = Buffer.from("ProgramDerivedAddress");

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

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
  if (typeof value !== "string" || !BASE58.test(value)) return null;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_VALUES.get(character);
    if (digit === undefined) return null;
    decoded = decoded * 58n + BigInt(digit);
  }
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
  return result.length === 32 ? result : null;
}

function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

function littleEndianInteger(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = value * 256n + BigInt(bytes[index]);
  }
  return value;
}

function isEd25519Point(bytes) {
  const encoded = Buffer.from(bytes);
  const sign = encoded[31] >>> 7;
  encoded[31] &= 0x7f;
  const y = littleEndianInteger(encoded);
  if (y >= ED25519_P) return false;
  const ySquared = y * y % ED25519_P;
  const numerator = mod(ySquared - 1n, ED25519_P);
  const denominator = mod(ED25519_D * ySquared + 1n, ED25519_P);
  if (denominator === 0n) return false;
  const xSquared = numerator * modPow(denominator, ED25519_P - 2n, ED25519_P) % ED25519_P;
  let x = modPow(xSquared, (ED25519_P + 3n) / 8n, ED25519_P);
  if (x * x % ED25519_P !== xSquared) x = x * ED25519_SQRT_MINUS_ONE % ED25519_P;
  return x * x % ED25519_P === xSquared && (x !== 0n || sign === 0);
}

function deriveProgramAddress(seeds, programId) {
  const program = decodeBase58(programId);
  if (!program) throw failure("INVALID_POOL_PROGRAM_ID");
  for (let bump = 255; bump >= 0; bump -= 1) {
    const bytes = createHash("sha256")
      .update(Buffer.concat([...seeds, Buffer.from([bump]), program, PDA_MARKER]))
      .digest();
    if (!isEd25519Point(bytes)) return encodeBase58(bytes);
  }
  throw failure("POOL_PDA_NOT_FOUND");
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
}

function decimalAtoms(value, label) {
  if (typeof value !== "string" || !DECIMAL_INTEGER.test(value)) throw failure(`${label}_INVALID`);
  const amount = BigInt(value);
  if (amount > U64_MAX) throw failure(`${label}_INVALID`);
  return amount;
}

function validateIdentity(identity) {
  if (!isRecord(identity) || identity.chainId !== "solana" ||
      !decodeBase58(identity.mint) || !decodeBase58(identity.pool) || !decodeBase58(identity.quote)) {
    throw failure("INVALID_IDENTITY");
  }
  return Object.freeze({
    chainId: "solana",
    mint: identity.mint,
    pool: identity.pool,
    quote: identity.quote
  });
}

function validatePoolProof(proof, identity, now) {
  if (!isRecord(proof) || proof.status !== "DECODED_UNVERIFIED" ||
      proof.sourceVersion !== "raydium-cp-swap@3d69122790e97cd6aff24e8ba95940793773f58c" ||
      proof.decoderVersion !== "raydium-cpmm-pool-v1" ||
      proof.sourceAuthentication !== "NOT_ESTABLISHED" ||
      proof.identity?.chainId !== identity.chainId || proof.identity?.mint !== identity.mint ||
      proof.identity?.pool !== identity.pool || proof.identity?.quote !== identity.quote ||
      proof.pool?.address !== identity.pool || proof.pool?.programId !== RAYDIUM_CPMM_PROGRAM_ID ||
      proof.poolExclusionEvidence?.status !== "DECODED_UNVERIFIED" ||
      proof.poolExclusionEvidence?.verified !== false ||
      proof.poolExclusionEvidence?.source !== "Solana JSON-RPC getMultipleAccounts" ||
      proof.poolExclusionEvidence?.identity?.chainId !== identity.chainId ||
      proof.poolExclusionEvidence?.identity?.mint !== identity.mint ||
      proof.poolExclusionEvidence?.identity?.pool !== identity.pool ||
      proof.poolExclusionEvidence?.identity?.quote !== identity.quote ||
      proof.poolExclusionEvidence?.sourceVersion !== proof.sourceVersion ||
      proof.poolExclusionEvidence?.decoderVersion !== proof.decoderVersion ||
      proof.poolExclusionEvidence?.responseSha256 !== proof.pool?.responseSha256 ||
      !/^[a-f0-9]{64}$/.test(proof.pool?.poolStateSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(proof.pool?.responseSha256 ?? "") ||
      !Number.isSafeInteger(proof.slot) || proof.slot < 0 ||
      proof.poolExclusionEvidence?.slot !== proof.slot ||
      !validTime(proof.observedAt) || proof.poolExclusionEvidence?.observedAt !== proof.observedAt ||
      now < proof.observedAt || now - proof.observedAt > MAX_EVIDENCE_AGE_MS) {
    throw failure("POOL_PROOF_NOT_BOUND");
  }
  const lpMint = proof.pool?.lpMint;
  const lpSupply = proof.pool?.lpSupplyAtoms;
  const tokenMints = [proof.pool?.token0?.mint, proof.pool?.token1?.mint];
  const expectedLpMint = deriveProgramAddress([
    Buffer.from("pool_lp_mint"),
    decodeBase58(identity.pool)
  ], RAYDIUM_CPMM_PROGRAM_ID);
  const expectedMintAuthority = deriveProgramAddress([
    Buffer.from("vault_and_lp_mint_auth_seed")
  ], RAYDIUM_CPMM_PROGRAM_ID);
  if (!isRecord(lpMint) || !decodeBase58(lpMint.address) ||
      lpMint.address !== expectedLpMint ||
      lpMint.tokenProgram !== TOKEN_PROGRAM || lpMint.decimals !== 9 ||
      lpMint.mintAuthority !== expectedMintAuthority ||
      proof.pool.lpMintDecimals !== 9 ||
      tokenMints.some(mint => !decodeBase58(mint)) ||
      new Set(tokenMints).size !== 2 ||
      !tokenMints.includes(identity.mint) || !tokenMints.includes(identity.quote) ||
      Buffer.compare(decodeBase58(tokenMints[0]), decodeBase58(tokenMints[1])) >= 0 ||
      proof.pool.lpSupplyMeaning !==
        "PoolState counter only; not evidence of LP burn, lock, or holder distribution" ||
      typeof lpMint.supplyAtoms !== "string" || !DECIMAL_INTEGER.test(lpMint.supplyAtoms) ||
      typeof lpSupply !== "string" || !DECIMAL_INTEGER.test(lpSupply)) {
    throw failure("LP_MINT_PROOF_INVALID");
  }
  const supply = decimalAtoms(lpMint.supplyAtoms, "LP_MINT_SUPPLY");
  const denominator = decimalAtoms(lpSupply, "POOL_LP_SUPPLY");
  if (supply > denominator || denominator === 0n) throw failure("LP_SUPPLY_CONTEXT_MISMATCH");
  return {lpMint, supply, denominator};
}

function readAccountData(account, expectedMint, address) {
  if (!isRecord(account) || account.owner !== TOKEN_PROGRAM || account.executable === true ||
      !Array.isArray(account.data) || account.data.length !== 2 ||
      account.data[1] !== "base64" || typeof account.data[0] !== "string") {
    throw failure("LP_TOKEN_ACCOUNT_INVALID");
  }
  const encoded = account.data[0];
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 165 || bytes.toString("base64") !== encoded) {
    throw failure("LP_TOKEN_ACCOUNT_INVALID");
  }
  const mint = encodeBase58(bytes.subarray(0, 32));
  const authorityBytes = bytes.subarray(32, 64);
  const authority = encodeBase58(authorityBytes);
  const amount = bytes.readBigUInt64LE(64);
  const state = bytes[108];
  if (mint !== expectedMint || !decodeBase58(address) || !decodeBase58(authority) ||
      (state !== 1 && state !== 2)) {
    throw failure("LP_TOKEN_ACCOUNT_IDENTITY_MISMATCH");
  }
  return {
    address,
    authority,
    amountAtoms: amount.toString(),
    authorityKind: isEd25519Point(authorityBytes) ? "SIGNER_ADDRESS" : "PROGRAM_CUSTODY_UNKNOWN",
    accountState: state === 1 ? "INITIALIZED" : "FROZEN"
  };
}

function validateClaimAnnotations(
  {lockClaims = [], burnClaims = []}, accountAddresses, lpMint, holdUntil, now, slot
) {
  if (!Array.isArray(lockClaims) || lockClaims.length > MAX_CLAIMS ||
      !Array.isArray(burnClaims) || burnClaims.length > MAX_CLAIMS ||
      !validTime(holdUntil) || holdUntil <= now) {
    throw failure("CLAIM_ANNOTATION_INVALID");
  }
  const lockIds = new Set();
  const locks = lockClaims.map(claim => {
    if (!isRecord(claim) || !decodeBase58(claim.tokenAccount) ||
        !accountAddresses.has(claim.tokenAccount) || lockIds.has(claim.tokenAccount) ||
        !validTime(claim.lockedUntil)) {
      throw failure(lockIds.has(claim?.tokenAccount) ? "DUPLICATE_LOCK_CLAIM" : "LOCK_CLAIM_INVALID");
    }
    lockIds.add(claim.tokenAccount);
    return {
      tokenAccount: claim.tokenAccount,
      lockedUntil: claim.lockedUntil,
      status: claim.lockedUntil < holdUntil ? "EARLY_UNLOCK" : "UNSUPPORTED_LOCK_SEMANTICS",
      countedProtectedAtoms: "0"
    };
  });
  const burnIds = new Set();
  const burns = burnClaims.map(claim => {
    if (!isRecord(claim) || typeof claim.signature !== "string" ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(claim.signature) ||
        burnIds.has(claim.signature) ||
        !Number.isSafeInteger(claim.slot) || claim.slot < 0 || claim.slot > slot ||
        claim.mint !== lpMint ||
        typeof claim.amountAtoms !== "string" || !DECIMAL_INTEGER.test(claim.amountAtoms)) {
      throw failure(burnIds.has(claim?.signature) ? "DUPLICATE_BURN_EVIDENCE" : "BURN_CLAIM_INVALID");
    }
    burnIds.add(claim.signature);
    return {
      signature: claim.signature,
      amountAtoms: decimalAtoms(claim.amountAtoms, "BURN_CLAIM_AMOUNT").toString(),
      status: "UNVERIFIED_HISTORICAL_BURN_NOT_ADDED_TO_CURRENT_SUPPLY",
      countedProtectedAtoms: "0"
    };
  });
  return {locks, burns};
}

async function raceWithAbort(promise, signal) {
  if (signal?.aborted) throw failure("CANCELLED");
  if (!signal) return promise;
  let listener;
  const aborted = new Promise((_, reject) => {
    listener = () => reject(failure("CANCELLED"));
    signal.addEventListener("abort", listener, {once: true});
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

async function readBody(response, {signal, maxBytes, consumeBytes}) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw failure("RESPONSE_STREAM_MISSING");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await raceWithAbort(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw failure("RESPONSE_CHUNK_INVALID");
      total += value.byteLength;
      consumeBytes(value.byteLength);
      if (total > maxBytes) throw failure("RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function requestJson(method, params, id, {
  transport, signal, requestAt, timeoutMs, consumeBytes
}) {
  const request = Object.freeze({
    id,
    kind: method,
    url: RPC_URL,
    method: "POST",
    headers: Object.freeze({accept: "application/json", "content-type": "application/json"}),
    body: JSON.stringify({jsonrpc: "2.0", id, method, params}),
    redirect: "error",
    credentials: "omit"
  });
  const controller = new AbortController();
  const parentAbort = () => controller.abort();
  signal?.addEventListener("abort", parentAbort, {once: true});
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await raceWithAbort(Promise.resolve(transport(request, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit"
    })), controller.signal);
    if (controller.signal.aborted) throw failure(signal?.aborted ? "CANCELLED" : "TIMEOUT");
    if (response?.redirected === true || (response?.url && (() => {
      let returned;
      try { returned = new URL(response.url); } catch { return true; }
      const expected = new URL(RPC_URL);
      return returned.origin !== expected.origin || returned.pathname !== expected.pathname ||
        returned.search !== "" || returned.hash !== "" ||
        returned.username !== "" || returned.password !== "";
    })())) {
      throw failure("RESPONSE_ORIGIN_INVALID");
    }
    if (response?.status !== 200) throw failure(`HTTP_${response?.status ?? "INVALID"}`);
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw failure("RESPONSE_CONTENT_TYPE_INVALID");
    const contentLength = response.headers?.get?.("content-length");
    if (contentLength !== null && contentLength !== undefined &&
        (!/^(?:0|[1-9]\d*)$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
      throw failure("RESPONSE_TOO_LARGE");
    }
    const bytes = await readBody(response, {
      signal: controller.signal,
      maxBytes: MAX_RESPONSE_BYTES,
      consumeBytes
    });
    let payload;
    try { payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); } catch {
      throw failure("RESPONSE_JSON_INVALID");
    }
    if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== id ||
        payload.error || !isRecord(payload.result)) {
      throw failure("RESPONSE_ENVELOPE_INVALID");
    }
    return {
      payload,
      responseSha256: sha256(bytes),
      responseBytes: bytes.length,
      requestedAt: requestAt
    };
  } catch (error) {
    if (signal?.aborted) throw failure("CANCELLED");
    if (controller.signal.aborted) throw failure("TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", parentAbort);
  }
}

function unknownResult(identity, code, events = [], counters = {requests: 0, bytes: 0}) {
  return {
    status: "UNKNOWN",
    reasonCode: code,
    sourceVersion: LP_PROTECTION_SOURCE_VERSION,
    decoderVersion: LP_PROTECTION_DECODER_VERSION,
    sourceAuthentication: "NOT_ESTABLISHED",
    clockTrust: "INJECTED_LOCAL_CLOCK_UNVERIFIED",
    networkAccessed: counters.requests > 0,
    identity: identity ?? null,
    events,
    counters,
    lpProtection: {
      status: "UNKNOWN",
      reason: "pool-specific withdrawal protection is not semantically verified",
      verified: false,
      review: null,
      value: null
    },
    executionAuthorized: false,
    realDataEntryEligible: false
  };
}

export async function collectLpProtectionSource({
  identity: inputIdentity,
  poolProof,
  enabled = false,
  transport,
  clock,
  signal,
  holdUntil,
  lockClaims,
  burnClaims
} = {}) {
  if (enabled !== true) {
    return {
      status: "DISABLED",
      networkAccessed: false,
      sourceVersion: LP_PROTECTION_SOURCE_VERSION,
      decoderVersion: LP_PROTECTION_DECODER_VERSION,
      events: [],
      counters: {requests: 0, bytes: 0},
      lpProtection: {status: "UNKNOWN", reason: "source is disabled", verified: false},
      executionAuthorized: false,
      realDataEntryEligible: false
    };
  }
  if (typeof transport !== "function" || typeof clock !== "function") {
    throw new TypeError("enabled LP source requires injected transport and clock");
  }
  const identity = validateIdentity(inputIdentity);
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")) {
    throw new TypeError("signal must be an AbortSignal");
  }
  const counters = {requests: 0, bytes: 0};
  const events = [];
  let started;
  try { started = clock(); } catch {
    return unknownResult(identity, "LOCAL_CLOCK_INVALID", events, counters);
  }
  if (!validTime(started)) return unknownResult(identity, "LOCAL_CLOCK_INVALID", events, counters);
  const startedMonotonicAt = performance.now();
  const consumeBytes = bytes => {
    counters.bytes += bytes;
    if (counters.bytes > MAX_RUN_BYTES) throw failure("RUN_RESPONSE_TOO_LARGE");
  };
  const request = async (method, params) => {
    if (signal?.aborted) throw failure("CANCELLED");
    const requestAt = clock();
    if (counters.requests >= 2 || !validTime(requestAt) ||
        requestAt - started > MAX_DURATION_MS ||
        performance.now() - startedMonotonicAt > MAX_DURATION_MS) {
      throw failure("TIMEOUT");
    }
    counters.requests += 1;
    const id = counters.requests;
    const result = await requestJson(method, params, id, {
      transport,
      signal,
      requestAt,
      timeoutMs: MAX_REQUEST_MS,
      consumeBytes
    });
    const receivedAt = clock();
    if (!validTime(receivedAt) || receivedAt < requestAt || receivedAt - started > MAX_DURATION_MS ||
        performance.now() - startedMonotonicAt > MAX_DURATION_MS) {
      throw failure("TIMEOUT");
    }
    events.push({
      requestId: id,
      method,
      endpoint: RPC_URL,
      requestedAt: requestAt,
      receivedAt,
      responseBytes: result.responseBytes,
      responseSha256: result.responseSha256,
      slot: result.payload.result.context?.slot ?? null,
      commitment: "finalized"
    });
    return result.payload.result;
  };

  try {
    const now = clock();
    if (!validTime(now)) throw failure("LOCAL_CLOCK_INVALID");
    const {lpMint, supply: proofSupply, denominator} = validatePoolProof(poolProof, identity, now);
    if (!validTime(holdUntil) || holdUntil <= now) throw failure("HOLD_WINDOW_INVALID");
    const supplyResult = await request("getTokenSupply", [
      lpMint.address,
      {commitment: "finalized", minContextSlot: poolProof.slot}
    ]);
    const supplySlot = supplyResult.context?.slot;
    const supplyValue = supplyResult.value;
    if (!Number.isSafeInteger(supplySlot) || supplySlot !== poolProof.slot ||
        !isRecord(supplyValue) || supplyValue.decimals !== 9 ||
        typeof supplyValue.amount !== "string" || !DECIMAL_INTEGER.test(supplyValue.amount)) {
      throw failure("SUPPLY_CONTEXT_MISMATCH");
    }
    const supply = decimalAtoms(supplyValue.amount, "LP_MINT_SUPPLY");
    if (supply !== proofSupply) throw failure("LP_MINT_SUPPLY_CHANGED");

    const accountsResult = await request("getProgramAccounts", [
      TOKEN_PROGRAM,
      {
        commitment: "finalized",
        encoding: "base64",
        withContext: true,
        minContextSlot: poolProof.slot,
        filters: [{memcmp: {offset: 0, bytes: lpMint.address}}]
      }
    ]);
    const accountsSlot = accountsResult.context?.slot;
    const values = accountsResult.value;
    if (!Number.isSafeInteger(accountsSlot) || accountsSlot !== poolProof.slot ||
        !Array.isArray(values) || values.length > MAX_ACCOUNTS) {
      throw failure("ACCOUNT_CENSUS_CONTEXT_INVALID");
    }
    const accounts = [];
    const addresses = new Set();
    let accountAtoms = 0n;
    let signerAtoms = 0n;
    let custodyAtoms = 0n;
    let frozenAtoms = 0n;
    for (const item of values) {
      if (!isRecord(item) || addresses.has(item.pubkey)) throw failure("DUPLICATE_LP_TOKEN_ACCOUNT");
      const account = readAccountData(item.account, lpMint.address, item.pubkey);
      addresses.add(account.address);
      const amount = BigInt(account.amountAtoms);
      accountAtoms += amount;
      if (account.accountState === "FROZEN") frozenAtoms += amount;
      else if (account.authorityKind === "SIGNER_ADDRESS") signerAtoms += amount;
      else custodyAtoms += amount;
      accounts.push(account);
      if (accountAtoms > U64_MAX) throw failure("LP_ACCOUNT_SUM_OVERFLOW");
    }
    if (accountAtoms !== supply) throw failure("LP_ACCOUNT_SUPPLY_MISMATCH");
    const claims = validateClaimAnnotations(
      {lockClaims, burnClaims}, addresses, lpMint.address, holdUntil, now, poolProof.slot
    );
    const gap = denominator - supply;
    const observedAt = events.at(-1)?.receivedAt ?? now;
    const coverage = {
      complete: true,
      finalizedAccountSnapshot: true,
      exactContextSlot: true,
      accountSetBoundToLpMint: true,
      accountBalancesReconcileToMintSupply: true,
      denomination: "raw LP base units",
      denominatorAtoms: denominator.toString(),
      currentMintSupplyAtoms: supply.toString(),
      accountBalancesAtoms: accountAtoms.toString(),
      signerAddressAtoms: signerAtoms.toString(),
      potentiallyUnprotectedAtoms: signerAtoms.toString(),
      unknownProtectionAtoms: (denominator - signerAtoms).toString(),
      programCustodyUnknownAtoms: custodyAtoms.toString(),
      frozenAccountAtoms: frozenAtoms.toString(),
      poolCounterMinusMintSupplyAtoms: gap.toString(),
      actualBurnAtoms: null,
      actualBurnEvidenceStatus: "UNAVAILABLE; no transaction-bound burn proof is consumed",
      protectedAtoms: null,
      protectedPct: null,
      protectionPolicy: "FULL_COVERAGE_ONLY; no partial threshold accepted",
      historicalBurnsIncludedInCurrentSupply: false,
      historicalBurnClaimsCountedAtoms: "0",
      lockClaimsCountedAtoms: "0",
      poolCounterGapClassification: "UNKNOWN; pinned source includes a 100-unit initialization reserve and deployment semantics are unverified",
      protectionSemanticsReviewed: false,
      sourceAuthenticated: false
    };
    const lpProtection = {
      schema: "RAYDIUM_CPMM_LP_PROTECTION_V1",
      status: "UNKNOWN",
      source: "Solana JSON-RPC",
      sourceVersion: LP_PROTECTION_SOURCE_VERSION,
      decoderVersion: LP_PROTECTION_DECODER_VERSION,
      identity,
      observedAt,
      slot: poolProof.slot,
      responseSha256: events.map(event => event.responseSha256),
      poolProof: {
        sourceVersion: poolProof.sourceVersion,
        decoderVersion: poolProof.decoderVersion,
        slot: poolProof.slot,
        observedAt: poolProof.observedAt,
        poolStateSha256: poolProof.pool.poolStateSha256,
        responseSha256: poolProof.pool.responseSha256
      },
      verified: false,
      review: null,
      coverage,
      value: {
        pool: identity.pool,
        model: "unverified",
        denominatorAtoms: denominator.toString(),
        protectedAtoms: null,
        signerAddressAtoms: signerAtoms.toString(),
        potentiallyUnprotectedAtoms: signerAtoms.toString(),
        unknownProtectionAtoms: (denominator - signerAtoms).toString(),
        programCustodyUnknownAtoms: custodyAtoms.toString(),
        frozenAccountAtoms: frozenAtoms.toString(),
        noncirculatingPoolCounterAtoms: gap.toString()
      },
      reason: "exact balances are measured, but source-only withdrawal rules and unreviewed custody do not prove an irreversible lock or deployed-binary match"
    };
    return {
      status: "MEASURED_UNVERIFIED",
      reasonCode: "PROTECTION_SEMANTICS_UNVERIFIED",
      sourceVersion: LP_PROTECTION_SOURCE_VERSION,
      decoderVersion: LP_PROTECTION_DECODER_VERSION,
      sourceAuthentication: "NOT_ESTABLISHED",
      clockTrust: "INJECTED_LOCAL_CLOCK_UNVERIFIED",
      networkAccessed: true,
      identity,
      observedAt,
      slot: poolProof.slot,
      events,
      counters,
      accounts,
      claims,
      measurement: {
        denominatorAtoms: denominator.toString(),
        currentMintSupplyAtoms: supply.toString(),
        accountBalancesAtoms: accountAtoms.toString(),
        signerAddressAtoms: signerAtoms.toString(),
        potentiallyUnprotectedAtoms: signerAtoms.toString(),
        unknownProtectionAtoms: (denominator - signerAtoms).toString(),
        programCustodyUnknownAtoms: custodyAtoms.toString(),
        frozenAccountAtoms: frozenAtoms.toString(),
        poolCounterMinusMintSupplyAtoms: gap.toString(),
        actualBurnAtoms: null,
        actualBurnEvidenceStatus: "UNAVAILABLE; no transaction-bound burn proof is consumed",
        protectedAtoms: null,
        protectedPct: null,
        coverage
      },
      lpProtection,
      adapterEvidence: {
        identity,
        binding: identity,
        observedAt,
        slot: poolProof.slot,
        source: "Solana JSON-RPC",
        sourceVersion: LP_PROTECTION_SOURCE_VERSION,
        decoderVersion: LP_PROTECTION_DECODER_VERSION,
        coverage,
        review: null,
        verified: false,
        value: lpProtection.value
      },
      executionAuthorized: false,
      realDataEntryEligible: false
    };
  } catch (error) {
    const code = error?.code ?? (signal?.aborted ? "CANCELLED" : "SOURCE_DECODE_FAILED");
    return unknownResult(identity, code, events, counters);
  }
}
