const RPC_URL = "https://api.mainnet-beta.solana.com";
const RPC_METHOD = "getProgramAccounts";
const RPC_SOURCE = "Solana JSON-RPC getProgramAccounts";
const LEGACY_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAMS = new Set([LEGACY_TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const TOKEN_ACCOUNT_BYTES = 165;
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
  return {
    signal: controller.signal,
    wait: value => Promise.race([Promise.resolve(value), aborted]),
    reasonCode: () => reasonCode,
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

async function readBoundedBody(response, maxBytes, deadline, onByteCount) {
  if (!response?.body || typeof response.body.getReader !== "function") fail("INVALID_RESPONSE_BODY");
  const reader = response.body.getReader();
  const chunks = [];
  let byteCount = 0;
  const cancel = () => {
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
  };
  try {
    while (true) {
      const {done, value} = await deadline.wait(reader.read());
      if (done) break;
      if (!(value instanceof Uint8Array)) fail("INVALID_RESPONSE_BODY");
      if (value.byteLength > maxBytes - byteCount) {
        onByteCount(byteCount + value.byteLength);
        cancel();
        fail("RESPONSE_BYTE_LIMIT", {responseBytes: byteCount + value.byteLength});
      }
      byteCount += value.byteLength;
      onByteCount(byteCount);
      chunks.push(value);
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
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

function decodeTokenAccount(item, identity, programId) {
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
  const owner = encodeBase58(bytes.subarray(32, 64));
  if (!decodeBase58(owner)) fail("MALFORMED_TOKEN_ACCOUNT");
  return {
    pubkey: item.pubkey,
    owner,
    amount: bytes.readBigUInt64LE(64)
  };
}

function ownerTotals(accounts, identity, programId, bounds) {
  if (accounts.length > bounds.maxAccounts) fail("ACCOUNT_COUNT_LIMIT");
  const seenAccounts = new Set();
  const owners = new Map();
  let decodeWork = 0;
  let sum = 0n;
  for (const item of accounts) {
    if (!isRecord(item) || typeof item.pubkey !== "string") fail("MALFORMED_PROGRAM_ACCOUNT");
    if (seenAccounts.has(item.pubkey)) fail("DUPLICATE_TOKEN_ACCOUNT");
    seenAccounts.add(item.pubkey);
    const encoded = item.account?.data?.[0];
    if (typeof encoded !== "string" || encoded.length > 4 * Math.ceil(TOKEN_ACCOUNT_BYTES / 3)) {
      fail("UNSUPPORTED_ACCOUNT_LAYOUT");
    }
    decodeWork += item.pubkey.length + 64 + Math.ceil(encoded.length * 3 / 4);
    if (decodeWork > bounds.maxDecodeWork) fail("DECODE_WORK_LIMIT");
    const account = decodeTokenAccount(item, identity, programId);
    owners.set(account.owner, (owners.get(account.owner) ?? 0n) + account.amount);
    sum += account.amount;
  }
  if (sum > U64_MAX || [...owners.values()].some(amount => amount > U64_MAX)) {
    fail("AMOUNT_OVERFLOW");
  }
  return {owners, sum, accountCount: accounts.length, decodeWork};
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
    if (deadline.signal.aborted) fail("CANCELLED");
    requests += 1;
    const response = await deadline.wait(Promise.resolve().then(() => transport(request, {
      credentials: "omit",
      redirect: "error",
      signal: deadline.signal
    })));
    observedAt = parseTime(clock());
    if (observedAt === null) fail("INVALID_CLOCK");
    validateResponseTarget(response);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      fail(response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR");
    }
    const streamed = await readBoundedBody(response, bounds.maxResponseBytes, deadline,
      count => { responseBytes = count; });
    const rpc = parseRpcResponse(streamed.bytes);
    slot = rpc.slot.toString();
    const slotSkew = rpc.slot >= mint.slot ? rpc.slot - mint.slot : mint.slot - rpc.slot;
    if (slotSkew > BigInt(bounds.maxSlotSkew)) {
      fail("SLOT_SKEW", {slot, mintSlot: mint.slot.toString(), slotSkew: slotSkew.toString()});
    }
    const timeSkewMs = Math.abs(observedAt - mint.observedAt);
    if (timeSkewMs > bounds.maxTimeSkewMs) {
      fail("TIME_SKEW", {slot, mintSlot: mint.slot.toString(), timeSkewMs});
    }
    const totals = ownerTotals(rpc.accounts, boundIdentity, mint.programId, bounds);
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
    return {
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
    deadline?.close();
  }
}
