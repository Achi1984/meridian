import {createHash} from "node:crypto";
import {setImmediate as yieldToLoop} from "node:timers/promises";

const RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
const RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
const SOURCE_VERSION = "raydium-cp-swap@3d69122790e97cd6aff24e8ba95940793773f58c";
const DECODER_VERSION = "raydium-cpmm-pool-v1";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const PDA_MARKER = Buffer.from("ProgramDerivedAddress");
const AUTH_SEED = Buffer.from("vault_and_lp_mint_auth_seed");
const VAULT_SEED = Buffer.from("pool_vault");
const LP_MINT_SEED = Buffer.from("pool_lp_mint");
const POOL_STATE_LENGTH = 637;
const TOKEN_ACCOUNT_LENGTH = 165;
const MINT_LENGTH = 82;
const U64_MAX = (1n << 64n) - 1n;
const HARD_LIMITS = Object.freeze({
  maxRequests: 2,
  maxResponseBytes: 1_048_576,
  maxBytesPerRun: 2_097_152,
  maxElapsedMs: 30_000,
  requestTimeoutMs: 15_000,
  maxSlotSkew: 10_000
});
const DEFAULT_LIMITS = Object.freeze({
  maxRequests: 2,
  maxResponseBytes: 262_144,
  maxBytesPerRun: 524_288,
  maxElapsedMs: 15_000,
  requestTimeoutMs: 5_000,
  maxSlotSkew: 1_000
});
const POOL_DISCRIMINATOR = createHash("sha256")
  .update("account:PoolState", "utf8").digest().subarray(0, 8);
const FIELD_OFFSETS = Object.freeze({
  ammConfig: 8,
  poolCreator: 40,
  token0Vault: 72,
  token1Vault: 104,
  lpMint: 136,
  token0Mint: 168,
  token1Mint: 200,
  token0Program: 232,
  token1Program: 264,
  observation: 296,
  authorityBump: 328,
  status: 329,
  lpMintDecimals: 330,
  token0Decimals: 331,
  token1Decimals: 332,
  lpSupply: 333
});
const FIELD_LIMITS = Object.freeze({
  maxRequests: 2,
  maxResponseBytes: 1_048_576,
  maxBytesPerRun: 2_097_152,
  maxElapsedMs: 30_000,
  requestTimeoutMs: 15_000,
  maxSlotSkew: 10_000
});

export const RAYDIUM_CPMM_LAYOUT = Object.freeze({
  sourceVersion: SOURCE_VERSION,
  programId: RAYDIUM_CPMM_PROGRAM,
  poolStateLength: POOL_STATE_LENGTH,
  poolStateFields: FIELD_OFFSETS
});

class SourceFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new SourceFailure(code);
}

function abortFailure(signal) {
  return signal?.reason instanceof SourceFailure
    ? signal.reason
    : new SourceFailure("CANCELLED");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase58(value) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
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

const FIELD_P = (1n << 255n) - 19n;
const CURVE_D = mod(-121665n * modPow(121666n, FIELD_P - 2n, FIELD_P), FIELD_P);
const SQRT_MINUS_ONE = modPow(2n, (FIELD_P - 1n) / 4n, FIELD_P);

function littleEndianInteger(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = value * 256n + BigInt(bytes[index]);
  }
  return value;
}

function isEd25519Point(bytes) {
  if (bytes.length !== 32) return false;
  const encoded = Buffer.from(bytes);
  const sign = encoded[31] >>> 7;
  encoded[31] &= 0x7f;
  const y = littleEndianInteger(encoded);
  if (y >= FIELD_P) return false;
  const ySquared = y * y % FIELD_P;
  const numerator = mod(ySquared - 1n, FIELD_P);
  const denominator = mod(CURVE_D * ySquared + 1n, FIELD_P);
  if (denominator === 0n) return false;
  const xSquared = numerator * modPow(denominator, FIELD_P - 2n, FIELD_P) % FIELD_P;
  let x = modPow(xSquared, (FIELD_P + 3n) / 8n, FIELD_P);
  if (x * x % FIELD_P !== xSquared) x = x * SQRT_MINUS_ONE % FIELD_P;
  if (x * x % FIELD_P !== xSquared) return false;
  return x !== 0n || sign === 0;
}

function deriveProgramAddress(seeds, programId) {
  const programBytes = decodeBase58(programId);
  if (!programBytes || !Array.isArray(seeds) ||
      seeds.some(seed => !Buffer.isBuffer(seed) || seed.length < 1 || seed.length > 32)) {
    fail("INVALID_PDA_SEEDS");
  }
  for (let bump = 255; bump >= 0; bump -= 1) {
    const address = createHash("sha256")
      .update(Buffer.concat([...seeds, Buffer.from([bump]), programBytes, PDA_MARKER]))
      .digest();
    if (!isEd25519Point(address)) return {address: encodeBase58(address), bump};
  }
  fail("PDA_NOT_FOUND");
}

