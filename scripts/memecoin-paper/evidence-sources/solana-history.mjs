import {createHash} from "node:crypto";

export const SOLANA_HISTORY_SCHEMA = "MERIDIAN_SOLANA_SWAP_HISTORY_V1";
export const SOLANA_RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
export const HISTORY_LIMITS = Object.freeze({
  maxSignatures: 200,
  maxTransactions: 100,
  maxRequests: 101,
  maxBytesPerResponse: 1_048_576,
  maxDurationMs: 30_000
});
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const unknown = (reason, events = [], counters = {requests:0, bytes:0}) => ({
  status: "UNKNOWN", reason, schemaVersion: SOLANA_HISTORY_SCHEMA,
  sourceAuthentication: "NOT_ESTABLISHED",
  clockTrust: "INJECTED_LOCAL_CLOCK_UNVERIFIED",
  executionAuthorized: false, events, counters, observations: []
});

function validAddress(value) { return typeof value === "string" && ADDRESS.test(value); }
function limitsOf(input = {}) {
  if (!isRecord(input) || Object.keys(input).some(k => !(k in HISTORY_LIMITS))) throw new TypeError("unknown history limit");
  const result = {...HISTORY_LIMITS, ...input};
  for (const [k,max] of Object.entries(HISTORY_LIMITS)) {
    if (!Number.isSafeInteger(result[k]) || result[k] < 1 || result[k] > max) throw new TypeError("invalid history limit");
  }
  return result;
}
function responseDigest(payload) { return sha256(JSON.stringify(payload)); }
function checkResponse(response) {
  if (!isRecord(response) || response.jsonrpc !== "2.0" || !Number.isSafeInteger(response.id)) throw new Error("INVALID_RPC_RESPONSE");
  if (Object.hasOwn(response, "error")) throw new Error("RPC_ERROR");
  return response.result;
}
function extractDelta(balances, mint, vaults) {
  if (!Array.isArray(balances)) return null;
  const sums = new Map();
  for (const row of balances) {
    if (!isRecord(row) || row.mint !== mint || !Number.isSafeInteger(row.accountIndex) ||
        !isRecord(row.uiTokenAmount) || typeof row.uiTokenAmount.amount !== "string" ||
        !/^\d+$/.test(row.uiTokenAmount.amount) || !Number.isSafeInteger(row.uiTokenAmount.decimals)) return null;
    const owner = typeof row.owner === "string" ? row.owner : null;
    if (!owner) return null;
    sums.set(owner, (sums.get(owner) ?? 0n) + BigInt(row.uiTokenAmount.amount));
  }
  return sums;
}
function accountAddress(row) {
  return typeof row === "string" ? row : row?.pubkey;
}
function decodeSwap(result, {mint, pool, selectedMintVault}) {
  if (!isRecord(result) || !isRecord(result.transaction) || !isRecord(result.meta) ||
      result.meta.err !== null) return null;
  const message = result.transaction.message;
  const keys = message?.accountKeys;
  if (!Array.isArray(keys) || !keys.some(row => accountAddress(row) === pool)) return null;
  const logs = result.meta.logMessages;
  if (!Array.isArray(logs) || !logs.some(line => typeof line === "string" && /raydium.*swap|swap.*raydium/i.test(line))) return null;
  const pre = extractDelta(result.meta.preTokenBalances, mint, {selectedMintVault});
  const post = extractDelta(result.meta.postTokenBalances, mint, {selectedMintVault});
  if (!pre || !post) return null;
  const owners = new Set([...pre.keys(), ...post.keys()]);
  const vaultOwner = selectedMintVault ?? null;
  // Pool and trader deltas cancel globally; measure the non-vault trader delta.
  let net = 0n;
  for (const owner of owners) {
    if (owner !== vaultOwner) net += (post.get(owner) ?? 0n) - (pre.get(owner) ?? 0n);
  }
  if (net === 0n) return null;
  const vaultDelta = vaultOwner ? (post.get(vaultOwner) ?? 0n) - (pre.get(vaultOwner) ?? 0n) : null;
  const direction = vaultDelta !== null && vaultDelta < 0n ? "BUY"
    : vaultDelta !== null && vaultDelta > 0n ? "SELL" : null;
  if (!direction) return null;
  return {
    signature: result.signature,
    slot: result.slot,
    blockTime: result.blockTime ?? null,
    mint, pool, direction,
    baseAmountRaw: String(net < 0n ? -net : net),
    source: "Solana JSON-RPC getTransaction",
    sourceAuthentication: "NOT_ESTABLISHED"
  };
}
async function request({transport, signal, id, method, params, events, counters, limits, clock, started}) {
  if (counters.requests >= limits.maxRequests || performance.now() - started > limits.maxDurationMs) throw new Error("WORK_LIMIT");
  const requestedAt = clock();
  const body = JSON.stringify({jsonrpc:"2.0",id,method,params});
  const response = await transport({
    url: SOLANA_RPC_ORIGIN, method:"POST",
    headers: Object.freeze({"content-type":"application/json","accept":"application/json"}),
    body, redirect:"error", credentials:"omit", signal
  });
  if (response?.url && response.url !== SOLANA_RPC_ORIGIN) throw new Error("ORIGIN_MISMATCH");
  const text = await response.text();
  counters.requests += 1;
  counters.bytes += Buffer.byteLength(text);
  if (counters.bytes > limits.maxBytesPerResponse * limits.maxRequests ||
      Buffer.byteLength(text) > limits.maxBytesPerResponse) throw new Error("BYTE_LIMIT");
  let payload; try { payload = JSON.parse(text); } catch { throw new Error("INVALID_JSON"); }
  const result = checkResponse(payload);
  events.push({requestId:id,method,requestedAt,receivedAt:clock(),responseBytes:Buffer.byteLength(text),responseSha256:sha256(text),slot:result?.context?.slot ?? result?.slot ?? null});
  if (signal?.aborted) throw new Error("CANCELLED");
  return result;
}
export async function collectSolanaSwapHistory({
  enabled=false, transport, clock=Date.now, signal=new AbortController().signal,
  mint, pool, selectedMintVault=null, launchWindow, limits: inputLimits
} = {}) {
  if (enabled !== true) return {status:"DISABLED",networkAccessed:false,executionAuthorized:false,observations:[],events:[],counters:{requests:0,bytes:0}};
  if (typeof transport !== "function" || typeof clock !== "function" ||
      !validAddress(mint) || !validAddress(pool) ||
      (selectedMintVault !== null && !validAddress(selectedMintVault)) ||
      !isRecord(launchWindow) || !Number.isSafeInteger(launchWindow.from) ||
      !Number.isSafeInteger(launchWindow.to) || launchWindow.from < 0 ||
      launchWindow.to < launchWindow.from) return unknown("INVALID_CONTRACT");
  const limits=limitsOf(inputLimits), events=[], counters={requests:0,bytes:0}, observations=[];
  const started=performance.now();
  try {
    const signatures=await request({transport,signal,id:1,method:"getSignaturesForAddress",
      params:[pool,{limit:limits.maxSignatures,commitment:"finalized"}],events,counters,limits,clock,started});
    if (!Array.isArray(signatures)) return unknown("INVALID_SIGNATURE_RESPONSE",events,counters);
    const bounded=signatures.slice(0,limits.maxSignatures);
    for (const item of bounded) {
      if (!isRecord(item) || typeof item.signature !== "string" || !Number.isSafeInteger(item.slot) ||
          item.slot < 0 || item.err !== null) continue;
      const tx=await request({transport,signal,id:counters.requests+1,method:"getTransaction",
        params:[item.signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}],
        events,counters,limits,clock,started});
      if (!isRecord(tx) || !Number.isSafeInteger(tx.slot) || tx.slot < 0) continue;
      if (tx.blockTime !== null && tx.blockTime !== undefined &&
          (!Number.isSafeInteger(tx.blockTime) || tx.blockTime < launchWindow.from || tx.blockTime > launchWindow.to)) continue;
      if (tx.blockTime === null || tx.blockTime === undefined) continue;
      const decoded=decodeSwap({...tx,signature:item.signature},{mint,pool,selectedMintVault});
      if (decoded) observations.push(decoded);
    }
    return {status:"COLLECTED",schemaVersion:SOLANA_HISTORY_SCHEMA,mint,pool,
      launchWindow,events,counters,observations,sourceAuthentication:"NOT_ESTABLISHED",
      clockTrust:"INJECTED_LOCAL_CLOCK_UNVERIFIED",executionAuthorized:false,
      evidence:{complete:false,reason:"bounded history only; unsupported and incomplete transactions are excluded"}};
  } catch (error) {
    return unknown(typeof error?.message === "string" ? error.message : "SOURCE_FAILED",events,counters);
  }
}
