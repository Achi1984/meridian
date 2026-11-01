import {assertAllowedSolanaRpcMethod} from "./adapters.mjs";
import {PILOT_DEPENDENCY_PINS} from "./pilot-online.mjs";

const DEX_ORIGIN = "https://api.dexscreener.com";
const RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
const DEX_PATH = /^\/latest\/dex\/pairs\/solana\/[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const pins = Object.freeze({...PILOT_DEPENDENCY_PINS});

export function createPublicTransport(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new TypeError("a Fetch-compatible transport is required");
  return async (request, options = {}) => {
    if (!request || typeof request !== "object" || typeof request.url !== "string" ||
        request.redirect !== "error" || request.credentials !== "omit" ||
        options.redirect !== "error" || options.credentials !== "omit") {
      throw new TypeError("provider request must retain the fixed public read-only policy");
    }
    const url = new URL(request.url);
    if (url.username || url.password || url.search || url.hash) {
      throw new TypeError("provider request URL is outside the fixed public boundary");
    }
    const expectedHeaders = request.provider === "dex"
      ? {accept: "application/json"}
      : {accept: "application/json", "content-type": "application/json"};
    if (!request.headers || Object.keys(request.headers).sort().join(",") !==
        Object.keys(expectedHeaders).sort().join(",") ||
        Object.entries(expectedHeaders).some(([name, value]) => request.headers[name] !== value)) {
      throw new TypeError("provider request headers are outside the fixed public boundary");
    }
    if (request.provider === "dex") {
      if (url.origin !== DEX_ORIGIN || request.method !== "GET" || !DEX_PATH.test(url.pathname) ||
          request.requested?.pool !== url.pathname.split("/").at(-1) || request.body !== undefined) {
        throw new TypeError("DexScreener request is outside the fixed read-only boundary");
      }
    } else if (request.provider === "rpc") {
      if (url.origin !== RPC_ORIGIN || url.pathname !== "/" || request.method !== "POST") {
        throw new TypeError("Solana RPC request is outside the fixed read-only boundary");
      }
      let payload;
      try { payload = JSON.parse(request.body); } catch {
        throw new TypeError("Solana RPC body is invalid");
      }
      assertAllowedSolanaRpcMethod(payload?.method);
      if (payload?.jsonrpc !== "2.0" || payload.id !== request.id ||
          payload.method !== request.kind || payload.params?.[0] !== request.requested?.mint) {
        throw new TypeError("Solana RPC request identity is not bound to the provider request");
      }
    } else {
      throw new TypeError("provider is outside the fixed public boundary");
    }
    return fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : {body: request.body}),
      signal: options.signal,
      redirect: "error",
      credentials: "omit"
    });
  };
}

export async function createPinnedAssembly({fetchImpl = globalThis.fetch} = {}) {
  const [provider, controller, report] = await Promise.all([
    import("./provider-evidence.mjs"),
    import("./pilot-run-control.mjs"),
    import("./operator-report.mjs")
  ]);
  if (typeof provider.acquireProviderEvidence !== "function" ||
      typeof controller.createPilotRunControl !== "function" ||
      controller.READ_ONLY_PAPER !== "READ_ONLY_PAPER" ||
      controller.PILOT_EVIDENCE_SOURCE?.READ_ONLY_PAPER !== "READ_ONLY_PROVIDER_CALLBACK" ||
      typeof report.projectOperatorReport !== "function" ||
      typeof report.renderOperatorReport !== "function") {
    throw new TypeError("pinned Paper producer exports do not match the reviewed assembly contract");
  }
  return Object.freeze({
    pins,
    acquireProviderEvidence: provider.acquireProviderEvidence,
    createPilotRunControl: controller.createPilotRunControl,
    projectOperatorReport: report.projectOperatorReport,
    renderOperatorReport: report.renderOperatorReport,
    freshnessPolicy: Object.freeze({
      maxAcquisitionDurationMs: 30_000,
      maxPairAgeMs: 72 * 60 * 60 * 1000,
      maxFutureSkewMs: 0
    }),
    transport: createPublicTransport(fetchImpl)
  });
}
