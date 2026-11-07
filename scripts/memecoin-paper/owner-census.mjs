import {createHash} from "node:crypto";
import {decodeMintSafetyEvidence} from "../memecoin-paper-token-safety/decode.mjs";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const RPC_METHOD = "getProgramAccounts";
const RPC_SOURCE = "Solana JSON-RPC getProgramAccounts";
const LEGACY_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAMS = new Set([LEGACY_TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const TOKEN_ACCOUNT_BYTES = 165;
const DECODE_BATCH_SIZE = 256;
const MAX_READ_ITERATIONS = 65_536;
const MAX_EMPTY_READS = 256;
const READ_YIELD_INTERVAL = 64;
const U64_MAX = (1n << 64n) - 1n;
const MAX_BOUNDS = Object.freeze({
  maxRequests: 1,
  maxResponseBytes: 8_388_608,
  maxAccounts: 20_000,
  maxDecodeWork: 4_000_000,
  maxElapsedMs: 30_000,
  maxSlotSkew: 10_000,
  maxTimeSkewMs: 300_000,
  maxEvidenceAgeMs: 3_600_000
});
const BOUND_KEYS = Object.keys(MAX_BOUNDS);
export const PROSPECTIVE_CENSUS_BOUNDS = Object.freeze({
  maxAttempts: 3,
  maxRequests: 6,
  maxResponseBytes: 2_097_152,
  maxAccounts: MAX_BOUNDS.maxAccounts,
  maxDecodeWork: MAX_BOUNDS.maxDecodeWork,
  maxElapsedMs: MAX_BOUNDS.maxElapsedMs
});
const NATIVE_MINTS = new Set([
  "11111111111111111111111111111111",
  "So11111111111111111111111111111111111111112",
  "So11111111111111111111111111111111111111111"
]);

class CensusFailure extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new CensusFailure(code, details);
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
  const result = new Uint8Array(zeroes + bytes.length);
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

function parseTime(value) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.length <= 64 ? Date.parse(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 &&
    Number.isFinite(new Date(parsed).getTime()) ? parsed : null;
}

function parseSlot(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,19})$/.test(value)) {
    const slot = BigInt(value);
    if (slot <= U64_MAX) return slot;
  }
  return null;
}

function validateIdentity(identity) {
  if (!isRecord(identity) || identity.chainId !== "solana") fail("INVALID_IDENTITY");
  for (const field of ["mint", "pool", "quote"]) {
    if (!decodeBase58(identity[field])) fail("INVALID_IDENTITY");
  }
  return {
    chainId: "solana",
    mint: identity.mint,
    pool: identity.pool,
    quote: identity.quote
  };
}

function validateBounds(manifest) {
  const bounds = manifest?.bounds;
  if (!isRecord(bounds) || Object.keys(bounds).length !== BOUND_KEYS.length ||
      BOUND_KEYS.some(key => !Object.hasOwn(bounds, key))) {
    fail("INVALID_BOUNDS");
  }
  const checked = {};
  for (const key of BOUND_KEYS) {
    const ceiling = MAX_BOUNDS[key];
    const value = bounds[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) fail("INVALID_BOUNDS");
    checked[key] = value;
  }
  if (checked.maxRequests !== 1) fail("INVALID_BOUNDS");
  return checked;
}

function validateMintEvidence(mintEvidence, identity) {
  const binding = mintEvidence?.binding;
  const programId = binding?.ownerProgram;
  const supply = mintEvidence?.mint?.supplyAtoms;
  const slot = parseSlot(binding?.slot);
  const observedAt = parseTime(binding?.observedAt);
  if (mintEvidence?.status !== "DECODED_UNVERIFIED" ||
      mintEvidence?.sourceStatus !== "CALLER_INJECTED_RPC_DATA_NOT_AUTHENTICATED" ||
      mintEvidence.authorizationEligible !== false || mintEvidence.hardGateEligible !== false ||
      mintEvidence.mint?.initialized !== true ||
      binding?.expectedMint !== identity.mint || binding?.requestedMint !== identity.mint ||
      binding?.accountPubkey !== identity.mint || !TOKEN_PROGRAMS.has(programId) ||
      typeof supply !== "string" || !/^(?:0|[1-9]\d{0,19})$/.test(supply) ||
      BigInt(supply) > U64_MAX || slot === null || observedAt === null) {
    fail(TOKEN_PROGRAMS.has(programId) ? "MINT_EVIDENCE_INVALID" : "UNSUPPORTED_TOKEN_PROGRAM");
  }
  if (!Number.isInteger(mintEvidence.mint.decimals) ||
      mintEvidence.mint.decimals < 0 || mintEvidence.mint.decimals > 255) {
    fail("MINT_EVIDENCE_INVALID");
  }
  if (programId === TOKEN_2022_PROGRAM && mintEvidence.extensions?.state !== "ABSENT") {
    fail("UNSUPPORTED_MINT_EXTENSION");
  }
  return {programId, supply: BigInt(supply), slot, observedAt};
}