function validateIdentity(identity) {
  if (!isRecord(identity) || identity.chainId !== "solana" ||
      !decodeBase58(identity.mint) || !decodeBase58(identity.pool) ||
      !decodeBase58(identity.quote) || identity.mint === identity.quote) {
    fail("INVALID_IDENTITY");
  }
  return {
    chainId: "solana",
    mint: identity.mint,
    pool: identity.pool,
    quote: identity.quote
  };
}

function validateSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function" || typeof signal.aborted !== "boolean")) {
    fail("INVALID_SIGNAL");
  }
}

function validateLimits(input = {}) {
  if (!isRecord(input) || Reflect.ownKeys(input).some(key =>
    typeof key !== "string" || !Object.hasOwn(HARD_LIMITS, key))) {
    throw new TypeError("unknown Raydium source limit");
  }
  const limits = {...DEFAULT_LIMITS, ...input};
  for (const [key, maximum] of Object.entries(HARD_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum) {
      throw new TypeError(`${key} is outside the bounded Raydium source limit`);
    }
  }
  if (limits.maxRequests !== 2 || limits.maxResponseBytes > limits.maxBytesPerRun) {
    throw new TypeError("Raydium source limits must allow exactly two reads and fit the total byte cap");
  }
  return limits;
}

function readClock(clock) {
  let value;
  try { value = clock(); } catch { fail("CLOCK_UNAVAILABLE"); }
  if (!Number.isSafeInteger(value) || value < 0 ||
      !Number.isFinite(new Date(value).getTime())) fail("INVALID_CLOCK");
  return value;
}

function rpcRequest(method, params, id) {
  if (method !== "getAccountInfo" && method !== "getMultipleAccounts") {
    fail("RPC_METHOD_NOT_ALLOWED");
  }
  return Object.freeze({
    id,
    method,
    url: RPC_ORIGIN,
    httpMethod: "POST",
    headers: Object.freeze({accept: "application/json", "content-type": "application/json"}),
    body: JSON.stringify({jsonrpc: "2.0", id, method, params}),
    credentials: "omit",
    redirect: "error"
  });
}

function cancelResponseBody(response) {
  try { response?.body?.cancel?.().catch?.(() => {}); } catch { /* body may already be locked or closed */ }
}

