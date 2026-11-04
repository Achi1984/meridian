import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createMarketQuoteAdapter} from "../scripts/memecoin-paper/market-quote-adapter.mjs";
import {
  SYNTHETIC_MINT, SYNTHETIC_POOL, SYNTHETIC_QUOTE
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {syntheticOrderResponse} from "./fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs";

const NOW = Date.parse("2026-11-01T18:00:00Z");
const SOURCE = "Jupiter Swap API V2 /order";
const SOL = "So11111111111111111111111111111111111111112";
const IDENTITY = Object.freeze({
  chainId: "solana", mint: SYNTHETIC_MINT, pool: SYNTHETIC_POOL,
  quote: SYNTHETIC_QUOTE, decimals: 6
});

function request(overrides = {}) {
  return {
    identity: IDENTITY, side: "ENTRY", amountAtoms: "100000000", quoteDecimals: 6,
    candidateSampledAt: NOW - 2_000, authorizedAt: NOW - 1_000, slippageBps: 50, ...overrides
  };
}

async function quoted({clock = () => NOW, req = request()} = {}) {
  const fixture = syntheticOrderResponse({
    inputMint: SYNTHETIC_QUOTE, outputMint: SYNTHETIC_MINT
  });
  const bytes = Buffer.from(JSON.stringify(fixture.body));
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => clock(),
    transport: async () => new Response(bytes, {
      status: 200, headers: {"content-type": "application/json"}
    })
  });
  const result = await adapter.getPaperQuote(req);
  return {adapter, result, bytes};
}

function receipt(result, mutate = () => {}) {
  const candidate = result.quoteCandidate;
  const value = {
    schemaVersion: "memecoin-paper-quote-cost-receipt-v1",
    evidenceLabel: "SYNTHETIC_FIXTURE_ONLY",
    evidenceId: "synthetic-cost-receipt-1",
    source: SOURCE,
    responseSha256: candidate.sourceResponse.sha256,
    responseByteLength: candidate.sourceResponse.byteLength,
    quoteRequestId: candidate.route.requestId,
    identity: {...IDENTITY},
    side: "ENTRY",
    quoteObservedAt: candidate.receiptTime.observedAt,
    observedAt: candidate.receiptTime.observedAt,
    amountUnit: "MICRO_USD",
    routeAmountBasis: "GROSS_BEFORE_ALL_COSTS",
    inclusion: {
      fee: "EXPLICIT_PROTOCOL_AND_PLATFORM_FEE_ONLY",
      spread: "BID_ASK_SPREAD_ONLY",
      slippage: "REALIZED_SHORTFALL_VS_QUOTED_PRICE_ONLY",
      priceImpact: "DEPTH_IMPACT_VS_MID_BENCHMARK_ONLY",
      network: "PAYER_SETTLED_LAMPORTS_ONLY"
    },
    conversions: {
      quote: {mint: SYNTHETIC_QUOTE, decimals: 6, microUsdPerWholeToken: "1000000",
        observedAt: NOW - 500, method: "MEASURED_SOURCE_RECEIPT", evidenceSha256: "b".repeat(64)},
      sol: {mint: SOL, decimals: 9, microUsdPerWholeToken: "150000000",
        observedAt: NOW - 500, method: "MEASURED_SOURCE_RECEIPT", evidenceSha256: "c".repeat(64)}
    },
    network: {lamports: "5000", payerSettled: true},
    microUsd: {fee: "12345", spread: "1", slippage: "10000", priceImpact: "10001", network: "750"}
  };
  mutate(value);
  return value;
}

function verdict(adapter, result, mutate) {
  return adapter.validateCostReceipt(result, receipt(result, mutate));
}

test("raw response digest is computed from the bytes the adapter read", async () => {
  const {result, bytes} = await quoted();
  assert.equal(result.quoteCandidate.sourceResponse.sha256,
    createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.quoteCandidate.sourceResponse.byteLength, bytes.length);
  assert.equal(result.quoteCandidate.costs.status, "UNKNOWN");
});

