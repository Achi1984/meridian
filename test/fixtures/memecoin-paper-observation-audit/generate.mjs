const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodedIndex(value) {
  let number = value;
  let result = "";
  while (number > 0) {
    result = BASE58[number % BASE58.length] + result;
    number = Math.floor(number / BASE58.length);
  }
  return result || "1";
}

function address(value) {
  const suffix = encodedIndex(value);
  return `${"B".repeat(32 - suffix.length)}${suffix}`;
}

export function createObservationFixture(count = 159) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 300) {
    throw new TypeError("fixture candidate count must be between 1 and 300");
  }
  const candidates = Array.from({length: count}, (_, index) => ({
    chainId: "solana",
    mint: address(index * 3 + 1),
    pool: address(index * 3 + 2),
    quote: address(index * 3 + 3)
  }));
  const providerEvents = candidates.flatMap((candidate, candidateIndex) => [
    {provider: "DexScreener public API", endpointKind: "pair", status: "RECEIVED"},
    {provider: "Solana JSON-RPC", endpointKind: "getAccountInfo", status: "HTTP_429"},
    {provider: "Solana JSON-RPC", endpointKind: "getTokenLargestAccounts", status: "TIMEOUT"},
    {provider: "Solana JSON-RPC", endpointKind: "getTokenSupply", status: "RECEIVED"}
  ].map((event, requestIndex) => ({
    requestId: requestIndex + 1,
    provider: event.provider,
    endpointKind: event.endpointKind,
    requested: candidate,
    returned: event.status === "RECEIVED" ? candidate : null,
    status: event.status,
    reason: event.status === "RECEIVED" ? null : `${event.status} from generated fixture`,
    requestedAt: 1_800_000_001_000 + candidateIndex,
    receivedAt: event.status === "TIMEOUT" ? null : 1_800_000_001_010 + candidateIndex,
    observedAtBasis: "response-receipt-not-source-event-time",
    bytes: event.status === "RECEIVED" ? 16 : 0
  })));
  const accounting = {
    requests: providerEvents.length,
    bytes: providerEvents.reduce((sum, event) => sum + event.bytes, 0),
    providerEvents: providerEvents.length,
    dexRequests: count,
    rpcRequests: count * 3,
    candidates: count
  };
  return {candidates, providerEvents, accounting};
}

export function createBlockedDecisions() {
  const checks = Object.fromEntries([
    "identity", "pairAge", "marketCap", "tokenDecimals", "mintAuthority",
    "freezeAuthority", "lpProtection", "liquidity", "volume1h", "top10Owners",
    "devHoldings", "priorRug", "bundledLaunch", "priceRunup", "tokenExtensions"
  ].map(name => [name, {
    status: "UNKNOWN",
    reason: "required evidence missing",
    source: null,
    observedAt: null
  }]));
  return {
    filters: {status: "UNKNOWN", reason: null, checks},
    analysis: {
      status: "BLOCKED",
      reason: "hard filters must all PASS before scoring",
      components: {}
    }
  };
}
