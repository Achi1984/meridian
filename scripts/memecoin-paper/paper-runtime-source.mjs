import {createHash} from "node:crypto";
import {canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {createMarketQuoteAdapter} from "./market-quote-adapter.mjs";
import {
  createPaperSourcePipeline,
  PAPER_SOURCE_PIPELINE_VERSION
} from "./paper-source-pipeline.mjs";

const PAPER_SOURCE_POLICY = Object.freeze({
  schemaVersion: "memecoin-paper-source-policy/v1",
  enabled: false,
  providers: Object.freeze([
    Object.freeze({
      name: "DexScreener public API",
      origin: "https://api.dexscreener.com",
      methods: Object.freeze(["GET /latest/dex/pairs/solana/{pool}"]),
      approved: false
    }),
    Object.freeze({
      name: "Solana mainnet public JSON-RPC",
      origin: "https://api.mainnet-beta.solana.com",
      methods: Object.freeze([
        "getAccountInfo", "getBlocks", "getBlockTime", "getProgramAccounts",
        "getSignaturesForAddress", "getSlot", "getTokenLargestAccounts",
        "getTokenSupply", "getTransaction"
      ]),
      approved: false
    }),
    Object.freeze({
      name: "Jupiter Swap API V2",
      origin: "https://api.jup.ag",
      methods: Object.freeze(["GET /swap/v2/order"]),
      approved: false
    })
  ]),
  missingRequirements: Object.freeze([
    "provider authenticity and source-time attestation",
    "complete historical archive and evidence census",
    "reviewed LP, developer, rug, bundled-supply, and wallet policies",
    "source-bound price and all five nonoverlapping USD cost components",
    "independent approval of this exact provider policy"
  ])
});

export const PAPER_RUNTIME_SOURCE_POLICY = PAPER_SOURCE_POLICY;
export const PAPER_RUNTIME_SOURCE_POLICY_SHA256 = createHash("sha256")
  .update(canonicalCheckpointBytes(PAPER_SOURCE_POLICY))
  .digest("hex");

export function createPaperRuntimeSourceAdapter(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Object.getOwnPropertySymbols(options).length !== 0 ||
      Object.getOwnPropertyNames(options).join(",") !== "sourcePolicySha256" ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(options, "sourcePolicySha256") ?? {}, "value")) {
    throw new TypeError("runtime source adapter options must be exact bounded data");
  }
  const {sourcePolicySha256} = options;
  if (sourcePolicySha256 !== PAPER_RUNTIME_SOURCE_POLICY_SHA256) {
    throw new TypeError("source policy digest does not match the module-owned policy");
  }

  const pipeline = createPaperSourcePipeline({
    enabled: false,
    mode: "EXTERNAL_READ_ONLY_INPUT"
  });
  const quoteAdapter = createMarketQuoteAdapter({enabled: false});

  return Object.freeze({
    async acquireCandidates({signal, remaining} = {}) {
      if (signal?.aborted) {
        return {status: "UNKNOWN", reason: "STOPPED", candidates: [], unresolved: []};
      }
      if (!remaining || !Number.isSafeInteger(remaining.requests) ||
          remaining.requests < 0 || !Number.isSafeInteger(remaining.bytes) ||
          remaining.bytes < 0 || !Number.isSafeInteger(remaining.candidates) ||
          remaining.candidates < 0) {
        return {
          status: "UNKNOWN",
          reason: "GLOBAL_BUDGET",
          candidates: [],
          unresolved: [...PAPER_SOURCE_POLICY.missingRequirements]
        };
      }
      return {
        status: "UNKNOWN",
        reason: "SOURCE_POLICY_UNAPPROVED",
        candidates: [],
        unresolved: [...PAPER_SOURCE_POLICY.missingRequirements],
        pipelineVersion: PAPER_SOURCE_PIPELINE_VERSION,
        pipelineEnabled: pipeline.enabled,
        quoteAdapterStatus: "DISABLED",
        networkAccessed: false
      };
    },
    async quote(request, options) {
      return quoteAdapter.getPaperQuote(request, options);
    }
  });
}