test("a complete synthetic receipt is structurally valid yet never grants authority", async () => {
  const {adapter, result} = await quoted();
  const accepted = verdict(adapter, result);
  assert.equal(accepted.status, "STRUCTURALLY_VALID_UNAUTHENTICATED");
  assert.deepEqual(accepted.costsCents, {
    feeCents: "2", spreadCents: "1", slippageCents: "1", priceImpactCents: "2", networkCents: "1"
  });
  assert.equal(accepted.totalCents, "7");
  assert.equal(accepted.provenance, "CALLER_ASSERTED_NOT_SOURCE_VERIFIED");
  assert.equal(accepted.authorizationEligible, false);
  assert.equal(accepted.executionRealistic, false);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.quoteCandidate.costs.status, "UNKNOWN");
  assert.equal(result.quoteCandidate.priceMicros, null);
});

const NEGATIVE = [
  ["missing digest", r => { delete r.responseSha256; }, "COST_RECEIPT_FIELD_MISSING"],
  ["forged digest", r => { r.responseSha256 = "d".repeat(64); }, "COST_RESPONSE_DIGEST_MISMATCH"],
  ["malformed digest", r => { r.responseSha256 = "XYZ"; }, "COST_RESPONSE_DIGEST_MISSING_OR_MALFORMED"],
  ["wrong byte length", r => { r.responseByteLength += 1; }, "COST_RESPONSE_DIGEST_MISMATCH"],
  ["wrong request id", r => { r.quoteRequestId = "other"; }, "COST_REQUEST_ID_MISMATCH"],
  ["pool mismatch", r => { r.identity.pool = SYNTHETIC_MINT; }, "COST_IDENTITY_MISMATCH"],
  ["decimals mismatch", r => { r.identity.decimals = 9; }, "COST_IDENTITY_MISMATCH"],
  ["side mismatch", r => { r.side = "EXIT"; }, "COST_SIDE_MISMATCH"],
  ["stale quote time", r => { r.quoteObservedAt -= 1; r.observedAt -= 1; }, "COST_QUOTE_TIME_MISMATCH"],
  ["future cost time", r => { r.observedAt += 1; }, "COST_TIME_NOT_BOUND_TO_QUOTE_RECEIPT"],
  ["wrong source", r => { r.source = "Other"; }, "COST_SOURCE_MISMATCH"],
  ["cents unit", r => { r.amountUnit = "USD_CENTS"; }, "COST_UNIT_UNSUPPORTED"],
  ["decimal USD string", r => { r.microUsd.fee = "0.01"; }, "COST_COMPONENT_NOT_EXACT_MICRO_USD_INTEGER_STRING:fee"],
  ["numeric component", r => { r.microUsd.fee = 5; }, "COST_COMPONENT_NOT_EXACT_MICRO_USD_INTEGER_STRING:fee"],
  ["negative component", r => { r.microUsd.slippage = "-1"; }, "COST_COMPONENT_NOT_EXACT_MICRO_USD_INTEGER_STRING:slippage"],
  ["missing spread", r => { delete r.microUsd.spread; }, "COST_COMPONENT_MISSING:spread"],
  ["extra component", r => { r.microUsd.total = "1"; }, "COST_COMPONENTS_MISSING_OR_UNSUPPORTED"],
  ["net route basis", r => { r.routeAmountBasis = "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS"; }, "COST_ROUTE_BASIS_OVERLAPS_COMPONENTS"],
  ["fee overlaps spread", r => { r.inclusion.spread = "INCLUDES_FEE"; }, "COST_INCLUSION_BASIS_UNSUPPORTED:spread"],
  ["impact includes slippage", r => { r.inclusion.priceImpact = "IMPACT_PLUS_SLIPPAGE"; }, "COST_INCLUSION_BASIS_UNSUPPORTED:priceImpact"],
  ["missing inclusion", r => { delete r.inclusion; }, "COST_RECEIPT_FIELD_MISSING"],
  ["missing conversions", r => { delete r.conversions; }, "COST_RECEIPT_FIELD_MISSING"],
  ["missing sol conversion", r => { delete r.conversions.sol; }, "COST_CONVERSION_MISSING_OR_MALFORMED:sol"],
  ["assumed USD parity", r => { r.conversions.quote.method = "ASSUMED_PARITY"; }, "COST_CONVERSION_NOT_MEASURED_AND_DIGEST_BOUND:quote"],
  ["quote conversion wrong mint", r => { r.conversions.quote.mint = SYNTHETIC_MINT; }, "COST_CONVERSION_IDENTITY_MISMATCH:quote"],
  ["quote conversion wrong decimals", r => { r.conversions.quote.decimals = 9; }, "COST_CONVERSION_IDENTITY_MISMATCH:quote"],
  ["zero conversion price", r => { r.conversions.quote.microUsdPerWholeToken = "0"; }, "COST_CONVERSION_UNITS_INVALID:quote"],
  ["future conversion", r => { r.conversions.sol.observedAt = NOW + 1; }, "COST_CONVERSION_TIME_INVALID_OR_FUTURE:sol"],
  ["stale conversion", r => { r.conversions.quote.observedAt = NOW - 5 * 60_000 - 1; }, "COST_CONVERSION_STALE:quote"],
  ["network not payer settled", r => { r.network.payerSettled = false; }, "COST_NETWORK_NOT_PAYER_SETTLED_LAMPORTS"],
  ["network USD inconsistent", r => { r.microUsd.network = "751"; }, "COST_NETWORK_USD_CONVERSION_INCONSISTENT"],
  ["wrong schema", r => { r.schemaVersion = "v2"; }, "COST_RECEIPT_SCHEMA_UNSUPPORTED"],
  ["unknown field", r => { r.authorizationEligible = true; }, "COST_RECEIPT_MALFORMED_OR_UNSUPPORTED_FIELD"]
];