function raceWithAbort(promise, signal, onLateValue) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortFailure(signal));
    };
    if (signal.aborted) {
      settled = true;
      reject(abortFailure(signal));
    } else {
      signal.addEventListener("abort", onAbort, {once: true});
    }
    promise.then(
      value => {
        if (settled) {
          try { onLateValue?.(value); } catch { /* late response cleanup must not escape */ }
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

function validateResponseTarget(response) {
  if (response?.redirected === true) fail("REDIRECT_BLOCKED");
  if (response?.url !== undefined && typeof response.url !== "string") fail("INVALID_RESPONSE_URL");
  if (typeof response?.url === "string" && response.url !== "") {
    let returned;
    try { returned = new URL(response.url); } catch { fail("INVALID_RESPONSE_URL"); }
    if (returned.origin !== RPC_ORIGIN || returned.pathname !== "/" ||
        returned.search !== "" || returned.hash !== "" ||
        returned.username !== "" || returned.password !== "") fail("INVALID_RESPONSE_URL");
  }
}

async function readJson(response, {signal, limits, counters}) {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) fail("INVALID_CONTENT_TYPE");
  const lengthHeader = response.headers?.get?.("content-length");
  if (lengthHeader !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(lengthHeader) ||
        !Number.isSafeInteger(Number(lengthHeader))) fail("INVALID_CONTENT_LENGTH");
    if (Number(lengthHeader) > limits.maxResponseBytes ||
        Number(lengthHeader) > limits.maxBytesPerRun - counters.bytes) fail("RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("MISSING_RESPONSE_STREAM");
  const chunks = [];
  const digest = createHash("sha256");
  let size = 0;
  let reads = 0;
  let emptyReads = 0;
  try {
    while (true) {
      if (signal?.aborted) fail("CANCELLED");
      reads += 1;
      if (reads > 65_536) fail("STREAM_READ_LIMIT");
      const {done, value} = await raceWithAbort(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) fail("INVALID_RESPONSE_CHUNK");
      if (value.byteLength === 0) {
        emptyReads += 1;
        if (emptyReads > 256) fail("EMPTY_STREAM_LIMIT");
        if (reads % 64 === 0) await yieldToLoop();
        continue;
      }
      emptyReads = 0;
      if (value.byteLength > limits.maxResponseBytes - size ||
          value.byteLength > limits.maxBytesPerRun - counters.bytes) fail("RESPONSE_TOO_LARGE");
      size += value.byteLength;
      counters.bytes += value.byteLength;
      digest.update(value);
      chunks.push(value);
      if (reads % 64 === 0) await yieldToLoop();
    }
  } catch (error) {
    try { reader.cancel?.().catch?.(() => {}); } catch { /* reader may already be closed */ }
    if (error instanceof SourceFailure) throw error;
    if (signal?.aborted) fail("CANCELLED");
    fail("RESPONSE_READ_FAILED");
  } finally {
    try { reader.releaseLock?.(); } catch { /* an aborted read may still be pending */ }
  }
  if (lengthHeader !== null && Number(lengthHeader) !== size) fail("INVALID_CONTENT_LENGTH");
  const bytes = Buffer.concat(chunks, size);
  let text;
  try { text = new TextDecoder("utf-8", {fatal: true}).decode(bytes); } catch { fail("INVALID_UTF8"); }
  let payload;
  try { payload = JSON.parse(text); } catch { fail("INVALID_JSON"); }
  return {payload, responseSha256: digest.digest("hex"), responseBytes: size};
}

async function requestJson({
  request, transport, signal, limits, counters, timeoutMs, beforeDispatch
}) {
  let response = null;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(abortFailure(signal));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, {once: true});
  const timer = setTimeout(() => controller.abort(new SourceFailure("TIMEOUT")), timeoutMs);
  try {
    if (controller.signal.aborted) fail("CANCELLED");
    const transportPromise = Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        fail(controller.signal.reason?.code ?? "CANCELLED");
      }
      beforeDispatch();
      return transport(request, {
        credentials: "omit",
        redirect: "error",
        signal: controller.signal
      });
    });
    response = await raceWithAbort(
      transportPromise,
      controller.signal,
      cancelResponseBody
    );
    validateResponseTarget(response);
    if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) {
      fail("INVALID_HTTP_STATUS");
    }
    if (response.status < 200 || response.status >= 300) fail(`HTTP_${response.status}`);
    return await readJson(response, {signal: controller.signal, limits, counters});
  } catch (error) {
    cancelResponseBody(response);
    const code = error instanceof SourceFailure ? error.code
      : controller.signal.aborted
        ? controller.signal.reason?.code ?? "CANCELLED"
        : "TRANSPORT_ERROR";
    fail(code);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function rpcResult(payload, expectedId) {
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== expectedId ||
      payload.error !== undefined || !isRecord(payload.result) ||
      !isRecord(payload.result.context) ||
      !Number.isSafeInteger(payload.result.context.slot) ||
      payload.result.context.slot < 0 ||
      !Object.hasOwn(payload.result, "value")) fail("INVALID_RPC_ENVELOPE");
  return payload.result;
}

function accountData(account, label, maximumLength) {
  if (!isRecord(account) || account.executable !== false ||
      typeof account.owner !== "string" || !decodeBase58(account.owner) ||
      !Array.isArray(account.data) || account.data.length !== 2 ||
      account.data[1] !== "base64" || typeof account.data[0] !== "string" ||
      account.data[0].length > Math.ceil(maximumLength * 4 / 3) + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(account.data[0])) {
    fail(`INVALID_${label}_ACCOUNT`);
  }
  const bytes = Buffer.from(account.data[0], "base64");
  if (bytes.length > maximumLength || bytes.toString("base64") !== account.data[0]) {
    fail(`INVALID_${label}_ACCOUNT`);
  }
  return {owner: account.owner, bytes};
}

function readKey(bytes, offset) {
  return encodeBase58(bytes.subarray(offset, offset + 32));
}

function readU64(bytes, offset) {
  const value = bytes.readBigUInt64LE(offset);
  if (value > U64_MAX) fail("INVALID_U64");
  return value.toString();
}

