import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE
} from "../../../scripts/memecoin-paper/synthetic-fixtures.mjs";

export const SYNTHETIC_PROVIDER_SECRET = "synthetic-provider-secret-not-a-credential";
export const SYNTHETIC_PROVIDER_TIME = Date.parse("2026-10-30T12:00:00.000Z");
export const SYNTHETIC_PROGRAM = SYNTHETIC_POOL;
export const SYNTHETIC_OWNER_A = SYNTHETIC_MINT;
export const SYNTHETIC_OWNER_B = SYNTHETIC_QUOTE;

export function syntheticTransaction({
  signature = "synthetic-signature-1",
  slot = 500_001,
  blockTime = Math.floor(SYNTHETIC_PROVIDER_TIME / 1_000),
  version = 0,
  meta = {err: null}
} = {}) {
  return {signature, slot, blockTime, version, meta, transaction: {signatures: [signature]}};
}

export function syntheticAccount({
  address = SYNTHETIC_POOL,
  owner = SYNTHETIC_OWNER_A,
  amount = "17"
} = {}) {
  return {address, decoded: {owner, amount}};
}

export function syntheticPriceResponse({
  value = 0.00042,
  updateUnixTime = Math.floor(SYNTHETIC_PROVIDER_TIME / 1_000)
} = {}) {
  return {data: {value, updateUnixTime}};
}

export function jsonResponse(value, {
  url = "",
  redirected = false,
  status = 200
} = {}) {
  const response = new Response(JSON.stringify(value), {status});
  return {
    body: response.body,
    headers: response.headers,
    status,
    url,
    redirected
  };
}

export function jsonRpcResponse(request, result, options = {}) {
  const input = JSON.parse(request.body);
  return jsonResponse({
    jsonrpc: "2.0",
    id: input.id,
    result
  }, options);
}