function makeRequest(identity, programId) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: RPC_METHOD,
    params: [programId, {
      commitment: "finalized",
      encoding: "base64",
      filters: [{memcmp: {offset: 0, bytes: identity.mint}}],
      withContext: true
    }]
  };
  return Object.freeze({
    url: RPC_URL,
    method: "POST",
    headers: Object.freeze({
      accept: "application/json",
      "content-type": "application/json"
    }),
    body: JSON.stringify(payload),
    credentials: "omit",
    redirect: "error"
  });
}

function createDeadline(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const startedMonotonicAt = performance.now();
  let reasonCode = null;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const abort = code => {
    if (controller.signal.aborted) return;
    reasonCode = code;
    const error = new CensusFailure(code);
    controller.abort(error);
    rejectAbort(error);
  };
  const onParentAbort = () => abort("CANCELLED");
  if (parentSignal?.aborted) abort("CANCELLED");
  else parentSignal?.addEventListener("abort", onParentAbort, {once: true});
  const timer = setTimeout(() => abort("TIMEOUT"), timeoutMs);
  const check = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (performance.now() - startedMonotonicAt >= timeoutMs) {
      abort("TIMEOUT");
      throw controller.signal.reason;
    }
  };
  return {
    signal: controller.signal,
    check,
    async wait(value) {
      const pending = Promise.resolve(value);
      void pending.catch(() => {});
      check();
      const result = await Promise.race([pending, aborted]);
      check();
      return result;
    },
    reasonCode: () => reasonCode,
    elapsedMs: () => performance.now() - startedMonotonicAt,
    close() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  };
}

function validateResponseTarget(response) {
  if (response?.redirected === true) fail("REDIRECT_BLOCKED");
  if (response?.url !== undefined && response.url !== "") {
    let returned;
    try { returned = new URL(response.url); } catch { fail("INVALID_RESPONSE_URL"); }
    const expected = new URL(RPC_URL);
    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname ||
        returned.search !== "" || returned.hash !== "" ||
        returned.username !== "" || returned.password !== "") {
      fail("INVALID_RESPONSE_URL");
    }
  }
}

function cancelBody(body) {
  try { void Promise.resolve(body?.cancel()).catch(() => {}); } catch {}
}