function decodePoolState(bytes) {
  if (bytes.length !== POOL_STATE_LENGTH ||
      !bytes.subarray(0, 8).equals(POOL_DISCRIMINATOR)) fail("UNSUPPORTED_POOL_LAYOUT");
  const fields = {
    ammConfig: readKey(bytes, FIELD_OFFSETS.ammConfig),
    poolCreator: readKey(bytes, FIELD_OFFSETS.poolCreator),
    token0Vault: readKey(bytes, FIELD_OFFSETS.token0Vault),
    token1Vault: readKey(bytes, FIELD_OFFSETS.token1Vault),
    lpMint: readKey(bytes, FIELD_OFFSETS.lpMint),
    token0Mint: readKey(bytes, FIELD_OFFSETS.token0Mint),
    token1Mint: readKey(bytes, FIELD_OFFSETS.token1Mint),
    token0Program: readKey(bytes, FIELD_OFFSETS.token0Program),
    token1Program: readKey(bytes, FIELD_OFFSETS.token1Program),
    observation: readKey(bytes, FIELD_OFFSETS.observation),
    authorityBump: bytes[FIELD_OFFSETS.authorityBump],
    status: bytes[FIELD_OFFSETS.status],
    lpMintDecimals: bytes[FIELD_OFFSETS.lpMintDecimals],
    token0Decimals: bytes[FIELD_OFFSETS.token0Decimals],
    token1Decimals: bytes[FIELD_OFFSETS.token1Decimals],
    lpSupply: readU64(bytes, FIELD_OFFSETS.lpSupply)
  };
  if (fields.status > 7 || fields.lpMintDecimals !== 9 ||
      fields.token0Decimals > 18 || fields.token1Decimals > 18) fail("UNSUPPORTED_POOL_FIELDS");
  if (bytes[390] > 1 || bytes[389] > 2) fail("UNSUPPORTED_POOL_FIELDS");
  return fields;
}

function compareAddresses(left, right) {
  const leftBytes = decodeBase58(left);
  const rightBytes = decodeBase58(right);
  if (!leftBytes || !rightBytes) fail("INVALID_POOL_MINT");
  return Buffer.compare(leftBytes, rightBytes);
}

function validatePoolIdentity(pool, identity) {
  if (compareAddresses(pool.token0Mint, pool.token1Mint) >= 0 ||
      !TOKEN_PROGRAMS.has(pool.token0Program) || !TOKEN_PROGRAMS.has(pool.token1Program)) {
    fail("UNSUPPORTED_POOL_MODEL");
  }
  const token0IsMint = pool.token0Mint === identity.mint && pool.token1Mint === identity.quote;
  const token1IsMint = pool.token1Mint === identity.mint && pool.token0Mint === identity.quote;
  if (!token0IsMint && !token1IsMint) fail("POOL_TOKEN_IDENTITY_MISMATCH");
  return token0IsMint
    ? {
        selectedMint: pool.token0Mint,
        selectedVault: pool.token0Vault,
        selectedTokenProgram: pool.token0Program,
        selectedDecimals: pool.token0Decimals,
        quoteMint: pool.token1Mint,
        quoteVault: pool.token1Vault,
        quoteTokenProgram: pool.token1Program,
        quoteDecimals: pool.token1Decimals
      }
    : {
        selectedMint: pool.token1Mint,
        selectedVault: pool.token1Vault,
        selectedTokenProgram: pool.token1Program,
        selectedDecimals: pool.token1Decimals,
        quoteMint: pool.token0Mint,
        quoteVault: pool.token0Vault,
        quoteTokenProgram: pool.token0Program,
        quoteDecimals: pool.token0Decimals
      };
}

function validateCanonicalPdas(pool, identity) {
  const authority = deriveProgramAddress([AUTH_SEED], RAYDIUM_CPMM_PROGRAM);
  if (authority.bump !== pool.authorityBump) fail("POOL_AUTHORITY_BUMP_MISMATCH");
  const vault0 = deriveProgramAddress([
    VAULT_SEED,
    decodeBase58(identity.pool),
    decodeBase58(pool.token0Mint)
  ], RAYDIUM_CPMM_PROGRAM);
  const vault1 = deriveProgramAddress([
    VAULT_SEED,
    decodeBase58(identity.pool),
    decodeBase58(pool.token1Mint)
  ], RAYDIUM_CPMM_PROGRAM);
  const lpMint = deriveProgramAddress([
    LP_MINT_SEED,
    decodeBase58(identity.pool)
  ], RAYDIUM_CPMM_PROGRAM);
  if (vault0.address !== pool.token0Vault || vault1.address !== pool.token1Vault ||
      lpMint.address !== pool.lpMint) fail("POOL_PDA_MISMATCH");
  return authority.address;
}

function readCOptionPubkey(bytes, tagOffset, keyOffset) {
  const tag = bytes.readUInt32LE(tagOffset);
  if (tag > 1) fail("INVALID_TOKEN_OPTION");
  const keyBytes = bytes.subarray(keyOffset, keyOffset + 32);
  if (tag === 0 && keyBytes.some(byte => byte !== 0)) fail("INVALID_TOKEN_OPTION");
  return tag === 0 ? null : encodeBase58(keyBytes);
}