for (const [name, mutate, reason] of NEGATIVE) {
  test(`cost receipt rejects ${name}`, async () => {
    const {adapter, result} = await quoted();
    const rejected = verdict(adapter, result, mutate);
    assert.equal(rejected.status, "REJECTED");
    assert.ok(rejected.reasons.includes(reason), rejected.reasons.join());
    assert.equal(rejected.costsCents, null);
    assert.equal(rejected.authorizationEligible, false);
  });
}

test("a cost receipt is refused after quote expiry or when the clock regresses", async () => {
  let now = NOW;
  const {adapter, result} = await quoted({clock: () => now});
  now = result.quoteCandidate.route.expiresAt + 1;
  assert.ok(verdict(adapter, result).reasons.includes("COST_QUOTE_EXPIRED"));
  now = NOW - 1;
  assert.ok(verdict(adapter, result).reasons.includes("COST_CLOCK_INVALID"));
});

test("receipts cannot be validated against copied or unrelated quote results", async () => {
  const {adapter, result} = await quoted();
  assert.deepEqual(adapter.validateCostReceipt(structuredClone(result), receipt(result)).reasons,
    ["COST_QUOTE_RESULT_NOT_ISSUED_BY_THIS_ADAPTER"]);
  const other = await quoted();
  assert.ok(other.adapter.validateCostReceipt(result, receipt(result)).reasons
    .includes("COST_QUOTE_RESULT_NOT_ISSUED_BY_THIS_ADAPTER"));
  assert.equal(adapter.validateCostReceipt(null, null).status, "REJECTED");
});

test("quotes with stale causal references cannot carry a valid cost receipt", async () => {
  const {adapter, result} = await quoted({
    req: request({candidateSampledAt: NOW - 10 * 60_000, authorizedAt: NOW - 9 * 60_000})
  });
  assert.ok(result.reasons.includes("CAUSAL_REFERENCE_STALE"));
  const rejected = verdict(adapter, result);
  assert.equal(rejected.status, "REJECTED");
  assert.ok(rejected.reasons.includes("COST_QUOTE_NOT_CAUSAL_AND_IDENTITY_BOUND"));
});

test("a disabled adapter rejects every cost receipt", () => {
  const rejected = createMarketQuoteAdapter().validateCostReceipt({}, {});
  assert.deepEqual(rejected.reasons, ["ADAPTER_DISABLED"]);
});