async function readBoundedBody(response, maxBytes, deadline, onByteCount) {
  let reader;
  const chunks = [];
  let byteCount = 0;
  let reads = 0;
  let emptyReads = 0;
  try {
    if (!response?.body || typeof response.body.getReader !== "function") fail("INVALID_RESPONSE_BODY");
    reader = response.body.getReader();
    while (true) {
      deadline.check();
      if (reads >= MAX_READ_ITERATIONS) fail("RESPONSE_READ_LIMIT");
      if (reads > 0 && reads % READ_YIELD_INTERVAL === 0) {
        await deadline.wait(new Promise(resolve => setTimeout(resolve, 0)));
      }
      deadline.check();
      reads += 1;
      const {done, value} = await deadline.wait(reader.read());
      if (done) break;
      if (!(value instanceof Uint8Array)) fail("INVALID_RESPONSE_BODY");
      if (value.byteLength === 0) {
        emptyReads += 1;
        if (emptyReads >= MAX_EMPTY_READS) fail("RESPONSE_NO_PROGRESS");
        continue;
      }
      emptyReads = 0;
      if (value.byteLength > maxBytes - byteCount) {
        onByteCount(byteCount + value.byteLength);
        fail("RESPONSE_BYTE_LIMIT", {responseBytes: byteCount + value.byteLength});
      }
      byteCount += value.byteLength;
      onByteCount(byteCount);
      chunks.push(value);
    }
  } catch (error) {
    cancelBody(reader ?? response?.body);
    throw error;
  } finally {
    try { reader?.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {bytes, byteCount};
}

function parseRpcResponse(bytes) {
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch {
    fail("INVALID_JSON");
  }
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== 1 ||
      Object.hasOwn(payload, "error") || !isRecord(payload.result) ||
      !isRecord(payload.result.context) || !Array.isArray(payload.result.value)) {
    fail("INVALID_RPC_RESPONSE");
  }
  const slot = parseSlot(payload.result.context.slot);
  if (slot === null) fail("INVALID_CONTEXT_SLOT");
  return {accounts: payload.result.value, slot};
}

function canonicalAccountData(data) {
  if (!Array.isArray(data) || data.length !== 2 || data[1] !== "base64" ||
      typeof data[0] !== "string") fail("INVALID_ACCOUNT_DATA");
  const encoded = data[0];
  if (encoded.length > 4 * Math.ceil(TOKEN_ACCOUNT_BYTES / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail("UNSUPPORTED_ACCOUNT_LAYOUT");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) fail("INVALID_ACCOUNT_DATA");
  if (bytes.length !== TOKEN_ACCOUNT_BYTES) fail("UNSUPPORTED_ACCOUNT_LAYOUT");
  return bytes;
}

function decodeTokenAccount(item, identity, programId, rejectNative = false) {
  if (!isRecord(item) || !decodeBase58(item.pubkey) || !isRecord(item.account) ||
      item.account.owner !== programId || item.account.executable !== false) {
    fail("MALFORMED_PROGRAM_ACCOUNT");
  }
  const bytes = canonicalAccountData(item.account.data);
  if (encodeBase58(bytes.subarray(0, 32)) !== identity.mint) fail("ACCOUNT_MINT_MISMATCH");
  for (const offset of [72, 109, 129]) {
    const option = bytes.readUInt32LE(offset);
    if (option !== 0 && option !== 1) fail("MALFORMED_TOKEN_ACCOUNT");
  }
  if (bytes[108] !== 1 && bytes[108] !== 2) fail("MALFORMED_TOKEN_ACCOUNT");
  if (rejectNative && bytes.readUInt32LE(109) !== 0) fail("NATIVE_TOKEN_ACCOUNT_EXCLUDED");
  const owner = encodeBase58(bytes.subarray(32, 64));
  if (!decodeBase58(owner)) fail("MALFORMED_TOKEN_ACCOUNT");
  return {
    pubkey: item.pubkey,
    owner,
    amount: bytes.readBigUInt64LE(64)
  };
}

async function ownerTotals(accounts, identity, programId, bounds, deadline,
  {work = {decodeWork: 0}, rejectNative = false} = {}) {
  if (accounts.length > bounds.maxAccounts) fail("ACCOUNT_COUNT_LIMIT");
  const seenAccounts = new Set();
  const owners = new Map();
  let zeroBalanceAccountCount = 0;
  let sum = 0n;
  for (let index = 0; index < accounts.length; index += 1) {
    if (index > 0 && index % DECODE_BATCH_SIZE === 0) {
      await deadline.wait(new Promise(resolve => setTimeout(resolve, 0)));
    }
    deadline.check();
    const item = accounts[index];
    if (!isRecord(item) || typeof item.pubkey !== "string") fail("MALFORMED_PROGRAM_ACCOUNT");
    if (seenAccounts.has(item.pubkey)) fail("DUPLICATE_TOKEN_ACCOUNT");
    seenAccounts.add(item.pubkey);
    const encoded = item.account?.data?.[0];
    if (typeof encoded !== "string" || encoded.length > 4 * Math.ceil(TOKEN_ACCOUNT_BYTES / 3)) {
      fail("UNSUPPORTED_ACCOUNT_LAYOUT");
    }
    work.decodeWork += item.pubkey.length + 64 + Math.ceil(encoded.length * 3 / 4);
    if (work.decodeWork > bounds.maxDecodeWork) fail("DECODE_WORK_LIMIT");
    const account = decodeTokenAccount(item, identity, programId, rejectNative);
    if (account.amount === 0n) zeroBalanceAccountCount += 1;
    owners.set(account.owner, (owners.get(account.owner) ?? 0n) + account.amount);
    sum += account.amount;
  }
  if (sum > U64_MAX || [...owners.values()].some(amount => amount > U64_MAX)) {
    fail("AMOUNT_OVERFLOW");
  }
  deadline.check();
  return {owners, sum, accountCount: accounts.length, decodeWork: work.decodeWork,
    zeroBalanceAccountCount};
}

function sortOwners(ownerMap) {
  return [...ownerMap].map(([owner, amount]) => ({owner, amountAtoms: amount.toString()}))
    .sort((left, right) => {
      const a = BigInt(left.amountAtoms);
      const b = BigInt(right.amountAtoms);
      return a === b ? left.owner.localeCompare(right.owner) : a > b ? -1 : 1;
    });
}

function unknownResult(identity, code, details = {}) {
  const boundIdentity = identity ?? null;
  const result = {
    status: "UNKNOWN",
    reason: code,
    source: RPC_SOURCE,
    boundIdentity,
    slot: details.slot ?? null,
    observedAt: details.observedAt ?? null,
    accountCoverage: "UNKNOWN",
    rawCensus: null,
    coverage: {
      complete: false,
      aggregation: "owner",
      exclusions: [],
      cryptographicCompleteness: false,
      reason: code
    },
    filterEvidence: boundIdentity ? {
      value: null,
      source: RPC_SOURCE,
      observedAt: details.observedAt ?? null,
      slot: details.slot ?? null,
      verified: false,
      coverage: {complete: false, aggregation: "owner", exclusions: []},
      binding: boundIdentity
    } : null,
    exclusionAssessment: {
      status: "UNKNOWN",
      suppliedEvidenceIgnored: details.poolExclusionEvidenceSupplied === true,
      reason: "NO_SUPPORTED_REVIEWED_POOL_EXCLUSION_DECODER"
    },
    developerAssociation: {status: "UNKNOWN", reason: "NOT_ESTABLISHED_BY_TOKEN_ACCOUNT_OWNER"},
    executionAuthorized: false,
    provenance: {
      endpoint: RPC_URL,
      method: RPC_METHOD,
      requestCount: details.requests ?? 0,
      responseBytes: details.responseBytes ?? 0,
      programId: details.requestPlan?.programId ?? null,
      commitment: details.requestPlan?.commitment ?? null,
      bounds: details.bounds ?? null,
      trust: "UNAUTHENTICATED_RPC_RESPONSE"
    }
  };
  if (details.requestPlan) result.requestPlan = details.requestPlan;
  if (details.mintSlot !== undefined) result.mintSlot = details.mintSlot;
  if (details.mintObservedAt !== undefined) result.mintObservedAt = details.mintObservedAt;
  if (details.slotSkew !== undefined) result.slotSkew = details.slotSkew;
  if (details.timeSkewMs !== undefined) result.timeSkewMs = details.timeSkewMs;
  return result;
}

function makeRequestPlan(identity, programId) {
  const request = makeRequest(identity, programId);
  return {
    url: request.url,
    method: request.method,
    credentials: request.credentials,
    redirect: request.redirect,
    rpcMethod: RPC_METHOD,
    programId,
    commitment: "finalized",
    encoding: "base64",
    withContext: true,
    filters: [{memcmp: {offset: 0, bytes: identity.mint}}],
    requestCount: 1,
    pagination: false,
    retry: false
  };
}

function prospectiveBounds(input = {}) {
  if (!isRecord(input) || Object.keys(input).some(key =>
    !Object.hasOwn(PROSPECTIVE_CENSUS_BOUNDS, key))) fail("INVALID_BOUNDS");
  const bounds = {...PROSPECTIVE_CENSUS_BOUNDS, ...input};
  for (const [key, ceiling] of Object.entries(PROSPECTIVE_CENSUS_BOUNDS)) {
    if (!Number.isSafeInteger(bounds[key]) || bounds[key] < 1 || bounds[key] > ceiling) {
      fail("INVALID_BOUNDS");
    }
  }
  return bounds;
}

function rawBytes(bytes) {
  return {
    encoding: "base64",
    byteLength: bytes.length,
    bytes: Buffer.from(bytes).toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function prospectiveRpc(bytes) {
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch { fail("INVALID_JSON"); }
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== 1 ||
      Object.hasOwn(payload, "error") || !isRecord(payload.result) ||
      Object.keys(payload.result).some(key => !["context", "value"].includes(key)) ||
      !isRecord(payload.result.context) ||
      !Number.isSafeInteger(payload.result.context.slot) || payload.result.context.slot < 0) {
    fail("INVALID_RPC_RESPONSE");
  }
  return payload.result;
}

export async function captureProspectiveOwnerCensus({
  enabled = false, identity, bounds: inputBounds, transport, clock, signal
} = {}) {
  if (enabled !== true) return {status: "DISABLED", executionAuthorized: false};
  let boundIdentity = null;
  let bounds;
  let deadline;
  let startedAt = null;
  let endedAt = null;
  let attempts = 0;
  let requests = 0;
  let responseBytes = 0;
  let requestBytes = 0;
  const work = {decodeWork: 0};
  const exchanges = [];
  const pairs = [];
  let lastWallTime = null;
  const wallTime = () => {
    const now = parseTime(clock());
    if (now === null || (lastWallTime !== null && now < lastWallTime)) fail("INVALID_CLOCK");
    lastWallTime = now;
    if (startedAt !== null && now - startedAt >= bounds.maxElapsedMs) fail("TIMEOUT");
    return now;
  };
  const consumed = () => ({
    attempts, requests, requestBytes, responseBytes, decodeWork: work.decodeWork,
    elapsedMs: deadline?.elapsedMs() ?? 0,
    acquisitionWallElapsedMs: startedAt === null || endedAt === null ? null : endedAt - startedAt
  });
  const resultDetails = () => ({
    requests, responseBytes, bounds,
    requestPlan: boundIdentity ? makeRequestPlan(boundIdentity, LEGACY_TOKEN_PROGRAM) : undefined
  });
  try {
    boundIdentity = validateIdentity(identity);
    if (NATIVE_MINTS.has(boundIdentity.mint)) fail("NATIVE_MINT_EXCLUDED");
    bounds = prospectiveBounds(inputBounds);
    if (typeof transport !== "function" || typeof clock !== "function" ||
        (signal !== undefined && (!signal || typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function" || typeof signal.aborted !== "boolean"))) {
      fail("INVALID_TRANSPORT_OR_CLOCK");
    }
    startedAt = wallTime();
    deadline = createDeadline(signal, bounds.maxElapsedMs);
    const requestRpc = async (method, params) => {
      deadline.check();
      wallTime();
      if (requests >= bounds.maxRequests) fail("REQUEST_LIMIT");
      const request = Object.freeze({
        ...makeRequest(boundIdentity, LEGACY_TOKEN_PROGRAM),
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})
      });
      const requestStartedAt = wallTime();
      let response;
      let bodyReadStarted = false;
      try {
        response = await deadline.wait(Promise.resolve().then(() => {
          deadline.check();
          requests += 1;
          requestBytes += Buffer.byteLength(request.body);
          return transport(request, {
            credentials: "omit", redirect: "error", signal: deadline.signal
          });
        }).then(received => {
          try { deadline.check(); } catch (error) {
            cancelBody(received?.body);
            throw error;
          }
          response = received;
          return received;
        }));
        validateResponseTarget(response);
        const contentLength = response.headers?.get("content-length");
        if (contentLength !== undefined && contentLength !== null &&
            (!/^\d{1,16}$/.test(contentLength) ||
             !Number.isSafeInteger(Number(contentLength)))) fail("INVALID_RESPONSE_HEADERS");
        if (contentLength != null && Number(contentLength) > bounds.maxResponseBytes - responseBytes) {
          fail("RESPONSE_BYTE_LIMIT");
        }
        bodyReadStarted = true;
        const previousBytes = responseBytes;
        const streamed = await readBoundedBody(response, bounds.maxResponseBytes - previousBytes,
          deadline, count => { responseBytes = previousBytes + count; });
        const responseEndedAt = wallTime();
        if (contentLength != null && Number(contentLength) !== streamed.byteCount) {
          fail("TRUNCATED_RESPONSE");
        }
        exchanges.push({
          attempt: attempts, rpcMethod: method, requestStartedAt, responseEndedAt,
          request: {...request, body: rawBytes(Buffer.from(request.body, "utf8"))},
          response: {status: response.status, body: rawBytes(streamed.bytes)}
        });
        deadline.check();
        if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
          fail(response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR");
        }
        const rpc = prospectiveRpc(streamed.bytes);
        deadline.check();
        return rpc;
      } finally {
        if (!bodyReadStarted) cancelBody(response?.body);
      }
    };
    while (attempts < bounds.maxAttempts) {
      if (requests + 2 > bounds.maxRequests) fail("REQUEST_LIMIT");
      attempts += 1;
      const census = await requestRpc("getProgramAccounts", [LEGACY_TOKEN_PROGRAM, {
        commitment: "finalized", encoding: "base64", withContext: true,
        filters: [{memcmp: {offset: 0, bytes: boundIdentity.mint}}]
      }]);
      if (!Array.isArray(census.value)) fail("INVALID_RPC_RESPONSE");
      const totals = await ownerTotals(census.value, boundIdentity, LEGACY_TOKEN_PROGRAM,
        bounds, deadline, {work, rejectNative: true});
      const mintRpc = await requestRpc("getAccountInfo", [boundIdentity.mint, {
        commitment: "finalized", encoding: "base64", minContextSlot: census.context.slot
      }]);
      const pair = {
        attempt: attempts, censusSlot: String(census.context.slot),
        mintSlot: String(mintRpc.context.slot), sameSlot: census.context.slot === mintRpc.context.slot
      };
      pairs.push(pair);
      if (!pair.sameSlot) continue;
      if (!isRecord(mintRpc.value) || mintRpc.value.owner !== LEGACY_TOKEN_PROGRAM) {
        fail("UNSUPPORTED_TOKEN_PROGRAM");
      }
      if (mintRpc.value.executable !== false) fail("MALFORMED_MINT_ACCOUNT");
      const data = mintRpc.value.data;
      if (!Array.isArray(data) || data.length !== 2 || data[1] !== "base64" ||
          typeof data[0] !== "string" || data[0].length !== 112) fail("UNSUPPORTED_MINT_LAYOUT");
      work.decodeWork += data[0].length + 82 + boundIdentity.mint.length;
      if (work.decodeWork > bounds.maxDecodeWork) fail("DECODE_WORK_LIMIT");
      const mintBytes = Buffer.from(data[0], "base64");
      if (mintBytes.length !== 82 || mintBytes.toString("base64") !== data[0]) {
        fail("UNSUPPORTED_MINT_LAYOUT");
      }
      const mintEvidence = decodeMintSafetyEvidence({
        chainId: "solana", expectedMint: boundIdentity.mint,
        requestedMint: boundIdentity.mint, accountPubkey: boundIdentity.mint,
        observedAt: wallTime(), rpcResult: mintRpc
      });
      if (mintEvidence.status !== "DECODED_UNVERIFIED") fail("MINT_EVIDENCE_INVALID");
      const mint = validateMintEvidence(mintEvidence, boundIdentity);
      if (totals.sum !== mint.supply) fail("SUPPLY_MISMATCH");
      const owners = sortOwners(totals.owners);
      deadline.check();
      endedAt = wallTime();
      const result = unknownResult(boundIdentity,
        "SAME_SLOT_RECONCILED_BUT_SOURCE_COMPLETENESS_IS_UNAUTHENTICATED",
        {...resultDetails(), slot: pair.censusSlot, observedAt: endedAt});
      result.requestPlan = {
        ...result.requestPlan, requestCount: requests, retry: "SLOT_MISMATCH_ONLY",
        maxAttempts: bounds.maxAttempts, rpcMethods: ["getProgramAccounts", "getAccountInfo"],
        exactSlotSelector: false
      };
      result.provenance.decodeWork = work.decodeWork;
      result.provenance.retries = attempts - 1;
      result.accountCoverage = "RECONCILED_RPC_RESPONSE_ONLY";
      result.rawCensus = {
        accountCount: totals.accountCount,
        zeroBalanceAccountCount: totals.zeroBalanceAccountCount,
        positiveOwnerCount: owners.filter(owner => BigInt(owner.amountAtoms) > 0n).length,
        distinctOwnerCount: owners.length,
        observedAmountAtoms: totals.sum.toString(), mintSupplyAtoms: mint.supply.toString(),
        owners
      };
      result.coverage.supplyReconciled = true;
      result.coverage.sourceCompletenessAuthenticated = false;
      result.authorizationEligible = false;
      result.hardGateEligible = false;
      deadline.check();
      endedAt = wallTime();
      result.observedAt = endedAt;
      result.filterEvidence.observedAt = endedAt;
      result.capture = {
        schema: "MERIDIAN_PROSPECTIVE_SAME_SLOT_CENSUS_V1",
        status: "RECONCILED_DIAGNOSTIC_ONLY",
        slot: pair.censusSlot, acquisitionStartedAt: startedAt, acquisitionEndedAt: endedAt,
        timeBasis: "LOCAL_ACQUISITION_TIME_NOT_HISTORICAL_STATE_TIME",
        bounds, consumed: consumed(), pairs, exchanges
      };
      deadline.check();
      return result;
    }
    fail("SLOT_RACE_EXHAUSTED");
  } catch (error) {
    try {
      const now = parseTime(typeof clock === "function" ? clock() : null);
      if (now !== null && startedAt !== null && now >= lastWallTime) endedAt = now;
    } catch {}
    const reason = error instanceof CensusFailure ? error.code
      : deadline?.reasonCode() ?? "CENSUS_FAILED";
    return {
      ...unknownResult(boundIdentity, reason, {requests, responseBytes, bounds}),
      authorizationEligible: false, hardGateEligible: false,
      capture: {
        status: "FAILED", acquisitionStartedAt: startedAt, acquisitionEndedAt: endedAt,
        timeBasis: "LOCAL_ACQUISITION_TIME_NOT_HISTORICAL_STATE_TIME",
        bounds: bounds ?? null, consumed: consumed(), pairs, exchanges
      }
    };
  } finally {
    deadline?.close();
  }
}

export async function acquireOwnerCensus({
  identity,
  manifest,
  transport,
  clock,
  signal,
  mintEvidence,
  poolExclusionEvidence
} = {}) {
  let boundIdentity = null;
  let bounds;
  let mint;
  let requestPlan;
  let requests = 0;
  let responseBytes = 0;
  let deadline;
  let response;
  let bodyReadStarted = false;
  let observedAt = null;
  let slot = null;
  const poolExclusionEvidenceSupplied = poolExclusionEvidence !== undefined &&
    poolExclusionEvidence !== null;
  try {
    boundIdentity = validateIdentity(identity);
    bounds = validateBounds(manifest);
    if (typeof transport !== "function" || typeof clock !== "function" ||
        (signal !== undefined && (!signal || typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function" || typeof signal.aborted !== "boolean"))) {
      fail("INVALID_TRANSPORT_OR_CLOCK");
    }
    mint = validateMintEvidence(mintEvidence, boundIdentity);
    const startedAt = parseTime(clock());
    if (startedAt === null) fail("INVALID_CLOCK");
    requestPlan = makeRequestPlan(boundIdentity, mint.programId);
    const request = makeRequest(boundIdentity, mint.programId);
    deadline = createDeadline(signal, bounds.maxElapsedMs);
    await deadline.wait(Promise.resolve().then(() => {
      deadline.check();
      requests += 1;
      return transport(request, {
        credentials: "omit",
        redirect: "error",
        signal: deadline.signal
      });
    }).then(received => {
      if (deadline.signal.aborted) cancelBody(received?.body);
      else response = received;
      return received;
    }));
    observedAt = parseTime(clock());
    if (observedAt === null) fail("INVALID_CLOCK");
    validateResponseTarget(response);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      fail(response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR");
    }
    const contentLength = response.headers?.get("content-length");
    if (contentLength !== undefined && contentLength !== null) {
      if (!/^\d{1,16}$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
        fail("INVALID_RESPONSE_HEADERS");
      }
      if (Number(contentLength) > bounds.maxResponseBytes) fail("RESPONSE_BYTE_LIMIT");
    }
    bodyReadStarted = true;
    const streamed = await readBoundedBody(response, bounds.maxResponseBytes, deadline,
      count => { responseBytes = count; });
    const rpc = parseRpcResponse(streamed.bytes);
    deadline.check();
    slot = rpc.slot.toString();
    const slotSkew = rpc.slot >= mint.slot ? rpc.slot - mint.slot : mint.slot - rpc.slot;
    if (slotSkew > BigInt(bounds.maxSlotSkew)) {
      fail("SLOT_SKEW", {slot, mintSlot: mint.slot.toString(), slotSkew: slotSkew.toString()});
    }
    const timeSkewMs = Math.abs(observedAt - mint.observedAt);
    if (timeSkewMs > bounds.maxTimeSkewMs) {
      fail("TIME_SKEW", {slot, mintSlot: mint.slot.toString(), timeSkewMs});
    }
    const totals = await ownerTotals(rpc.accounts, boundIdentity, mint.programId, bounds, deadline);
    if (totals.sum !== mint.supply) {
      fail("SUPPLY_MISMATCH", {
        slot,
        mintSlot: mint.slot.toString(),
        observedAtoms: totals.sum.toString(),
        mintSupplyAtoms: mint.supply.toString()
      });
    }
    const finishedAt = parseTime(clock());
    if (finishedAt === null || finishedAt < startedAt || observedAt < startedAt ||
        observedAt > finishedAt || mint.observedAt > finishedAt ||
        finishedAt - startedAt > bounds.maxElapsedMs ||
        finishedAt - observedAt > bounds.maxEvidenceAgeMs ||
        finishedAt - mint.observedAt > bounds.maxEvidenceAgeMs) {
      fail("STALE_OR_ELAPSED");
    }
    const owners = sortOwners(totals.owners);
    deadline.check();
    const result = {
      status: "UNKNOWN",
      reason: "RPC_CENSUS_RECONCILED_BUT_SOURCE_COMPLETENESS_IS_UNAUTHENTICATED",
      source: RPC_SOURCE,
      boundIdentity,
      slot,
      observedAt,
      mintSlot: mint.slot.toString(),
      mintObservedAt: mint.observedAt,
      accountCoverage: "RECONCILED_RPC_RESPONSE_ONLY",
      rawCensus: {
        accountCount: totals.accountCount,
        ownerCount: owners.length,
        observedAmountAtoms: totals.sum.toString(),
        mintSupplyAtoms: mint.supply.toString(),
        owners,
        largestOwners: owners.slice(0, 10)
      },
      coverage: {
        complete: false,
        accountResponseWithinBounds: true,
        supplyReconciled: true,
        aggregation: "owner",
        exclusions: [],
        poolExclusion: "UNKNOWN",
        burnedSupplySubtracted: false,
        developerAssociation: "UNKNOWN",
        cryptographicCompleteness: false,
        sourceCompletenessAuthenticated: false
      },
      filterEvidence: {
        value: null,
        source: RPC_SOURCE,
        observedAt,
        slot,
        verified: false,
        coverage: {
          complete: false,
          aggregation: "owner",
          denominatorAtoms: mint.supply.toString(),
          exclusions: []
        },
        binding: boundIdentity
      },
      exclusionAssessment: {
        status: "UNKNOWN",
        suppliedEvidenceIgnored: poolExclusionEvidenceSupplied,
        reason: "NO_SUPPORTED_REVIEWED_POOL_EXCLUSION_DECODER"
      },
      developerAssociation: {
        status: "UNKNOWN",
        reason: "A_LARGEST_OWNER_IS_NOT_DEVELOPER_ATTRIBUTION"
      },
      executionAuthorized: false,
      provenance: {
        endpoint: RPC_URL,
        method: RPC_METHOD,
        programId: mint.programId,
        commitment: "finalized",
        encoding: "base64",
        requestCount: requests,
        responseBytes,
        accountCount: totals.accountCount,
        decodeWork: totals.decodeWork,
        bounds: {...bounds},
        slotSkew: slotSkew.toString(),
        timeSkewMs,
        trust: "UNAUTHENTICATED_RPC_RESPONSE",
        retries: 0,
        pagination: false
      },
      requestPlan
    };
    deadline.check();
    return result;
  } catch (error) {
    const code = error instanceof CensusFailure ? error.code
      : deadline?.reasonCode() ?? "CENSUS_FAILED";
    return unknownResult(boundIdentity, code, {
      requests,
      responseBytes,
      observedAt,
      slot,
      mintSlot: mint?.slot?.toString(),
      mintObservedAt: mint?.observedAt,
      bounds,
      requestPlan,
      poolExclusionEvidenceSupplied,
      ...(error instanceof CensusFailure ? error.details : {})
    });
  } finally {
    if (!bodyReadStarted) cancelBody(response?.body);
    deadline?.close();
  }
}