function readCOptionU64(bytes, tagOffset, valueOffset) {
  const tag = bytes.readUInt32LE(tagOffset);
  if (tag > 1) fail("INVALID_TOKEN_OPTION");
  const value = bytes.readBigUInt64LE(valueOffset);
  if (tag === 0 && value !== 0n) fail("INVALID_TOKEN_OPTION");
  return tag === 0 ? null : value.toString();
}

function decodeVault(account, expected) {
  const {owner, bytes} = accountData(account, "VAULT", TOKEN_ACCOUNT_LENGTH);
  if (owner !== expected.tokenProgram || bytes.length !== TOKEN_ACCOUNT_LENGTH ||
      readKey(bytes, 0) !== expected.mint) fail("VAULT_IDENTITY_MISMATCH");
  const authority = readKey(bytes, 32);
  const amountAtoms = readU64(bytes, 64);
  if (authority !== expected.authority || ![1, 2].includes(bytes[108])) {
    fail("VAULT_AUTHORITY_OR_STATE_MISMATCH");
  }
  readCOptionPubkey(bytes, 72, 76);
  readCOptionU64(bytes, 109, 113);
  readCOptionPubkey(bytes, 129, 133);
  return {
    address: expected.address,
    mint: expected.mint,
    tokenProgram: owner,
    authority,
    amountAtoms,
    decimals: expected.decimals,
    state: bytes[108] === 1 ? "initialized" : "frozen"
  };
}

function decodeLpMint(account, pool, expectedAuthority) {
  const {owner, bytes} = accountData(account, "LP_MINT", MINT_LENGTH);
  if (owner !== TOKEN_PROGRAM || bytes.length !== MINT_LENGTH ||
      bytes[44] !== pool.lpMintDecimals || bytes[44] !== 9 || bytes[45] !== 1) {
    fail("LP_MINT_IDENTITY_MISMATCH");
  }
  const mintAuthority = readCOptionPubkey(bytes, 0, 4);
  readCOptionPubkey(bytes, 46, 50);
  if (mintAuthority !== expectedAuthority) fail("LP_MINT_AUTHORITY_MISMATCH");
  return {
    address: pool.lpMint,
    tokenProgram: owner,
    decimals: bytes[44],
    supplyAtoms: readU64(bytes, 36),
    mintAuthority
  };
}

function parsePoolAccount(account) {
  const decoded = accountData(account, "POOL", POOL_STATE_LENGTH);
  if (decoded.owner !== RAYDIUM_CPMM_PROGRAM) fail("POOL_PROGRAM_OWNER_MISMATCH");
  return {bytes: decoded.bytes, fields: decodePoolState(decoded.bytes)};
}

function requestEvent(request, status, requestedAt, receivedAt, responseBytes = 0, responseSha256 = null) {
  return {
    requestId: request.id,
    method: request.method,
    endpoint: RPC_ORIGIN,
    status,
    requestedAt,
    receivedAt,
    responseBytes,
    responseSha256,
    timeBasis: "injected local receipt clock; source clock is not authenticated",
    slot: null
  };
}

const USER_SAFE_FAILURES = Object.freeze({
  CANCELLED: "collection was cancelled",
  CLOCK_UNAVAILABLE: "injected clock was unavailable",
  INVALID_CLOCK: "injected clock returned an invalid timestamp",
  INVALID_IDENTITY: "requested Solana pool identity was invalid",
  INVALID_SIGNAL: "cancellation signal was invalid",
  INVALID_POOL_ACCOUNT: "pool account response was malformed",
  POOL_PROGRAM_OWNER_MISMATCH: "pool account is not owned by the pinned Raydium CPMM program",
  UNSUPPORTED_POOL_LAYOUT: "pool account did not match the pinned Raydium PoolState layout",
  UNSUPPORTED_POOL_FIELDS: "pool account contained unsupported state or decimal fields",
  UNSUPPORTED_POOL_MODEL: "pool mint ordering or token program is not supported",
  POOL_TOKEN_IDENTITY_MISMATCH: "pool token mints did not match the requested mint and quote",
  POOL_AUTHORITY_BUMP_MISMATCH: "pool authority bump did not match the canonical program-derived address",
  POOL_PDA_MISMATCH: "pool vault or LP mint address did not match the pinned PDA derivation",
  POOL_STATE_CHANGED: "pool state changed between bounded RPC reads",
  VAULT_IDENTITY_MISMATCH: "vault mint or token program did not match the pool state",
  VAULT_AUTHORITY_OR_STATE_MISMATCH: "vault authority or token-account state did not match",
  LP_MINT_IDENTITY_MISMATCH: "LP mint owner, initialization, or decimals did not match the pool state",
  LP_MINT_AUTHORITY_MISMATCH: "LP mint authority did not match the pinned Raydium authority PDA",
  RPC_SLOT_INVALID: "RPC context slot was invalid or outside the bounded slot skew",
  RPC_METHOD_NOT_ALLOWED: "RPC method is not in this source allowlist",
  INVALID_PDA_SEEDS: "program-derived-address inputs were invalid",
  PDA_NOT_FOUND: "program-derived address could not be derived",
  INVALID_TOKEN_OPTION: "token account or mint option tag was invalid",
  INVALID_U64: "account integer field was invalid",
  INVALID_IDENTITY_BYTES: "account identity bytes were invalid"
});

function safeFailure(code) {
  if (USER_SAFE_FAILURES[code]) return USER_SAFE_FAILURES[code];
  if (/^HTTP_[1-5]\d\d$/.test(code)) return `Solana RPC returned ${code}; no retry was attempted`;
  const messages = {
    INVALID_CONTENT_LENGTH: "RPC response content length was invalid",
    INVALID_CONTENT_TYPE: "RPC response was not JSON",
    INVALID_HTTP_STATUS: "RPC returned an invalid HTTP status",
    INVALID_JSON: "RPC response was not valid JSON",
    INVALID_RESPONSE_CHUNK: "RPC response stream was malformed",
    INVALID_RESPONSE_URL: "RPC response origin or path was not allowlisted",
    INVALID_RPC_ENVELOPE: "RPC response envelope or context slot was invalid",
    INVALID_UTF8: "RPC response was not valid UTF-8",
    MISSING_RESPONSE_STREAM: "RPC response stream was unavailable",
    REDIRECT_BLOCKED: "RPC redirects are not accepted",
    RESPONSE_READ_FAILED: "RPC response stream could not be read",
    RESPONSE_TOO_LARGE: "RPC response exceeded a configured byte limit",
    STREAM_READ_LIMIT: "RPC response exceeded the stream-read work limit",
    EMPTY_STREAM_LIMIT: "RPC response exceeded the empty-chunk limit",
    TIMEOUT: "RPC request or collection exceeded its deadline",
    TRANSPORT_ERROR: "injected RPC transport failed",
    INVALID_HTTP_STATUS: "RPC returned an invalid HTTP status"
  };
  return messages[code] ?? "RPC evidence could not be safely decoded";
}

function unknownResult(identity, code, details = {}) {
  return {
    status: "UNKNOWN",
    reasonCode: code,
    reason: safeFailure(code),
    sourceVersion: SOURCE_VERSION,
    decoderVersion: DECODER_VERSION,
    sourceAuthentication: "NOT_ESTABLISHED",
    clockTrust: "INJECTED_LOCAL_CLOCK_UNVERIFIED",
    identity,
    observedAt: details.observedAt ?? null,
    slot: details.slot ?? null,
    events: details.events ?? [],
    counters: details.counters ?? {requests: 0, bytes: 0},
    pool: null,
    poolExclusionEvidence: null,
    lpProtection: {status: "UNKNOWN", reason: "pool-state decoding does not prove LP burn or lock"},
    developerAttribution: {status: "UNKNOWN", reason: "pool_creator is not token developer attribution"},
    ownerConcentration: {status: "UNKNOWN", reason: "vault identity alone is not a complete owner census"},
    executionAuthorized: false
  };
}

export async function collectRaydiumCpmmPoolEvidence({
  identity: inputIdentity,
  enabled = false,
  transport,
  clock,
  signal,
  limits: inputLimits
} = {}) {
  if (enabled !== true) {
    return {
      status: "DISABLED",
      networkAccessed: false,
      sourceVersion: SOURCE_VERSION,
      decoderVersion: DECODER_VERSION,
      events: [],
      counters: {requests: 0, bytes: 0},
      poolExclusionEvidence: null,
      lpProtection: {status: "UNKNOWN", reason: "source is disabled"},
      developerAttribution: {status: "UNKNOWN", reason: "source is disabled"},
      ownerConcentration: {status: "UNKNOWN", reason: "source is disabled"},
      executionAuthorized: false
    };
  }
  if (typeof transport !== "function" || typeof clock !== "function") {
    throw new TypeError("enabled Raydium source requires injected transport and clock functions");
  }
  const limits = validateLimits(inputLimits);
  const counters = {requests: 0, bytes: 0};
  const events = [];
  let identity;
  let slot = null;
  let observedAt = null;
  let startedAt;
  let startedMonotonicAt;
  let lastClockAt = null;
  const deadlineAt = () => startedMonotonicAt + limits.maxElapsedMs;
  const acceptClock = time => {
    if (lastClockAt !== null && time < lastClockAt) fail("INVALID_CLOCK");
    lastClockAt = time;
    return time;
  };
  const observeClock = () => acceptClock(readClock(clock));
  try {
    validateSignal(signal);
    identity = validateIdentity(inputIdentity);
    startedAt = observeClock();
    startedMonotonicAt = performance.now();
    const checkBoundary = time => {
      if (signal?.aborted) fail("CANCELLED");
      const currentTime = time === undefined ? observeClock() : acceptClock(time);
      if (signal?.aborted) fail("CANCELLED");
      if (currentTime - startedAt > limits.maxElapsedMs ||
          performance.now() >= deadlineAt()) fail("TIMEOUT");
      return currentTime;
    };
    const runRequest = async (method, params) => {
      const now = checkBoundary();
      const remainingMs = limits.maxElapsedMs - (performance.now() - startedMonotonicAt);
      if (remainingMs <= 0 || counters.requests >= limits.maxRequests) fail("TIMEOUT");
      const request = rpcRequest(method, params, counters.requests + 1);
      const requestedAt = now;
      const before = counters.bytes;
      const timeoutMs = Math.max(1, Math.min(limits.requestTimeoutMs, Math.ceil(remainingMs)));
      const result = await requestJson({
        request, transport, signal, limits, counters, timeoutMs,
        beforeDispatch: () => {
          checkBoundary();
          if (counters.requests >= limits.maxRequests) fail("TIMEOUT");
          counters.requests += 1;
        }
      });
      const receivedAt = observeClock();
      checkBoundary(receivedAt);
      const rpc = rpcResult(result.payload, request.id);
      const responseSlot = rpc.context.slot;
      events.push(requestEvent(request, "OK", requestedAt, receivedAt,
        result.responseBytes, result.responseSha256));
      events.at(-1).slot = responseSlot;
      return {...result, rpc, responseSlot, receivedAt, request};
    };

    const initial = await runRequest("getAccountInfo", [
      identity.pool,
      {commitment: "finalized", encoding: "base64"}
    ]);
    checkBoundary();
    if (initial.rpc.value === null) fail("INVALID_POOL_ACCOUNT");
    const initialPool = parsePoolAccount(initial.rpc.value);
    checkBoundary();
    const tokenPair = validatePoolIdentity(initialPool.fields, identity);
    validateCanonicalPdas(initialPool.fields, identity);
    checkBoundary();
    const second = await runRequest("getMultipleAccounts", [
      [
        identity.pool,
        initialPool.fields.token0Vault,
        initialPool.fields.token1Vault,
        initialPool.fields.lpMint
      ],
      {
        commitment: "finalized",
        encoding: "base64",
        minContextSlot: initial.responseSlot
      }
    ]);
    if (second.responseSlot < initial.responseSlot ||
        second.responseSlot - initial.responseSlot > limits.maxSlotSkew) {
      fail("RPC_SLOT_INVALID");
    }
    checkBoundary();
    if (!Array.isArray(second.rpc.value) || second.rpc.value.length !== 4 ||
        second.rpc.value.some(account => account === null)) fail("INVALID_RPC_ENVELOPE");
    const poolAgain = parsePoolAccount(second.rpc.value[0]);
    checkBoundary();
    if (!poolAgain.bytes.equals(initialPool.bytes)) fail("POOL_STATE_CHANGED");
    const pool = poolAgain.fields;
    const canonicalAuthority = validateCanonicalPdas(pool, identity);
    checkBoundary();
    const pair = validatePoolIdentity(pool, identity);
    checkBoundary();
    const vault0 = decodeVault(second.rpc.value[1], {
      address: pool.token0Vault,
      mint: pool.token0Mint,
      tokenProgram: pool.token0Program,
      authority: canonicalAuthority,
      decimals: pool.token0Decimals
    });
    checkBoundary();
    const vault1 = decodeVault(second.rpc.value[2], {
      address: pool.token1Vault,
      mint: pool.token1Mint,
      tokenProgram: pool.token1Program,
      authority: canonicalAuthority,
      decimals: pool.token1Decimals
    });
    checkBoundary();
    const lpMint = decodeLpMint(second.rpc.value[3], pool, canonicalAuthority);
    checkBoundary();
    const selectedVault = pair.selectedMint === pool.token0Mint ? vault0 : vault1;
    const quoteVault = pair.quoteMint === pool.token0Mint ? vault0 : vault1;
    slot = second.responseSlot;
    observedAt = second.receivedAt;
    const allVaults = [vault0, vault1];
    const poolExclusionEvidence = {
      schema: "RAYDIUM_CPMM_POOL_VAULT_EXCLUSIONS_V1",
      status: "DECODED_UNVERIFIED",
      source: "Solana JSON-RPC getMultipleAccounts",
      sourceVersion: SOURCE_VERSION,
      decoderVersion: DECODER_VERSION,
      identity,
      observedAt,
      slot,
      verified: false,
      review: null,
      responseSha256: second.responseSha256,
      coverage: {
        complete: true,
        scope: "the two vault accounts named by this selected Raydium CPMM pool state",
        selectedPoolBound: true,
        vaultPdasDerived: true,
        vaultTokenMintsBound: true,
        vaultTokenProgramsBound: true,
        vaultAuthorityBound: true,
        ownerCensusComplete: false,
        ownerResolutionComplete: false,
        burnedSupplyExcluded: false,
        sourceAuthenticated: false
      },
      value: {
        pool: identity.pool,
        selectedPoolTokenAccounts: [selectedVault.address],
        burnedTokenAccounts: [],
        poolVaults: allVaults,
        selectedMintVault: selectedVault,
        quoteMintVault: quoteVault
      }
    };
    const result = {
      status: "DECODED_UNVERIFIED",
      reason: "pinned Raydium CPMM fields and vault accounts decoded from caller-injected RPC data; source is unauthenticated",
      sourceVersion: SOURCE_VERSION,
      decoderVersion: DECODER_VERSION,
      sourceAuthentication: "NOT_ESTABLISHED",
      clockTrust: "INJECTED_LOCAL_CLOCK_UNVERIFIED",
      identity,
      observedAt,
      slot,
      initialPoolSlot: initial.responseSlot,
      slotSkew: second.responseSlot - initial.responseSlot,
      events,
      counters,
      pool: {
        address: identity.pool,
        programId: RAYDIUM_CPMM_PROGRAM,
        ammConfig: pool.ammConfig,
        poolCreator: pool.poolCreator,
        poolCreatorMeaning: "Raydium CPMM pool creator; not token developer attribution",
        token0: {
          mint: pool.token0Mint,
          programId: pool.token0Program,
          decimals: pool.token0Decimals,
          vault: vault0
        },
        token1: {
          mint: pool.token1Mint,
          programId: pool.token1Program,
          decimals: pool.token1Decimals,
          vault: vault1
        },
        lpMint,
        lpMintDecimals: pool.lpMintDecimals,
        lpSupplyAtoms: pool.lpSupply,
        lpSupplyMeaning: "PoolState counter only; not evidence of LP burn, lock, or holder distribution",
        poolStateSha256: createHash("sha256").update(poolAgain.bytes).digest("hex"),
        responseSha256: second.responseSha256
      },
      poolExclusionEvidence,
      ownerCensusHandoff: {
        schema: poolExclusionEvidence.schema,
        identity,
        observedAt,
        slot,
        source: poolExclusionEvidence.source,
        sourceVersion: poolExclusionEvidence.sourceVersion,
        decoderVersion: poolExclusionEvidence.decoderVersion,
        responseSha256: poolExclusionEvidence.responseSha256,
        pool: identity.pool,
        selectedPoolTokenAccounts: [selectedVault.address],
        burnedTokenAccounts: [],
        coverage: poolExclusionEvidence.coverage,
        verified: false,
        review: null
      },
      lpProtection: {
        status: "UNKNOWN",
        reason: "pool state, LP mint authority, and LP supply do not prove LP burn or a lock through the proposed hold"
      },
      developerAttribution: {
        status: "UNKNOWN",
        reason: "pool_creator is not evidence that the address is the token developer"
      },
      ownerConcentration: {
        status: "UNKNOWN",
        reason: "the pool-vault exclusion contribution is not a complete owner census or reviewed concentration result"
      },
      executionAuthorized: false
    };
    checkBoundary();
    return result;
  } catch (error) {
    const code = error instanceof SourceFailure ? error.code
      : signal?.aborted ? "CANCELLED"
        : "SOURCE_DECODE_FAILED";
    if (events.length < counters.requests) {
      events.push({
        requestId: counters.requests,
        method: counters.requests === 1 ? "getAccountInfo" : "getMultipleAccounts",
        endpoint: RPC_ORIGIN,
        status: code,
        reason: safeFailure(code),
        requestedAt: null,
        receivedAt: (() => { try { return observeClock(); } catch { return null; } })(),
        responseBytes: 0,
        responseSha256: null,
        timeBasis: "injected local receipt clock; source clock is not authenticated",
        slot: null
      });
    }
    return unknownResult(identity, code, {
      observedAt,
      slot,
      events,
      counters
    });
  }
}
